import {
  zoneRepository,
  zoneMemberRepository,
  zoneCoordinatorConfigRepository,
  agentCapabilityRepository,
  taskFlowRepository,
  auditLogRepository,
  type ZoneMember,
  type ZoneCoordinatorConfig,
  type AgentCapability,
  type Capability,
  type AssignStrategy,
  type TaskFlowAction,
  type AuditEventType,
} from '../../stratix-database';

// ============================================
// Task Types
// ============================================

export type TaskType = 'coding' | 'writing' | 'analysis' | 'research' | 'general';
export type TaskStatus = 'pending' | 'delegated' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
export type TaskPriority = 1 | 2 | 3 | 4 | 5;

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  type: TaskType;
  priority: TaskPriority;
  assigneeId?: string;
  status: TaskStatus;
  zoneId: string;
}

// ============================================
// Process Result
// ============================================

export interface ProcessResult {
  success: boolean;
  tasks: TaskItem[];
  delegated: string[];
  pending: string[];
  requiresUserConfirm: string[];
  error?: string;
}

// ============================================
// Delegate Result
// ============================================

export interface DelegateResult {
  success: boolean;
  taskId: string;
  agentId: string;
  flowId?: string;
  error?: string;
}

// ============================================
// Zone Status Summary
// ============================================

export interface ZoneStatusSummary {
  zoneId: string;
  memberCount: number;
  activeTaskCount: number;
  completedTaskCount: number;
  pendingTaskCount: number;
  recentActivity: Array<{
    id: string;
    eventType: AuditEventType;
    actorId: string | null;
    targetId: string | null;
    createdAt: number;
  }>;
}

// ============================================
// Task Complete Params (from Agent)
// ============================================

export interface TaskCompleteParams {
  taskId: string;
  success: boolean;
  output?: string;
  files?: string[];
  summary?: string;
  issues?: string[];
  duration?: number;
}

// ============================================
// ZoneCoordinator - Zone 的协调者大脑
// ============================================

export class ZoneCoordinator {
  readonly zoneId: string;
  readonly title: string;
  readonly prompt: string;

  private config: ZoneCoordinatorConfig;
  private members: Map<string, ZoneMember> = new Map();
  private agentCapabilities: Map<string, Map<string, AgentCapability>> = new Map();
  private pendingTasks: TaskItem[] = [];
  private activeTasks: Map<string, TaskItem> = new Map();
  private lastAssignedIndex: number = -1;

  constructor(zoneId: string, config?: Partial<ZoneCoordinatorConfig>) {
    this.zoneId = zoneId;

    // Load zone info from ZoneRepository
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone ${zoneId} not found`);
    }
    this.title = zone.title;
    this.prompt = zone.prompt;

    // Load or create coordinator config
    const existingConfig = zoneCoordinatorConfigRepository.getConfig(zoneId);
    if (existingConfig) {
      this.config = existingConfig;
    } else if (config) {
      // Create default config with provided overrides
      this.config = {
        llmProvider: config.llmProvider ?? 'openai',
        model: config.model ?? null,
        autoDecompose: config.autoDecompose ?? true,
        autoAssign: config.autoAssign ?? true,
        requireUserConfirm: config.requireUserConfirm ?? false,
        assignStrategy: config.assignStrategy ?? 'capability_match',
        entryCondition: config.entryCondition ?? null,
      };
      zoneCoordinatorConfigRepository.setConfig(zoneId, this.config);
    } else {
      // Create default config
      this.config = {
        llmProvider: 'openai',
        model: null,
        autoDecompose: true,
        autoAssign: true,
        requireUserConfirm: false,
        assignStrategy: 'capability_match',
        entryCondition: null,
      };
      zoneCoordinatorConfigRepository.setConfig(zoneId, this.config);
    }

    // Load members and capabilities
    this.loadMembers();
    this.loadCapabilities();
  }

  // ==================== 核心方法 ====================

  /**
   * 处理输入需求
   * @param requirement 用户或上游 Zone 输入的需求描述
   */
  async processRequirement(requirement: string): Promise<ProcessResult> {
    try {
      // 1. 调用 decomposeRequirement 获取任务列表（stub）
      const tasks = await this.decomposeRequirement(requirement);

      if (tasks.length === 0) {
        return {
          success: true,
          tasks: [],
          delegated: [],
          pending: [],
          requiresUserConfirm: [],
        };
      }

      // Store pending tasks
      this.pendingTasks.push(...tasks);

      const delegated: string[] = [];
      const pending: string[] = [];
      const requiresUserConfirm: string[] = [];

      // 2. 对每个任务调用 matchTaskToAgent 匹配 Agent
      for (const task of tasks) {
        const agentId = await this.matchTaskToAgent(task);

        if (!agentId) {
          pending.push(task.id);
          continue;
        }

        // Check if user confirmation is required
        if (this.config.requireUserConfirm) {
          requiresUserConfirm.push(task.id);
          continue;
        }

        // 3. 调用 delegateTask 分派任务
        const result = await this.delegateTask(task.id, agentId);
        if (result.success) {
          delegated.push(task.id);
        } else {
          pending.push(task.id);
        }
      }

      // 4. 记录 audit_log（task_created）
      for (const task of tasks) {
        auditLogRepository.log(
          this.zoneId,
          'task_created',
          undefined,
          task.id,
          { taskType: task.type, priority: task.priority, title: task.title }
        );
      }

      return {
        success: true,
        tasks,
        delegated,
        pending,
        requiresUserConfirm,
      };
    } catch (error) {
      return {
        success: false,
        tasks: [],
        delegated: [],
        pending: [],
        requiresUserConfirm: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 分解需求为任务（使用 LLM）
   */
  private async decomposeRequirement(requirement: string): Promise<TaskItem[]> {
    try {
      const systemPrompt = this.buildSystemPrompt();
      const llmResponse = await this.callLLM(systemPrompt, requirement);
      return this.parseTaskItems(llmResponse);
    } catch (error) {
      console.warn(`[ZoneCoordinator] LLM decomposition failed, using fallback: ${error}`);
      // Fallback: return a single general task
      return [{
        id: this.generateId(),
        title: requirement.slice(0, 100),
        description: requirement,
        type: 'general',
        priority: 3,
        status: 'pending',
        zoneId: this.zoneId,
      }];
    }
  }

  /**
   * 调用 LLM（OpenAI-compatible API）
   */
  private async callLLM(systemPrompt: string, userMessage: string): Promise<string> {
    const { url, apiKey, model } = this.getLLMConfig();

    const body: Record<string, unknown> = {
      model: model || 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.7,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('LLM returned empty response');
    }

    return content;
  }

  /**
   * 获取 LLM 配置
   */
  private getLLMConfig(): { url: string; apiKey: string | null; model: string | null } {
    const provider = this.config.llmProvider || 'openai';
    const model = this.config.model;

    switch (provider) {
      case 'openai':
        return {
          url: 'https://api.openai.com/v1/chat/completions',
          apiKey: process.env.OPENAI_API_KEY || null,
          model,
        };
      case 'anthropic':
        return {
          url: 'https://api.anthropic.com/v1/messages',
          apiKey: process.env.ANTHROPIC_API_KEY || null,
          model: model || 'claude-sonnet-4-20250514',
        };
      case 'deepseek':
        return {
          url: 'https://api.deepseek.com/v1/chat/completions',
          apiKey: process.env.DEEPSEEK_API_KEY || null,
          model: model || 'deepseek-chat',
        };
      case 'ollama':
        return {
          url: 'http://localhost:11434/api/chat',
          apiKey: null,
          model: model || 'llama3',
        };
      default:
        return {
          url: 'https://api.openai.com/v1/chat/completions',
          apiKey: process.env.OPENAI_API_KEY || null,
          model,
        };
    }
  }

  /**
   * 解析 LLM 返回的 JSON 任务列表
   */
  private parseTaskItems(llmResponse: string): TaskItem[] {
    // Try to extract JSON from markdown code block or raw JSON
    let jsonStr = llmResponse.trim();

    // Remove markdown code block wrapper
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    // Try to find JSON array in the response
    const arrayMatch = jsonStr.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (arrayMatch) {
      jsonStr = arrayMatch[0];
    }

    try {
      const tasks = JSON.parse(jsonStr) as Array<{
        title?: string;
        name?: string;
        description?: string;
        desc?: string;
        type?: string;
        taskType?: string;
        priority?: number;
      }>;

      if (!Array.isArray(tasks)) {
        throw new Error('LLM response is not an array');
      }

      return tasks
        .filter(t => t.title || t.name)
        .map(t => ({
          id: this.generateId(),
          title: t.title || t.name || 'Untitled Task',
          description: t.description || t.desc || '',
          type: this.normalizeTaskType(t.type || t.taskType),
          priority: this.normalizePriority(t.priority),
          status: 'pending' as TaskStatus,
          zoneId: this.zoneId,
        }));
    } catch (error) {
      console.warn('[ZoneCoordinator] Failed to parse task items:', error);
      return [];
    }
  }

  /**
   * 标准化任务类型
   */
  private normalizeTaskType(type?: string): TaskType {
    if (!type) return 'general';
    const lower = type.toLowerCase();
    if (lower.includes('code') || lower.includes('dev')) return 'coding';
    if (lower.includes('write') || lower.includes('doc')) return 'writing';
    if (lower.includes('analy')) return 'analysis';
    if (lower.includes('research') || lower.includes('search')) return 'research';
    return 'general';
  }

  /**
   * 标准化优先级
   */
  private normalizePriority(priority?: number): TaskPriority {
    if (!priority || priority < 1 || priority > 5) return 3;
    return priority as TaskPriority;
  }

  /**
   * 构建系统提示词
   */
  private buildSystemPrompt(): string {
    const memberList = this.buildMemberList();
    const capabilityList = this.buildCapabilityList();
    const assignStrategyDescription = this.buildAssignStrategyDescription();

    return `你是 ${this.title} 的协调者。

## Zone 身份
${this.title} 是一个${this.prompt || '协作空间'}。

## Zone 目标 (Key Results)
${this.prompt || '暂无明确目标'}

## 当前成员
${memberList}

## 成员能力
${capabilityList}

## 你的职责
1. 接收并理解需求
2. 将需求分解为可执行的任务
3. 根据成员能力分配任务
4. 监控任务进度
5. 汇总结果并反馈

## 任务类型定义
- coding: 代码编写、重构、调试
- writing: 文案、文档、报告
- analysis: 数据分析、需求分析
- research: 信息检索、调研
- general: 其他通用任务

## 分派规则
${assignStrategyDescription}

## 输出格式要求
你必须输出一 JSON 数组，每个元素包含：
- title: 任务名称（必填）
- description: 任务描述（选填）
- type: 任务类型，可选值：coding, writing, analysis, research, general（选填，默认为 general）
- priority: 优先级 1-5，1 最高，5 最低（选填，默认为 3）

示例：
[
  {"title": "需求分析", "description": "分析用户需求并输出文档", "type": "analysis", "priority": 1},
  {"title": "代码实现", "description": "实现核心功能模块", "type": "coding", "priority": 2}
]`;
  }

  /**
   * 构建成员列表字符串
   */
  private buildMemberList(): string {
    if (this.members.size === 0) {
      return '（暂无成员）';
    }

    const lines: string[] = [];
    for (const [agentId, member] of this.members) {
      lines.push(`- ${member.agentId} (角色: ${member.role})`);
    }
    return lines.join('\n');
  }

  /**
   * 构建能力列表字符串
   */
  private buildCapabilityList(): string {
    if (this.agentCapabilities.size === 0) {
      return '（暂无能力数据）';
    }

    const lines: string[] = [];
    for (const [agentId, caps] of this.agentCapabilities) {
      const capList: string[] = [];
      for (const [capName, cap] of caps) {
        capList.push(`${capName}(等级: ${cap.level}, 当前负载: ${cap.currentLoad})`);
      }
      lines.push(`- ${agentId}: ${capList.join(', ') || '无能力数据'}`);
    }
    return lines.join('\n');
  }

  /**
   * 构建分派策略描述
   */
  private buildAssignStrategyDescription(): string {
    switch (this.config.assignStrategy) {
      case 'random':
        return '随机选择可用 Agent';
      case 'capability_match':
        return '优先选择该任务类型能力最强的 Agent，其次考虑当前负载';
      case 'load_balance':
        return '优先选择当前负载最低的 Agent';
      case 'priority':
        return '高优先级任务分配给能力最强的 Agent，低优先级任务分配给能力较弱但可用的 Agent';
      case 'round_robin':
        return '轮询分配任务给所有可用 Agent';
      default:
        return '默认能力匹配策略';
    }
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * 匹配任务给 Agent
   * 支持五种策略：random, capability_match, load_balance, priority, round_robin
   */
  private async matchTaskToAgent(task: TaskItem): Promise<string | null> {
    const availableAgents = this.getAvailableAgents(task.type);

    if (availableAgents.length === 0) {
      return null;
    }

    const strategy = this.config.assignStrategy;

    switch (strategy) {
      case 'random':
        return this.matchByRandom(availableAgents);

      case 'capability_match':
        return this.matchByCapabilityMatch(availableAgents, task.type);

      case 'load_balance':
        return this.matchByLoadBalance(availableAgents);

      case 'priority':
        return this.matchByPriority(availableAgents, task.type);

      case 'round_robin':
        return this.matchByRoundRobin(availableAgents);

      default:
        return this.matchByCapabilityMatch(availableAgents, task.type);
    }
  }

  private matchByRandom(availableAgents: string[]): string {
    const index = Math.floor(Math.random() * availableAgents.length);
    return availableAgents[index];
  }

  private matchByCapabilityMatch(availableAgents: string[], taskType: TaskType): string {
    // Sort by capability level (highest first), then by load (lowest first)
    const sorted = [...availableAgents].sort((a, b) => {
      const capA = this.getAgentCapabilityLevel(a, taskType);
      const capB = this.getAgentCapabilityLevel(b, taskType);
      if (capB !== capA) return capB - capA;
      const loadA = this.getAgentLoad(a);
      const loadB = this.getAgentLoad(b);
      return loadA - loadB;
    });
    return sorted[0];
  }

  private matchByLoadBalance(availableAgents: string[]): string {
    // Sort by current load (lowest first)
    const sorted = [...availableAgents].sort((a, b) => {
      return this.getAgentLoad(a) - this.getAgentLoad(b);
    });
    return sorted[0];
  }

  private matchByPriority(availableAgents: string[], taskType: TaskType): string {
    // High priority (1) -> strongest agent; Low priority (5) -> weaker but available agent
    // This preserves strong agents for high-priority tasks
    const sorted = [...availableAgents].sort((a, b) => {
      const capA = this.getAgentCapabilityLevel(a, taskType);
      const capB = this.getAgentCapabilityLevel(b, taskType);
      const loadA = this.getAgentLoad(a);
      const loadB = this.getAgentLoad(b);

      // For agents with same capability level, prefer lower load
      if (capA === capB) {
        return loadA - loadB;
      }
      // Capability difference outweighs load difference
      return capB - capA;
    });
    return sorted[0];
  }

  private matchByRoundRobin(availableAgents: string[]): string {
    if (availableAgents.length === 0) return '';
    this.lastAssignedIndex = (this.lastAssignedIndex + 1) % availableAgents.length;
    return availableAgents[this.lastAssignedIndex];
  }

  private getAgentLoad(agentId: string): number {
    const caps = this.agentCapabilities.get(agentId);
    if (!caps) return 0;
    // Return sum of all capability loads for this agent
    let totalLoad = 0;
    for (const cap of caps.values()) {
      totalLoad += cap.currentLoad;
    }
    return totalLoad;
  }

  /**
   * 分派任务
   * a. 创建 task_flow 记录（delegated）
   * b. 创建 audit_log（task_assigned）
   * c. 更新 AgentCapability 的 load（incrementLoad）
   */
  async delegateTask(taskId: string, toAgentId: string): Promise<DelegateResult> {
    try {
      const task = this.pendingTasks.find(t => t.id === taskId) ||
        this.activeTasks.get(taskId);

      if (!task) {
        return { success: false, taskId, agentId: toAgentId, error: 'Task not found' };
      }

      // a. Create task_flow record (delegated)
      const flowRecord = taskFlowRepository.addFlow(
        taskId,
        this.zoneId,
        null, // fromAgentId: null means Zone created
        toAgentId,
        'delegated',
        { reason: `Delegated via ${this.config.assignStrategy} strategy` }
      );

      // b. Create audit_log (task_assigned)
      auditLogRepository.log(
        this.zoneId,
        'task_assigned',
        undefined, // actor is Zone Coordinator
        toAgentId,
        { taskId, taskTitle: task.title }
      );

      // c. Update AgentCapability load (incrementLoad)
      agentCapabilityRepository.incrementLoad(toAgentId, this.zoneId);

      // Update task status
      task.status = 'delegated';
      task.assigneeId = toAgentId;
      this.pendingTasks = this.pendingTasks.filter(t => t.id !== taskId);
      this.activeTasks.set(taskId, task);

      return {
        success: true,
        taskId,
        agentId: toAgentId,
        flowId: flowRecord.flowId,
      };
    } catch (error) {
      return {
        success: false,
        taskId,
        agentId: toAgentId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 接收任务完成报告
   * a. 记录 task_flow（completed/failed）
   * b. 记录 audit_log
   * c. 更新 AgentCapability 的 load（decrementLoad）
   * d. 检查是否所有任务完成
   */
  async receiveTaskReport(report: TaskCompleteParams): Promise<void> {
    const task = this.activeTasks.get(report.taskId);

    if (!task) {
      console.warn(`[ZoneCoordinator] Received report for unknown task: ${report.taskId}`);
      return;
    }

    // a. Record task_flow (completed/failed)
    const action: TaskFlowAction = report.success ? 'completed' : 'failed';
    taskFlowRepository.addFlow(
      report.taskId,
      this.zoneId,
      task.assigneeId!,
      task.assigneeId!,
      action,
      {
        output: report.output,
        files: report.files,
        issues: report.issues,
        duration: report.duration,
      }
    );

    // b. Record audit_log
    auditLogRepository.log(
      this.zoneId,
      report.success ? 'task_completed' : 'task_failed',
      task.assigneeId!,
      report.taskId,
      {
        success: report.success,
        output: report.output,
        files: report.files,
        summary: report.summary,
        issues: report.issues,
        duration: report.duration,
      }
    );

    // c. Update AgentCapability load (decrementLoad)
    if (task.assigneeId) {
      agentCapabilityRepository.decrementLoad(task.assigneeId, this.zoneId);
    }

    // d. Update task status
    task.status = report.success ? 'completed' : 'failed';
    this.activeTasks.delete(report.taskId);
  }

  /**
   * 获取 Zone 状态摘要
   */
  getStatusSummary(): ZoneStatusSummary {
    const recentActivity = auditLogRepository.getRecentEvents(this.zoneId, 10);

    let completedCount = 0;
    let activeCount = 0;
    let pendingCount = this.pendingTasks.length;

    for (const task of this.activeTasks.values()) {
      if (task.status === 'completed') completedCount++;
      else if (task.status === 'in_progress' || task.status === 'delegated') activeCount++;
    }

    return {
      zoneId: this.zoneId,
      memberCount: this.members.size,
      activeTaskCount: activeCount,
      completedTaskCount: completedCount,
      pendingTaskCount: pendingCount,
      recentActivity: recentActivity.map(e => ({
        id: e.id,
        eventType: e.eventType,
        actorId: e.actorId,
        targetId: e.targetId,
        createdAt: e.createdAt,
      })),
    };
  }

  // ==================== 能力管理 ====================

  /**
   * 更新 Agent 能力
   */
  updateAgentCapability(agentId: string, capabilities: Array<{ capability: Capability; level: number }>): void {
    for (const cap of capabilities) {
      agentCapabilityRepository.setCapability(agentId, this.zoneId, cap.capability, cap.level);
    }
    // Reload capabilities
    this.loadCapabilities();
  }

  /**
   * 获取可用 Agent
   * @param taskType 可选，按任务类型筛选有对应能力的 Agent
   * @param maxLoad 最大负载阈值，默认 5
   */
  getAvailableAgents(taskType?: TaskType, maxLoad: number = 5): string[] {
    const available: string[] = [];

    for (const [agentId, caps] of this.agentCapabilities.entries()) {
      // Skip if agent is not a member
      if (!this.members.has(agentId)) continue;

      // If taskType specified, check if agent has this capability
      if (taskType) {
        const cap = caps.get(taskType);
        if (!cap) continue;
        // Skip if load >= maxLoad
        if (cap.currentLoad >= maxLoad) continue;
      } else {
        // No taskType specified: check if any capability has room for more work
        let hasCapacity = false;
        for (const c of caps.values()) {
          if (c.currentLoad < maxLoad) {
            hasCapacity = true;
            break;
          }
        }
        if (!hasCapacity) continue;
      }

      available.push(agentId);
    }

    return available;
  }

  /**
   * 获取 Agent 能力等级
   */
  getAgentCapabilityLevel(agentId: string, taskType: TaskType): number {
    const caps = this.agentCapabilities.get(agentId);
    if (!caps) return 0;
    const cap = caps.get(taskType);
    return cap?.level ?? 0;
  }

  // ==================== Private Helpers ====================

  private loadMembers(): void {
    const members = zoneMemberRepository.getMembers(this.zoneId);
    this.members.clear();
    for (const member of members) {
      this.members.set(member.agentId, member);
    }
  }

  private loadCapabilities(): void {
    this.agentCapabilities.clear();

    for (const [agentId] of this.members) {
      const caps = agentCapabilityRepository.getCapabilities(agentId, this.zoneId);
      const capMap = new Map<string, AgentCapability>();
      for (const cap of caps) {
        capMap.set(cap.capability, cap);
      }
      this.agentCapabilities.set(agentId, capMap);
    }
  }
}

export default ZoneCoordinator;
