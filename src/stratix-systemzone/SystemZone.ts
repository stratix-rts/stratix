// ============================================
// SystemZone.ts - System Zone 主类
// Phase 1: Step 7 - 手动触发循环集成
// ============================================

import { Observer } from './observer/Observer';
import { Strategist } from './strategist/Strategist';
import { Guardian } from './guardian/Guardian';

import type {
  SystemZoneStatus,
  SystemZoneKnowledge,
  UserInput,
  UserInputType,
  Insight,
  InsightType,
  Proposal,
  ProposalStatus,
} from './types';

import type { ObserverPipelineConfig } from './observer/types';
import type { ScannerConfig, ProposalMapperConfig } from './strategist/types';
import type { StrategistLLMEnhancerConfig } from './strategist/StrategistLLMEnhancer';
import type { GuardianConfig } from './guardian/Guardian';
import type { GuardianValidationResult } from './guardian/Guardian';

// ------------------------------------------------
// 常量定义
// ------------------------------------------------

const DEFAULT_ZONE_ID = 'system';
const DEFAULT_OWNER_ID = 'system';

// ------------------------------------------------
// Event Types
// ------------------------------------------------

export type SystemZoneEventType =
  | 'initialized'
  | 'status_changed'
  | 'input_received'
  | 'insight_generated'
  | 'analysis_started'
  | 'analysis_completed'
  | 'proposal_generated'
  | 'proposal_approved'
  | 'proposal_rejected'
  | 'guardian_alert'
  | 'circuit_tripped'
  | 'error';

export interface SystemZoneEvent {
  type: SystemZoneEventType;
  timestamp: Date;
  payload: Record<string, unknown>;
}

// ------------------------------------------------
// SystemZone Dependencies
// ------------------------------------------------

export interface SystemZoneDependencies {
  /** 保存洞察的函数 */
  saveInsight?: (insight: Insight) => Promise<void>;
  /** 保存用户输入的函数 */
  saveInput?: (input: UserInput) => Promise<void>;
  /** 保存提案的函数 */
  saveProposal?: (proposal: Proposal) => Promise<void>;
  /** 批量保存提案的函数 */
  saveProposals?: (proposals: Proposal[]) => Promise<void>;
  /** 更新提案状态 */
  updateProposalStatus?: (id: string, status: ProposalStatus, approvedBy?: string) => Promise<void>;
  /** 获取洞察列表 */
  getInsights?: (filters?: { archived?: boolean; type?: InsightType; limit?: number }) => Promise<Insight[]>;
  /** 获取提案列表 */
  getProposals?: (filters?: { status?: ProposalStatus; limit?: number }) => Promise<Proposal[]>;
  /** 通知用户 */
  notify?: (message: string) => Promise<void>;
}

// ------------------------------------------------
// SystemZone Config
// ------------------------------------------------

export interface SystemZoneInitConfig {
  /** Zone ID */
  zoneId?: string;
  /** Owner ID */
  ownerId?: string;
  /** Zone 名称 */
  name?: string;
  /** Observer 配置 */
  observer?: ObserverPipelineConfig;
  /** Scanner 配置 */
  scanner?: ScannerConfig;
  /** ProposalMapper 配置 */
  mapper?: ProposalMapperConfig;
  /** LLM Enhancer 配置 */
  enhancer?: StrategistLLMEnhancerConfig;
  /** Guardian 配置 */
  guardian?: GuardianConfig;
  /** 依赖注入 */
  dependencies?: SystemZoneDependencies;
}

// ------------------------------------------------
// SystemZone State
// ------------------------------------------------

export interface SystemZoneState {
  zoneId: string;
  ownerId: string;
  name: string;
  status: SystemZoneStatus;
  observer: {
    status: string;
    pendingInputs: number;
    processedInputs: number;
    insightsGenerated: number;
  };
  strategist: {
    status: string;
    lastScan: Date | null;
    lastAnalysis: Date | null;
    proposalCount: number;
  };
  guardian: {
    status: string;
    alertCount: number;
    circuitBreakerState: string;
  };
}

// ------------------------------------------------
// SystemZone 类
// ============================================
// 手动触发循环流程：
// 1. 用户输入信息 → Observer 接收
// 2. 用户触发观察 → Observer 处理输入 → 生成洞察
// 3. 用户触发分析 → Strategist 扫描 → 生成提案
// 4. 用户审批提案 → Guardian 验证
// ============================================

export class SystemZone {
  // Identity
  private zoneId: string;
  private ownerId: string;
  private name: string;

  // State machine: active | paused | learning
  private status: SystemZoneStatus;

  // Sub-modules
  private observer: Observer;
  private strategist: Strategist;
  private guardian: Guardian;

  // Knowledge base (in-memory for Phase 1)
  private insights: Insight[] = [];
  private proposals: Proposal[] = [];

  // Config
  private config: SystemZoneInitConfig;

  // Dependencies
  private deps: SystemZoneDependencies;

  // 事件监听器
  private eventListeners: Map<SystemZoneEventType, Array<(event: SystemZoneEvent) => void>> = new Map();

  // Guardian validation wrapper
  private guardianValidate = (proposal: Proposal): { valid: boolean; reason?: string } => {
    const result: GuardianValidationResult = this.guardian.validateProposal(proposal);
    return { valid: result.valid, reason: result.reasons.join(', ') };
  };

  constructor(config: SystemZoneInitConfig = {}) {
    this.config = config;
    this.zoneId = config.zoneId ?? DEFAULT_ZONE_ID;
    this.ownerId = config.ownerId ?? DEFAULT_OWNER_ID;
    this.name = config.name ?? 'System Zone';
    this.status = 'active';
    this.deps = config.dependencies ?? {};

    // 初始化 Observer
    const observerConfig: ObserverPipelineConfig = config.observer ?? {
      preprocessor: {
        detectLanguageEnabled: true,
        deduplicationEnabled: true,
        cleaningEnabled: true,
      },
      extractor: {
        model: 'claude-sonnet-4-20250514',
        maxTokens: 1024,
        temperature: 0.3,
        timeoutMs: 30000,
      },
    };

    this.observer = new Observer(observerConfig, {
      saveInsight: async (insight: Insight) => {
        if (this.deps.saveInsight) {
          await this.deps.saveInsight(insight);
        }
      },
      saveInput: async (input: UserInput) => {
        if (this.deps.saveInput) {
          await this.deps.saveInput(input);
        }
      },
    });

    // 初始化 Strategist
    const scannerConfig: ScannerConfig = config.scanner ?? {
      timeoutMs: 60000,
      fileSizeThreshold: 500,
      coverageThreshold: 50,
      cacheEnabled: true,
      cacheTtlMs: 30 * 60 * 1000,
    };

    const mapperConfig: ProposalMapperConfig = config.mapper ?? {
      coverageThreshold: 50,
      fileSizeThreshold: 500,
    };

    const enhancerConfig: StrategistLLMEnhancerConfig = config.enhancer ?? {
      model: 'claude-sonnet-4-20250514',
      maxTokens: 2048,
      temperature: 0.3,
      timeoutMs: 30000,
    };

    this.strategist = new Strategist(
      { scanner: scannerConfig, mapper: mapperConfig, enhancer: enhancerConfig },
      {
        validateProposal: this.guardianValidate,
        saveProposals: async (proposals: Proposal[]) => {
          if (this.deps.saveProposals) {
            await this.deps.saveProposals(proposals);
          } else if (this.deps.saveProposal) {
            for (const proposal of proposals) {
              await this.deps.saveProposal(proposal);
            }
          }
        },
      }
    );

    // 初始化 Guardian
    const guardianConfig: GuardianConfig = config.guardian ?? {
      protection: {
        forbiddenPaths: [
          '**/payment/**',
          '**/permission/**',
          '**/.env*',
          '**/credentials/**',
        ],
        requireApproval: true,
        notifyOnProposal: true,
        circuitBreakerEnabled: true,
      },
      circuitBreakerConfig: {
        maxConsecutiveFailures: 3,
        resetAfterMs: 60000,
      },
    };

    this.guardian = new Guardian(guardianConfig);

    // 设置 Guardian 回调
    this.guardian.setOnAlert((alert) => {
      this.emit('guardian_alert', { alert });
    });

    this.guardian.setOnCircuitTripped((failureCount) => {
      this.emit('circuit_tripped', { failureCount });
    });

    // 订阅子模块事件
    this.setupEventForwarding();
  }

  /**
   * 设置事件转发 - 将子模块的事件转发到 SystemZone
   */
  private setupEventForwarding(): void {
    // Observer 事件转发
    this.observer.on('input_received', (event) => {
      this.emit('input_received', event.payload);
    });

    this.observer.on('insight_extracted', (event) => {
      this.emit('insight_generated', event.payload);
    });

    this.observer.on('status_changed', (event) => {
      this.emit('status_changed', { component: 'observer', ...event.payload });
    });

    // Strategist 事件转发
    this.strategist.on('scan_started', (event) => {
      this.emit('status_changed', { component: 'strategist', phase: 'scan', ...event.payload });
    });

    this.strategist.on('scan_completed', (event) => {
      this.emit('status_changed', { component: 'strategist', phase: 'scan_complete', ...event.payload });
    });

    this.strategist.on('analysis_started', (event) => {
      this.emit('analysis_started', event.payload);
    });

    this.strategist.on('analysis_completed', (event) => {
      this.emit('analysis_completed', event.payload);
    });

    this.strategist.on('proposals_generated', (event) => {
      this.emit('proposal_generated', event.payload);
    });

    this.strategist.on('status_changed', (event) => {
      this.emit('status_changed', { component: 'strategist', ...event.payload });
    });

    this.strategist.on('error', (event) => {
      this.emit('error', { component: 'strategist', ...event.payload });
    });
  }

  // ------------------------------------------------
  // 公共方法
  // ------------------------------------------------

  /**
   * 手动触发循环：完整的 Observe → Analyze → Propose 流程
   *
   * 流程：
   * 1. Observer 处理所有待处理的输入，生成洞察
   * 2. Strategist 执行完整分析，生成改进提案
   * 3. Guardian 验证所有提案
   *
   * @param userInputContent 可选的初始用户输入（会在观察前添加）
   * @returns 包含洞察和提案的结果
   */
  async runCycle(userInputContent?: string): Promise<{
    insights: Insight[];
    proposals: Proposal[];
    errors: string[];
  }> {
    const errors: string[] = [];
    let insights: Insight[] = [];
    let proposals: Proposal[] = [];

    try {
      this.emit('status_changed', { status: 'learning' });

      // Step 1: 如果有用户输入，先添加
      if (userInputContent) {
        await this.addInput(userInputContent);
      }

      // Step 2: 运行观察循环
      this.emit('status_changed', { phase: 'observe' });
      try {
        insights = await this.observe();
      } catch (error) {
        errors.push(`Observer error: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Step 3: 运行分析循环
      this.emit('status_changed', { phase: 'analyze' });
      this.emit('analysis_started', { insightsCount: insights.length });

      try {
        proposals = await this.analyze();
      } catch (error) {
        errors.push(`Strategist error: ${error instanceof Error ? error.message : String(error)}`);
      }

      this.emit('analysis_completed', {
        insightsCount: insights.length,
        proposalsCount: proposals.length,
      });

      this.emit('status_changed', { status: 'active' });
    } catch (error) {
      errors.push(`Cycle error: ${error instanceof Error ? error.message : String(error)}`);
      this.emit('error', { error: errors[errors.length - 1] });
    }

    return { insights, proposals, errors };
  }

  /**
   * 添加用户输入
   * @param content 输入内容
   * @param type 输入类型（可选，将自动推断）
   * @param metadata 附加元数据
   */
  async addInput(
    content: string,
    type?: UserInput['type'],
    metadata?: UserInput['metadata']
  ): Promise<UserInput> {
    const input = await this.observer.receiveInput(content, 'manual', type, metadata);

    this.emit('input_received', { input });

    return input;
  }

  /**
   * 触发观察循环
   * 处理所有待处理的输入，生成洞察
   */
  async observe(): Promise<Insight[]> {
    const insights = await this.observer.processAll();

    for (const insight of insights) {
      this.emit('insight_generated', { insight });
    }

    return insights;
  }

  /**
   * 触发分析循环
   * 执行完整扫描，生成改进提案
   */
  async analyze(): Promise<Proposal[]> {
    const proposals = await this.strategist.analyze();

    for (const proposal of proposals) {
      this.emit('proposal_generated', { proposal });
    }

    return proposals;
  }

  /**
   * 审批提案
   * @param proposalId 提案 ID
   * @param action 审批动作：'approve' | 'reject'
   * @param comment 审批评论（可选）
   */
  async approveProposal(
    proposalId: string,
    action: 'approve' | 'reject',
    comment?: string
  ): Promise<{ success: boolean; proposal?: Proposal; error?: string }> {
    // 获取提案
    const proposals = this.deps.getProposals ? await this.deps.getProposals() : [];
    const proposal = proposals.find((p) => p.id === proposalId);

    if (!proposal) {
      // 尝试从 strategist 获取
      const strategistProposals = this.strategist.getState().currentProposals;
      const found = strategistProposals.find((p) => p.id === proposalId);

      if (!found) {
        return { success: false, error: `Proposal not found: ${proposalId}` };
      }

      // 执行审批
      if (action === 'approve') {
        // Guardian 验证
        const validation = this.guardian.validateProposal(found);

        if (!validation.valid) {
          this.emit('guardian_alert', { proposal: found, reasons: validation.reasons });
          return { success: false, error: `Proposal blocked by Guardian: ${validation.reasons.join(', ')}` };
        }

        // 记录成功
        this.guardian.recordSuccess();

        // 更新状态（模拟）
        found.status = 'approved';
        found.approvedBy = this.ownerId;

        this.emit('proposal_approved', { proposal: found, comment });
        return { success: true, proposal: found };
      } else {
        found.status = 'rejected';
        this.emit('proposal_rejected', { proposal: found, comment });
        return { success: true, proposal: found };
      }
    }

    // 直接更新已存储的提案
    if (action === 'approve') {
      const validation = this.guardian.validateProposal(proposal);

      if (!validation.valid) {
        this.emit('guardian_alert', { proposal, reasons: validation.reasons });
        return { success: false, error: `Proposal blocked by Guardian: ${validation.reasons.join(', ')}` };
      }

      this.guardian.recordSuccess();
      proposal.status = 'approved';
      proposal.approvedBy = this.ownerId;

      this.emit('proposal_approved', { proposal, comment });
      return { success: true, proposal };
    } else {
      proposal.status = 'rejected';
      this.emit('proposal_rejected', { proposal, comment });
      return { success: true, proposal };
    }
  }

  /**
   * 获取当前状态
   */
  getState(): SystemZoneState {
    const observerState = this.observer.getState();
    const strategistState = this.strategist.getState();
    const guardianState = this.guardian.getState();

    return {
      zoneId: this.zoneId,
      ownerId: this.ownerId,
      name: this.name,
      status: this.status,
      observer: {
        status: observerState.status,
        pendingInputs: observerState.pendingInputs.length,
        processedInputs: observerState.processedInputs.length,
        insightsGenerated: observerState.metrics.insightsGenerated,
      },
      strategist: {
        status: strategistState.status,
        lastScan: strategistState.lastScan,
        lastAnalysis: strategistState.lastAnalysis,
        proposalCount: strategistState.currentProposals.length,
      },
      guardian: {
        status: guardianState.status,
        alertCount: guardianState.recentAlerts.length,
        circuitBreakerState: this.guardian.getCircuitBreakerState(),
      },
    };
  }

  /**
   * 获取状态摘要
   */
  getSummary(): {
    status: SystemZoneStatus;
    observer: ReturnType<Observer['getSummary']>;
    strategist: ReturnType<Strategist['getSummary']>;
    guardian: ReturnType<Guardian['getSummary']>;
  } {
    return {
      status: this.status,
      observer: this.observer.getSummary(),
      strategist: this.strategist.getSummary(),
      guardian: this.guardian.getSummary(),
    };
  }

  /**
   * 获取 Observer 实例
   */
  getObserver(): Observer {
    return this.observer;
  }

  /**
   * 获取 Strategist 实例
   */
  getStrategist(): Strategist {
    return this.strategist;
  }

  /**
   * 获取 Guardian 实例
   */
  getGuardian(): Guardian {
    return this.guardian;
  }

  /**
   * 设置依赖函数
   */
  setDependencies(dependencies: SystemZoneDependencies): void {
    this.deps = { ...this.deps, ...dependencies };

    // 同步到 Observer
    this.observer.setDependencies({
      saveInsight: dependencies.saveInsight,
      saveInput: dependencies.saveInput,
    });
  }

  /**
   * 重置熔断器
   */
  resetCircuitBreaker(): void {
    this.guardian.resetCircuitBreaker();
  }

  /**
   * 初始化 SystemZone
   * 调用此方法完成所有子模块的初始化
   */
  async initialize(): Promise<void> {
    this.status = 'active';
    this.emit('initialized', { zoneId: this.zoneId, status: this.status });
    this.emit('status_changed', { status: this.status });
  }

  /**
   * 接收用户输入，触发 Observer 完整流程
   * @param content 用户输入的文本内容
   * @param metadata 附加元数据
   * @returns 提取的洞察列表
   */
  async submitInput(
    content: string,
    metadata?: { type?: UserInputType; tags?: string[]; url?: string }
  ): Promise<Insight[]> {
    if (this.status === 'paused') {
      throw new Error('SystemZone is paused, cannot receive input');
    }

    // Observer 接收输入
    await this.observer.receiveInput(
      content,
      'manual',
      metadata?.type,
      metadata ? { tags: metadata.tags, url: metadata.url } : undefined
    );

    this.emit('input_received', { content: content.slice(0, 100) });

    // Observer 处理所有待处理输入（完整流程：预处理 → LLM 提取 → 存储）
    const insights = await this.observer.processAll();

    // 保存到本地知识库
    for (const insight of insights) {
      this.insights.push(insight);
      this.emit('insight_generated', { insight });
    }

    return insights;
  }

  /**
   * 触发 Strategist 完整流程
   * 扫描 → 映射 → LLM增强 → Guardian检查
   * @returns 生成的提案列表
   */
  async triggerAnalysis(): Promise<Proposal[]> {
    if (this.status === 'paused') {
      throw new Error('SystemZone is paused, cannot trigger analysis');
    }

    this.emit('analysis_started', { timestamp: new Date() });

    try {
      // Strategist.analyze() 执行完整流程
      const proposals = await this.strategist.analyze();

      // 通过 Guardian 验证所有提案
      const validatedProposals: Proposal[] = [];
      for (const proposal of proposals) {
        const guardianResult = this.guardian.validateProposal(proposal);

        if (guardianResult.valid) {
          validatedProposals.push(proposal);
          this.proposals.push(proposal);
          this.emit('proposal_generated', { proposal });
        } else {
          console.log(`[SystemZone] Proposal blocked by Guardian: ${guardianResult.reasons.join(', ')}`);
          // 创建告警记录
          for (const alert of guardianResult.alerts) {
            this.guardian.createLesson(
              'error',
              'guardian',
              `Proposal blocked: ${alert.message}`,
              `Proposal ${proposal.id}`,
              'Check Guardian protection rules'
            );
          }
          this.emit('guardian_alert', { proposal, reasons: guardianResult.reasons });
        }
      }

      this.emit('analysis_completed', {
        proposalCount: validatedProposals.length,
        proposals: validatedProposals,
      });

      // 通知用户有新提案
      if (validatedProposals.length > 0 && this.deps.notify) {
        await this.deps.notify(`Generated ${validatedProposals.length} new proposals for review`);
      }

      return validatedProposals;
    } catch (error) {
      // 分析失败，记录到 Guardian
      this.guardian.recordFailure();

      this.emit('error', {
        error: error instanceof Error ? error.message : String(error),
        phase: 'analysis',
      });

      throw error;
    }
  }

  /**
   * 仅运行扫描（不生成提案，不调用 LLM）
   */
  async runScan(): Promise<void> {
    if (this.status === 'paused') {
      throw new Error('SystemZone is paused, cannot run scan');
    }

    await this.strategist.scan();
  }

  /**
   * 从扫描结果生成提案（不使用 LLM）
   */
  async generateProposalsFromScan(): Promise<Proposal[]> {
    if (this.status === 'paused') {
      throw new Error('SystemZone is paused, cannot generate proposals');
    }

    const scanResult = this.strategist.getLatestScanResult();
    if (!scanResult) {
      throw new Error('No scan result available, run scan first');
    }

    const proposals = await this.strategist.generateProposalsFromScan(scanResult);

    // Guardian 验证
    const validatedProposals: Proposal[] = [];
    for (const proposal of proposals) {
      const guardianResult = this.guardian.validateProposal(proposal);
      if (guardianResult.valid) {
        validatedProposals.push(proposal);
        this.proposals.push(proposal);
      }
    }

    return validatedProposals;
  }

  /**
   * 获取提案列表
   * @param filters 过滤条件
   */
  async getProposals(filters?: {
    status?: ProposalStatus;
    type?: Proposal['type'];
    limit?: number;
  }): Promise<Proposal[]> {
    // 优先使用依赖注入的查询
    if (this.deps.getProposals) {
      return this.deps.getProposals(filters);
    }

    // Fallback: 内存查询
    let result = [...this.proposals];

    if (filters?.status) {
      result = result.filter((p) => p.status === filters.status);
    }

    if (filters?.type) {
      result = result.filter((p) => p.type === filters.type);
    }

    // 按时间倒序
    result.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (filters?.limit) {
      result = result.slice(0, filters.limit);
    }

    return result;
  }

  /**
   * 获取洞察列表
   * @param filters 过滤条件
   */
  async getInsights(filters?: {
    archived?: boolean;
    type?: InsightType;
    limit?: number;
  }): Promise<Insight[]> {
    // 优先使用依赖注入的查询
    if (this.deps.getInsights) {
      return this.deps.getInsights(filters);
    }

    // Fallback: 内存查询
    let result = [...this.insights];

    if (filters?.archived !== undefined) {
      result = result.filter((i) => i.archived === filters.archived);
    }

    if (filters?.type) {
      result = result.filter((i) => i.type === filters.type);
    }

    // 按时间倒序
    result.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (filters?.limit) {
      result = result.slice(0, filters.limit);
    }

    return result;
  }

  /**
   * 获取 SystemZone 整体状态
   */
  getStatus(): {
    zoneId: string;
    ownerId: string;
    name: string;
    status: SystemZoneStatus;
    observer: {
      status: string;
      pendingInputs: number;
      processedInputs: number;
      insightsGenerated: number;
    };
    strategist: {
      status: string;
      lastScan: Date | null;
      lastAnalysis: Date | null;
      proposalCount: number;
    };
    guardian: {
      status: string;
      circuitBreaker: string;
      alertCount: number;
    };
    knowledge: {
      insightCount: number;
      proposalCount: number;
      pendingProposalCount: number;
    };
  } {
    const observerState = this.observer.getState();
    const strategistState = this.strategist.getState();
    const guardianState = this.guardian.getState();

    return {
      zoneId: this.zoneId,
      ownerId: this.ownerId,
      name: this.name,
      status: this.status,
      observer: {
        status: observerState.status,
        pendingInputs: observerState.pendingInputs.length,
        processedInputs: observerState.processedInputs.length,
        insightsGenerated: observerState.metrics.insightsGenerated,
      },
      strategist: {
        status: strategistState.status,
        lastScan: strategistState.lastScan,
        lastAnalysis: strategistState.lastAnalysis,
        proposalCount: strategistState.currentProposals.length,
      },
      guardian: {
        status: guardianState.status,
        circuitBreaker: this.guardian.getCircuitBreakerState(),
        alertCount: guardianState.recentAlerts.length,
      },
      knowledge: {
        insightCount: this.insights.length,
        proposalCount: this.proposals.length,
        pendingProposalCount: this.proposals.filter((p) => p.status === 'pending').length,
      },
    };
  }

  /**
   * 设置状态
   * @param newStatus 新状态：active | paused | learning
   */
  setStatus(newStatus: SystemZoneStatus): void {
    const previousStatus = this.status;
    this.status = newStatus;
    this.emit('status_changed', { previousStatus, currentStatus: newStatus });
  }

  /**
   * 暂停 SystemZone
   */
  pause(): void {
    this.setStatus('paused');
  }

  /**
   * 恢复 SystemZone
   */
  resume(): void {
    this.setStatus('active');
  }

  /**
   * 进入学习模式
   */
  startLearning(): void {
    this.setStatus('learning');
  }

  /**
   * 清除内存中的知识库（不删除数据库数据）
   */
  clearKnowledge(): void {
    this.insights = [];
    this.proposals = [];
  }

  // ------------------------------------------------
  // 事件系统
  // ------------------------------------------------

  /**
   * 订阅事件
   */
  on(eventType: SystemZoneEventType, listener: (event: SystemZoneEvent) => void): void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, []);
    }
    this.eventListeners.get(eventType)!.push(listener);
  }

  /**
   * 取消订阅
   */
  off(eventType: SystemZoneEventType, listener: (event: SystemZoneEvent) => void): void {
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
  private emit(eventType: SystemZoneEventType, payload: Record<string, unknown>): void {
    const event: SystemZoneEvent = {
      type: eventType,
      timestamp: new Date(),
      payload,
    };

    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error('[SystemZone] Event listener error:', error);
        }
      }
    }
  }
}

// Default instance for convenience
let defaultInstance: SystemZone | null = null;

export function getDefaultSystemZone(config?: SystemZoneInitConfig): SystemZone {
  if (!defaultInstance) {
    defaultInstance = new SystemZone(config);
  }
  return defaultInstance;
}

export function resetDefaultSystemZone(): void {
  defaultInstance = null;
}
