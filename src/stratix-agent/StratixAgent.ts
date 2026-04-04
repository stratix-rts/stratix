import { readFileSync, existsSync } from 'fs';
import { join as pathJoin } from 'path';

import { AutoSaver } from './core/AutoSaver';
import { BUILTIN_SKILLS } from './core/BuiltinSkills';
import { HealthChecker } from './core/HealthChecker';
import { LLMConnector } from './core/LLMConnector';
import { MemoryManager } from './core/MemoryManager';
import { MetricsCollector } from './core/MetricsCollector';
import { PromptBuilder } from './core/PromptBuilder';
import { RateLimiter } from './core/RateLimiter';
import { SessionManager } from './core/SessionManager';
import { createExecutor } from './core/SkillExecutors';
import { SkillRegistry } from './core/SkillRegistry';
import { SkillTrigger } from './core/SkillTrigger';
import { StorageManager } from './core/StorageManager';
import { TokenManager } from './core/TokenManager';
import { ToolUseLoop } from './core/ToolUseLoop';
import { AgentConfig, SoulConfig, AgentResponse, SkillResult } from './types';

export class StratixAgent {
  public config: AgentConfig;
  public soul: SoulConfig;
  public memory: MemoryManager;
  public skills: SkillRegistry;
  public sessions: SessionManager;

  protected llm: LLMConnector;
  protected promptBuilder: PromptBuilder;
  protected tokenManager: TokenManager;
  protected skillTrigger: SkillTrigger;
  protected healthChecker: HealthChecker;
  protected rateLimiter: RateLimiter;
  protected metricsCollector: MetricsCollector;
  protected storage: StorageManager;
  protected autoSaver: AutoSaver;
  protected backgroundTasks: NodeJS.Timeout[] = [];
  protected initialized: boolean = false;
  protected toolUseLoop: ToolUseLoop | null = null;
  protected toolUseEnabled: boolean = false;

  constructor(config: AgentConfig, soul: SoulConfig) {
    this.config = config;
    this.soul = soul;

    this.llm = new LLMConnector({
      provider: config.provider,
      model: config.model,
      apiKey: config.apiKey,
      baseUrl: config.endpoint,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    });

    this.memory = new MemoryManager({
      maxShortTerm: config.maxShortTerm || 20,
      storagePath: pathJoin(process.cwd(), 'stratix-data', 'agents', config.agentId, 'memory'),
    });

    this.skills = new SkillRegistry();
    this.skills.registerExecutor('http', createExecutor('http'));
    this.skills.registerExecutor('builtin', createExecutor('builtin'));
    this.skills.registerExecutor('fs', createExecutor('fs'));
    this.skills.registerExecutor('bash', createExecutor('bash'));
    this.skills.registerExecutor('zone', createExecutor('zone'));
    this.sessions = new SessionManager({
      storagePath: pathJoin(process.cwd(), 'stratix-data', 'agents', config.agentId, 'sessions'),
    });

    this.promptBuilder = new PromptBuilder();
    this.tokenManager = new TokenManager(config.model);
    this.skillTrigger = new SkillTrigger();
    this.healthChecker = new HealthChecker();
    this.rateLimiter = new RateLimiter({ maxRequests: 60, windowMs: 60000 });
    this.metricsCollector = new MetricsCollector();
    this.storage = new StorageManager();
    this.autoSaver = new AutoSaver(async () => {
      await this.memory.save();
      await this.sessions.saveSessions(this.config.agentId);
    }, 5000);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.memory.load();
    await this.sessions.loadSessions(this.config.agentId);
    this.registerBuiltinSkills();
    this.initialized = true;
  }

  private registerBuiltinSkills(): void {
    // 注册内置技能（file_read, file_write, bash, api_call, calculator）
    for (const skill of BUILTIN_SKILLS) {
      this.skills.registerSkill(skill);
      this.skills.enableSkill(skill.skillId);
    }

    // 从文件加载额外技能（如果有）
    const skillsLibPath = pathJoin(process.cwd(), 'stratix-data', 'skills-lib');
    const indexFile = pathJoin(skillsLibPath, 'index.json');

    if (!existsSync(indexFile)) {
      return;
    }

    try {
      const index = JSON.parse(readFileSync(indexFile, 'utf-8'));
      const skillsDir = skillsLibPath;

      for (const skillFile of index.skills || []) {
        const skillPath = pathJoin(skillsDir, skillFile);
        if (existsSync(skillPath)) {
          const skillDef = JSON.parse(readFileSync(skillPath, 'utf-8'));
          this.skills.registerSkill(skillDef);
          this.skills.enableSkill(skillDef.skillId);
        }
      }
    } catch (error) {
      console.warn('Failed to load builtin skills:', error);
    }
  }

  async chat(
    message: string,
    options?: {
      sessionId?: string;
      stream?: boolean;
      onChunk?: (chunk: string) => void;
      useToolUse?: boolean;  // 启用原生 Tool Use 模式
    }
  ): Promise<AgentResponse> {
    const { sessionId, stream, onChunk, useToolUse = false } = options || {};

    if (!this.rateLimiter.check(this.config.agentId)) {
      throw new Error('Rate limit exceeded');
    }

    const startTime = Date.now();
    const session = this.sessions.getOrCreateSession(this.config.agentId, sessionId);

    this.sessions.addMessage(session.sessionId, { role: 'user', content: message });
    this.memory.addMessage('user', message);

    const systemMessages = this.promptBuilder.buildSystemPrompt(
      this.soul,
      this.memory.buildContext(),
      this.skills.getEnabledSkills(),
      []
    );

    const historyMessages = this.sessions.getMessages(session.sessionId, 10);
    const truncatedMessages = this.tokenManager.truncateMessages(
      [...systemMessages, ...historyMessages],
      0
    );

    let result;
    const skillExecutions: SkillResult[] = [];

    // Tool Use 模式：使用结构化工具调用
    if (useToolUse) {
      // 如果没有初始化 ToolUseLoop，自动创建
      if (!this.toolUseLoop) {
        this.toolUseLoop = new ToolUseLoop(
          this.skills,
          this.llm,
          { maxIterations: 10, maxTotalTime: 120000 }
        );
      }
      const tools = LLMConnector.skillsToTools(this.skills.getEnabledSkills());
      const loopResult = await this.toolUseLoop.execute(
        truncatedMessages,
        tools,
        {
          agentId: this.config.agentId,
          sessionId: session.sessionId,
          allowedPaths: [process.cwd(), '/tmp'],
          maxToolCalls: 20
        }
      );

      // 将 tool calls 转换为 skill executions
      for (const tc of loopResult.toolCalls) {
        skillExecutions.push({
          success: !tc.error,
          skillId: tc.name,
          result: tc.result,
          error: tc.error,
          executionTime: tc.executionTime
        });
      }

      result = {
        content: loopResult.finalContent,
        usage: undefined,
        finishReason: loopResult.success ? 'stop' as const : 'error' as const
      };
    } else {
      // 传统模式：文本解析
      if (stream && onChunk) {
        result = await this.llm.generateStream(truncatedMessages, onChunk);
      } else {
        result = await this.llm.generate(truncatedMessages);
      }

      // 解析并执行文本中的 skill calls（并行执行）
      const skillCalls = this.skillTrigger.parseSkillCalls(
        result.content,
        this.skills.getEnabledSkills()
      );

      if (skillCalls.length > 0) {
        const executionResults = await Promise.allSettled(
          skillCalls.map(call =>
            this.skills.execute(call.skillId, call.params, {
              agentId: this.config.agentId,
              sessionId: session.sessionId,
            })
          )
        );

        for (const execResult of executionResults) {
          if (execResult.status === 'fulfilled') {
            skillExecutions.push(execResult.value);
          }
        }
      }
    }

    const latency = Date.now() - startTime;
    this.metricsCollector.recordRequest(latency, result.usage?.totalTokens || 0, true);

    this.sessions.addMessage(session.sessionId, { role: 'assistant', content: result.content });
    this.memory.addMessage('assistant', result.content);

    return {
      sessionId: session.sessionId,
      response: result.content,
      skillExecutions: skillExecutions.length > 0 ? skillExecutions : undefined,
      usage: result.usage,
    };
  }

  /**
   * 启用/禁用原生 Tool Use 模式
   * @param enabled 是否启用
   */
  enableToolUse(enabled: boolean): void {
    this.toolUseEnabled = enabled;
    if (enabled && !this.toolUseLoop) {
      this.toolUseLoop = new ToolUseLoop(
        this.skills,
        this.llm,
        { maxIterations: 10, maxTotalTime: 120000 }
      );
    } else if (!enabled) {
      this.toolUseLoop = null;
    }
  }

  /**
   * 检查是否启用了 Tool Use
   */
  isToolUseEnabled(): boolean {
    return this.toolUseEnabled;
  }

  async executeSkill(skillId: string, params: Record<string, any>): Promise<SkillResult> {
    return this.skills.execute(skillId, params, {
      agentId: this.config.agentId,
    });
  }

  async updateConfig(updates: Partial<AgentConfig>): Promise<void> {
    Object.assign(this.config, updates);
    this.config.updatedAt = new Date().toISOString();
    await this.storage.saveConfig(this.config);
    this.autoSaver.trigger();
  }

  async updateSoul(updates: Partial<SoulConfig>): Promise<void> {
    Object.assign(this.soul, updates);
    await this.storage.saveSoul(this.config.agentId, this.soul);
    this.autoSaver.trigger();
  }

  async addLongTermMemory(content: string, importance: 1 | 2 | 3 = 2): Promise<void> {
    this.memory.addLongTermMemory({
      title: content.slice(0, 30),
      content,
      importance,
    });
  }

  async searchMemory(query: string): Promise<{ content: string }[]> {
    const results = this.memory.searchLongTerm(query);
    return results.map(r => ({ content: r.content }));
  }

  startBackgroundTasks(): void {
    const saveTask = setInterval(async () => {
      try {
        await this.memory.save();
        await this.sessions.saveSessions(this.config.agentId);
      } catch (error) {
        console.error('Background save failed:', error);
      }
    }, 5 * 60 * 1000);
    this.backgroundTasks.push(saveTask);

    const healthTask = setInterval(() => {
      this.healthChecker.check();
    }, 60 * 1000);
    this.backgroundTasks.push(healthTask);
  }

  async dispose(): Promise<void> {
    for (const task of this.backgroundTasks) {
      clearInterval(task);
    }
    this.backgroundTasks = [];

    this.autoSaver.dispose();

    await this.memory.save();
    await this.sessions.saveSessions(this.config.agentId);

    this.initialized = false;
  }

  getHealthStatus() {
    return this.healthChecker.getStatus();
  }

  getMetrics() {
    return this.metricsCollector.getMetrics();
  }
}
