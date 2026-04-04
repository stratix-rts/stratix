// ============================================
// Strategist.ts - 战略家
// Phase 1: Step 5 - Strategist（扫描映射 + LLM 增强）
// ============================================

import type {
  Proposal,
  ScanResult,
  StrategistState,
  StrategistStatus,
} from '../types';

import { ProjectScanner } from './ProjectScanner';
import { ProposalMapper } from './ProposalMapper';
import { StrategistLLMEnhancer } from './StrategistLLMEnhancer';

import type {
  ScannerConfig,
  ProposalMapperConfig,
} from './types';

import type { StrategistLLMEnhancerConfig } from './StrategistLLMEnhancer';

// ------------------------------------------------
// 常量定义
// ------------------------------------------------

const DEFAULT_ZONE_ID = 'system';

// ------------------------------------------------
// Strategist Event Types
// ------------------------------------------------

export type StrategistEventType =
  | 'scan_started'
  | 'scan_completed'
  | 'analysis_started'
  | 'analysis_completed'
  | 'proposals_generated'
  | 'proposal_enriched'
  | 'status_changed'
  | 'error';

export interface StrategistEvent {
  type: StrategistEventType;
  timestamp: Date;
  payload: Record<string, unknown>;
}

// ------------------------------------------------
// Strategist Dependencies
// ------------------------------------------------

export interface StrategistDependencies {
  /** 保存提案的函数 */
  saveProposal?: (proposal: Proposal) => Promise<void>;
  /** 批量保存提案的函数 */
  saveProposals?: (proposals: Proposal[]) => Promise<void>;
  /** 验证提案的函数（返回是否允许） */
  validateProposal?: (proposal: Proposal) => { valid: boolean; reason?: string };
}

// ------------------------------------------------
// Strategist Config
// ------------------------------------------------

export interface StrategistConfig {
  scanner?: ScannerConfig;
  mapper?: ProposalMapperConfig;
  enhancer?: StrategistLLMEnhancerConfig;
}

// ------------------------------------------------
// Strategist 类
// ------------------------------------------------

export class Strategist {
  private state: StrategistState;
  private scanner: ProjectScanner;
  private mapper: ProposalMapper;
  private enhancer: StrategistLLMEnhancer;
  private config: StrategistConfig;

  // 事件回调
  private eventListeners: Map<StrategistEventType, Array<(event: StrategistEvent) => void>> = new Map();

  // 依赖（延迟初始化）
  private _saveProposal?: (proposal: Proposal) => Promise<void>;
  private _saveProposals?: (proposals: Proposal[]) => Promise<void>;
  private _validateProposal?: (proposal: Proposal) => { valid: boolean; reason?: string };

  constructor(
    config: StrategistConfig = {},
    dependencies?: StrategistDependencies
  ) {
    this.config = config;
    this._saveProposal = dependencies?.saveProposal;
    this._saveProposals = dependencies?.saveProposals;
    this._validateProposal = dependencies?.validateProposal;

    // Initialize state
    this.state = {
      status: 'idle',
      lastScan: null,
      lastAnalysis: null,
      currentProposals: [],
      scanResult: null,
    };

    // Initialize components
    this.scanner = new ProjectScanner(config.scanner);
    this.mapper = new ProposalMapper(config.mapper);
    this.enhancer = new StrategistLLMEnhancer(config.enhancer);
  }

  // ------------------------------------------------
  // 公共方法
  // ------------------------------------------------

  /**
   * 执行完整的 Strategist Pipeline
   * 扫描 → 映射 → LLM 增强 → Guardian 验证
   */
  async analyze(): Promise<Proposal[]> {
    this.state.status = 'scanning';
    this.emit('status_changed', { status: 'scanning' });
    this.emit('scan_started', {});

    try {
      // Step 1: 确定性扫描
      const scanStartTime = Date.now();
      const scanResult = await this.scanner.scanAll();
      this.state.scanResult = scanResult.scanResult;
      this.state.lastScan = new Date();

      this.emit('scan_completed', {
        scanResult: scanResult.scanResult,
        duration: scanResult.duration,
        success: scanResult.success,
        errors: scanResult.errors,
      });

      // Step 2: 确定性映射
      this.state.status = 'analyzing';
      this.emit('status_changed', { status: 'analyzing' });
      this.emit('analysis_started', {});

      const mappingContext = {
        timestamp: new Date(),
        scanResult: scanResult.scanResult,
        projectRoot: this.scanner.getConfig().cwd,
      };

      let proposals = this.mapper.mapFromScanResult(mappingContext);

      // Step 3: LLM 增强
      proposals = await this.enrichProposals(proposals);

      this.emit('analysis_completed', {
        proposalCount: proposals.length,
        duration: Date.now() - scanStartTime,
      });

      // Step 4: Guardian 验证
      const validatedProposals = this.validateProposals(proposals);

      // Update state
      this.state.status = 'proposing';
      this.state.currentProposals = validatedProposals;
      this.state.lastAnalysis = new Date();

      this.emit('status_changed', { status: 'proposing' });
      this.emit('proposals_generated', {
        proposals: validatedProposals,
        totalCount: validatedProposals.length,
      });

      // Step 5: 保存提案
      await this.saveProposalsToDb(validatedProposals);

      // Reset to idle
      this.state.status = 'idle';
      this.emit('status_changed', { status: 'idle' });

      return validatedProposals;
    } catch (error) {
      this.state.status = 'idle';
      this.emit('status_changed', { status: 'idle' });
      this.emit('error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 仅运行扫描（不生成提案）
   */
  async scan(): Promise<ScanResult> {
    this.state.status = 'scanning';
    this.emit('status_changed', { status: 'scanning' });
    this.emit('scan_started', {});

    try {
      const result = await this.scanner.scanAll();
      this.state.scanResult = result.scanResult;
      this.state.lastScan = new Date();

      this.emit('scan_completed', {
        scanResult: result.scanResult,
        success: result.success,
      });

      this.state.status = 'idle';
      this.emit('status_changed', { status: 'idle' });

      return result.scanResult;
    } catch (error) {
      this.state.status = 'idle';
      this.emit('status_changed', { status: 'idle' });
      this.emit('error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 从扫描结果生成提案（不使用 LLM）
   */
  async generateProposalsFromScan(scanResult: ScanResult): Promise<Proposal[]> {
    this.state.status = 'analyzing';
    this.emit('status_changed', { status: 'analyzing' });
    this.emit('analysis_started', {});

    const mappingContext = {
      timestamp: new Date(),
      scanResult,
      projectRoot: this.scanner.getConfig().cwd,
    };

    const proposals = this.mapper.mapFromScanResult(mappingContext);

    // Validate with Guardian
    const validatedProposals = this.validateProposals(proposals);

    this.state.status = 'proposing';
    this.state.currentProposals = validatedProposals;
    this.state.lastAnalysis = new Date();

    this.emit('analysis_completed', {
      proposalCount: validatedProposals.length,
    });
    this.emit('proposals_generated', {
      proposals: validatedProposals,
      totalCount: validatedProposals.length,
    });

    this.state.status = 'idle';
    this.emit('status_changed', { status: 'idle' });

    return validatedProposals;
  }

  /**
   * 使用 LLM 增强现有提案
   */
  async enrichProposal(proposal: Proposal): Promise<Proposal> {
    const enriched = await this.enhancer.enrichProposal(proposal);

    this.emit('proposal_enriched', {
      proposalId: proposal.id,
      enrichedTitle: enriched.title,
    });

    return enriched;
  }

  /**
   * 对扫描结果进行架构级 LLM 分析
   */
  async analyzeArchitecture(scanResult: ScanResult): Promise<Proposal[]> {
    this.state.status = 'analyzing';
    this.emit('status_changed', { status: 'analyzing' });
    this.emit('analysis_started', {});

    const proposals = await this.enhancer.analyzeArchitecture(scanResult);

    // Validate proposals
    const validatedProposals = this.validateProposals(proposals);

    this.emit('analysis_completed', {
      proposalCount: validatedProposals.length,
      isArchitectureAnalysis: true,
    });

    this.state.status = 'idle';
    this.emit('status_changed', { status: 'idle' });

    return validatedProposals;
  }

  /**
   * 清除扫描缓存
   */
  clearCache(): void {
    this.scanner.clearCache();
  }

  /**
   * 获取当前状态
   */
  getState(): StrategistState {
    return {
      ...this.state,
      currentProposals: [...this.state.currentProposals],
    };
  }

  /**
   * 获取状态摘要
   */
  getSummary(): {
    status: StrategistStatus;
    lastScan: Date | null;
    lastAnalysis: Date | null;
    proposalCount: number;
    hasScanResult: boolean;
  } {
    return {
      status: this.state.status,
      lastScan: this.state.lastScan,
      lastAnalysis: this.state.lastAnalysis,
      proposalCount: this.state.currentProposals.length,
      hasScanResult: this.state.scanResult !== null,
    };
  }

  /**
   * 获取扫描器（用于测试）
   */
  getScanner(): ProjectScanner {
    return this.scanner;
  }

  /**
   * 获取映射器（用于测试）
   */
  getMapper(): ProposalMapper {
    return this.mapper;
  }

  /**
   * 获取增强器（用于测试）
   */
  getEnhancer(): StrategistLLMEnhancer {
    return this.enhancer;
  }

  /**
   * 手动设置依赖
   */
  setDependencies(dependencies: StrategistDependencies): void {
    this._saveProposal = dependencies.saveProposal;
    this._saveProposals = dependencies.saveProposals;
    this._validateProposal = dependencies.validateProposal;
  }

  /**
   * 获取最新扫描结果
   */
  getLatestScanResult(): ScanResult | null {
    return this.state.scanResult;
  }

  // ------------------------------------------------
  // 事件系统
  // ------------------------------------------------

  /**
   * 订阅事件
   */
  on(eventType: StrategistEventType, listener: (event: StrategistEvent) => void): void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, []);
    }
    this.eventListeners.get(eventType)!.push(listener);
  }

  /**
   * 取消订阅
   */
  off(eventType: StrategistEventType, listener: (event: StrategistEvent) => void): void {
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
  private emit(eventType: StrategistEventType, payload: Record<string, unknown>): void {
    const event: StrategistEvent = {
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
          console.error('[Strategist] Event listener error:', error);
        }
      }
    }
  }

  // ------------------------------------------------
  // 私有方法
  // ------------------------------------------------

  /**
   * 增强提案（LLM + 源码）
   */
  private async enrichProposals(proposals: Proposal[]): Promise<Proposal[]> {
    const enriched: Proposal[] = [];

    for (const proposal of proposals) {
      try {
        // Only enrich proposals with specific target files
        if (proposal.target.file) {
          const e = await this.enhancer.enrichProposal(proposal);
          enriched.push(e);
          this.emit('proposal_enriched', {
            proposalId: proposal.id,
            enriched: true,
          });
        } else {
          enriched.push(proposal);
        }
      } catch (error) {
        console.warn('[Strategist] Failed to enrich proposal:', error);
        // Keep original proposal on failure
        enriched.push(proposal);
      }
    }

    return enriched;
  }

  /**
   * 使用 Guardian 验证提案
   */
  private validateProposals(proposals: Proposal[]): Proposal[] {
    if (!this._validateProposal) {
      return proposals;
    }

    const validated: Proposal[] = [];

    for (const proposal of proposals) {
      const result = this._validateProposal(proposal);

      if (result.valid) {
        validated.push(proposal);
      } else {
        console.log(`[Strategist] Proposal blocked by Guardian: ${result.reason}`);
      }
    }

    return validated;
  }

  /**
   * 保存提案到数据库
   */
  private async saveProposalsToDb(proposals: Proposal[]): Promise<void> {
    if (!proposals.length) return;

    try {
      if (this._saveProposals) {
        await this._saveProposals(proposals);
      } else if (this._saveProposal) {
        for (const proposal of proposals) {
          await this._saveProposal(proposal);
        }
      }
    } catch (error) {
      console.warn('[Strategist] Failed to save proposals to database:', error);
    }
  }
}