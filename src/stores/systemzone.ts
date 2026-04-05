import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

// ============================================
// System Zone Pinia Store
// 对接 /api/systemzone/* 后端路由
// ============================================

const BASE_URL = typeof window !== 'undefined' && (window as any).GATEWAY_URL
  ? (window as any).GATEWAY_URL
  : 'http://127.0.0.1:7524';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<{ success: boolean; data: T; error?: string }> {
  const url = `${BASE_URL}${path}`;
  try {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const result = await response.json();
    return result;
  } catch (e) {
    return { success: false, data: null as T, error: e instanceof Error ? e.message : 'Network error' };
  }
}

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

export interface ObserverSummary {
  totalInputs: number;
  processedInputs: number;
  pendingInputs: number;
  lastRunAt: string | null;
  status: 'idle' | 'running' | 'error';
}

export interface StrategistSummary {
  totalProposals: number;
  pendingProposals: number;
  approvedProposals: number;
  executedProposals: number;
  lastRunAt: string | null;
  status: 'idle' | 'running' | 'error';
}

export interface GuardianState {
  circuitBreakerOpen: boolean;
  totalValidations: number;
  blockedCount: number;
  lastValidationAt: string | null;
}

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

export interface Proposal {
  id: string;
  title: string;
  description: string;
  type: string;
  status: 'pending' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed' | 'rolled_back';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  targetFiles: string[];
  estimatedImpact: string;
  guardianValidation?: {
    valid: boolean;
    reasons: string[];
    alerts: any[];
  };
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  executedAt?: string;
  executionResult?: ExecutionResult;
}

export interface ExecutionResult {
  proposalId: string;
  status: 'running' | 'completed' | 'failed' | 'rolled_back';
  commitHash?: string;
  rollbackHash?: string;
  changes: string[];
  testResults?: {
    passed: number;
    failed: number;
    total: number;
  };
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface ExternalSource {
  id: string;
  name: string;
  type: 'rss' | 'webhook' | 'api_polling';
  url: string;
  config: Record<string, any>;
  enabled: boolean;
  lastFetchAt: string | null;
  status: 'active' | 'error' | 'disabled';
  itemCount?: number;
}

export interface BootstrapStatus {
  running: boolean;
  mode: 'manual' | 'semi_auto' | 'full_auto';
  cyclesCompleted: number;
  lastCycleAt: string | null;
  currentPhase?: string;
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
  overallScore: number;
  dimensions: {
    name: string;
    score: number;
    maxScore: number;
    details?: string;
  }[];
  violations: {
    rule: string;
    severity: 'info' | 'warning' | 'error';
    message: string;
    file?: string;
  }[];
  checkedAt: string;
}

// -------------------------------------------------------------------------
// Store
// -------------------------------------------------------------------------

export const useSystemZoneStore = defineStore('systemzone', () => {
  // State
  const connected = ref(false);
  const loading = ref(false);
  const error = ref<string | null>(null);

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
    executions.value.filter(e => e.status === 'running')
  );

  const insightsCount = computed(() => insights.value.length);
  const proposalsCount = computed(() => proposals.value.length);

  // ---------------------------------------------------------------
  // API Methods
  // ---------------------------------------------------------------

  async function fetchStatus(): Promise<void> {
    const result = await apiFetch<{ observer: ObserverSummary; strategist: StrategistSummary; guardian: GuardianState }>(
      '/api/systemzone/status'
    );
    if (result.success) {
      status.value = result.data;
      connected.value = true;
    } else {
      connected.value = false;
      error.value = result.error ?? 'Failed to fetch status';
    }
  }

  async function fetchInsights(): Promise<void> {
    const result = await apiFetch<{ insights: Insight[] }>('/api/systemzone/insights');
    if (result.success) {
      insights.value = result.data.insights || [];
    }
  }

  async function addInput(content: string): Promise<boolean> {
    loading.value = true;
    const result = await apiFetch<{}>('/api/systemzone/inputs', {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    loading.value = false;
    return result.success;
  }

  async function addBatchInputs(inputs: { content: string; sourceType?: string }[]): Promise<boolean> {
    loading.value = true;
    const result = await apiFetch<{}>('/api/systemzone/inputs/batch', {
      method: 'POST',
      body: JSON.stringify({ inputs }),
    });
    loading.value = false;
    return result.success;
  }

  async function triggerObserve(): Promise<boolean> {
    loading.value = true;
    const result = await apiFetch<{}>('/api/systemzone/observe', {
      method: 'POST',
      body: JSON.stringify({ trigger: 'manual' }),
    });
    loading.value = false;
    if (result.success) {
      await fetchInsights();
      await fetchStatus();
    }
    return result.success;
  }

  async function triggerAnalyze(): Promise<boolean> {
    loading.value = true;
    const result = await apiFetch<{}>('/api/systemzone/analyze', {
      method: 'POST',
    });
    loading.value = false;
    if (result.success) {
      await fetchProposals();
      await fetchStatus();
    }
    return result.success;
  }

  async function fetchProposals(filterStatus?: string): Promise<void> {
    const query = filterStatus ? `?status=${filterStatus}` : '';
    const result = await apiFetch<{ proposals: Proposal[] }>(`/api/systemzone/proposals${query}`);
    if (result.success) {
      proposals.value = result.data.proposals || [];
    }
  }

  async function approveProposal(id: string, action: 'approve' | 'reject', comment?: string): Promise<boolean> {
    loading.value = true;
    const result = await apiFetch<{}>(`/api/systemzone/proposals/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ action, comment }),
    });
    loading.value = false;
    if (result.success) {
      await fetchProposals();
      await fetchStatus();
    }
    return result.success;
  }

  async function executeProposal(id: string): Promise<boolean> {
    loading.value = true;
    const result = await apiFetch<{ execution: ExecutionResult }>(`/api/systemzone/proposals/${id}/execute`, {
      method: 'POST',
    });
    loading.value = false;
    if (result.success) {
      await fetchProposals();
      await fetchExecutions();
      await fetchStatus();
    }
    return result.success;
  }

  async function fetchExecutions(): Promise<void> {
    const result = await apiFetch<{ executions: ExecutionResult[] }>('/api/systemzone/executions');
    if (result.success) {
      executions.value = result.data.executions || [];
    }
  }

  async function fetchSources(): Promise<void> {
    const result = await apiFetch<{ sources: ExternalSource[] }>('/api/systemzone/sources');
    if (result.success) {
      sources.value = result.data.sources || [];
    }
  }

  async function addSource(source: Omit<ExternalSource, 'id' | 'lastFetchAt' | 'status' | 'itemCount'>): Promise<boolean> {
    loading.value = true;
    const result = await apiFetch<{ source: ExternalSource }>('/api/systemzone/sources', {
      method: 'POST',
      body: JSON.stringify(source),
    });
    loading.value = false;
    if (result.success) {
      await fetchSources();
    }
    return result.success;
  }

  async function removeSource(id: string): Promise<boolean> {
    const result = await apiFetch<{}>(`/api/systemzone/sources/${id}`, {
      method: 'DELETE',
    });
    if (result.success) {
      sources.value = sources.value.filter(s => s.id !== id);
    }
    return result.success;
  }

  async function fetchBootstrapStatus(): Promise<void> {
    const result = await apiFetch<BootstrapStatus>('/api/systemzone/bootstrap/status');
    if (result.success) {
      bootstrapStatus.value = result.data;
    }
  }

  async function startBootstrap(): Promise<boolean> {
    const result = await apiFetch<{}>('/api/systemzone/bootstrap/start', {
      method: 'POST',
    });
    if (result.success) {
      await fetchBootstrapStatus();
    }
    return result.success;
  }

  async function stopBootstrap(): Promise<boolean> {
    const result = await apiFetch<{}>('/api/systemzone/bootstrap/stop', {
      method: 'POST',
    });
    if (result.success) {
      await fetchBootstrapStatus();
    }
    return result.success;
  }

  async function triggerBootstrapCycle(): Promise<boolean> {
    loading.value = true;
    const result = await apiFetch<{}>('/api/systemzone/bootstrap/cycle', {
      method: 'POST',
    });
    loading.value = false;
    if (result.success) {
      await fetchBootstrapStatus();
      await fetchProposals();
      await fetchExecutions();
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
    }
    return result.success;
  }

  async function fetchFitness(): Promise<void> {
    const result = await apiFetch<FitnessReport>('/api/systemzone/fitness');
    if (result.success) {
      fitnessReport.value = result.data;
    }
  }

  // ---------------------------------------------------------------
  // Auto Refresh
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
    loading.value = true;
    await Promise.all([
      fetchStatus(),
      fetchInsights(),
      fetchProposals(),
      fetchExecutions(),
    ]);
    loading.value = false;
    startAutoRefresh();
  }

  function cleanup(): void {
    stopAutoRefresh();
  }

  return {
    // State
    connected,
    loading,
    error,
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

    // Lifecycle
    initialize,
    cleanup,
    startAutoRefresh,
    stopAutoRefresh,
  };
});
