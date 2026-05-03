/**
 * ReflectionManager - 反思和自校正逻辑
 * 从 EnhancedStratixAgent 拆分出来的独立职责类
 */

import type { LLMConnector } from './LLMConnector';
import type { MemoryManager } from './MemoryManager';
import type { EnhancedSoulConfig, ReflectionEntry } from '../types/soul';

export interface ReflectionManagerOptions {
  llm: LLMConnector;
  soul: EnhancedSoulConfig;
  memory: MemoryManager;
  onEvolutionCheck?: () => void;
}

export interface MemoryEntry {
  id: string;
  title: string;
  content: string;
  importance: 1 | 2 | 3;
  createdAt: string;
}

export class ReflectionManager {
  private llm: LLMConnector;
  private soul: EnhancedSoulConfig;
  private memory: MemoryManager;
  private onEvolutionCheck?: () => void;

  // State
  private reflectionHistory: ReflectionEntry[] = [];
  private memoryEntries: MemoryEntry[] = [];

  /** Default timeout for LLM calls during reflection (ms) */
  private static readonly DEFAULT_LLM_TIMEOUT_MS = 30000;

  constructor(options: ReflectionManagerOptions) {
    this.llm = options.llm;
    this.soul = options.soul;
    this.memory = options.memory;
    this.onEvolutionCheck = options.onEvolutionCheck;
  }

  private async generateWithTimeout(
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    timeoutMs: number = ReflectionManager.DEFAULT_LLM_TIMEOUT_MS
  ): Promise<{ content: string }> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Reflection LLM call timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    return Promise.race([this.llm.generate(messages), timeoutPromise]);
  }

  /**
   * 反思机制
   */
  async performReflection(task: string, result: string): Promise<void> {
    const reflectionConfig = this.soul.reflection;
    if (!reflectionConfig?.enabled) return;

    const reflectionPrompt = `任务: ${task}
结果: ${result}

请简短反思:
1. 任务完成度如何？
2. 有什么可以改进的地方？
3. 从中学到了什么？`;

    const response = await this.generateWithTimeout([{ role: 'user', content: reflectionPrompt }]);
    const reflectionContent = response.content;

    // 创建反思条目
    const entry: ReflectionEntry = {
      id: `reflection-${Date.now()}`,
      timestamp: new Date().toISOString(),
      task,
      result,
      reflection: reflectionContent,
    };

    this.reflectionHistory.push(entry);

    // 如果启用了长期记忆，保存重要反思
    if (this.reflectionHistory.length > 10) {
      const summary = await this.summarizeReflections();
      await this.addMemoryEntry(summary, 2);
      this.reflectionHistory = [];
    }

    // 自我纠正检查
    if (reflectionConfig.onError && result.includes('[ERROR]')) {
      await this.selfCorrect(task, result, reflectionContent);
    }

    // 进化检查
    if (reflectionConfig.evolutionCheck?.enabled && this.onEvolutionCheck) {
      this.onEvolutionCheck();
    }
  }

  /**
   * 自我纠正
   */
  async selfCorrect(task: string, result: string, reflection: string): Promise<void> {
    const correctionPrompt = `原始任务: ${task}
执行结果: ${result}
反思: ${reflection}

请分析问题并提出纠正方案。不要重复相同的错误。`;

    const correction = await this.generateWithTimeout([{ role: 'user', content: correctionPrompt }]);

    // 保存纠正历史
    await this.addMemoryEntry(
      `自我纠正: ${correction.content}`,
      3
    );
  }

  /**
   * 总结反思历史
   */
  async summarizeReflections(): Promise<string> {
    if (this.reflectionHistory.length === 0) return '';

    const summaryPrompt = `请总结以下反思要点，提取关键经验（不超过 200 字）:\n\n${
      this.reflectionHistory.map(r => `- ${r.reflection}`).join('\n')
    }`;

    const response = await this.generateWithTimeout([{ role: 'user', content: summaryPrompt }]);
    return response.content;
  }

  /**
   * 添加长期记忆
   */
  async addMemoryEntry(content: string, importance: 1 | 2 | 3 = 2): Promise<void> {
    if (this.memory) {
      // 使用内置的记忆系统
      const entry: MemoryEntry = {
        id: `memory-${Date.now()}`,
        title: content.substring(0, 50),
        content,
        importance,
        createdAt: new Date().toISOString(),
      };
      this.memoryEntries.push(entry);

      // 如果支持长期记忆，添加到 MemoryManager
      this.memory.addLongTermMemory({
        title: entry.title,
        content: entry.content,
        importance: entry.importance,
      });
    }
  }

  /**
   * 获取反思历史
   */
  getReflectionHistory(): ReflectionEntry[] {
    return [...this.reflectionHistory];
  }

  /**
   * 获取记忆条目
   */
  getMemoryEntries(): MemoryEntry[] {
    return [...this.memoryEntries];
  }

  /**
   * 清空反思历史
   */
  clearReflectionHistory(): void {
    this.reflectionHistory = [];
  }

  /**
   * 清空记忆
   */
  clearMemory(): void {
    this.memoryEntries = [];
  }
}
