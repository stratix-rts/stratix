/**
 * @jest-environment jsdom
 */
/**
 * System Zone Pinia Store Tests
 * Tests all actions, getters, and state mutations.
 */

// ---------------------------------------------------------------------------
// Mock browser globals (node environment has no window/document)
// ---------------------------------------------------------------------------

// Define window global before any module imports that reference it
const mockDocument = {
  visibilityState: 'visible',
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
};

global.window = {
  GATEWAY_URL: 'http://127.0.0.1:7524',
  document: mockDocument,
} as unknown as Window & typeof globalThis;

global.document = mockDocument as unknown as Document;

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { useSystemZoneStore } from '../systemzone';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';

// Mock the logger module
jest.mock('../../stratix-systemzone/ui/logger', () => ({
  szLog: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    flush: jest.fn(),
  },
  withLog: jest.fn((_ctx: string, fn: Function) => fn()),
  autoHeal: {
    registerHealAction: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  },
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockSuccess = <T>(data: T) => ({
  success: true,
  data,
});

const mockFailure = (error: string) => ({
  success: false,
  data: null,
  error,
});

const createMockStatus = () => ({
  observer: {
    totalInputs: 10,
    processedInputs: 7,
    pendingInputs: 3,
    lastRunAt: '2026-04-05T10:00:00Z',
    status: 'idle' as const,
  },
  strategist: {
    totalProposals: 5,
    pendingProposals: 2,
    approvedProposals: 2,
    executedProposals: 1,
    lastRunAt: '2026-04-05T10:00:00Z',
    status: 'idle' as const,
  },
  guardian: {
    circuitBreakerOpen: false,
    totalValidations: 20,
    blockedCount: 1,
    lastValidationAt: '2026-04-05T09:55:00Z',
  },
});

const createMockInsight = (overrides?: Partial<import('../systemzone').Insight>): import('../systemzone').Insight => ({
  id: 'insight-1',
  content: 'Test insight content',
  type: 'code_smell',
  confidence: 0.85,
  entities: ['file-a.ts'],
  sourceId: 'src-1',
  createdAt: '2026-04-05T10:00:00Z',
  archived: false,
  ...overrides,
});

const createMockProposal = (overrides?: Partial<import('../systemzone').Proposal>): import('../systemzone').Proposal => ({
  id: 'proposal-1',
  title: 'Test Proposal',
  description: 'Improves code quality',
  type: 'improve_code',
  status: 'pending',
  riskLevel: 'low',
  targetFiles: ['src/a.ts'],
  estimatedImpact: 'medium',
  createdAt: '2026-04-05T10:00:00Z',
  updatedAt: '2026-04-05T10:00:00Z',
  ...overrides,
});

const createMockSource = (overrides?: Partial<import('../systemzone').ExternalSource>): import('../systemzone').ExternalSource => ({
  id: 'source-1',
  name: 'Test RSS Feed',
  type: 'rss',
  url: 'https://example.com/feed.xml',
  config: {},
  enabled: true,
  lastFetchAt: '2026-04-05T10:00:00Z',
  status: 'active',
  itemCount: 42,
  ...overrides,
});

const createMockBootstrapStatus = (): import('../systemzone').BootstrapStatus => ({
  running: false,
  mode: 'manual',
  cyclesCompleted: 5,
  lastCycleAt: '2026-04-05T09:00:00Z',
  currentPhase: 'idle',
});

const createMockFitnessReport = (): import('../systemzone').FitnessReport => ({
  overallScore: 82,
  dimensions: [
    { name: 'correctness', score: 90, maxScore: 100, details: 'All checks passed' },
    { name: 'performance', score: 75, maxScore: 100 },
  ],
  violations: [
    { rule: 'no-any', severity: 'warning' as const, message: 'Avoid using any type', file: 'src/a.ts' },
  ],
  checkedAt: '2026-04-05T10:00:00Z',
});

const createMockExecutionResult = (): import('../systemzone').ExecutionResult => ({
  proposalId: 'proposal-1',
  status: 'completed',
  commitHash: 'abc123',
  changes: ['src/a.ts: modified'],
  testResults: { passed: 10, failed: 0, total: 10 },
  startedAt: '2026-04-05T10:00:00Z',
  completedAt: '2026-04-05T10:01:00Z',
});

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

describe('useSystemZoneStore', () => {
  let store: ReturnType<typeof useSystemZoneStore>;

  beforeEach(() => {
    const pinia = createPinia();
    setActivePinia(pinia);
    store = useSystemZoneStore();
    mockFetch.mockReset();
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Initial State
  // ---------------------------------------------------------------------------

  describe('initial state', () => {
    it('has correct default values', () => {
      expect(store.connected).toBe(false);
      expect(store.globalLoading).toBe(false);
      expect(store.globalError).toBe(null);
      expect(store.loading).toBe(false);
      expect(store.error).toBe(null);
      expect(store.status).toBe(null);
      expect(store.insights).toEqual([]);
      expect(store.proposals).toEqual([]);
      expect(store.executions).toEqual([]);
      expect(store.sources).toEqual([]);
      expect(store.bootstrapStatus).toBe(null);
      expect(store.fitnessReport).toBe(null);
    });

    it('panelLoading has all keys initialized to false', () => {
      expect(store.panelLoading.status).toBe(false);
      expect(store.panelLoading.insights).toBe(false);
      expect(store.panelLoading.proposals).toBe(false);
      expect(store.panelLoading.executions).toBe(false);
      expect(store.panelLoading.sources).toBe(false);
      expect(store.panelLoading.bootstrap).toBe(false);
      expect(store.panelLoading.fitness).toBe(false);
    });

    it('panelError has all keys initialized to null', () => {
      expect(store.panelError.status).toBe(null);
      expect(store.panelError.insights).toBe(null);
      expect(store.panelError.proposals).toBe(null);
      expect(store.panelError.executions).toBe(null);
      expect(store.panelError.sources).toBe(null);
      expect(store.panelError.bootstrap).toBe(null);
      expect(store.panelError.fitness).toBe(null);
    });
  });

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  describe('getters', () => {
    it('pendingProposals returns only pending proposals', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSuccess({ proposals: [
          createMockProposal({ id: 'p1', status: 'pending' }),
          createMockProposal({ id: 'p2', status: 'approved' }),
          createMockProposal({ id: 'p3', status: 'pending' }),
        ]})),
      });
      await store.fetchProposals();
      expect(store.pendingProposals).toHaveLength(2);
      expect(store.pendingProposals.map(p => p.id)).toEqual(['p1', 'p3']);
    });

    it('activeExecutions returns only running executions', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSuccess({ executions: [
          createMockExecutionResult(),
          { ...createMockExecutionResult(), proposalId: 'p2', status: 'running' },
        ]})),
      });
      await store.fetchExecutions();
      expect(store.activeExecutions).toHaveLength(1);
      expect(store.activeExecutions[0].proposalId).toBe('p2');
    });

    it('insightsCount returns correct length', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSuccess({ insights: [
          createMockInsight({ id: 'i1' }),
          createMockInsight({ id: 'i2' }),
        ]})),
      });
      await store.fetchInsights();
      expect(store.insightsCount).toBe(2);
    });

    it('proposalsCount returns correct length', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSuccess({ proposals: [
          createMockProposal({ id: 'p1' }),
          createMockProposal({ id: 'p2' }),
          createMockProposal({ id: 'p3' }),
        ]})),
      });
      await store.fetchProposals();
      expect(store.proposalsCount).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // fetchStatus
  // ---------------------------------------------------------------------------

  describe('fetchStatus', () => {
    it('sets status on success', async () => {
      const mockStatus = createMockStatus();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSuccess(mockStatus)),
      });

      await store.fetchStatus();

      expect(store.status).toEqual(mockStatus);
      expect(store.connected).toBe(true);
      expect(store.globalError).toBe(null);
      expect(store.panelError.status).toBe(null);
      expect(store.panelLoading.status).toBe(false);
    });

    it('sets connected false and error on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockFailure('Server error')),
      });

      await store.fetchStatus();

      expect(store.connected).toBe(false);
      expect(store.globalError).toBe('Server error');
      expect(store.panelError.status).toBe('Server error');
    });

    it('sets panelLoading true while fetching', async () => {
      let resolve: (value: any) => void;
      mockFetch.mockImplementationOnce(() => new Promise(r => resolve = r));

      const p = store.fetchStatus();
      expect(store.panelLoading.status).toBe(true);
      resolve!({ ok: true, json: () => Promise.resolve(mockSuccess(createMockStatus())) });
      await p;
      expect(store.panelLoading.status).toBe(false);
    });

    it('returns void', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSuccess(createMockStatus())),
      });
      const result = await store.fetchStatus();
      expect(result).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // fetchInsights
  // ---------------------------------------------------------------------------

  describe('fetchInsights', () => {
    it('populates insights on success', async () => {
      const insights = [createMockInsight({ id: 'i1' }), createMockInsight({ id: 'i2' })];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSuccess({ insights })),
      });

      await store.fetchInsights();

      expect(store.insights).toEqual(insights);
      expect(store.panelError.insights).toBe(null);
    });

    it('sets panelError on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockFailure('Network error')),
      });

      await store.fetchInsights();

      expect(store.insights).toEqual([]);
      expect(store.panelError.insights).toBe('Network error');
    });

    it('defaults to empty array when data.insights is missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSuccess<any>({})),
      });

      await store.fetchInsights();

      expect(store.insights).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // fetchProposals
  // ---------------------------------------------------------------------------

  describe('fetchProposals', () => {
    it('populates proposals on success', async () => {
      const proposals = [createMockProposal({ id: 'p1' }), createMockProposal({ id: 'p2' })];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSuccess({ proposals })),
      });

      await store.fetchProposals();

      expect(store.proposals).toEqual(proposals);
      expect(store.panelError.proposals).toBe(null);
    });

    it('appends ?status query param when filterStatus is provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSuccess({ proposals: [] })),
      });

      await store.fetchProposals('pending');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('proposals?status=pending'),
        expect.any(Object)
      );
    });

    it('sets panelError on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockFailure('Fetch error')),
      });

      await store.fetchProposals();

      expect(store.panelError.proposals).toBe('Fetch error');
    });
  });

  // ---------------------------------------------------------------------------
  // fetchSources
  // ---------------------------------------------------------------------------

  describe('fetchSources', () => {
    it('populates sources on success', async () => {
      const sources = [createMockSource({ id: 's1' }), createMockSource({ id: 's2' })];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSuccess({ sources })),
      });

      await store.fetchSources();

      expect(store.sources).toEqual(sources);
      expect(store.panelError.sources).toBe(null);
    });

    it('sets panelError on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockFailure('Source error')),
      });

      await store.fetchSources();

      expect(store.panelError.sources).toBe('Source error');
    });

    it('removes source from state after successful delete', async () => {
      // Pre-populate sources
      store.sources = [createMockSource({ id: 's1' }), createMockSource({ id: 's2' })];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSuccess({})),
      });

      await store.removeSource('s1');

      expect(store.sources.map(s => s.id)).toEqual(['s2']);
    });

    it('setPanelError on failed delete', async () => {
      store.sources = [createMockSource({ id: 's1' })];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockFailure('Delete failed')),
      });

      await store.removeSource('s1');

      expect(store.panelError.sources).toBe('Delete failed');
    });
  });

  // ---------------------------------------------------------------------------
  // fetchBootstrapStatus
  // ---------------------------------------------------------------------------

  describe('fetchBootstrapStatus', () => {
    it('populates bootstrapStatus on success', async () => {
      const bootstrapStatus = createMockBootstrapStatus();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSuccess(bootstrapStatus)),
      });

      await store.fetchBootstrapStatus();

      expect(store.bootstrapStatus).toEqual(bootstrapStatus);
      expect(store.panelError.bootstrap).toBe(null);
    });

    it('sets panelError on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockFailure('Bootstrap error')),
      });

      await store.fetchBootstrapStatus();

      expect(store.panelError.bootstrap).toBe('Bootstrap error');
    });
  });

  // ---------------------------------------------------------------------------
  // fetchFitness
  // ---------------------------------------------------------------------------

  describe('fetchFitness', () => {
    it('populates fitnessReport on success', async () => {
      const report = createMockFitnessReport();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSuccess(report)),
      });

      await store.fetchFitness();

      expect(store.fitnessReport).toEqual(report);
      expect(store.panelError.fitness).toBe(null);
    });

    it('sets panelError on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockFailure('Fitness error')),
      });

      await store.fetchFitness();

      expect(store.panelError.fitness).toBe('Fitness error');
    });
  });

  // ---------------------------------------------------------------------------
  // retryPanel
  // ---------------------------------------------------------------------------

  describe('retryPanel', () => {
    it('retries status panel', async () => {
      const mockStatus = createMockStatus();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSuccess(mockStatus)),
      });

      await store.retryPanel('status');

      expect(store.status).toEqual(mockStatus);
    });

    it('retries insights panel', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSuccess({ insights: [createMockInsight({ id: 'i1' })] })),
      });

      await store.retryPanel('insights');

      expect(store.insights).toHaveLength(1);
    });

    it('retries proposals panel', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSuccess({ proposals: [createMockProposal({ id: 'p1' })] })),
      });

      await store.retryPanel('proposals');

      expect(store.proposals).toHaveLength(1);
    });

    it('retries executions panel', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSuccess({ executions: [createMockExecutionResult()] })),
      });

      await store.retryPanel('executions');

      expect(store.executions).toHaveLength(1);
    });

    it('retries sources panel', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSuccess({ sources: [createMockSource({ id: 's1' })] })),
      });

      await store.retryPanel('sources');

      expect(store.sources).toHaveLength(1);
    });

    it('retries bootstrap panel', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSuccess(createMockBootstrapStatus())),
      });

      await store.retryPanel('bootstrap');

      expect(store.bootstrapStatus).not.toBeNull();
    });

    it('retries fitness panel', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSuccess(createMockFitnessReport())),
      });

      await store.retryPanel('fitness');

      expect(store.fitnessReport).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // State mutations — actions that change state
  // ---------------------------------------------------------------------------

  describe('addInput', () => {
    it('sets globalLoading true during the call', async () => {
      let resolve: (value: any) => void;
      mockFetch.mockImplementationOnce(() => new Promise(r => resolve = r));

      const p = store.addInput('test content');
      expect(store.globalLoading).toBe(true);
      resolve!({ ok: true, json: () => Promise.resolve(mockSuccess({})) });
      await p;
      expect(store.globalLoading).toBe(false);
    });

    it('returns true on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSuccess({})),
      });

      const result = await store.addInput('test');
      expect(result).toBe(true);
    });

    it('returns false on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockFailure('Add input failed')),
      });

      const result = await store.addInput('test');
      expect(result).toBe(false);
    });
  });

  describe('addBatchInputs', () => {
    it('returns true on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSuccess({})),
      });

      const result = await store.addBatchInputs([{ content: 'a' }, { content: 'b' }]);
      expect(result).toBe(true);
    });

    it('returns false on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockFailure('Batch error')),
      });

      const result = await store.addBatchInputs([{ content: 'a' }]);
      expect(result).toBe(false);
    });
  });

  describe('triggerObserve', () => {
    it('calls fetchInsights and fetchStatus on success', async () => {
      const insightsResult = { insights: [createMockInsight({ id: 'i1' })] };
      const statusResult = createMockStatus();

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess({})) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess(insightsResult)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess(statusResult)) });

      const result = await store.triggerObserve();
      expect(result).toBe(true);
      expect(store.insights).toHaveLength(1);
    });

    it('returns false on trigger failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockFailure('Trigger error')),
      });

      const result = await store.triggerObserve();
      expect(result).toBe(false);
    });
  });

  describe('triggerAnalyze', () => {
    it('calls fetchProposals and fetchStatus on success', async () => {
      const proposalsResult = { proposals: [createMockProposal({ id: 'p1' })] };
      const statusResult = createMockStatus();

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess({})) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess(proposalsResult)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess(statusResult)) });

      const result = await store.triggerAnalyze();
      expect(result).toBe(true);
      expect(store.proposals).toHaveLength(1);
    });

    it('returns false on trigger failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockFailure('Analyze error')),
      });

      const result = await store.triggerAnalyze();
      expect(result).toBe(false);
    });
  });

  describe('approveProposal', () => {
    it('calls fetchProposals, fetchStatus, fetchExecutions on success', async () => {
      const proposalsResult = { proposals: [createMockProposal({ id: 'p1' })] };
      const statusResult = createMockStatus();
      const executionsResult = { executions: [createMockExecutionResult()] };

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess({})) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess(proposalsResult)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess(statusResult)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess(executionsResult)) });

      const result = await store.approveProposal('p1', 'approve');
      expect(result).toBe(true);
    });

    it('returns false on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockFailure('Approve error')),
      });

      const result = await store.approveProposal('p1', 'approve');
      expect(result).toBe(false);
    });
  });

  describe('executeProposal', () => {
    it('returns true and refreshes data on success', async () => {
      const proposalsResult = { proposals: [createMockProposal({ id: 'p1' })] };
      const executionsResult = { executions: [createMockExecutionResult()] };
      const statusResult = createMockStatus();

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess({ execution: executionsResult.executions[0] })) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess(proposalsResult)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess(executionsResult)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess(statusResult)) });

      const result = await store.executeProposal('p1');
      expect(result).toBe(true);
    });

    it('returns false on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockFailure('Execute error')),
      });

      const result = await store.executeProposal('p1');
      expect(result).toBe(false);
    });
  });

  describe('fetchExecutions', () => {
    it('populates executions on success', async () => {
      const executions = [createMockExecutionResult()];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSuccess({ executions })),
      });

      await store.fetchExecutions();

      expect(store.executions).toEqual(executions);
      expect(store.panelError.executions).toBe(null);
    });

    it('sets panelError on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockFailure('Executions error')),
      });

      await store.fetchExecutions();

      expect(store.panelError.executions).toBe('Executions error');
    });
  });

  describe('addSource', () => {
    it('calls fetchSources on success', async () => {
      const sourcesResult = { sources: [createMockSource({ id: 's1' })] };
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess({ source: sourcesResult.sources[0] })) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess(sourcesResult)) });

      const result = await store.addSource({ name: 'New Source', type: 'rss', url: 'https://x.com', config: {}, enabled: true });
      expect(result).toBe(true);
    });

    it('returns false on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockFailure('Add source error')),
      });

      const result = await store.addSource({ name: 'Bad', type: 'rss', url: 'https://x.com', config: {}, enabled: true });
      expect(result).toBe(false);
    });
  });

  describe('startBootstrap', () => {
    it('calls fetchBootstrapStatus on success', async () => {
      const bootstrapResult = createMockBootstrapStatus();
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess({})) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess(bootstrapResult)) });

      const result = await store.startBootstrap();
      expect(result).toBe(true);
      expect(store.bootstrapStatus).toEqual(bootstrapResult);
    });

    it('returns false on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockFailure('Start error')),
      });

      const result = await store.startBootstrap();
      expect(result).toBe(false);
    });
  });

  describe('stopBootstrap', () => {
    it('calls fetchBootstrapStatus on success', async () => {
      const bootstrapResult = { ...createMockBootstrapStatus(), running: false };
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess({})) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess(bootstrapResult)) });

      const result = await store.stopBootstrap();
      expect(result).toBe(true);
    });

    it('returns false on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockFailure('Stop error')),
      });

      const result = await store.stopBootstrap();
      expect(result).toBe(false);
    });
  });

  describe('triggerBootstrapCycle', () => {
    it('refreshes bootstrap, proposals, executions on success', async () => {
      const bootstrapResult = createMockBootstrapStatus();
      const proposalsResult = { proposals: [createMockProposal({ id: 'p1' })] };
      const executionsResult = { executions: [createMockExecutionResult()] };

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess({})) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess(bootstrapResult)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess(proposalsResult)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess(executionsResult)) });

      const result = await store.triggerBootstrapCycle();
      expect(result).toBe(true);
    });

    it('returns false on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockFailure('Cycle error')),
      });

      const result = await store.triggerBootstrapCycle();
      expect(result).toBe(false);
    });
  });

  describe('setBootstrapMode', () => {
    it('calls fetchBootstrapStatus on success', async () => {
      const bootstrapResult = { ...createMockBootstrapStatus(), mode: 'full_auto' as const };
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess({})) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess(bootstrapResult)) });

      const result = await store.setBootstrapMode('full_auto');
      expect(result).toBe(true);
    });

    it('returns false on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockFailure('Mode error')),
      });

      const result = await store.setBootstrapMode('full_auto');
      expect(result).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // initialize / cleanup
  // ---------------------------------------------------------------------------

  describe('initialize', () => {
    it('calls fetchStatus, fetchInsights, fetchProposals', async () => {
      const statusResult = createMockStatus();
      const insightsResult = { insights: [createMockInsight({ id: 'i1' })] };
      const proposalsResult = { proposals: [createMockProposal({ id: 'p1' })] };

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess(statusResult)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess(insightsResult)) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSuccess(proposalsResult)) });

      await store.initialize();

      expect(store.status).toEqual(statusResult);
      expect(store.insights).toHaveLength(1);
      expect(store.proposals).toHaveLength(1);
      expect(store.globalLoading).toBe(false);
    });

    it('sets globalError on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockFailure('Init error')),
      });

      await store.initialize();

      expect(store.globalError).toBe('Init error');
      expect(store.globalLoading).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('cleans up without throwing', () => {
      expect(() => store.cleanup()).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Computed alias: loading and error
  // ---------------------------------------------------------------------------

  describe('computed aliases', () => {
    it('loading computed mirrors globalLoading', async () => {
      store.globalLoading = true;
      await nextTick();
      expect(store.loading).toBe(true);
      store.globalLoading = false;
      await nextTick();
      expect(store.loading).toBe(false);
    });

    it('error computed mirrors globalError', async () => {
      store.globalError = 'Test error';
      await nextTick();
      expect(store.error).toBe('Test error');
      store.globalError = null;
      await nextTick();
      expect(store.error).toBe(null);
    });
  });

  // ---------------------------------------------------------------------------
  // Network error handling
  // ---------------------------------------------------------------------------

  describe('network errors', () => {
    it('fetchProposals handles network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network is unreachable'));

      await store.fetchProposals();

      expect(store.panelError.proposals).toBe('Network is unreachable');
    });

    it('fetchSources handles network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network is unreachable'));

      await store.fetchSources();

      expect(store.panelError.sources).toBe('Network is unreachable');
    });

    it('fetchBootstrapStatus handles network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network is unreachable'));

      await store.fetchBootstrapStatus();

      expect(store.panelError.bootstrap).toBe('Network is unreachable');
    });

    it('fetchFitness handles network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network is unreachable'));

      await store.fetchFitness();

      expect(store.panelError.fitness).toBe('Network is unreachable');
    });

    it('fetchStatus handles network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network is unreachable'));

      await store.fetchStatus();

      expect(store.connected).toBe(false);
      expect(store.globalError).toBe('Network is unreachable');
    });
  });
});
