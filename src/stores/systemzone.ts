import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { szLog, withLog, autoHeal } from '../stratix-systemzone/ui/logger';

// ============================================
// System Zone Pinia Store
// 对接 /api/systemzone/* 后端路由
// ============================================

const BASE_URL = typeof window !== 'undefined' && (window as any).GATEWAY_URL
  ? (window as any).GATEWAY_URL
  : 'http://127.0.0.1:7524';

async function apiFetch<T = any>(path: string, options?: RequestInit): Promise<T & { success: boolean; error?: string }> {
  const method = options?.method || 'GET';
  szLog.debug('api', `${method} ${path}`);
  const url = `${BASE_URL}${path}`;
  try {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const result = await response.json();
    if (!result.success) {
      szLog.warn('api', `${method} ${path} 返回错误`, { error: result.error, status: response.status });
    } else {
      szLog.debug('api', `${method} ${path} 成功`);
    }
    return result;
  } catch (e) {
    szLog.error('api', `${method} ${path} 网络错误`, e, { path });
    return { success: false, error: e instanceof Error ? e.message : 'Network error' } as T & { success: boolean; error?: string };
  }
}

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

export interface ObserverSummary {
  status: 'idle' | 'running' | 'error';
  pendingCount: number;
  processedCount: number;
  totalInputsReceived: number;
  totalInsightsGenerated: number;
}

export interface StrategistSummary {
  status: 'idle' | 'running' | 'error';
  lastScan: string | null;
  lastAnalysis: string | null;
  proposalCount: number;
  hasScanResult: boolean;
}

// 后端 guardian 返回的是 guardian.getState().status，即 GuardianStatus 字符串
export type GuardianState = string;

export interface Insight {
  id: string;
  content: string;
  type: string;
  confidence: number;
  entities: string[];
  sourceId: string;
  createdAt: string;
  archived: boolean;
  metadata?: Record<string, any>;
}

export interface ProposalTarget {
  path?: string;
  files?: string[];
  description?: string;
}

export interface ProposalSelection {
  strategy?: string;
  criteria?: string[];
  scope?: string;
}

export interface Proposal {
  id: string;
  timestamp: string;
  type: string;
  title: string;
  description: string;
  target: ProposalTarget;
  selection: ProposalSelection;
  status: 'pending' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed' | 'rolled_back';
  approvedBy?: string;
  executedAt?: string;
}

export interface ExecutionResult {
  proposalId: string;
  success: boolean;
  phase: string;
  duration: number;
  error: string | null;
  commitHash: string | null;
  rollbackHash: string | null;
}

export interface ExternalSource {
  id: string;
  name: string;
  type: string;
  status: string;
  url: string;
  ownerId: string;
  createdAt: string;
  lastFetchedAt: string | null;
  lastError: string | null;
  fetchCount: number;
  errorCount: number;
}

export interface BootstrapStatus {
  engineRunning: boolean;
  mode: 'manual' | 'semi_auto' | 'full_auto';
  cycleCount: number;
  lastCycleAt: string | null;
  phase?: string;
  successCount?: number;
  failureCount?: number;
  totalProposalsGenerated?: number;
  totalProposalsExecuted?: number;
  improvementScore?: number;
}

export interface BootstrapHistoryEntry {
  id: string;
  startedAt: string;
  completedAt: string;
  status: 'success' | 'partial' | 'failed';
  proposalsGenerated: number;
  proposalsApproved: number;
  proposalsExecuted: number;
}

export interface FitnessReport {
  timestamp: string;
  metrics: {
    testCoverage: number;
    cyclomaticComplexity: number;
    duplicationRate: number;
    responseTime: number;
    errorRate: number;
  };
  scores: {
    codeQuality: number;
    performance: number;
    systemHealth: number;
    overall: number;
  };
  passed: boolean;
  violations: string[];
}

// -------------------------------------------------------------------------
// Per-panel loading/error tracking key
// -------------------------------------------------------------------------
export type PanelKey = 'status' | 'insights' | 'proposals' | 'executions' | 'sources' | 'bootstrap' | 'fitness';

// -------------------------------------------------------------------------
// Store
// -------------------------------------------------------------------------

export const useSystemZoneStore = defineStore('systemzone', () => {
  // Global state
  const connected = ref(false);
  const globalLoading = ref(false);
  const globalError = ref<string | null>(null);

  // Per-panel loading/error state
  const panelLoading = ref<Record<PanelKey, boolean>>({
    status: false,
    insights: false,
    proposals: false,
    executions: false,
    sources: false,
    bootstrap: false,
    fitness: false,
  });
  const panelError = ref<Record<PanelKey, string | null>>({
    status: null,
    insights: null,
    proposals: null,
    executions: null,
    sources: null,
    bootstrap: null,
    fitness: null,
  });

  // Compat: existing components use store.loading
  const loading = computed(() => globalLoading.value);

  // Error: combine global + last panel error
  const error = computed(() => globalError.value);

  const status = ref<{
    observer: ObserverSummary;
    strategist: StrategistSummary;
    guardian: GuardianState;
  } | null>(null);

  const insights = ref<Insight[]>([]);
  const proposals = ref<Proposal[]>([]);
  const executions = ref<ExecutionResult[]>([]);
  const sources = ref<ExternalSource[]>([]);
  const bootstrapStatus = ref<BootstrapStatus | null>(null);
  const bootstrapHistory = ref<BootstrapHistoryEntry[]>([]);
  const fitnessReport = ref<FitnessReport | null>(null);

  // Auto refresh
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  // Computed
  const pendingProposals = computed(() =>
    proposals.value.filter(p => p.status === 'pending')
  );

  const activeExecutions = computed(() =>
    executions.value.filter(e => !e.success && e.phase === 'executing')
  );

  const insightsCount = computed(() => insights.value.length);
  const proposalsCount = computed(() => proposals.value.length);

  // ---------------------------------------------------------------
  // Panel helpers
  // ---------------------------------------------------------------

  function setPanelLoading(key: PanelKey, val: boolean) {
    panelLoading.value = { ...panelLoading.value, [key]: val };
  }

  function setPanelError(key: PanelKey, val: string | null) {
    panelError.value = { ...panelError.value, [key]: val };
  }

  // ---------------------------------------------------------------
  // API Methods (with per-panel loading/error)
  // ---------------------------------------------------------------

  async function fetchStatus(): Promise<void> {
    setPanelLoading('status', true);
    setPanelError('status', null);
    const result = await apiFetch<{ status: { observer: ObserverSummary; strategist: StrategistSummary; guardian: GuardianState } }>(
      '/api/systemzone/status'
    );
    setPanelLoading('status', false);
    if (result.success) {
      status.value = result.status;
      connected.value = true;
      globalError.value = null;
    } else {
      connected.value = false;
      const errMsg = result.error ?? '无法获取系统状态';
      globalError.value = errMsg;
      setPanelError('status', errMsg);
    }
  }

  async function fetchInsights(): Promise<void> {
    setPanelLoading('insights', true);
    setPanelError('insights', null);
    const result = await apiFetch<{ insights: Insight[] }>('/api/systemzone/insights');
    setPanelLoading('insights', false);
    if (result.success) {
      insights.value = result.insights || [];
    } else {
      setPanelError('insights', result.error ?? '无法获取洞察数据');
    }
  }

  async function addInput(content: string): Promise<boolean> {
    globalLoading.value = true;
    const result = await apiFetch<{}>('/api/systemzone/inputs', {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    globalLoading.value = false;
    if (!result.success) {
      setPanelError('insights', result.error ?? '添加输入失败');
    }
    return result.success;
  }

  async function addBatchInputs(inputs: { content: string; sourceType?: string }[]): Promise<boolean> {
    globalLoading.value = true;
    const result = await apiFetch<{}>('/api/systemzone/inputs/batch', {
      method: 'POST',
      body: JSON.stringify({ inputs }),
    });
    globalLoading.value = false;
    if (!result.success) {
      setPanelError('insights', result.error ?? '批量添加输入失败');
    }
    return result.success;
  }

  async function triggerObserve(): Promise<boolean> {
    globalLoading.value = true;
    const result = await apiFetch<{}>('/api/systemzone/observe', {
      method: 'POST',
      body: JSON.stringify({ trigger: 'manual' }),
    });
    globalLoading.value = false;
    if (result.success) {
      await fetchInsights();
      await fetchStatus();
    } else {
      setPanelError('insights', result.error ?? '触发观察失败');
    }
    return result.success;
  }

  async function triggerAnalyze(): Promise<boolean> {
    globalLoading.value = true;
    const result = await apiFetch<{}>('/api/systemzone/analyze', {
      method: 'POST',
    });
    globalLoading.value = false;
    if (result.success) {
      await fetchProposals();
      await fetchStatus();
    } else {
      setPanelError('proposals', result.error ?? '触发分析失败');
    }
    return result.success;
  }

  async function fetchProposals(filterStatus?: string): Promise<void> {
    setPanelLoading('proposals', true);
    setPanelError('proposals', null);
    const query = filterStatus ? `?status=${filterStatus}` : '';
    const result = await apiFetch<{ proposals: Proposal[] }>(`/api/systemzone/proposals${query}`);
    setPanelLoading('proposals', false);
    if (result.success) {
      proposals.value = result.proposals || [];
    } else {
      setPanelError('proposals', result.error ?? '无法获取提案数据');
    }
  }

  async function approveProposal(id: string, action: 'approve' | 'reject', comment?: string): Promise<boolean> {
    globalLoading.value = true;
    const result = await apiFetch<{}>(`/api/systemzone/proposals/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ action, comment }),
    });
    globalLoading.value = false;
    if (result.success) {
      await fetchProposals();
      await fetchStatus();
      // Refresh executions too since approval may trigger execution
      await fetchExecutions();
    } else {
      setPanelError('proposals', result.error ?? '审批提案失败');
    }
    return result.success;
  }

  async function executeProposal(id: string): Promise<boolean> {
    globalLoading.value = true;
    const result = await apiFetch<{ execution: ExecutionResult }>(`/api/systemzone/proposals/${id}/execute`, {
      method: 'POST',
    });
    globalLoading.value = false;
    if (result.success) {
      await fetchProposals();
      await fetchExecutions();
      await fetchStatus();
    } else {
      setPanelError('proposals', result.error ?? '执行提案失败');
      setPanelError('executions', result.error ?? '执行提案失败');
    }
    return result.success;
  }

  async function fetchExecutions(): Promise<void> {
    setPanelLoading('executions', true);
    setPanelError('executions', null);
    const result = await apiFetch<{ executions: ExecutionResult[] }>('/api/systemzone/executions');
    setPanelLoading('executions', false);
    if (result.success) {
      executions.value = result.executions || [];
    } else {
      setPanelError('executions', result.error ?? '无法获取执行记录');
    }
  }

  async function fetchSources(): Promise<void> {
    setPanelLoading('sources', true);
    setPanelError('sources', null);
    const result = await apiFetch<{ sources: ExternalSource[] }>('/api/systemzone/sources');
    setPanelLoading('sources', false);
    if (result.success) {
      sources.value = result.sources || [];
    } else {
      setPanelError('sources', result.error ?? '无法获取外部源数据');
    }
  }

  async function addSource(source: { name: string; type: string; url: string; config: Record<string, any> }): Promise<boolean> {
    globalLoading.value = true;
    const result = await apiFetch<{ source: ExternalSource }>('/api/systemzone/sources', {
      method: 'POST',
      body: JSON.stringify(source),
    });
    globalLoading.value = false;
    if (result.success) {
      await fetchSources();
    } else {
      setPanelError('sources', result.error ?? '添加外部源失败');
    }
    return result.success;
  }

  async function removeSource(id: string): Promise<boolean> {
    const result = await apiFetch<{}>(`/api/systemzone/sources/${id}`, {
      method: 'DELETE',
    });
    if (result.success) {
      sources.value = sources.value.filter(s => s.id !== id);
    } else {
      setPanelError('sources', result.error ?? '删除外部源失败');
    }
    return result.success;
  }

  async function fetchBootstrapStatus(): Promise<void> {
    setPanelLoading('bootstrap', true);
    setPanelError('bootstrap', null);
    const result = await apiFetch<{ status: BootstrapStatus }>('/api/systemzone/bootstrap/status');
    setPanelLoading('bootstrap', false);
    if (result.success) {
      bootstrapStatus.value = result.status;
    } else {
      setPanelError('bootstrap', result.error ?? '无法获取自举引擎状态');
    }
  }

  async function startBootstrap(): Promise<boolean> {
    const result = await apiFetch<{}>('/api/systemzone/bootstrap/start', {
      method: 'POST',
    });
    if (result.success) {
      await fetchBootstrapStatus();
    } else {
      setPanelError('bootstrap', result.error ?? '启动自举引擎失败');
    }
    return result.success;
  }

  async function stopBootstrap(): Promise<boolean> {
    const result = await apiFetch<{}>('/api/systemzone/bootstrap/stop', {
      method: 'POST',
    });
    if (result.success) {
      await fetchBootstrapStatus();
    } else {
      setPanelError('bootstrap', result.error ?? '停止自举引擎失败');
    }
    return result.success;
  }

  async function triggerBootstrapCycle(): Promise<boolean> {
    globalLoading.value = true;
    const result = await apiFetch<{}>('/api/systemzone/bootstrap/cycle', {
      method: 'POST',
    });
    globalLoading.value = false;
    if (result.success) {
      await fetchBootstrapStatus();
      await fetchProposals();
      await fetchExecutions();
    } else {
      setPanelError('bootstrap', result.error ?? '触发自举循环失败');
    }
    return result.success;
  }

  async function setBootstrapMode(mode: 'manual' | 'semi_auto' | 'full_auto'): Promise<boolean> {
    const result = await apiFetch<{}>('/api/systemzone/bootstrap/mode', {
      method: 'PUT',
      body: JSON.stringify({ mode }),
    });
    if (result.success) {
      await fetchBootstrapStatus();
    } else {
      setPanelError('bootstrap', result.error ?? '切换自举模式失败');
    }
    return result.success;
  }

  async function fetchFitness(): Promise<void> {
    setPanelLoading('fitness', true);
    setPanelError('fitness', null);
    const result = await apiFetch<{ report: FitnessReport }>('/api/systemzone/fitness');
    setPanelLoading('fitness', false);
    if (result.success) {
      fitnessReport.value = result.report;
    } else {
      setPanelError('fitness', result.error ?? '无法获取健康报告');
    }
  }

  // ---------------------------------------------------------------
  // Per-panel retry helpers
  // ---------------------------------------------------------------

  async function retryPanel(key: PanelKey): Promise<void> {
    switch (key) {
      case 'status': await fetchStatus(); break;
      case 'insights': await fetchInsights(); break;
      case 'proposals': await fetchProposals(); break;
      case 'executions': await fetchExecutions(); break;
      case 'sources': await fetchSources(); break;
      case 'bootstrap': await fetchBootstrapStatus(); break;
      case 'fitness': await fetchFitness(); break;
    }
  }

  // ---------------------------------------------------------------
  // Auto Refresh (visibility-aware)
  // ---------------------------------------------------------------

  function startAutoRefresh(intervalMs: number = 30000): void {
    stopAutoRefresh();
    refreshTimer = setInterval(async () => {
      if (document.visibilityState === 'visible') {
        await Promise.all([
          fetchStatus(),
          fetchProposals(),
          fetchExecutions(),
        ]);
      }
    }, intervalMs);
  }

  function stopAutoRefresh(): void {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  // ---------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------

  async function initialize(): Promise<void> {
    globalLoading.value = true;
    szLog.info('store', 'System Zone 控制台初始化');

    try {
      // allSettled: 一个失败不影响其他请求的数据
      const results = await Promise.allSettled([
        fetchStatus(),
        fetchInsights(),
        fetchProposals(),
      ]);
      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        szLog.warn('store', `初始化部分失败: ${failures.length}/${results.length}`);
      }

      // 注册自动修复动作
      autoHeal.registerHealAction('reconnect', async () => {
        try {
          await fetchStatus();
          return connected.value;
        } catch {
          return false;
        }
      });

      // 启动心跳巡检（60秒一次）
      autoHeal.start(60_000);

      startAutoRefresh();
      szLog.info('store', '初始化完成');
    } catch (err) {
      szLog.error('store', '初始化失败', err);
      globalError.value = err instanceof Error ? err.message : '初始化失败';
    } finally {
      globalLoading.value = false;
    }
  }

  function cleanup(): void {
    stopAutoRefresh();
    autoHeal.stop();
    szLog.info('store', 'System Zone 控制台关闭');
    szLog.flush();
  }

  return {
    // State
    connected,
    globalLoading,
    globalError,
    loading,
    error,
    panelLoading,
    panelError,
    status,
    insights,
    proposals,
    executions,
    sources,
    bootstrapStatus,
    bootstrapHistory,
    fitnessReport,

    // Computed
    pendingProposals,
    activeExecutions,
    insightsCount,
    proposalsCount,

    // Actions
    fetchStatus,
    fetchInsights,
    addInput,
    addBatchInputs,
    triggerObserve,
    triggerAnalyze,
    fetchProposals,
    approveProposal,
    executeProposal,
    fetchExecutions,
    fetchSources,
    addSource,
    removeSource,
    fetchBootstrapStatus,
    startBootstrap,
    stopBootstrap,
    triggerBootstrapCycle,
    setBootstrapMode,
    fetchFitness,
    retryPanel,

    // Lifecycle
    initialize,
    cleanup,
    startAutoRefresh,
    stopAutoRefresh,
  };
});
