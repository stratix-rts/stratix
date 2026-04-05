/**
 * SystemZone API Routes - Unit Tests
 *
 * Tests all key routes with happy path + error handling.
 * Uses supertest + express to test routes via HTTP.
 * All internal dependencies are mocked with jest.mock().
 */

import express, { Express } from 'express';
import request from 'supertest';

// ------------------------------------------------
// Mock ZoneAuthGuard before importing router
// ------------------------------------------------

const mockOwnerId = 'test-owner-123';

jest.mock('../../auth/ZoneAuthGuard', () => ({
  ZoneAuthGuard: {
    middleware: () => {
      return (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
        // Inject ownerId for testing
        (_req as express.Request & { ownerId: string }).ownerId = mockOwnerId;
        next();
      };
    },
  },
}));

// ------------------------------------------------
// Mock all internal module dependencies
// ------------------------------------------------

const mockInsightsStore = new Map<string, any[]>();
const mockInputsStore = new Map<string, any[]>();
const mockProposalsStore = new Map<string, any[]>();
const mockExecutionsStore = new Map<string, any[]>();
const mockSourceManagerInstances = new Map<string, any>();
const mockObserverInstances = new Map<string, any>();
const mockStrategistInstances = new Map<string, any>();
const mockGuardianInstances = new Map<string, any>();
const mockExecutorInstances = new Map<string, any>();
const mockFitnessEvaluatorInstances = new Map<string, any>();
const mockBootstrapStores = new Map<string, any>();
const mockExperimentStores = new Map<string, any[]>();
const mockRawInputsStore = new Map<string, Map<string, any[]>>();

// Mock Observer
const mockObserverInstance = {
  receiveInput: jest.fn().mockResolvedValue({
    id: 'input-1',
    timestamp: new Date(),
    type: 'text',
    content: 'test input content',
  }),
  processAll: jest.fn().mockResolvedValue([
    {
      id: 'insight-1',
      timestamp: new Date(),
      type: 'code_smell',
      content: 'Found duplicate code',
      confidence: 0.9,
      entities: [],
      archived: false,
    },
  ]),
  getSummary: jest.fn().mockReturnValue({
    inputsProcessed: 10,
    insightsGenerated: 5,
    lastProcessedAt: new Date(),
  }),
};

mockObserverInstances.set(mockOwnerId, mockObserverInstance);

// Mock Strategist
const mockStrategistInstance = {
  analyze: jest.fn().mockResolvedValue([
    {
      id: 'proposal-1',
      timestamp: new Date(),
      type: 'refactor',
      title: 'Remove duplicate code',
      description: 'Found duplicate code in auth module',
      target: { filePath: 'src/auth.ts', type: 'file' },
      selection: { startLine: 10, endLine: 20 },
      status: 'pending',
    },
  ]),
  getSummary: jest.fn().mockReturnValue({
    proposalsGenerated: 3,
    lastAnalysisAt: new Date(),
  }),
};

mockStrategistInstances.set(mockOwnerId, mockStrategistInstance);

// Mock Guardian
const mockGuardianInstance = {
  validateProposal: jest.fn().mockReturnValue({ valid: true, reasons: [] }),
  getState: jest.fn().mockReturnValue({
    status: 'active',
    circuitBreakerOpen: false,
    consecutiveFailures: 0,
  }),
};

mockGuardianInstances.set(mockOwnerId, mockGuardianInstance);

// Mock Executor
const mockExecutorInstance = {
  executeProposal: jest.fn().mockResolvedValue({
    proposalId: 'proposal-1',
    success: true,
    phase: 'applied',
    duration: 1500,
    error: null,
    commitHash: 'abc123',
    rollbackHash: null,
  }),
  getState: jest.fn().mockReturnValue({
    phase: 'idle',
    currentProposalId: null,
    consecutiveFailures: 0,
  }),
  canExecute: jest.fn().mockResolvedValue(true),
  cancelExecution: jest.fn().mockResolvedValue(undefined),
};

mockExecutorInstances.set(mockOwnerId, mockExecutorInstance);

// Mock FitnessEvaluator
const mockFitnessEvaluatorInstance = {
  evaluate: jest.fn().mockResolvedValue({
    timestamp: new Date(),
    metrics: {
      testCoverage: 80,
      lintErrors: 2,
      typeErrors: 0,
    },
    scores: {
      overall: 85,
      reliability: 90,
      maintainability: 80,
    },
    passed: true,
    violations: [],
  }),
  canEnableExecutor: jest.fn().mockResolvedValue(true),
};

mockFitnessEvaluatorInstances.set(mockOwnerId, mockFitnessEvaluatorInstance);

// Mock SourceManager
const mockSourceManagerInstance = {
  addSource: jest.fn().mockResolvedValue({
    id: 'source-1',
    name: 'Test RSS',
    type: 'rss',
    status: 'active',
    url: 'https://example.com/feed.xml',
    config: { pollInterval: 3600 },
    ownerId: mockOwnerId,
    createdAt: new Date(),
    lastFetchedAt: null,
    fetchCount: 0,
    errorCount: 0,
  }),
  getSources: jest.fn().mockReturnValue([
    {
      id: 'source-1',
      name: 'Test RSS',
      type: 'rss',
      status: 'active',
      url: 'https://example.com/feed.xml',
      ownerId: mockOwnerId,
      createdAt: new Date(),
      lastFetchedAt: new Date(),
      lastError: null,
      fetchCount: 5,
      errorCount: 0,
    },
  ]),
  getSource: jest.fn().mockReturnValue({
    id: 'source-1',
    name: 'Test RSS',
    type: 'rss',
    status: 'active',
    url: 'https://example.com/feed.xml',
    config: { pollInterval: 3600 },
    ownerId: mockOwnerId,
    createdAt: new Date(),
    lastFetchedAt: new Date(),
    lastError: null,
    fetchCount: 5,
    errorCount: 0,
  }),
  removeSource: jest.fn().mockResolvedValue(undefined),
  fetchSource: jest.fn().mockResolvedValue([
    {
      id: 'raw-input-1',
      sourceId: 'source-1',
      sourceType: 'rss',
      title: 'Test Article',
      content: 'Article content here',
      url: 'https://example.com/article-1',
      author: 'Test Author',
      publishedAt: new Date(),
      fetchedAt: new Date(),
      contentType: 'article',
      metadata: {},
      hash: 'hash123',
    },
  ]),
  processWebhook: jest.fn().mockResolvedValue([
    {
      id: 'raw-input-2',
      sourceId: 'source-1',
      sourceType: 'webhook',
      title: 'Webhook Event',
      content: 'Webhook payload',
      url: 'https://example.com/webhook',
      author: null,
      publishedAt: new Date(),
      fetchedAt: new Date(),
      contentType: 'event',
      metadata: {},
      hash: 'hash456',
    },
  ]),
  // Expose internal sources map for PATCH test
  sources: new Map([['source-1', {
    id: 'source-1',
    name: 'Test RSS',
    type: 'rss',
    status: 'active',
    url: 'https://example.com/feed.xml',
    config: { pollInterval: 3600 },
    ownerId: mockOwnerId,
    createdAt: new Date(),
    lastFetchedAt: new Date(),
    lastError: null,
    fetchCount: 5,
    errorCount: 0,
  }]]),
};

mockSourceManagerInstances.set(mockOwnerId, mockSourceManagerInstance);

// Bootstrap store factory
function createMockBootstrapStore() {
  return {
    state: {
      phase: 'idle',
      mode: 'manual',
      cycleCount: 0,
      successCount: 0,
      failureCount: 0,
      lastCycleAt: null,
      lastDiscoveryAt: null,
      activeExperiments: [],
      consecutiveFailures: 0,
      totalProposalsGenerated: 0,
      totalProposalsExecuted: 0,
      totalProposalsRolledBack: 0,
      improvementScore: 50,
    },
    config: {
      requireHumanApprovalForMode: ['full_auto'],
    },
    engineRunning: false,
    cycleInterval: null as NodeJS.Timeout | null,
    history: [] as Array<{
      timestamp: Date;
      action: string;
      cycleCount: number;
      proposalsGenerated: number;
      proposalsExecuted: number;
      improvementScore: number;
    }>,
  };
}

mockBootstrapStores.set(mockOwnerId, createMockBootstrapStore());

// ------------------------------------------------
// Module mocking
// ------------------------------------------------

jest.mock('../../observer/Observer', () => ({
  Observer: jest.fn().mockImplementation(() => mockObserverInstance),
}));

jest.mock('../../strategist/Strategist', () => ({
  Strategist: jest.fn().mockImplementation(() => mockStrategistInstance),
}));

jest.mock('../../guardian/Guardian', () => ({
  Guardian: jest.fn().mockImplementation(() => mockGuardianInstance),
}));

jest.mock('../../executor/Executor', () => ({
  Executor: jest.fn().mockImplementation(() => mockExecutorInstance),
}));

jest.mock('../../fitness/FitnessEvaluator', () => ({
  FitnessEvaluator: jest.fn().mockImplementation(() => mockFitnessEvaluatorInstance),
}));

jest.mock('../../sources/SourceManager', () => ({
  SourceManager: jest.fn().mockImplementation(() => mockSourceManagerInstance),
}));

// ------------------------------------------------
// Import router AFTER mocks are set up
// ------------------------------------------------

// We need to reset modules to ensure our mocks are used
// Use dynamic import after jest.doMock pattern via jest.resetModules

// Instead, we'll use jest.isolateModules to safely import
// For simplicity, we test the router by importing and setting up manually

// ------------------------------------------------
// Test setup
// ------------------------------------------------

let app: Express;

beforeAll(() => {
  // Build the express app and mount the router
  // We do this by importing the route factory
  app = express();
  app.use(express.json());
});

beforeEach(() => {
  // Reset all mock call counts
  jest.clearAllMocks();

  // Reset stores to clean state
  mockInsightsStore.clear();
  mockInputsStore.clear();
  mockProposalsStore.clear();
  mockExecutionsStore.clear();
  mockRawInputsStore.clear();
  mockExperimentStores.set(mockOwnerId, []);

  // Reset bootstrap store
  mockBootstrapStores.set(mockOwnerId, createMockBootstrapStore());

  // Re-setup observer mock to return fresh data
  mockObserverInstance.receiveInput.mockResolvedValue({
    id: `input-${Date.now()}`,
    timestamp: new Date(),
    type: 'text',
    content: 'test input content',
  });

  mockObserverInstance.processAll.mockResolvedValue([
    {
      id: `insight-${Date.now()}`,
      timestamp: new Date(),
      type: 'code_smell',
      content: 'Found duplicate code',
      confidence: 0.9,
      entities: [],
      archived: false,
    },
  ]);

  mockStrategistInstance.analyze.mockResolvedValue([
    {
      id: `proposal-${Date.now()}`,
      timestamp: new Date(),
      type: 'refactor',
      title: 'Remove duplicate code',
      description: 'Found duplicate code in auth module',
      target: { filePath: 'src/auth.ts', type: 'file' },
      selection: { startLine: 10, endLine: 20 },
      status: 'pending',
    },
  ]);

  mockGuardianInstance.validateProposal.mockReturnValue({ valid: true, reasons: [] });
  mockExecutorInstance.executeProposal.mockResolvedValue({
    proposalId: 'proposal-1',
    success: true,
    phase: 'applied',
    duration: 1500,
    error: null,
    commitHash: 'abc123',
    rollbackHash: null,
  });
  mockFitnessEvaluatorInstance.evaluate.mockResolvedValue({
    timestamp: new Date(),
    metrics: { testCoverage: 80, lintErrors: 2, typeErrors: 0 },
    scores: { overall: 85, reliability: 90, maintainability: 80 },
    passed: true,
    violations: [],
  });
  mockFitnessEvaluatorInstance.canEnableExecutor.mockResolvedValue(true);
});

// ------------------------------------------------
// Helper: Build isolated router app for each test
// ------------------------------------------------

function createTestApp(): Express {
  // We create a fresh app with the router for each test to avoid state leakage
  // This re-imports the module with fresh closures
  return app;
}

// ------------------------------------------------
// POST /inputs - Input submission
// ------------------------------------------------

describe('POST /inputs', () => {
  beforeEach(() => {
    // Re-setup the app with the router
    app = express();
    app.use(express.json());
    // We need to dynamically import to get the router with our mocks
  });

  it('should add input successfully', async () => {
    // Build a minimal test using the mocked Observer receiveInput
    mockObserverInstance.receiveInput.mockResolvedValueOnce({
      id: 'input-new-1',
      timestamp: new Date(),
      type: 'text',
      content: 'new input content',
    });

    // Use the route handler directly for isolated testing
    // since module-level Maps make per-test isolation tricky
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/inputs')
      .send({ content: 'new input content' })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.input.id).toBe('input-new-1');
    expect(response.body.input.type).toBe('text');
  });

  it('should reject missing content', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/inputs')
      .send({})
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('Missing required field: content');
  });

  it('should reject non-string content', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/inputs')
      .send({ content: 12345 })
      .expect(400);

    expect(response.body.success).toBe(false);
  });

  it('should handle Observer receiveInput error', async () => {
    mockObserverInstance.receiveInput.mockRejectedValueOnce(
      new Error('Observer failed')
    );

    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/inputs')
      .send({ content: 'test input' })
      .expect(500);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('Observer failed');
  });
});

// ------------------------------------------------
// POST /observe - Observation cycle
// ------------------------------------------------

describe('POST /observe', () => {
  it('should trigger observation successfully', async () => {
    mockObserverInstance.processAll.mockResolvedValueOnce([
      {
        id: 'insight-obs-1',
        timestamp: new Date(),
        type: 'pattern',
        content: 'Detected API usage pattern',
        confidence: 0.85,
        entities: [],
        archived: false,
      },
    ]);

    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/observe')
      .send({ trigger: 'manual' })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.processed).toBe(1);
    expect(response.body.insights[0].id).toBe('insight-obs-1');
  });

  it('should reject invalid trigger value', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/observe')
      .send({ trigger: 'automatic' })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('Invalid trigger');
  });

  it('should handle processAll error', async () => {
    mockObserverInstance.processAll.mockRejectedValueOnce(
      new Error('Observation pipeline failed')
    );

    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/observe')
      .send({})
      .expect(500);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('Observation pipeline failed');
  });
});

// ------------------------------------------------
// POST /analyze - Analysis
// ------------------------------------------------

describe('POST /analyze', () => {
  it('should run analysis successfully', async () => {
    mockStrategistInstance.analyze.mockResolvedValueOnce([
      {
        id: 'proposal-an-1',
        timestamp: new Date(),
        type: 'optimization',
        title: 'Optimize database query',
        description: 'Query can use index',
        target: { filePath: 'src/db.ts', type: 'file' },
        selection: { startLine: 50, endLine: 60 },
        status: 'pending',
      },
    ]);

    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/analyze')
      .send({})
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.generated).toBe(1);
    expect(response.body.proposals[0].title).toBe('Optimize database query');
  });

  it('should handle Strategist analyze error', async () => {
    mockStrategistInstance.analyze.mockRejectedValueOnce(
      new Error('Scanner timeout')
    );

    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/analyze')
      .send({})
      .expect(500);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('Scanner timeout');
  });
});

// ------------------------------------------------
// GET /proposals - List proposals
// ------------------------------------------------

describe('GET /proposals', () => {
  beforeEach(() => {
    // Pre-populate proposals store via the module's internal Map
    // Since we can't directly access module-level Maps, we mock the Strategist's analyze
    // to return proposals that get saved, then we test the GET
    mockProposalsStore.set(mockOwnerId, [
      {
        id: 'proposal-list-1',
        timestamp: new Date(),
        type: 'refactor',
        title: 'First proposal',
        description: 'Description 1',
        target: { filePath: 'src/a.ts', type: 'file' },
        selection: { startLine: 1, endLine: 5 },
        status: 'pending',
      },
      {
        id: 'proposal-list-2',
        timestamp: new Date(),
        type: 'optimization',
        title: 'Second proposal',
        description: 'Description 2',
        target: { filePath: 'src/b.ts', type: 'file' },
        selection: { startLine: 10, endLine: 15 },
        status: 'approved',
        approvedBy: 'test-owner-123',
      },
    ]);
  });

  it('should list all proposals', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .get('/api/systemzone/proposals')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.count).toBe(2);
  });

  it('should filter proposals by status', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .get('/api/systemzone/proposals?status=approved')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.proposals.every((p: any) => p.status === 'approved')).toBe(true);
  });

  it('should apply limit parameter', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .get('/api/systemzone/proposals?limit=1')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.count).toBeLessThanOrEqual(1);
  });

  it('should handle store error', async () => {
    // Force an error by making proposalsStore.get throw
    const originalGet = mockProposalsStore.get.bind(mockProposalsStore);
    mockProposalsStore.get = jest.fn().mockImplementation(() => {
      throw new Error('Store read error');
    });

    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .get('/api/systemzone/proposals')
      .expect(500);

    expect(response.body.success).toBe(false);

    mockProposalsStore.get = originalGet;
  });
});

// ------------------------------------------------
// POST /proposals/:id/approve - Approve/reject proposal
// ------------------------------------------------

describe('POST /proposals/:id/approve', () => {
  beforeEach(() => {
    mockProposalsStore.set(mockOwnerId, [
      {
        id: 'proposal-approve-1',
        timestamp: new Date(),
        type: 'refactor',
        title: 'Proposal to approve',
        description: 'Test description',
        target: { filePath: 'src/test.ts', type: 'file' },
        selection: { startLine: 1, endLine: 10 },
        status: 'pending',
      },
    ]);
  });

  it('should approve a pending proposal', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/proposals/proposal-approve-1/approve')
      .send({ action: 'approve', comment: 'Looks good' })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.proposal.status).toBe('approved');
    expect(response.body.proposal.approvedBy).toBe(mockOwnerId);
    expect(response.body.comment).toBe('Looks good');
  });

  it('should reject a pending proposal', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/proposals/proposal-approve-1/approve')
      .send({ action: 'reject', comment: 'Not ready' })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.proposal.status).toBe('rejected');
  });

  it('should reject missing action', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/proposals/proposal-approve-1/approve')
      .send({})
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('Missing or invalid required field: action');
  });

  it('should reject invalid action value', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/proposals/proposal-approve-1/approve')
      .send({ action: 'maybe' })
      .expect(400);

    expect(response.body.success).toBe(false);
  });

  it('should return 404 for non-existent proposal', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/proposals/non-existent-id/approve')
      .send({ action: 'approve' })
      .expect(404);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('Proposal not found');
  });

  it('should return 409 for already processed proposal', async () => {
    // Change status to already approved
    mockProposalsStore.get(mockOwnerId)![0].status = 'approved';

    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/proposals/proposal-approve-1/approve')
      .send({ action: 'approve' })
      .expect(409);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('Proposal is not pending');
  });

  it('should block proposal when Guardian validation fails', async () => {
    mockGuardianInstance.validateProposal.mockReturnValueOnce({
      valid: false,
      reasons: ['Forbidden path accessed'],
    });

    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/proposals/proposal-approve-1/approve')
      .send({ action: 'approve' })
      .expect(200);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('Proposal blocked by Guardian');
  });

  it('should handle approval error', async () => {
    mockGuardianInstance.validateProposal.mockImplementation(() => {
      throw new Error('Guardian error');
    });

    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/proposals/proposal-approve-1/approve')
      .send({ action: 'approve' })
      .expect(500);

    expect(response.body.success).toBe(false);
  });
});

// ------------------------------------------------
// GET /insights - List insights
// ------------------------------------------------

describe('GET /insights', () => {
  beforeEach(() => {
    mockInsightsStore.set(mockOwnerId, [
      {
        id: 'insight-list-1',
        timestamp: new Date(),
        type: 'code_smell',
        content: 'Long function detected',
        entities: [{ type: 'function', name: 'processData' }],
        confidence: 0.9,
        archived: false,
      },
      {
        id: 'insight-list-2',
        timestamp: new Date(),
        type: 'security',
        content: 'SQL injection risk',
        entities: [],
        confidence: 0.95,
        archived: true,
      },
    ]);
  });

  it('should list all insights', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .get('/api/systemzone/insights')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.count).toBe(2);
  });

  it('should filter by archived status', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .get('/api/systemzone/insights?archived=false')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.insights.every((i: any) => i.archived === false)).toBe(true);
  });

  it('should apply limit parameter', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .get('/api/systemzone/insights?limit=1')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.count).toBeLessThanOrEqual(1);
  });

  it('should handle store error', async () => {
    const originalGet = mockInsightsStore.get.bind(mockInsightsStore);
    mockInsightsStore.get = jest.fn().mockImplementation(() => {
      throw new Error('Insights store error');
    });

    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .get('/api/systemzone/insights')
      .expect(500);

    expect(response.body.success).toBe(false);

    mockInsightsStore.get = originalGet;
  });
});

// ------------------------------------------------
// GET /status - System status
// ------------------------------------------------

describe('GET /status', () => {
  it('should return system status', async () => {
    mockObserverInstance.getSummary.mockReturnValueOnce({
      inputsProcessed: 100,
      insightsGenerated: 50,
      lastProcessedAt: new Date(),
    });
    mockStrategistInstance.getSummary.mockReturnValueOnce({
      proposalsGenerated: 10,
      lastAnalysisAt: new Date(),
    });
    mockGuardianInstance.getState.mockReturnValueOnce({
      status: 'active',
      circuitBreakerOpen: false,
      consecutiveFailures: 0,
    });

    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .get('/api/systemzone/status')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.status.observer).toBeDefined();
    expect(response.body.status.strategist).toBeDefined();
    expect(response.body.status.guardian).toBe('active');
  });

  it('should handle status check error', async () => {
    mockObserverInstance.getSummary.mockImplementation(() => {
      throw new Error('Observer summary error');
    });

    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .get('/api/systemzone/status')
      .expect(500);

    expect(response.body.success).toBe(false);
  });
});

// ------------------------------------------------
// POST /bootstrap/start - Bootstrap engine start
// ------------------------------------------------

describe('POST /bootstrap/start', () => {
  beforeEach(() => {
    mockBootstrapStores.set(mockOwnerId, createMockBootstrapStore());
  });

  it('should start bootstrap engine', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/bootstrap/start')
      .send({})
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Bootstrap engine started');
    expect(response.body.status.phase).toBe('discovering');
    expect(response.body.status.mode).toBe('manual');
  });

  it('should return 409 if engine already running', async () => {
    // Mark engine as already running
    const store = mockBootstrapStores.get(mockOwnerId)!;
    store.engineRunning = true;
    store.state.phase = 'discovering';

    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/bootstrap/start')
      .send({})
      .expect(409);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('Bootstrap engine already running');
  });

  it('should handle start error', async () => {
    const originalSet = mockBootstrapStores.set.bind(mockBootstrapStores);
    mockBootstrapStores.set = jest.fn().mockImplementation(() => {
      throw new Error('Bootstrap store error');
    });

    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/bootstrap/start')
      .send({})
      .expect(500);

    expect(response.body.success).toBe(false);

    mockBootstrapStores.set = originalSet;
  });
});

// ------------------------------------------------
// GET /fitness - Fitness report
// ------------------------------------------------

describe('GET /fitness', () => {
  it('should return fitness report', async () => {
    mockFitnessEvaluatorInstance.evaluate.mockResolvedValueOnce({
      timestamp: new Date(),
      metrics: {
        testCoverage: 75,
        lintErrors: 5,
        typeErrors: 1,
      },
      scores: {
        overall: 80,
        reliability: 85,
        maintainability: 75,
      },
      passed: true,
      violations: [
        { rule: 'test-coverage', severity: 'warning', message: 'Coverage below 80%' },
      ],
    });

    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .get('/api/systemzone/fitness')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.report.scores.overall).toBe(80);
    expect(response.body.report.passed).toBe(true);
    expect(response.body.report.violations).toHaveLength(1);
  });

  it('should handle fitness evaluation error', async () => {
    mockFitnessEvaluatorInstance.evaluate.mockRejectedValueOnce(
      new Error('Fitness evaluation failed')
    );

    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .get('/api/systemzone/fitness')
      .expect(500);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('Fitness evaluation failed');
  });
});

// ------------------------------------------------
// GET /sources - List sources
// ------------------------------------------------

describe('GET /sources', () => {
  beforeEach(() => {
    mockSourceManagerInstance.getSources.mockReturnValue([
      {
        id: 'source-list-1',
        name: 'Tech News RSS',
        type: 'rss',
        status: 'active',
        url: 'https://news.example.com/rss',
        ownerId: mockOwnerId,
        createdAt: new Date(),
        lastFetchedAt: new Date(),
        lastError: null,
        fetchCount: 10,
        errorCount: 0,
      },
      {
        id: 'source-list-2',
        name: 'GitHub Webhook',
        type: 'webhook',
        status: 'active',
        url: 'https://api.example.com/webhook/github',
        ownerId: mockOwnerId,
        createdAt: new Date(),
        lastFetchedAt: new Date(),
        lastError: null,
        fetchCount: 50,
        errorCount: 1,
      },
    ]);
  });

  it('should list all sources', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .get('/api/systemzone/sources')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.count).toBe(2);
    expect(response.body.sources[0].name).toBe('Tech News RSS');
  });

  it('should filter sources by status', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .get('/api/systemzone/sources?status=active')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.sources.every((s: any) => s.status === 'active')).toBe(true);
  });

  it('should filter sources by type', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .get('/api/systemzone/sources?type=webhook')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.sources.every((s: any) => s.type === 'webhook')).toBe(true);
  });

  it('should handle getSources error', async () => {
    mockSourceManagerInstance.getSources.mockImplementationOnce(() => {
      throw new Error('Source manager error');
    });

    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .get('/api/systemzone/sources')
      .expect(500);

    expect(response.body.success).toBe(false);
  });
});

// ------------------------------------------------
// Additional route tests: POST /inputs/batch
// ------------------------------------------------

describe('POST /inputs/batch', () => {
  it('should add multiple inputs in batch', async () => {
    mockObserverInstance.receiveInput
      .mockResolvedValueOnce({ id: 'batch-1', timestamp: new Date(), type: 'text', content: 'input 1' })
      .mockResolvedValueOnce({ id: 'batch-2', timestamp: new Date(), type: 'text', content: 'input 2' });

    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/inputs/batch')
      .send({
        inputs: [
          { content: 'batch input 1' },
          { content: 'batch input 2' },
        ],
      })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.added).toBe(2);
    expect(response.body.inputs).toHaveLength(2);
  });

  it('should reject batch with more than 50 inputs', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const tooManyInputs = Array.from({ length: 51 }, (_, i) => ({ content: `input ${i}` }));

    const response = await request(testApp)
      .post('/api/systemzone/inputs/batch')
      .send({ inputs: tooManyInputs })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('Maximum 50 inputs per batch');
  });

  it('should reject non-array inputs', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/inputs/batch')
      .send({ inputs: 'not an array' })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('inputs (must be an array)');
  });
});

// ------------------------------------------------
// GET /executions - Execution history
// ------------------------------------------------

describe('GET /executions', () => {
  beforeEach(() => {
    mockExecutionsStore.set(mockOwnerId, [
      {
        proposalId: 'exec-1',
        success: true,
        phase: 'applied',
        duration: 1200,
        error: null,
        commitHash: 'commit1',
        rollbackHash: null,
      },
      {
        proposalId: 'exec-2',
        success: false,
        phase: 'failed',
        duration: 500,
        error: 'Test failed',
        commitHash: null,
        rollbackHash: 'rollback1',
      },
    ]);
  });

  it('should list execution history', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .get('/api/systemzone/executions')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.count).toBe(2);
  });

  it('should apply limit to executions', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .get('/api/systemzone/executions?limit=1')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.count).toBeLessThanOrEqual(1);
  });
});

// ------------------------------------------------
// PUT /bootstrap/mode - Bootstrap mode switch
// ------------------------------------------------

describe('PUT /bootstrap/mode', () => {
  beforeEach(() => {
    mockBootstrapStores.set(mockOwnerId, createMockBootstrapStore());
  });

  it('should switch to semi_auto mode', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .put('/api/systemzone/bootstrap/mode')
      .send({ mode: 'semi_auto' })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.currentMode).toBe('semi_auto');
    expect(response.body.previousMode).toBe('manual');
  });

  it('should require confirmation for full_auto mode', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .put('/api/systemzone/bootstrap/mode')
      .send({ mode: 'full_auto' })
      .expect(403);

    expect(response.body.success).toBe(false);
    expect(response.body.requiresConfirmation).toBe(true);
  });

  it('should accept full_auto with confirmation', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .put('/api/systemzone/bootstrap/mode')
      .send({ mode: 'full_auto', confirmed: true })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.currentMode).toBe('full_auto');
  });

  it('should reject invalid mode', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .put('/api/systemzone/bootstrap/mode')
      .send({ mode: 'super_auto' })
      .expect(400);

    expect(response.body.success).toBe(false);
  });
});

// ------------------------------------------------
// POST /sources - Add source
// ------------------------------------------------

describe('POST /sources', () => {
  it('should add a new source', async () => {
    mockSourceManagerInstance.addSource.mockResolvedValueOnce({
      id: 'new-source-1',
      name: 'New RSS Feed',
      type: 'rss',
      status: 'active',
      url: 'https://newfeed.example.com/rss.xml',
      config: { pollInterval: 7200 },
      ownerId: mockOwnerId,
      createdAt: new Date(),
      lastFetchedAt: null,
      fetchCount: 0,
      errorCount: 0,
    });

    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/sources')
      .send({
        name: 'New RSS Feed',
        type: 'rss',
        url: 'https://newfeed.example.com/rss.xml',
        config: { pollInterval: 7200 },
      })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.source.id).toBe('new-source-1');
  });

  it('should reject missing name', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/sources')
      .send({
        type: 'rss',
        url: 'https://example.com/rss.xml',
        config: {},
      })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('name');
  });

  it('should reject invalid type', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/sources')
      .send({
        name: 'Test Source',
        type: 'invalid_type',
        url: 'https://example.com/rss.xml',
        config: {},
      })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('type');
  });

  it('should reject missing url', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/sources')
      .send({
        name: 'Test Source',
        type: 'rss',
        config: {},
      })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('url');
  });
});

// ------------------------------------------------
// GET /sources/:id - Get single source
// ------------------------------------------------

describe('GET /sources/:id', () => {
  it('should return a source by id', async () => {
    mockSourceManagerInstance.getSource.mockReturnValueOnce({
      id: 'source-get-1',
      name: 'Get Test Source',
      type: 'rss',
      status: 'active',
      url: 'https://get.example.com/rss.xml',
      config: { pollInterval: 3600 },
      ownerId: mockOwnerId,
      createdAt: new Date(),
      lastFetchedAt: new Date(),
      lastError: null,
      fetchCount: 3,
      errorCount: 0,
    });

    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .get('/api/systemzone/sources/source-get-1')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.source.id).toBe('source-get-1');
  });

  it('should return 404 for non-existent source', async () => {
    mockSourceManagerInstance.getSource.mockReturnValueOnce(null);

    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .get('/api/systemzone/sources/non-existent')
      .expect(404);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('Source not found');
  });

  it('should return 403 for source owned by different user', async () => {
    mockSourceManagerInstance.getSource.mockReturnValueOnce({
      id: 'other-user-source',
      name: 'Other User Source',
      type: 'rss',
      status: 'active',
      url: 'https://other.example.com/rss.xml',
      config: {},
      ownerId: 'different-owner',
      createdAt: new Date(),
      lastFetchedAt: null,
      lastError: null,
      fetchCount: 0,
      errorCount: 0,
    });

    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .get('/api/systemzone/sources/other-user-source')
      .expect(403);

    expect(response.body.success).toBe(false);
  });
});

// ------------------------------------------------
// POST /proposals/:id/execute - Execute proposal
// ------------------------------------------------

describe('POST /proposals/:id/execute', () => {
  beforeEach(() => {
    mockProposalsStore.set(mockOwnerId, [
      {
        id: 'proposal-exec-1',
        timestamp: new Date(),
        type: 'refactor',
        title: 'Proposal to execute',
        description: 'Test',
        target: { filePath: 'src/test.ts', type: 'file' },
        selection: { startLine: 1, endLine: 10 },
        status: 'approved',
      },
    ]);
  });

  it('should execute an approved proposal', async () => {
    mockFitnessEvaluatorInstance.canEnableExecutor.mockResolvedValueOnce(true);
    mockExecutorInstance.canExecute.mockResolvedValueOnce(true);
    mockExecutorInstance.executeProposal.mockResolvedValueOnce({
      proposalId: 'proposal-exec-1',
      success: true,
      phase: 'applied',
      duration: 2000,
      error: null,
      commitHash: 'exec-commit-123',
      rollbackHash: null,
    });

    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/proposals/proposal-exec-1/execute')
      .send({})
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.execution.commitHash).toBe('exec-commit-123');
  });

  it('should return 404 for non-existent proposal', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/proposals/non-existent/execute')
      .send({})
      .expect(404);

    expect(response.body.success).toBe(false);
  });

  it('should return 409 for non-approved proposal', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/proposals/proposal-exec-1/execute')
      .send({})
      .expect(409);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('not approved');
  });

  it('should return 409 when fitness check fails', async () => {
    mockFitnessEvaluatorInstance.canEnableExecutor.mockResolvedValueOnce(false);

    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .post('/api/systemzone/proposals/proposal-exec-1/execute')
      .send({})
      .expect(409);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('Fitness check failed');
  });
});

// ------------------------------------------------
// DELETE /sources/:id - Delete source
// ------------------------------------------------

describe('DELETE /sources/:id', () => {
  it('should delete a source', async () => {
    mockSourceManagerInstance.getSource.mockReturnValueOnce({
      id: 'source-del-1',
      name: 'Source to delete',
      type: 'rss',
      status: 'active',
      url: 'https://delete.example.com/rss.xml',
      config: {},
      ownerId: mockOwnerId,
      createdAt: new Date(),
      lastFetchedAt: new Date(),
      lastError: null,
      fetchCount: 1,
      errorCount: 0,
    });
    mockSourceManagerInstance.removeSource.mockResolvedValueOnce(undefined);

    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .delete('/api/systemzone/sources/source-del-1')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.message).toContain('deleted');
  });

  it('should return 404 for non-existent source', async () => {
    mockSourceManagerInstance.getSource.mockReturnValueOnce(null);

    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .delete('/api/systemzone/sources/non-existent')
      .expect(404);

    expect(response.body.success).toBe(false);
  });

  it('should return 403 for source owned by different user', async () => {
    mockSourceManagerInstance.getSource.mockReturnValueOnce({
      id: 'other-owner-source',
      name: 'Other Owner Source',
      type: 'rss',
      status: 'active',
      url: 'https://other.example.com/rss.xml',
      config: {},
      ownerId: 'someone-else',
      createdAt: new Date(),
      lastFetchedAt: null,
      lastError: null,
      fetchCount: 0,
      errorCount: 0,
    });

    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .delete('/api/systemzone/sources/other-owner-source')
      .expect(403);

    expect(response.body.success).toBe(false);
  });
});

// ------------------------------------------------
// GET /experiments - List experiments
// ------------------------------------------------

describe('GET /experiments', () => {
  beforeEach(() => {
    mockExperimentStores.set(mockOwnerId, [
      {
        id: 'exp-1',
        name: 'Test Experiment',
        description: 'Testing new feature',
        status: 'running',
        proposalId: 'proposal-1',
        branchName: 'experiment/exp-1',
        worktreePath: '/tmp/exp-1',
        createdAt: new Date(),
        startedAt: new Date(),
        completedAt: null,
        result: null,
        parentZoneId: null,
      },
    ]);
  });

  it('should list experiments', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .get('/api/systemzone/experiments')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.count).toBe(1);
    expect(response.body.experiments[0].name).toBe('Test Experiment');
  });

  it('should filter experiments by status', async () => {
    const { default: router } = await import('../systemzone');

    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/systemzone', router);

    const response = await request(testApp)
      .get('/api/systemzone/experiments?status=completed')
      .expect(200);

    expect(response.body.experiments.every((e: any) => e.status === 'completed')).toBe(true);
  });
});
