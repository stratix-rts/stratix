// ============================================
// Observer - 观察者
// Phase 1: Step 4 - Observer（规则预处理 + LLM）
// ============================================

import type {
  ObserverState,
  ObserverStatus,
  UserInput,
  Insight,
} from '../types';

import type {
  ObserverPipelineConfig,
  ObserverEvent,
  ObserverEventType,
} from './types';

import type { RawInput } from '../sources/types';
import type { SourceManager } from '../sources/SourceManager';

import { InputPreprocessor } from './InputPreprocessor';
import { InsightExtractor } from './InsightExtractor';

// ------------------------------------------------
// 常量定义
// ------------------------------------------------

const DEFAULT_ZONE_ID = 'system';
const MAX_PENDING_INPUTS = 100;
const MAX_PROCESSED_INPUTS = 1000;

// ------------------------------------------------
// Observer 类
// ------------------------------------------------

export class Observer {
  private state: ObserverState;
  private preprocessor: InputPreprocessor;
  private extractor: InsightExtractor;
  private config: ObserverPipelineConfig;

  // 事件回调
  private eventListeners: Map<ObserverEventType, Array<(event: ObserverEvent) => void>> = new Map();

  // 依赖（延迟初始化）
  private _saveInsight?: (insight: Insight) => Promise<void>;
  private _saveInput?: (input: UserInput) => Promise<void>;

  // 外部信息洞察存储
  private lastExternalInsights: Insight[] = [];
  private _sourceManager?: SourceManager;

  constructor(
    config: ObserverPipelineConfig,
    dependencies?: {
      saveInsight?: (insight: Insight) => Promise<void>;
      saveInput?: (input: UserInput) => Promise<void>;
    }
  ) {
    this.config = config;
    this._saveInsight = dependencies?.saveInsight;
    this._saveInput = dependencies?.saveInput;

    // Initialize state
    this.state = {
      status: 'idle',
      lastReceive: null,
      pendingInputs: [],
      processedInputs: [],
      metrics: {
        inputsReceived: 0,
        insightsGenerated: 0,
      },
    };

    // Initialize components
    this.preprocessor = new InputPreprocessor(config.preprocessor);
    this.extractor = new InsightExtractor(config.extractor);
  }

  // ------------------------------------------------
  // 公共方法
  // ------------------------------------------------

  /**
   * 接收用户输入
   * @param content 用户输入的文本内容
   * @param source 输入来源：'manual' | 'api'
   * @param type 输入类型（可选，将自动推断）
   * @param metadata 附加元数据
   */
  async receiveInput(
    content: string,
    source: 'manual' | 'api' = 'manual',
    type?: UserInput['type'],
    metadata?: UserInput['metadata']
  ): Promise<UserInput> {
    const input: UserInput = {
      id: `input_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date(),
      content,
      source,
      type: type ?? 'other',
      metadata,
    };

    // Add to pending inputs
    this.state.pendingInputs.push(input);
    this.state.metrics.inputsReceived++;
    this.state.lastReceive = new Date();
    this.state.status = 'receiving';

    // Trim pending inputs if too many
    if (this.state.pendingInputs.length > MAX_PENDING_INPUTS) {
      this.state.pendingInputs = this.state.pendingInputs.slice(-MAX_PENDING_INPUTS);
    }

    this.emit('input_received', { input });

    return input;
  }

  /**
   * 处理所有待处理的输入
   * 运行完整的 Observer Pipeline: 预处理 → LLM 提取 → 存储
   */
  async processAll(): Promise<Insight[]> {
    if (this.state.pendingInputs.length === 0) {
      return [];
    }

    this.state.status = 'processing';
    this.emit('status_changed', { status: 'processing' });

    const insights: Insight[] = [];
    const inputsToProcess = [...this.state.pendingInputs];
    this.state.pendingInputs = [];

    for (const input of inputsToProcess) {
      try {
        const insight = await this.processInput(input);
        if (insight) {
          insights.push(insight);
          this.state.metrics.insightsGenerated++;
        }
      } catch (error) {
        console.error('[Observer] Failed to process input:', error);
        this.emit('extraction_failed', {
          inputId: input.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Mark as processed
      this.state.processedInputs.push(input);
    }

    // Trim processed inputs if too many
    if (this.state.processedInputs.length > MAX_PROCESSED_INPUTS) {
      this.state.processedInputs = this.state.processedInputs.slice(-MAX_PROCESSED_INPUTS);
    }

    this.state.status = 'idle';
    this.emit('status_changed', { status: 'idle' });

    return insights;
  }

  /**
   * 处理单个输入
   */
  async processInput(input: UserInput): Promise<Insight | null> {
    // Step 1: 规则预处理
    const preprocessed = this.preprocessor.process(input.content);

    // Override type if auto-detected
    if (!input.type || input.type === 'other') {
      input.type = preprocessed.inferredType;
    }

    this.emit('input_processed', {
      inputId: input.id,
      preprocessed,
    });

    // Step 2: LLM 语义提取
    const extractionResult = await this.extractor.extract({
      input,
      preprocessed,
      zoneId: DEFAULT_ZONE_ID,
    });

    if (!extractionResult.success || !extractionResult.insight) {
      throw new Error(extractionResult.error ?? 'Extraction failed');
    }

    // Step 3: 保存到数据库
    if (this._saveInsight) {
      await this._saveInsight(extractionResult.insight);
    }

    if (this._saveInput) {
      await this._saveInput(input);
    }

    this.emit('insight_extracted', {
      inputId: input.id,
      insight: extractionResult.insight,
      usage: extractionResult.usage,
    });

    return extractionResult.insight;
  }

  /**
   * 直接从文本提取洞察（便捷方法）
   * 不经过完整的接收-处理流程，直接提取
   */
  async extractFromText(text: string): Promise<{
    preprocessed: ReturnType<InputPreprocessor['process']>;
    extraction: Awaited<ReturnType<InsightExtractor['extractFromText']>>;
  }> {
    // Preprocess
    const preprocessed = this.preprocessor.process(text);

    // Extract
    const extraction = await this.extractor.extractFromText(preprocessed.cleaned);

    return { preprocessed, extraction };
  }

  /**
   * 获取当前状态
   */
  getState(): ObserverState {
    return {
      ...this.state,
      pendingInputs: [...this.state.pendingInputs],
      processedInputs: this.state.processedInputs.slice(-100),
      metrics: { ...this.state.metrics },
    };
  }

  /**
   * 获取状态摘要
   */
  getSummary(): {
    status: ObserverStatus;
    pendingCount: number;
    processedCount: number;
    totalInputsReceived: number;
    totalInsightsGenerated: number;
  } {
    return {
      status: this.state.status,
      pendingCount: this.state.pendingInputs.length,
      processedCount: this.state.processedInputs.length,
      totalInputsReceived: this.state.metrics.inputsReceived,
      totalInsightsGenerated: this.state.metrics.insightsGenerated,
    };
  }

  /**
   * 获取预处理器（用于测试）
   */
  getPreprocessor(): InputPreprocessor {
    return this.preprocessor;
  }

  /**
   * 获取提取器（用于测试）
   */
  getExtractor(): InsightExtractor {
    return this.extractor;
  }

  /**
   * 手动设置保存函数
   */
  setDependencies(dependencies: {
    saveInsight?: (insight: Insight) => Promise<void>;
    saveInput?: (input: UserInput) => Promise<void>;
  }): void {
    this._saveInsight = dependencies.saveInsight;
    this._saveInput = dependencies.saveInput;
  }

  /**
   * 清空待处理的输入
   */
  clearPending(): void {
    this.state.pendingInputs = [];
  }

  /**
   * 重置指标
   */
  resetMetrics(): void {
    this.state.metrics = {
      inputsReceived: 0,
      insightsGenerated: 0,
    };
  }

  // ------------------------------------------------
  // 外部信息源集成
  // ------------------------------------------------

  /**
   * 设置 SourceManager（用于 trigger="external" 时获取数据）
   */
  setSourceManager(sourceManager: SourceManager): void {
    this._sourceManager = sourceManager;
  }

  /**
   * 处理外部信息输入
   * @param inputs SourceManager 抓取去重后的外部信息
   * @returns 提取的洞察列表
   */
  async observeExternalInputs(inputs: RawInput[]): Promise<Insight[]> {
    if (inputs.length === 0) {
      return [];
    }

    this.state.status = 'processing';
    this.emit('status_changed', { status: 'processing' });

    const insights: Insight[] = [];

    for (const rawInput of inputs) {
      try {
        // 将 RawInput 转换为 UserInput 格式
        const externalTags = Array.isArray(rawInput.metadata?.tags) ? rawInput.metadata.tags : [];
        const userInput: UserInput = {
          id: rawInput.id,
          timestamp: rawInput.fetchedAt,
          content: rawInput.content,
          source: 'api',
          type: this.mapContentTypeToUserInputType(rawInput.contentType),
          metadata: {
            url: rawInput.url,
            tags: [
              rawInput.sourceType,
              rawInput.contentType,
              ...externalTags,
            ].filter(Boolean) as string[],
          },
        };

        // 走现有预处理 + LLM 提取流程
        const insight = await this.processInput(userInput);
        if (insight) {
          insights.push(insight);
          this.lastExternalInsights.push(insight);
          this.state.metrics.insightsGenerated++;
        }
      } catch (error) {
        console.error('[Observer] Failed to process external input:', error);
        this.emit('extraction_failed', {
          inputId: rawInput.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 保持外部洞察记录在合理范围
    if (this.lastExternalInsights.length > MAX_PROCESSED_INPUTS) {
      this.lastExternalInsights = this.lastExternalInsights.slice(-MAX_PROCESSED_INPUTS);
    }

    this.state.status = 'idle';
    this.emit('status_changed', { status: 'idle' });

    return insights;
  }

  /**
   * 观察入口（支持多种触发器）
   * @param trigger 触发类型：'manual' | 'api' | 'external'
   * @param sourceManager 当 trigger="external" 时需要提供
   * @returns 提取的洞察列表
   */
  async observe(
    trigger: 'manual' | 'api' | 'external',
    sourceManager?: SourceManager
  ): Promise<Insight[]> {
    switch (trigger) {
      case 'external': {
        const sm = sourceManager ?? this._sourceManager;
        if (!sm) {
          throw new Error('SourceManager is required for trigger="external"');
        }
        // 获取所有活跃源的最新数据
        const allInputs = await sm.fetchAll();
        const inputs: RawInput[] = [];
        for (const inputsForSource of allInputs.values()) {
          inputs.push(...inputsForSource);
        }
        return this.observeExternalInputs(inputs);
      }
      case 'manual':
      case 'api':
      default:
        return this.processAll();
    }
  }

  /**
   * 获取最近从外部信息生成的洞察
   * @param limit 返回数量限制（默认全部）
   */
  getLastExternalInsights(limit?: number): Insight[] {
    if (limit === undefined || limit === null) {
      return [...this.lastExternalInsights];
    }
    return this.lastExternalInsights.slice(-limit);
  }

  /**
   * 将外部信息内容类型映射为 UserInput 类型
   */
  private mapContentTypeToUserInputType(contentType: string): UserInput['type'] {
    const mapping: Record<string, UserInput['type']> = {
      article: 'news',
      changelog: 'news',
      release: 'news',
      issue: 'analysis',
      commit: 'code',
      tweet: 'other',
      other: 'other',
    };
    return mapping[contentType] ?? 'other';
  }

  // ------------------------------------------------
  // 事件系统
  // ------------------------------------------------

  /**
   * 订阅事件
   */
  on(eventType: ObserverEventType, listener: (event: ObserverEvent) => void): void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, []);
    }
    this.eventListeners.get(eventType)!.push(listener);
  }

  /**
   * 取消订阅
   */
  off(eventType: ObserverEventType, listener: (event: ObserverEvent) => void): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * 触发事件
   */
  private emit(eventType: ObserverEventType, payload: Record<string, unknown>): void {
    const event: ObserverEvent = {
      type: eventType,
      timestamp: new Date(),
      payload,
    };

    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      for (let i = listeners.length - 1; i >= 0; i--) {
        const listener = listeners[i];
        try {
          listener(event);
        } catch (error) {
          console.error('[Observer] Event listener error, removing:', error);
          listeners.splice(i, 1);
        }
      }
    }
  }
}
