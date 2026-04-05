/**
 * SystemZone API Routes - Unit Tests
 *
 * Tests key routes that don't depend on module-level in-memory stores.
 * Routes that read/write internal Maps (proposalsStore, insightsStore, etc.)
 * are skipped because those Maps cannot be populated from tests.
 *
 * Uses supertest + express to test routes via HTTP.
 * Internal class dependencies are mocked with jest.mock().
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
// Mock instance maps (shared across test module loads)
// These simulate the instances that getObserver/getStrategist/etc. create
// ------------------------------------------------

const mockObserverInstances = new Map<string, any>();
const mockStrategistInstances = new Map<string, any>();
const mockGuardianInstances = new Map<string, any>();
const mockExecutorInstances = new Map<string, any>();
const mockFitnessEvaluatorInstances = new Map<string, any>();
const mockSourceManagerInstances = new Map<string, any>();

// ------------------------------------------------
// Mock Observer instance
// ------------------------------------------------

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

// Set after instance creation
mockObserverInstances.set(mockOwnerId, mockObserverInstance);

// Clear instance Maps between tests to avoid state leakage
beforeEach(() => {
  // Reset module cache so systemzone module is re-imported with fresh internal Maps
  jest.resetModules();
  // Clear test file's instance Maps
  mockObserverInstances.delete(mockOwnerId);
  mockStrategistInstances.delete(mockOwnerId);
  mockGuardianInstances.delete(mockOwnerId);
  mockExecutorInstances.delete(mockOwnerId);
  mockFitnessEvaluatorInstances.delete(mockOwnerId);
  mockSourceManagerInstances.delete(mockOwnerId);
  // Re-set the mock instances so they are available
  mockObserverInstances.set(mockOwnerId, mockObserverInstance);
  mockStrategistInstances.set(mockOwnerId, mockStrategistInstance);
  mockGuardianInstances.set(mockOwnerId, mockGuardianInstance);
  mockExecutorInstances.set(mockOwnerId, mockExecutorInstance);
  mockFitnessEvaluatorInstances.set(mockOwnerId, mockFitnessEvaluatorInstance);
  mockSourceManagerInstances.set(mockOwnerId, mockSourceManagerInstance);
});

// ------------------------------------------------
// Mock Strategist instance
// ------------------------------------------------

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

// ------------------------------------------------
// Mock Guardian instance
// ------------------------------------------------

const mockGuardianInstance = {
  validateProposal: jest.fn().mockReturnValue({ valid: true, reasons: [] }),
  getState: jest.fn().mockReturnValue({
    status: 'active',
    circuitBreakerOpen: false,
    consecutiveFailures: 0,
  }),
};

mockGuardianInstances.set(mockOwnerId, mockGuardianInstance);

// ------------------------------------------------
// Mock Executor instance
// ------------------------------------------------

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

// ------------------------------------------------
// Mock FitnessEvaluator instance
// ------------------------------------------------

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

// ------------------------------------------------
// Mock SourceManager instance
// ------------------------------------------------

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
};

mockSourceManagerInstances.set(mockOwnerId, mockSourceManagerInstance);

// ------------------------------------------------
// Module mocking - mock the classes to return our instances
// ------------------------------------------------

jest.mock('../../../observer/Observer', () => ({
  Observer: jest.fn().mockImplementation(() => mockObserverInstance),
}));

jest.mock('../../../strategist/Strategist', () => ({
  Strategist: jest.fn().mockImplementation(() => mockStrategistInstance),
}));

jest.mock('../../../guardian/Guardian', () => ({
  Guardian: jest.fn().mockImplementation(() => mockGuardianInstance),
}));

jest.mock('../../../executor/Executor', () => ({
  Executor: jest.fn().mockImplementation(() => mockExecutorInstance),
}));

jest.mock('../../../fitness/FitnessEvaluator', () => ({
  FitnessEvaluator: jest.fn().mockImplementation(() => mockFitnessEvaluatorInstance),
}));

jest.mock('../../../sources/SourceManager', () => ({
  SourceManager: jest.fn().mockImplementation(() => mockSourceManagerInstance),
}));

// ------------------------------------------------
// Test setup
// ------------------------------------------------

let app: Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
});

beforeEach(() => {
  jest.clearAllMocks();

  // Reset mock returns to default values
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
  mockExecutorInstance.canExecute.mockResolvedValue(true);
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
// Helper: Build test app with router
// ------------------------------------------------

function createTestApp(): Express {
  return app;
}

// ------------------------------------------------
// POST /inputs - Input submission (no store dependency)
// ------------------------------------------------

describe('POST /inputs', () => {
  it('should add input successfully', async () => {
    mockObserverInstance.receiveInput.mockResolvedValueOnce({
      id: 'input-new-1',
      timestamp: new Date(),
      type: 'text',
      content: 'new input content',
    });

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
// POST /observe - Observation cycle (no store dependency)
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
// POST /analyze - Analysis (no store dependency)
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
// GET /status - System status (no store dependency)
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
// GET /fitness - Fitness report (no store dependency)
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
// POST /inputs/batch - Batch input (no store dependency)
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
// GET /sources - List sources (no store dependency)
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
// POST /sources - Add source (no store dependency)
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
// GET /sources/:id - Get single source (no store dependency)
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
// DELETE /sources/:id - Delete source (no store dependency)
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
// Skipped: Routes that depend on module-level stores
// These cannot be tested because proposalsStore, insightsStore,
// executionsStore, experimentStores, and bootstrapStores are
// local to the route module and cannot be populated from tests.
// ------------------------------------------------

describe.skip('GET /proposals (skipped - requires store)', () => {});
describe.skip('POST /proposals/:id/approve (skipped - requires store)', () => {});
describe.skip('GET /insights (skipped - requires store)', () => {});
describe.skip('GET /executions (skipped - requires store)', () => {});
describe.skip('POST /proposals/:id/execute (skipped - requires store)', () => {});
describe.skip('POST /bootstrap/start (skipped - requires store)', () => {});
describe.skip('PUT /bootstrap/mode (skipped - requires store)', () => {});
describe.skip('GET /experiments (skipped - requires store)', () => {});
