import { access, readFile } from 'fs/promises';
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
import { createExecutor } from './core/executors';
import { SkillRegistry } from './core/SkillRegistry';
import { SkillTrigger } from './core/SkillTrigger';
import { StorageManager } from './core/StorageManager';
import { TokenManager } from './core/TokenManager';
import { ToolUseLoop } from './core/ToolUseLoop';
import { AgentConfig, SoulConfig, AgentResponse, SkillResult, ChatMessage, GenerateResult, Session, HealthStatus, MetricsData } from './types';

// ============================================
// Constants
// ============================================
const DEFAULT_MAX_SHORT_TERM = 20;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 60;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60000;
const AUTO_SAVE_INTERVAL_MS = 5000;
const DEFAULT_MESSAGE_HISTORY_LIMIT = 10;
const DEFAULT_TOOL_USE_MAX_ITERATIONS = 10;
const DEFAULT_TOOL_USE_MAX_TOTAL_TIME_MS = 120000;
const DEFAULT_MAX_TOOL_CALLS = 20;
const BACKGROUND_SAVE_INTERVAL_MS = 300000; // 5 minutes
const HEALTH_CHECK_INTERVAL_MS = 60000; // 1 minute

// ============================================
// Structured logging helper
// ============================================
function log(level: 'info' | 'warn' | 'error', message: string, ctx?: Record<string, unknown>): void {
  console[level](`[StratixAgent] ${message}`, ctx || '');
}

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
      maxShortTerm: config.maxShortTerm || DEFAULT_MAX_SHORT_TERM,
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
    this.rateLimiter = new RateLimiter({ maxRequests: DEFAULT_RATE_LIMIT_MAX_REQUESTS, windowMs: DEFAULT_RATE_LIMIT_WINDOW_MS });
    this.metricsCollector = new MetricsCollector();
    this.storage = new StorageManager();
    this.autoSaver = new AutoSaver(async () => {
      await this.memory.save();
      await this.sessions.saveSessions(this.config.agentId);
    }, AUTO_SAVE_INTERVAL_MS);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.memory.load();
    await this.sessions.loadSessions(this.config.agentId);
    await this.registerBuiltinSkills();
    this.initialized = true;
  }

  private async registerBuiltinSkills(): Promise<void> {
    // 注册内置技能（file_read, file_write, bash, api_call, calculator）
    for (const skill of BUILTIN_SKILLS) {
      this.skills.registerSkill(skill);
      this.skills.enableSkill(skill.skillId);
    }

    // 从文件加载额外技能（如果有）
    const skillsLibPath = pathJoin(process.cwd(), 'stratix-data', 'skills-lib');
    const indexFile = pathJoin(skillsLibPath, 'index.json');

    try {
      await access(indexFile);
    } catch {
      log('warn', 'Skills library index not found, skipping', { indexFile });
      return;
    }

    try {
      const indexContent = await readFile(indexFile, 'utf-8');
      const index = JSON.parse(indexContent);
      const skillsDir = skillsLibPath;

      for (const skillFile of index.skills || []) {
        const skillPath = pathJoin(skillsDir, skillFile);
        try {
          await access(skillPath);
          const skillContent = await readFile(skillPath, 'utf-8');
          const skillDef = JSON.parse(skillContent);
          this.skills.registerSkill(skillDef);
          this.skills.enableSkill(skillDef.skillId);
        } catch (err) {
          log('warn', 'Failed to load skill from file', { skillPath, error: String(err) });
        }
      }
    } catch (error) {
      log('warn', 'Failed to load builtin skills', { error: String(error) });
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

    const truncatedMessages = this.prepareChatMessages(session.sessionId);

    const { result, skillExecutions } = useToolUse
      ? await this.runToolUseChat(truncatedMessages, session)
      : await this.runTraditionalChat(truncatedMessages, stream, onChunk, session);

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

  private prepareChatMessages(sessionId: string): ChatMessage[] {
    const systemMessages = this.promptBuilder.buildSystemPrompt(
      this.soul,
      this.memory.buildContext(),
      this.skills.getEnabledSkills(),
      []
    );
    const historyMessages = this.sessions.getMessages(sessionId, DEFAULT_MESSAGE_HISTORY_LIMIT);
    return this.tokenManager.truncateMessages([...systemMessages, ...historyMessages], 0);
  }

  private async runToolUseChat(
    messages: ChatMessage[],
    session: Session
  ): Promise<{ result: GenerateResult; skillExecutions: SkillResult[] }> {
    if (!this.toolUseLoop) {
      this.toolUseLoop = new ToolUseLoop(
        this.skills,
        this.llm,
        { maxIterations: DEFAULT_TOOL_USE_MAX_ITERATIONS, maxTotalTime: DEFAULT_TOOL_USE_MAX_TOTAL_TIME_MS }
      );
    }
    const tools = LLMConnector.skillsToTools(this.skills.getEnabledSkills());
    const loopResult = await this.toolUseLoop.execute(messages, tools, {
      agentId: this.config.agentId,
      sessionId: session.sessionId,
      allowedPaths: [process.cwd(), '/tmp'],
      maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
    });

    const skillExecutions: SkillResult[] = loopResult.toolCalls.map(tc => ({
      success: !tc.error,
      skillId: tc.name,
      result: tc.result,
      error: tc.error,
      executionTime: tc.executionTime,
    }));

    const result: GenerateResult = {
      content: loopResult.finalContent,
      usage: undefined,
      finishReason: loopResult.success ? 'stop' : 'error',
    };

    return { result, skillExecutions };
  }

  private async runTraditionalChat(
    messages: ChatMessage[],
    stream: boolean | undefined,
    onChunk: ((chunk: string) => void) | undefined,
    session: Session
  ): Promise<{ result: GenerateResult; skillExecutions: SkillResult[] }> {
    const skillExecutions: SkillResult[] = [];

    const llmResult = stream && onChunk
      ? await this.llm.generateStream(messages, onChunk)
      : await this.llm.generate(messages);

    const skillCalls = this.skillTrigger.parseSkillCalls(
      llmResult.content,
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
        } else {
          skillExecutions.push({
            success: false,
            skillId: 'unknown',
            result: undefined,
            error: execResult.reason instanceof Error ? execResult.reason.message : String(execResult.reason),
            executionTime: 0,
          });
          log('warn', 'Skill execution failed', { reason: String(execResult.reason) });
        }
      }
    }

    const result: GenerateResult = {
      content: llmResult.content,
      usage: llmResult.usage,
      finishReason: 'stop',
    };

    return { result, skillExecutions };
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
        { maxIterations: DEFAULT_TOOL_USE_MAX_ITERATIONS, maxTotalTime: DEFAULT_TOOL_USE_MAX_TOTAL_TIME_MS }
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

  async executeSkill(skillId: string, params: Record<string, unknown>): Promise<SkillResult> {
    return this.skills.execute(skillId, params, {
      agentId: this.config.agentId,
    });
  }

  async updateConfig(updates: Partial<AgentConfig>): Promise<void> {
    // Defensive copy to avoid accidental mutation of external object
    const sanitized = { ...updates };
    Object.assign(this.config, sanitized);
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
    if (this.backgroundTasks.length > 0) {
      log('warn', 'Background tasks already running');
      return;
    }
    const saveTask = setInterval(async () => {
      try {
        await this.memory.save();
        await this.sessions.saveSessions(this.config.agentId);
      } catch (error) {
        log('error', 'Background save failed', { error: String(error) });
      }
    }, BACKGROUND_SAVE_INTERVAL_MS);
    this.backgroundTasks.push(saveTask);

    const healthTask = setInterval(() => {
      try {
        this.healthChecker.check();
      } catch (error) {
        log('error', 'Health check failed', { error: String(error) });
      }
    }, HEALTH_CHECK_INTERVAL_MS);
    this.backgroundTasks.push(healthTask);
  }

  async dispose(): Promise<void> {
    for (const task of this.backgroundTasks) {
      clearInterval(task);
    }
    this.backgroundTasks = [];

    this.autoSaver.dispose();
    this.toolUseLoop = null;
    this.toolUseEnabled = false;

    await this.memory.save();
    await this.sessions.saveSessions(this.config.agentId);

    this.initialized = false;
  }

  getHealthStatus(): HealthStatus {
    return this.healthChecker.getStatus();
  }

  getMetrics(): MetricsData {
    return this.metricsCollector.getMetrics();
  }
}
