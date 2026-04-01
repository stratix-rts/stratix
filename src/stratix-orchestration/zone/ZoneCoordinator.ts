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
   * 分解需求为任务（暂用 stub，返回空数组）
   * LLM 集成是下一个任务
   */
  private async decomposeRequirement(requirement: string): Promise<TaskItem[]> {
    // TODO: Integrate with LLM for actual requirement decomposition
    // For now, return empty array as per Phase 2 skeleton
    return [];
  }

  /**
   * 匹配任务给 Agent
   * 支持四种策略：random, capability_match, load_balance, priority
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
    // Same as capability_match: sort by capability+level, then by load
    return this.matchByCapabilityMatch(availableAgents, taskType);
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
   */
  getAvailableAgents(taskType?: TaskType): string[] {
    const available: string[] = [];

    for (const [agentId, caps] of this.agentCapabilities.entries()) {
      // Skip if agent is not a member
      if (!this.members.has(agentId)) continue;

      // If taskType specified, check if agent has this capability
      if (taskType) {
        const cap = caps.get(taskType);
        if (!cap) continue;
        // Skip if load is too high (e.g., > 5)
        if (cap.currentLoad >= 5) continue;
      } else {
        // No taskType specified: check if any capability has room for more work
        let hasCapacity = false;
        for (const c of caps.values()) {
          if (c.currentLoad < 5) {
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
