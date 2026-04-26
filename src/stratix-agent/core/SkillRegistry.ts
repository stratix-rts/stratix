import { SkillDefinition, SkillExecutor, SkillResult, ExecutionContext } from '../types';

/**
 * LRU Cache entry with insertion order tracking for reliable eviction
 */
interface LRUCacheEntry {
  result: SkillResult;
  timestamp: number;
  insertedAt: number; // Track insertion order for reliable LRU eviction
}

/**
 * 技能执行进度回调（新版本）
 */
export type SkillExecutionCallback = (skillId: string, stage: 'started' | 'validating' | 'executing' | 'completed' | 'error', data?: any) => void;

export class SkillRegistry {
  private availableSkills: Map<string, SkillDefinition> = new Map();
  private enabledSkills: Set<string> = new Set();
  private executors: Map<string, SkillExecutor> = new Map();
  private cache: Map<string, LRUCacheEntry> = new Map();
  private cacheInsertionCounter = 0; // Monotonic counter for reliable insertion order

  // 缓存配置
  private cacheEnabled = true;
  private cacheTTL = 5 * 60 * 1000; // 5 分钟缓存
  private cacheMaxEntries = 1000;

  // 执行超时配置
  private defaultTimeout = 30000; // 默认 30 秒
  private maxTimeout = 120000; // 最大 120 秒

  // 进度回调
  private progressCallback: SkillExecutionCallback | null = null;

  /**
   * 注册进度回调
   */
  onProgress(callback: SkillExecutionCallback | null): void {
    this.progressCallback = callback;
  }

  /**
   * 触发进度回调
   */
  private notifyProgress(skillId: string, stage: 'started' | 'validating' | 'executing' | 'completed' | 'error', data?: any): void {
    if (this.progressCallback) {
      try {
        this.progressCallback(skillId, stage, data);
      } catch (error) {
        console.error('[SkillRegistry] Progress callback error:', error);
      }
    }
  }

  /**
   * 设置默认超时时间
   */
  setDefaultTimeout(timeout: number): void {
    this.defaultTimeout = Math.min(timeout, this.maxTimeout);
  }

  /**
   * 获取默认超时时间
   */
  getDefaultTimeout(): number {
    return this.defaultTimeout;
  }

  registerSkill(skill: SkillDefinition): void {
    this.availableSkills.set(skill.skillId, skill);
  }

  registerSkills(skills: SkillDefinition[]): void {
    skills.forEach(s => this.registerSkill(s));
  }

  enableSkill(skillId: string): boolean {
    if (this.availableSkills.has(skillId)) {
      this.enabledSkills.add(skillId);
      return true;
    }
    return false;
  }

  disableSkill(skillId: string): void {
    this.enabledSkills.delete(skillId);
  }

  getEnabledSkills(): SkillDefinition[] {
    return Array.from(this.enabledSkills)
      .map(id => this.availableSkills.get(id)!)
      .filter(Boolean);
  }

  registerExecutor(name: string, executor: SkillExecutor): void {
    this.executors.set(name, executor);
  }

  getSkill(skillId: string): SkillDefinition | undefined {
    return this.availableSkills.get(skillId);
  }

  hasSkill(skillId: string): boolean {
    return this.availableSkills.has(skillId);
  }

  isEnabled(skillId: string): boolean {
    return this.enabledSkills.has(skillId);
  }

  listAllSkills(): SkillDefinition[] {
    return Array.from(this.availableSkills.values());
  }

  listSkillsByCategory(category: string): SkillDefinition[] {
    return Array.from(this.availableSkills.values())
      .filter(skill => skill.parameters.some(p => p.name === 'category' && p.default === category));
  }

  searchSkills(query: string): SkillDefinition[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.availableSkills.values())
      .filter(skill =>
        skill.name.toLowerCase().includes(lowerQuery) ||
        skill.description.toLowerCase().includes(lowerQuery)
      );
  }

  removeSkill(skillId: string): boolean {
    this.enabledSkills.delete(skillId);
    return this.availableSkills.delete(skillId);
  }

  /**
   * 生成本地缓存 key
   */
  private getCacheKey(skillId: string, params: Record<string, any>): string {
    return `${skillId}:${JSON.stringify(params)}`;
  }

  /**
   * 获取缓存结果
   */
  private getCachedResult(cacheKey: string): SkillResult | null {
    if (!this.cacheEnabled) return null;

    const entry = this.cache.get(cacheKey);
    if (!entry) return null;

    // 检查是否过期
    if (Date.now() - entry.timestamp > this.cacheTTL) {
      this.cache.delete(cacheKey);
      return null;
    }

    return entry.result;
  }

  /**
   * 设置缓存结果
   */
  private setCacheResult(cacheKey: string, result: SkillResult): void {
    if (!this.cacheEnabled) return;

    // 如果缓存已满，删除最旧的条目（使用 insertion order 追踪）
    if (this.cache.size >= this.cacheMaxEntries) {
      let oldestKey: string | null = null;
      let oldestInsertedAt = Infinity;

      for (const [key, entry] of this.cache.entries()) {
        if (entry.insertedAt < oldestInsertedAt) {
          oldestInsertedAt = entry.insertedAt;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(cacheKey, {
      result,
      timestamp: Date.now(),
      insertedAt: ++this.cacheInsertionCounter
    });
  }

  /**
   * 清除所有缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 清除指定技能的缓存
   */
  clearCacheForSkill(skillId: string): number {
    let cleared = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${skillId}:`)) {
        this.cache.delete(key);
        cleared++;
      }
    }
    return cleared;
  }

  /**
   * 设置缓存 TTL（毫秒）
   */
  setCacheTTL(ttl: number): void {
    this.cacheTTL = ttl;
  }

  /**
   * 启用/禁用缓存
   */
  setCacheEnabled(enabled: boolean): void {
    this.cacheEnabled = enabled;
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats(): { size: number; ttl: number; enabled: boolean } {
    return {
      size: this.cache.size,
      ttl: this.cacheTTL,
      enabled: this.cacheEnabled
    };
  }

  async execute(
    skillId: string,
    params: Record<string, any>,
    context: ExecutionContext
  ): Promise<SkillResult> {
    const startTime = Date.now();

    // 触发开始回调
    this.notifyProgress(skillId, 'started', { params, timestamp: startTime });

    if (!this.enabledSkills.has(skillId)) {
      this.notifyProgress(skillId, 'error', { error: 'Skill not enabled' });
      return {
        success: false,
        skillId,
        error: `Skill ${skillId} is not enabled`,
        executionTime: Date.now() - startTime
      };
    }

    const skill = this.availableSkills.get(skillId);
    if (!skill) {
      this.notifyProgress(skillId, 'error', { error: 'Skill not found' });
      return {
        success: false,
        skillId,
        error: `Skill ${skillId} not found`,
        executionTime: Date.now() - startTime
      };
    }

    // 触发验证阶段回调
    this.notifyProgress(skillId, 'validating', { params });

    const validationError = this.validateParams(skill, params);
    if (validationError) {
      this.notifyProgress(skillId, 'error', { error: validationError });
      return {
        success: false,
        skillId,
        error: validationError,
        executionTime: Date.now() - startTime
      };
    }

    // 尝试从缓存获取（只对只读操作缓存）
    const cacheKey = this.getCacheKey(skillId, params);
    const cachedResult = this.getCachedResult(cacheKey);
    if (cachedResult) {
      // 返回缓存结果，但标记为缓存命中
      this.notifyProgress(skillId, 'completed', { cached: true, result: cachedResult.result });
      return {
        ...cachedResult,
        cached: true,
        executionTime: Date.now() - startTime
      };
    }

    // 触发执行阶段回调
    this.notifyProgress(skillId, 'executing', { executor: skill.executor });

    try {
      const executor = this.executors.get(skill.executor);
      if (!executor) {
        throw new Error(`Executor ${skill.executor} not found`);
      }

      // 确定超时时间：优先使用 Skill 自己的 timeout，其次使用全局默认
      const timeout = skill.timeout
        ? Math.min(skill.timeout, this.maxTimeout)
        : this.defaultTimeout;

      // 创建超时 Promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Skill execution timed out after ${timeout}ms`));
        }, timeout);
      });

      // 执行 Promise
      const executePromise = executor.execute(skill, params, context);

      // Race 执行
      const result = await Promise.race([executePromise, timeoutPromise]);

      // 只有成功的结果才缓存
      const finalResult: SkillResult = {
        success: true,
        skillId,
        result,
        executionTime: Date.now() - startTime
      };

      this.setCacheResult(cacheKey, finalResult);

      // 触发完成回调
      this.notifyProgress(skillId, 'completed', { result, executionTime: finalResult.executionTime });

      return finalResult;
    } catch (error) {
      // 判断是否是超时错误
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      const isTimeout = errorMsg.includes('timed out');

      // 触发错误回调
      this.notifyProgress(skillId, 'error', { error: errorMsg, isTimeout });

      return {
        success: false,
        skillId,
        error: errorMsg,
        executionTime: Date.now() - startTime
      };
    }
  }

  private validateParams(skill: SkillDefinition, params: Record<string, any>): string | null {
    for (const param of skill.parameters) {
      if (param.required && !(param.name in params) && param.default === undefined) {
        return `Missing required parameter: ${param.name}`;
      }
    }
    return null;
  }
}
