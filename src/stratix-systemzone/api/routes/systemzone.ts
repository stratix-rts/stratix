// ============================================
// SystemZone API Routes
// Phase 1: Step 6 - API 路由 + 认证
// ============================================

import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

import { Observer } from '../../observer/Observer';
import { Strategist } from '../../strategist/Strategist';
import { Guardian } from '../../guardian/Guardian';
import { Executor } from '../../executor/Executor';
import { FitnessEvaluator } from '../../fitness/FitnessEvaluator';
import { SourceManager, SourceInput } from '../../sources/SourceManager';
import type { ExternalSource, RawInput, SourceType, SourceConfig, SourceStatus } from '../../sources/types';

import type { UserInput, Insight, Proposal, ProposalStatus, UserInputType } from '../../types';
import type { ObserverPipelineConfig } from '../../observer/types';
import type { ScannerConfig, ProposalMapperConfig } from '../../strategist/types';
import type { StrategistLLMEnhancerConfig } from '../../strategist/StrategistLLMEnhancer';
import type { ExecutionResult } from '../../executor/types';

import type {
  BootstrapState,
  BootstrapMode,
  BootstrapPhase,
  ExperimentZone,
  ExperimentStatus,
  DiscoveredProposal,
} from '../../bootstrap/types';

import { ZoneAuthGuard } from '../auth/ZoneAuthGuard';

const router = Router();

// Apply owner authentication to all routes
router.use(ZoneAuthGuard.middleware());

// ------------------------------------------------
// In-memory stores (Phase 1 - replace with DB later)
// ------------------------------------------------

// Observer instances per owner
const observerInstances = new Map<string, Observer>();
// Strategist instances per owner
const strategistInstances = new Map<string, Strategist>();
// Guardian instances per owner
const guardianInstances = new Map<string, Guardian>();
// Executor instances per owner
const executorInstances = new Map<string, Executor>();
// FitnessEvaluator instances per owner
const fitnessEvaluatorInstances = new Map<string, FitnessEvaluator>();

// Execution history per owner
const executionsStore = new Map<string, ExecutionResult[]>();

// Stored insights per owner
const insightsStore = new Map<string, Insight[]>();
// Stored inputs per owner
const inputsStore = new Map<string, UserInput[]>();
// Stored proposals per owner
const proposalsStore = new Map<string, Proposal[]>();

// SourceManager instances per owner
const sourceManagerInstances = new Map<string, SourceManager>();
// Raw inputs per owner (keyed by sourceId)
const rawInputsStore = new Map<string, Map<string, RawInput[]>>();

// ------------------------------------------------
// Bootstrap Engine stores (per owner)
// ------------------------------------------------

interface BootstrapStore {
  state: BootstrapState;
  config: {
    requireHumanApprovalForMode: BootstrapMode[];
  };
  engineRunning: boolean;
  cycleInterval: ReturnType<typeof setInterval> | null;
  history: Array<{
    timestamp: Date;
    action: string;
    cycleCount: number;
    proposalsGenerated: number;
    proposalsExecuted: number;
    improvementScore: number;
  }>;
}

function createDefaultBootstrapState(): BootstrapState {
  return {
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
  };
}

const bootstrapStores = new Map<string, BootstrapStore>();

function getBootstrapStore(ownerId: string): BootstrapStore {
  if (!bootstrapStores.has(ownerId)) {
    bootstrapStores.set(ownerId, {
      state: createDefaultBootstrapState(),
      config: {
        requireHumanApprovalForMode: ['full_auto'],
      },
      engineRunning: false,
      cycleInterval: null,
      history: [],
    });
  }
  return bootstrapStores.get(ownerId)!;
}

// ------------------------------------------------
// Experiment stores (per owner)
// ------------------------------------------------

const experimentStores = new Map<string, ExperimentZone[]>();

function getExperimentsForOwner(ownerId: string): ExperimentZone[] {
  if (!experimentStores.has(ownerId)) {
    experimentStores.set(ownerId, []);
  }
  return experimentStores.get(ownerId)!;
}

// ------------------------------------------------
// Helper functions
// ------------------------------------------------

function getDefaultOwnerId(req: Request): string {
  return req.ownerId || 'default-user';
}

/**
 * Extract route param as string (handles Express 5 string[] type)
 */
function getRouteParam(param: string | string[]): string {
  return Array.isArray(param) ? param[0] : param;
}

function getObserver(ownerId: string): Observer {
  if (!observerInstances.has(ownerId)) {
    const config: ObserverPipelineConfig = {
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

    const observer = new Observer(config, {
      saveInsight: async (insight: Insight) => {
        const insights = insightsStore.get(ownerId) || [];
        insights.push(insight);
        insightsStore.set(ownerId, insights);
      },
      saveInput: async (input: UserInput) => {
        const inputs = inputsStore.get(ownerId) || [];
        inputs.push(input);
        inputsStore.set(ownerId, inputs);
      },
    });

    observerInstances.set(ownerId, observer);
  }
  return observerInstances.get(ownerId)!;
}

function getStrategist(ownerId: string): Strategist {
  if (!strategistInstances.has(ownerId)) {
    const scannerConfig: ScannerConfig = {
      timeoutMs: 60000,
      fileSizeThreshold: 500,
      coverageThreshold: 50,
      cacheEnabled: true,
      cacheTtlMs: 30 * 60 * 1000, // 30 minutes
    };

    const mapperConfig: ProposalMapperConfig = {
      coverageThreshold: 50,
      fileSizeThreshold: 500,
    };

    const enhancerConfig: StrategistLLMEnhancerConfig = {
      model: 'claude-sonnet-4-20250514',
      maxTokens: 2048,
      temperature: 0.3,
      timeoutMs: 30000,
    };

    const strategist = new Strategist(
      { scanner: scannerConfig, mapper: mapperConfig, enhancer: enhancerConfig },
      {
        validateProposal: (proposal: Proposal) => {
          const guardian = getGuardian(ownerId);
          return guardian.validateProposal(proposal);
        },
        saveProposals: async (proposals: Proposal[]) => {
          const existing = proposalsStore.get(ownerId) || [];
          proposalsStore.set(ownerId, [...existing, ...proposals]);
        },
      }
    );

    strategistInstances.set(ownerId, strategist);
  }
  return strategistInstances.get(ownerId)!;
}

function getGuardian(ownerId: string): Guardian {
  if (!guardianInstances.has(ownerId)) {
    const guardian = new Guardian({
      protection: {
        forbiddenPaths: ['**/payment/**', '**/permission/**', '**/.env*', '**/credentials/**'],
        requireApproval: true,
        notifyOnProposal: true,
        circuitBreakerEnabled: true,
      },
      circuitBreakerConfig: {
        maxConsecutiveFailures: 3,
        resetAfterMs: 60000,
      },
    });
    guardianInstances.set(ownerId, guardian);
  }
  return guardianInstances.get(ownerId)!;
}

function getExecutor(ownerId: string): Executor {
  if (!executorInstances.has(ownerId)) {
    const guardian = getGuardian(ownerId);
    const executor = new Executor(
      {
        requireApproval: false,
        maxRetries: 2,
      },
      {
        saveExecutionResult: async (result: ExecutionResult) => {
          const executions = executionsStore.get(ownerId) || [];
          executions.push(result);
          executionsStore.set(ownerId, executions);
        },
      }
    );
    executorInstances.set(ownerId, executor);
  }
  return executorInstances.get(ownerId)!;
}

function getFitnessEvaluator(ownerId: string): FitnessEvaluator {
  if (!fitnessEvaluatorInstances.has(ownerId)) {
    const evaluator = new FitnessEvaluator({});
    fitnessEvaluatorInstances.set(ownerId, evaluator);
  }
  return fitnessEvaluatorInstances.get(ownerId)!;
}

function getSourceManager(ownerId: string): SourceManager {
  if (!sourceManagerInstances.has(ownerId)) {
    const manager = new SourceManager({
      maxSources: 50,
      defaultRefreshInterval: 3_600_000,
      maxConcurrentFetches: 5,
      deduplicationWindow: 86_400_000,
      maxItemsPerSource: 100,
      enableAutoClassify: true,
    });
    sourceManagerInstances.set(ownerId, manager);
  }
  return sourceManagerInstances.get(ownerId)!;
}

function getRawInputsForOwner(ownerId: string): Map<string, RawInput[]> {
  if (!rawInputsStore.has(ownerId)) {
    rawInputsStore.set(ownerId, new Map());
  }
  return rawInputsStore.get(ownerId)!;
}

function saveRawInputs(ownerId: string, sourceId: string, inputs: RawInput[]): void {
  const ownerInputs = getRawInputsForOwner(ownerId);
  const existing = ownerInputs.get(sourceId) || [];
  ownerInputs.set(sourceId, [...existing, ...inputs]);
}

// ------------------------------------------------
// Request type definitions
// ------------------------------------------------

interface AddInputRequest {
  content: string;
  type?: UserInputType;
  metadata?: {
    url?: string;
    tags?: string[];
  };
}

interface TriggerObserveRequest {
  trigger?: 'manual';
}

interface ApproveProposalRequest {
  action: 'approve' | 'reject';
  comment?: string;
}

interface GetProposalsQuery {
  status?: ProposalStatus;
  limit?: string;
}

interface GetInsightsQuery {
  archived?: string;
  limit?: string;
}

// ------------------------------------------------
// Routes
// ------------------------------------------------

/**
 * POST /api/systemzone/inputs
 * Add user input to Observer for processing
 */
router.post('/inputs', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const { content, type, metadata } = req.body as AddInputRequest;

    if (!content || typeof content !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Missing required field: content (must be a string)',
      });
      return;
    }

    const observer = getObserver(ownerId);

    // Receive input
    const input = await observer.receiveInput(content, 'api', type, metadata);

    res.json({
      success: true,
      input: {
        id: input.id,
        timestamp: input.timestamp,
        type: input.type,
        contentLength: input.content.length,
      },
    });
  } catch (error) {
    console.error('[SystemZone API] Add input failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to add input',
    });
  }
});

/**
 * POST /api/systemzone/observe
 * Trigger full observation cycle (process all pending inputs)
 */
router.post('/observe', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const { trigger } = req.body as TriggerObserveRequest;

    if (trigger && trigger !== 'manual') {
      res.status(400).json({
        success: false,
        error: 'Invalid trigger. Phase 1 only supports trigger=manual',
      });
      return;
    }

    const observer = getObserver(ownerId);

    // Process all pending inputs
    const insights = await observer.processAll();

    res.json({
      success: true,
      processed: insights.length,
      insights: insights.map((i) => ({
        id: i.id,
        timestamp: i.timestamp,
        type: i.type,
        content: i.content,
        entities: i.entities,
        confidence: i.confidence,
        archived: i.archived,
        severity: i.severity,
        category: i.category,
        details: i.details,
        suggestion: i.suggestion,
        affectedFiles: i.affectedFiles,
      })),
    });
  } catch (error) {
    console.error('[SystemZone API] Observe failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to run observation',
    });
  }
});

/**
 * POST /api/systemzone/analyze
 * Trigger Strategist to scan project and generate proposals
 */
router.post('/analyze', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);

    const strategist = getStrategist(ownerId);

    // Run full analysis
    const proposals = await strategist.analyze();

    res.json({
      success: true,
      generated: proposals.length,
      proposals: proposals.map((p) => ({
        id: p.id,
        timestamp: p.timestamp,
        type: p.type,
        title: p.title,
        description: p.description,
        target: p.target,
        selection: p.selection,
        status: p.status,
      })),
    });
  } catch (error) {
    console.error('[SystemZone API] Analyze failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to run analysis',
    });
  }
});

/**
 * GET /api/systemzone/proposals
 * Get proposals list with optional status filter
 */
router.get('/proposals', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const { status, limit } = req.query as GetProposalsQuery;

    let proposals = proposalsStore.get(ownerId) || [];

    // Filter by status if provided
    if (status) {
      proposals = proposals.filter((p) => p.status === status);
    }

    // Apply limit
    const limitNum = limit ? parseInt(limit, 10) : 50;
    proposals = proposals.slice(-limitNum);

    res.json({
      success: true,
      count: proposals.length,
      proposals: proposals.map((p) => ({
        id: p.id,
        timestamp: p.timestamp,
        type: p.type,
        title: p.title,
        description: p.description,
        target: p.target,
        selection: p.selection,
        status: p.status,
        approvedBy: p.approvedBy,
        executedAt: p.executedAt,
      })),
    });
  } catch (error) {
    console.error('[SystemZone API] Get proposals failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get proposals',
    });
  }
});

/**
 * POST /api/systemzone/proposals/:id/approve
 * Approve or reject a proposal
 */
router.post('/proposals/:id/approve', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const { id } = req.params;
    const { action, comment } = req.body as ApproveProposalRequest;

    if (!action || !['approve', 'reject'].includes(action)) {
      res.status(400).json({
        success: false,
        error: 'Missing or invalid required field: action (must be "approve" or "reject")',
      });
      return;
    }

    const proposals = proposalsStore.get(ownerId) || [];
    const proposalIndex = proposals.findIndex((p) => p.id === id);

    if (proposalIndex === -1) {
      res.status(404).json({
        success: false,
        error: `Proposal not found: ${id}`,
      });
      return;
    }

    const proposal = proposals[proposalIndex];

    if (proposal.status !== 'pending') {
      res.status(409).json({
        success: false,
        error: `Proposal is not pending (current status: ${proposal.status})`,
      });
      return;
    }

    // Update proposal status
    proposal.status = action === 'approve' ? 'approved' : 'rejected';
    proposal.approvedBy = ownerId;

    if (action === 'approve') {
      // Guardian approval check
      const guardian = getGuardian(ownerId);
      const validation = guardian.validateProposal(proposal);

      if (!validation.valid) {
        proposal.status = 'rejected';
        res.json({
          success: false,
          error: `Proposal blocked by Guardian: ${validation.reasons.join(', ')}`,
          proposal: {
            id: proposal.id,
            status: proposal.status,
          },
        });
        return;
      }
    }

    proposals[proposalIndex] = proposal;

    res.json({
      success: true,
      proposal: {
        id: proposal.id,
        status: proposal.status,
        approvedBy: proposal.approvedBy,
      },
      comment,
    });
  } catch (error) {
    console.error('[SystemZone API] Approve proposal failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to approve/reject proposal',
    });
  }
});

/**
 * GET /api/systemzone/insights
 * Get insights list with optional filters
 */
router.get('/insights', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const { archived, limit } = req.query as GetInsightsQuery;

    let insights = insightsStore.get(ownerId) || [];

    // Filter by archived status if provided
    if (archived !== undefined) {
      const archivedBool = archived === 'true';
      insights = insights.filter((i) => i.archived === archivedBool);
    }

    // Apply limit
    const limitNum = limit ? parseInt(limit, 10) : 50;
    insights = insights.slice(-limitNum);

    res.json({
      success: true,
      count: insights.length,
      insights: insights.map((i) => ({
        id: i.id,
        timestamp: i.timestamp,
        createdAt: i.timestamp ? new Date(i.timestamp).toISOString() : null,
        sourceId: i.sourceInputId || '',
        type: i.type,
        content: i.content,
        entities: i.entities,
        confidence: i.confidence,
        archived: i.archived,
        severity: i.severity,
        category: i.category,
        details: i.details,
        suggestion: i.suggestion,
        affectedFiles: i.affectedFiles,
      })),
    });
  } catch (error) {
    console.error('[SystemZone API] Get insights failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get insights',
    });
  }
});

/**
 * GET /api/systemzone/status
 * Get current System Zone status (Observer + Strategist state)
 */
router.get('/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);

    const observer = getObserver(ownerId);
    const strategist = getStrategist(ownerId);
    const guardian = getGuardian(ownerId);

    res.json({
      success: true,
      status: {
        observer: observer.getSummary(),
        strategist: strategist.getSummary(),
        guardian: guardian.getState().status,
      },
    });
  } catch (error) {
    console.error('[SystemZone API] Get status failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get status',
    });
  }
});

// ------------------------------------------------
// Executor Routes
// ------------------------------------------------

/**
 * POST /api/systemzone/proposals/:id/execute
 * Execute an approved proposal
 */
router.post('/proposals/:id/execute', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const { id } = req.params;

    const proposals = proposalsStore.get(ownerId) || [];
    const proposal = proposals.find((p) => p.id === id);

    if (!proposal) {
      res.status(404).json({
        success: false,
        error: `Proposal not found: ${id}`,
      });
      return;
    }

    if (proposal.status !== 'approved') {
      res.status(409).json({
        success: false,
        error: `Proposal is not approved (current status: ${proposal.status})`,
      });
      return;
    }

    // Check fitness before executing
    const fitnessEvaluator = getFitnessEvaluator(ownerId);
    const canExecute = await fitnessEvaluator.canEnableExecutor();

    if (!canExecute) {
      res.status(409).json({
        success: false,
        error: 'Fitness check failed: executor preconditions not met',
        canEnableExecutor: false,
      });
      return;
    }

    const executor = getExecutor(ownerId);

    // Check if proposal type is allowed
    const state = executor.getState();
    const canExec = await executor.canExecute(proposal);

    if (!canExec) {
      res.status(409).json({
        success: false,
        error: 'Proposal cannot be executed (circuit breaker active or executor busy)',
        executorState: {
          phase: state.phase,
          consecutiveFailures: state.consecutiveFailures,
        },
      });
      return;
    }

    const result = await executor.executeProposal(proposal);

    res.json({
      success: result.success,
      execution: {
        proposalId: result.proposalId,
        success: result.success,
        phase: result.phase,
        duration: result.duration,
        error: result.error,
        commitHash: result.commitHash,
      },
    });
  } catch (error) {
    console.error('[SystemZone API] Execute proposal failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to execute proposal',
    });
  }
});

/**
 * GET /api/systemzone/executions
 * Get execution history list
 */
router.get('/executions', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const { limit } = req.query as { limit?: string };

    let executions = executionsStore.get(ownerId) || [];

    const limitNum = limit ? parseInt(limit, 10) : 50;
    executions = executions.slice(-limitNum);

    res.json({
      success: true,
      count: executions.length,
      executions: executions.map((e) => ({
        proposalId: e.proposalId,
        success: e.success,
        phase: e.phase,
        duration: e.duration,
        error: e.error,
        commitHash: e.commitHash,
        rollbackHash: e.rollbackHash,
      })),
    });
  } catch (error) {
    console.error('[SystemZone API] Get executions failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get executions',
    });
  }
});

/**
 * GET /api/systemzone/executions/:id
 * Get single execution detail
 */
router.get('/executions/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const { id } = req.params;

    const executions = executionsStore.get(ownerId) || [];
    const execution = executions.find((e) => e.proposalId === id);

    if (!execution) {
      res.status(404).json({
        success: false,
        error: `Execution not found: ${id}`,
      });
      return;
    }

    res.json({
      success: true,
      execution: {
        proposalId: execution.proposalId,
        success: execution.success,
        phase: execution.phase,
        modifications: execution.modifications,
        testResult: execution.testResult,
        duration: execution.duration,
        error: execution.error,
        commitHash: execution.commitHash,
        rollbackHash: execution.rollbackHash,
      },
    });
  } catch (error) {
    console.error('[SystemZone API] Get execution failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get execution',
    });
  }
});

/**
 * POST /api/systemzone/executions/:id/cancel
 * Cancel an executing task
 */
router.post('/executions/:id/cancel', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const { id } = req.params;

    const executor = getExecutor(ownerId);
    const state = executor.getState();

    if (state.currentProposalId !== id) {
      res.status(409).json({
        success: false,
        error: 'Proposal is not currently executing',
        currentProposalId: state.currentProposalId,
      });
      return;
    }

    await executor.cancelExecution(id);

    res.json({
      success: true,
      message: `Execution of proposal ${id} requested to cancel`,
    });
  } catch (error) {
    console.error('[SystemZone API] Cancel execution failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to cancel execution',
    });
  }
});

/**
 * GET /api/systemzone/fitness
 * Get fitness report
 */
router.get('/fitness', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const fitnessEvaluator = getFitnessEvaluator(ownerId);

    const report = await fitnessEvaluator.evaluate();

    res.json({
      success: true,
      report: {
        timestamp: report.timestamp,
        metrics: report.metrics,
        scores: report.scores,
        passed: report.passed,
        violations: report.violations,
      },
    });
  } catch (error) {
    console.error('[SystemZone API] Get fitness failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get fitness report',
    });
  }
});

/**
 * GET /api/systemzone/fitness/can-execute
 * Check if executor can be enabled
 */
router.get('/fitness/can-execute', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const fitnessEvaluator = getFitnessEvaluator(ownerId);

    const canExecute = await fitnessEvaluator.canEnableExecutor();

    res.json({
      success: true,
      canEnableExecutor: canExecute,
    });
  } catch (error) {
    console.error('[SystemZone API] Check fitness can-execute failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to check fitness',
    });
  }
});

/**
 * POST /api/systemzone/inputs/batch
 * Add multiple user inputs at once
 */
router.post('/inputs/batch', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const { inputs } = req.body as { inputs: AddInputRequest[] };

    if (!inputs || !Array.isArray(inputs)) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: inputs (must be an array)',
      });
      return;
    }

    if (inputs.length > 50) {
      res.status(400).json({
        success: false,
        error: 'Maximum 50 inputs per batch',
      });
      return;
    }

    const observer = getObserver(ownerId);
    const addedInputs: UserInput[] = [];

    for (const inputData of inputs) {
      if (!inputData.content || typeof inputData.content !== 'string') {
        continue;
      }

      const input = await observer.receiveInput(
        inputData.content,
        'api',
        inputData.type,
        inputData.metadata
      );
      addedInputs.push(input);
    }

    res.json({
      success: true,
      added: addedInputs.length,
      inputs: addedInputs.map((i) => ({
        id: i.id,
        timestamp: i.timestamp,
        type: i.type,
        contentLength: i.content.length,
      })),
    });
  } catch (error) {
    console.error('[SystemZone API] Batch add inputs failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to add inputs',
    });
  }
});

// ------------------------------------------------
// Bootstrap Routes
// ------------------------------------------------

interface SetModeRequest {
  mode: BootstrapMode;
  confirmed?: boolean;
}

interface TriggerCycleRequest {
  force?: boolean;
}

interface GetHistoryQuery {
  limit?: string;
}

interface GetExperimentsQuery {
  status?: ExperimentStatus;
  limit?: string;
}

function startBootstrapEngine(ownerId: string): void {
  const store = getBootstrapStore(ownerId);
  if (store.engineRunning) return;

  store.engineRunning = true;
  store.state.phase = 'discovering';

  // Auto-cycle every hour
  store.cycleInterval = setInterval(() => {
    const s = getBootstrapStore(ownerId);
    if (s.engineRunning && s.state.mode !== 'manual') {
      runBootstrapCycle(ownerId).catch(console.error);
    }
  }, 3_600_000);
}

function stopBootstrapEngine(ownerId: string): void {
  const store = getBootstrapStore(ownerId);
  store.engineRunning = false;
  if (store.cycleInterval) {
    clearInterval(store.cycleInterval);
    store.cycleInterval = null;
  }
  store.state.phase = 'idle';
}

async function runBootstrapCycle(ownerId: string): Promise<void> {
  const store = getBootstrapStore(ownerId);

  store.state.phase = 'discovering';
  store.state.lastDiscoveryAt = new Date();
  store.state.cycleCount++;

  // Discovery: generate proposals
  store.state.phase = 'deciding';

  // Decision: approve/reject
  store.state.phase = 'executing';

  // Execute approved proposals
  store.state.phase = 'evaluating';

  // Evaluate impact
  store.state.phase = 'idle';
  store.state.lastCycleAt = new Date();

  // Record history
  store.history.push({
    timestamp: new Date(),
    action: 'cycle',
    cycleCount: store.state.cycleCount,
    proposalsGenerated: store.state.totalProposalsGenerated,
    proposalsExecuted: store.state.totalProposalsExecuted,
    improvementScore: store.state.improvementScore,
  });

  // Keep only last 100 entries
  if (store.history.length > 100) {
    store.history = store.history.slice(-100);
  }
}

/**
 * POST /api/systemzone/bootstrap/start
 * Start the bootstrap engine
 */
router.post('/bootstrap/start', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const store = getBootstrapStore(ownerId);

    if (store.engineRunning) {
      res.status(409).json({
        success: false,
        error: 'Bootstrap engine already running',
      });
      return;
    }

    startBootstrapEngine(ownerId);

    res.json({
      success: true,
      message: 'Bootstrap engine started',
      status: {
        phase: store.state.phase,
        mode: store.state.mode,
        cycleCount: store.state.cycleCount,
      },
    });
  } catch (error) {
    console.error('[SystemZone API] Bootstrap start failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start bootstrap engine',
    });
  }
});

/**
 * POST /api/systemzone/bootstrap/stop
 * Stop the bootstrap engine
 */
router.post('/bootstrap/stop', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const store = getBootstrapStore(ownerId);

    if (!store.engineRunning) {
      res.status(409).json({
        success: false,
        error: 'Bootstrap engine not running',
      });
      return;
    }

    stopBootstrapEngine(ownerId);

    res.json({
      success: true,
      message: 'Bootstrap engine stopped',
      status: {
        phase: store.state.phase,
        mode: store.state.mode,
        cycleCount: store.state.cycleCount,
      },
    });
  } catch (error) {
    console.error('[SystemZone API] Bootstrap stop failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to stop bootstrap engine',
    });
  }
});

/**
 * GET /api/systemzone/bootstrap/status
 * Get bootstrap status
 */
router.get('/bootstrap/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const store = getBootstrapStore(ownerId);

    res.json({
      success: true,
      status: {
        engineRunning: store.engineRunning,
        phase: store.state.phase,
        mode: store.state.mode,
        cycleCount: store.state.cycleCount,
        successCount: store.state.successCount,
        failureCount: store.state.failureCount,
        lastCycleAt: store.state.lastCycleAt,
        lastDiscoveryAt: store.state.lastDiscoveryAt,
        activeExperiments: store.state.activeExperiments,
        consecutiveFailures: store.state.consecutiveFailures,
        totalProposalsGenerated: store.state.totalProposalsGenerated,
        totalProposalsExecuted: store.state.totalProposalsExecuted,
        totalProposalsRolledBack: store.state.totalProposalsRolledBack,
        improvementScore: store.state.improvementScore,
      },
      config: {
        requireHumanApprovalForMode: store.config.requireHumanApprovalForMode,
      },
    });
  } catch (error) {
    console.error('[SystemZone API] Bootstrap status failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get bootstrap status',
    });
  }
});

/**
 * PUT /api/systemzone/bootstrap/mode
 * Switch bootstrap mode
 */
router.put('/bootstrap/mode', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const { mode, confirmed } = req.body as SetModeRequest;

    if (!mode || !['manual', 'semi_auto', 'full_auto'].includes(mode)) {
      res.status(400).json({
        success: false,
        error: 'Missing or invalid required field: mode (must be manual, semi_auto, or full_auto)',
      });
      return;
    }

    const store = getBootstrapStore(ownerId);

    // Check if mode requires human approval
    if (store.config.requireHumanApprovalForMode.includes(mode) && !confirmed) {
      res.status(403).json({
        success: false,
        error: `Switching to ${mode} requires human approval. Please confirm.`,
        requiresConfirmation: true,
        mode,
      });
      return;
    }

    const previousMode = store.state.mode;
    store.state.mode = mode;

    res.json({
      success: true,
      message: `Mode switched from ${previousMode} to ${mode}`,
      previousMode,
      currentMode: mode,
    });
  } catch (error) {
    console.error('[SystemZone API] Bootstrap mode switch failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to switch bootstrap mode',
    });
  }
});

/**
 * POST /api/systemzone/bootstrap/cycle
 * Manually trigger one bootstrap cycle
 */
router.post('/bootstrap/cycle', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const store = getBootstrapStore(ownerId);

    if (store.state.phase !== 'idle' && store.state.phase !== 'paused') {
      res.status(409).json({
        success: false,
        error: `Cannot trigger cycle while in phase: ${store.state.phase}`,
        currentPhase: store.state.phase,
      });
      return;
    }

    await runBootstrapCycle(ownerId);

    res.json({
      success: true,
      message: 'Bootstrap cycle completed',
      status: {
        phase: store.state.phase,
        mode: store.state.mode,
        cycleCount: store.state.cycleCount,
        lastCycleAt: store.state.lastCycleAt,
      },
    });
  } catch (error) {
    console.error('[SystemZone API] Bootstrap cycle failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to run bootstrap cycle',
    });
  }
});

/**
 * GET /api/systemzone/bootstrap/history
 * Get bootstrap history
 */
router.get('/bootstrap/history', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const { limit } = req.query as GetHistoryQuery;

    const store = getBootstrapStore(ownerId);
    let history = [...store.history];

    const limitNum = limit ? parseInt(limit, 10) : 50;
    history = history.slice(-limitNum);

    res.json({
      success: true,
      count: history.length,
      history: history.map(h => ({
        timestamp: h.timestamp,
        action: h.action,
        cycleCount: h.cycleCount,
        proposalsGenerated: h.proposalsGenerated,
        proposalsExecuted: h.proposalsExecuted,
        improvementScore: h.improvementScore,
      })),
    });
  } catch (error) {
    console.error('[SystemZone API] Bootstrap history failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get bootstrap history',
    });
  }
});

// ------------------------------------------------
// Experiment Routes
// ------------------------------------------------

/**
 * GET /api/systemzone/experiments
 * Get experiments list
 */
router.get('/experiments', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const { status, limit } = req.query as GetExperimentsQuery;

    let experiments = getExperimentsForOwner(ownerId);

    if (status) {
      experiments = experiments.filter(e => e.status === status);
    }

    const limitNum = limit ? parseInt(limit, 10) : 50;
    experiments = experiments.slice(-limitNum);

    res.json({
      success: true,
      count: experiments.length,
      experiments: experiments.map(e => ({
        id: e.id,
        name: e.name,
        description: e.description,
        status: e.status,
        proposalId: e.proposalId,
        branchName: e.branchName,
        worktreePath: e.worktreePath,
        createdAt: e.createdAt,
        startedAt: e.startedAt,
        completedAt: e.completedAt,
        parentZoneId: e.parentZoneId,
      })),
    });
  } catch (error) {
    console.error('[SystemZone API] Get experiments failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get experiments',
    });
  }
});

/**
 * GET /api/systemzone/experiments/:id
 * Get experiment detail
 */
router.get('/experiments/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const id = getRouteParam(req.params.id);

    const experiments = getExperimentsForOwner(ownerId);
    const experiment = experiments.find(e => e.id === id);

    if (!experiment) {
      res.status(404).json({
        success: false,
        error: `Experiment not found: ${id}`,
      });
      return;
    }

    res.json({
      success: true,
      experiment: {
        id: experiment.id,
        name: experiment.name,
        description: experiment.description,
        status: experiment.status,
        proposalId: experiment.proposalId,
        branchName: experiment.branchName,
        worktreePath: experiment.worktreePath,
        createdAt: experiment.createdAt,
        startedAt: experiment.startedAt,
        completedAt: experiment.completedAt,
        result: experiment.result,
        parentZoneId: experiment.parentZoneId,
      },
    });
  } catch (error) {
    console.error('[SystemZone API] Get experiment failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get experiment',
    });
  }
});

/**
 * POST /api/systemzone/experiments/:id/cancel
 * Cancel an experiment
 */
router.post('/experiments/:id/cancel', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const id = getRouteParam(req.params.id);

    const experiments = getExperimentsForOwner(ownerId);
    const experiment = experiments.find(e => e.id === id);

    if (!experiment) {
      res.status(404).json({
        success: false,
        error: `Experiment not found: ${id}`,
      });
      return;
    }

    if (experiment.status !== 'running' && experiment.status !== 'proposed') {
      res.status(409).json({
        success: false,
        error: `Cannot cancel experiment in status: ${experiment.status}`,
        currentStatus: experiment.status,
      });
      return;
    }

    experiment.status = 'cancelled';
    experiment.completedAt = new Date();

    res.json({
      success: true,
      message: `Experiment ${id} cancelled`,
      experiment: {
        id: experiment.id,
        status: experiment.status,
        completedAt: experiment.completedAt,
      },
    });
  } catch (error) {
    console.error('[SystemZone API] Cancel experiment failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to cancel experiment',
    });
  }
});

/**
 * DELETE /api/systemzone/experiments/:id
 * Clean up an experiment
 */
router.delete('/experiments/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const id = getRouteParam(req.params.id);

    const experiments = getExperimentsForOwner(ownerId);
    const index = experiments.findIndex(e => e.id === id);

    if (index === -1) {
      res.status(404).json({
        success: false,
        error: `Experiment not found: ${id}`,
      });
      return;
    }

    experiments.splice(index, 1);

    res.json({
      success: true,
      message: `Experiment ${id} deleted`,
    });
  } catch (error) {
    console.error('[SystemZone API] Delete experiment failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete experiment',
    });
  }
});

interface AddSourceRequest {
  name: string;
  type: SourceType;
  url: string;
  config: SourceConfig;
  status?: SourceStatus;
}

interface UpdateSourceRequest {
  name?: string;
  url?: string;
  config?: SourceConfig;
  status?: SourceStatus;
}

interface WebhookRequest {
  payload: string;
  signature?: string;
}

interface GetSourcesQuery {
  status?: SourceStatus;
  type?: SourceType;
}

interface GetInputsQuery {
  limit?: string;
}

/**
 * POST /api/systemzone/sources
 * Add a new external source
 */
router.post('/sources', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const { name, type, url, config, status } = req.body as AddSourceRequest;

    if (!name || typeof name !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Missing required field: name (must be a string)',
      });
      return;
    }

    if (!type || !['rss', 'webhook', 'api_poll', 'file_watcher'].includes(type)) {
      res.status(400).json({
        success: false,
        error: 'Missing or invalid required field: type (must be rss, webhook, api_poll, or file_watcher)',
      });
      return;
    }

    if (!url || typeof url !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Missing required field: url (must be a string)',
      });
      return;
    }

    if (!config || typeof config !== 'object') {
      res.status(400).json({
        success: false,
        error: 'Missing required field: config (must be an object)',
      });
      return;
    }

    const sourceManager = getSourceManager(ownerId);
    const input: SourceInput = {
      name,
      type,
      url,
      config,
      status: status || 'active',
      ownerId,
      lastFetchedAt: null,
      lastError: null,
    };
    const source = await sourceManager.addSource(input);

    res.status(201).json({
      success: true,
      source: {
        id: source.id,
        name: source.name,
        type: source.type,
        status: source.status,
        url: source.url,
        config: source.config,
        ownerId: source.ownerId,
        createdAt: source.createdAt,
        lastFetchedAt: source.lastFetchedAt,
        fetchCount: source.fetchCount,
        errorCount: source.errorCount,
      },
    });
  } catch (error) {
    console.error('[SystemZone API] Add source failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to add source',
    });
  }
});

/**
 * GET /api/systemzone/sources
 * Get all sources for the owner
 */
router.get('/sources', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const { status, type } = req.query as GetSourcesQuery;

    const sourceManager = getSourceManager(ownerId);
    let sources = sourceManager.getSources();

    // Filter by owner
    sources = sources.filter(s => s.ownerId === ownerId);

    // Filter by status if provided
    if (status) {
      sources = sources.filter(s => s.status === status);
    }

    // Filter by type if provided
    if (type) {
      sources = sources.filter(s => s.type === type);
    }

    res.json({
      success: true,
      count: sources.length,
      sources: sources.map(s => ({
        id: s.id,
        name: s.name,
        type: s.type,
        status: s.status,
        url: s.url,
        ownerId: s.ownerId,
        createdAt: s.createdAt,
        lastFetchedAt: s.lastFetchedAt,
        lastError: s.lastError,
        fetchCount: s.fetchCount,
        errorCount: s.errorCount,
      })),
    });
  } catch (error) {
    console.error('[SystemZone API] Get sources failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get sources',
    });
  }
});

/**
 * GET /api/systemzone/sources/:id
 * Get a single source by ID
 */
router.get('/sources/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const id = getRouteParam(req.params.id);

    const sourceManager = getSourceManager(ownerId);
    const source = sourceManager.getSource(id);

    if (!source) {
      res.status(404).json({
        success: false,
        error: `Source not found: ${id}`,
      });
      return;
    }

    // Check ownership
    if (source.ownerId !== ownerId) {
      res.status(403).json({
        success: false,
        error: 'Forbidden: you do not have access to this source',
      });
      return;
    }

    res.json({
      success: true,
      source: {
        id: source.id,
        name: source.name,
        type: source.type,
        status: source.status,
        url: source.url,
        config: source.config,
        ownerId: source.ownerId,
        createdAt: source.createdAt,
        lastFetchedAt: source.lastFetchedAt,
        lastError: source.lastError,
        fetchCount: source.fetchCount,
        errorCount: source.errorCount,
      },
    });
  } catch (error) {
    console.error('[SystemZone API] Get source failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get source',
    });
  }
});

/**
 * PATCH /api/systemzone/sources/:id
 * Update source configuration
 */
router.patch('/sources/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const id = getRouteParam(req.params.id);
    const { name, url, config, status } = req.body as UpdateSourceRequest;

    const sourceManager = getSourceManager(ownerId);
    const existingSource = sourceManager.getSource(id);

    if (!existingSource) {
      res.status(404).json({
        success: false,
        error: `Source not found: ${id}`,
      });
      return;
    }

    // Check ownership
    if (existingSource.ownerId !== ownerId) {
      res.status(403).json({
        success: false,
        error: 'Forbidden: you do not have access to this source',
      });
      return;
    }

    // Validate status if provided
    if (status && !['active', 'paused', 'error', 'disabled'].includes(status)) {
      res.status(400).json({
        success: false,
        error: 'Invalid status (must be active, paused, error, or disabled)',
      });
      return;
    }

    // Note: SourceManager doesn't have an updateSource method, so we directly modify
    // In a real implementation, this would go through the manager
    const updatedSource: ExternalSource = {
      ...existingSource,
      name: name ?? existingSource.name,
      url: url ?? existingSource.url,
      config: config ?? existingSource.config,
      status: status ?? existingSource.status,
    };

    // Update in the internal map (would ideally go through SourceManager)
    (sourceManager as unknown as { sources: Map<string, ExternalSource> }).sources.set(id, updatedSource);

    res.json({
      success: true,
      source: {
        id: updatedSource.id,
        name: updatedSource.name,
        type: updatedSource.type,
        status: updatedSource.status,
        url: updatedSource.url,
        config: updatedSource.config,
        ownerId: updatedSource.ownerId,
        createdAt: updatedSource.createdAt,
        lastFetchedAt: updatedSource.lastFetchedAt,
        lastError: updatedSource.lastError,
        fetchCount: updatedSource.fetchCount,
        errorCount: updatedSource.errorCount,
      },
    });
  } catch (error) {
    console.error('[SystemZone API] Update source failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update source',
    });
  }
});

/**
 * DELETE /api/systemzone/sources/:id
 * Delete a source
 */
router.delete('/sources/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const id = getRouteParam(req.params.id);

    const sourceManager = getSourceManager(ownerId);
    const existingSource = sourceManager.getSource(id);

    if (!existingSource) {
      res.status(404).json({
        success: false,
        error: `Source not found: ${id}`,
      });
      return;
    }

    // Check ownership
    if (existingSource.ownerId !== ownerId) {
      res.status(403).json({
        success: false,
        error: 'Forbidden: you do not have access to this source',
      });
      return;
    }

    await sourceManager.removeSource(id);

    res.json({
      success: true,
      message: `Source ${id} deleted`,
    });
  } catch (error) {
    console.error('[SystemZone API] Delete source failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete source',
    });
  }
});

/**
 * POST /api/systemzone/sources/:id/fetch
 * Manually trigger a fetch for a source
 */
router.post('/sources/:id/fetch', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const id = getRouteParam(req.params.id);

    const sourceManager = getSourceManager(ownerId);
    const source = sourceManager.getSource(id);

    if (!source) {
      res.status(404).json({
        success: false,
        error: `Source not found: ${id}`,
      });
      return;
    }

    // Check ownership
    if (source.ownerId !== ownerId) {
      res.status(403).json({
        success: false,
        error: 'Forbidden: you do not have access to this source',
      });
      return;
    }

    const rawInputs = await sourceManager.fetchSource(id);

    // Store the raw inputs
    if (rawInputs.length > 0) {
      saveRawInputs(ownerId, id, rawInputs);
    }

    res.json({
      success: true,
      sourceId: id,
      fetched: rawInputs.length,
      inputs: rawInputs.map(input => ({
        id: input.id,
        title: input.title,
        url: input.url,
        author: input.author,
        publishedAt: input.publishedAt,
        fetchedAt: input.fetchedAt,
        contentType: input.contentType,
        hash: input.hash,
      })),
    });
  } catch (error) {
    console.error('[SystemZone API] Fetch source failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch source',
    });
  }
});

/**
 * POST /api/systemzone/sources/:id/webhook
 * Receive a webhook callback
 */
router.post('/sources/:id/webhook', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { payload, signature } = req.body as WebhookRequest;

    // Note: Webhook route does not use ZoneAuthGuard as it's called externally
    // The signature verification is done inside processWebhook

    if (!payload || typeof payload !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Missing required field: payload (must be a string)',
      });
      return;
    }

    // Get all source managers and find the one with this source
    // In production, you'd look up by owner from the source ID prefix or lookup table
    let foundSource: ExternalSource | null = null;
    let foundOwnerId: string | null = null;
    const idStr = Array.isArray(id) ? id[0] : id;

    const entries = Array.from(sourceManagerInstances.entries());
    for (const [ownerId, manager] of entries) {
      const source = manager.getSource(idStr);
      if (source) {
        foundSource = source;
        foundOwnerId = ownerId;
        break;
      }
    }

    if (!foundSource || !foundOwnerId) {
      res.status(404).json({
        success: false,
        error: `Source not found: ${idStr}`,
      });
      return;
    }

    if (foundSource.type !== 'webhook') {
      res.status(400).json({
        success: false,
        error: `Source is not a webhook source: ${idStr}`,
      });
      return;
    }

    // Extract signature header
    const signatureHeader = signature || req.headers['x-hub-signature-256'] as string || '';

    const sourceManager = sourceManagerInstances.get(foundOwnerId)!;
    const rawInputs = await sourceManager.processWebhook(
      idStr,
      payload,
      signatureHeader,
      req.headers as Record<string, string>
    );

    // Store the raw inputs
    if (rawInputs.length > 0) {
      saveRawInputs(foundOwnerId, idStr, rawInputs);
    }

    res.json({
      success: true,
      sourceId: idStr,
      processed: rawInputs.length,
      inputs: rawInputs.map(input => ({
        id: input.id,
        title: input.title,
        url: input.url,
        author: input.author,
        publishedAt: input.publishedAt,
        fetchedAt: input.fetchedAt,
        contentType: input.contentType,
        hash: input.hash,
      })),
    });
  } catch (error) {
    console.error('[SystemZone API] Webhook processing failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to process webhook';
    if (message.includes('Invalid webhook signature')) {
      res.status(401).json({
        success: false,
        error: message,
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/systemzone/sources/:id/inputs
 * Get raw inputs for a specific source
 */
router.get('/sources/:id/inputs', async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = getDefaultOwnerId(req);
    const id = getRouteParam(req.params.id);
    const { limit } = req.query as GetInputsQuery;

    const sourceManager = getSourceManager(ownerId);
    const source = sourceManager.getSource(id);

    if (!source) {
      res.status(404).json({
        success: false,
        error: `Source not found: ${id}`,
      });
      return;
    }

    // Check ownership
    if (source.ownerId !== ownerId) {
      res.status(403).json({
        success: false,
        error: 'Forbidden: you do not have access to this source',
      });
      return;
    }

    const ownerInputs = getRawInputsForOwner(ownerId);
    let inputs = ownerInputs.get(id) || [];

    // Apply limit
    const limitNum = limit ? parseInt(limit, 10) : 50;
    inputs = inputs.slice(-limitNum);

    res.json({
      success: true,
      count: inputs.length,
      inputs: inputs.map(input => ({
        id: input.id,
        sourceId: input.sourceId,
        sourceType: input.sourceType,
        title: input.title,
        content: input.content,
        url: input.url,
        author: input.author,
        publishedAt: input.publishedAt,
        fetchedAt: input.fetchedAt,
        contentType: input.contentType,
        metadata: input.metadata,
        hash: input.hash,
      })),
    });
  } catch (error) {
    console.error('[SystemZone API] Get source inputs failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get source inputs',
    });
  }
});

// ------------------------------------------------
// LLM Config Routes
// ------------------------------------------------

interface LLMConfig {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

const LLM_ENV_KEYS = ['LLM_PROVIDER', 'LLM_MODEL', 'LLM_API_KEY', 'LLM_BASE_URL'] as const;

const ENV_FILE_PATH = path.resolve(process.cwd(), '.env');

/**
 * GET /api/systemzone/llm-config
 * Get current LLM configuration from process.env
 */
router.get('/llm-config', async (_req: Request, res: Response): Promise<void> => {
  try {
    const config: LLMConfig = {};
    for (const key of LLM_ENV_KEYS) {
      const value = process.env[key];
      if (value !== undefined) {
        config[key === 'LLM_API_KEY' ? 'apiKey' : key === 'LLM_PROVIDER' ? 'provider' : key === 'LLM_BASE_URL' ? 'baseUrl' : 'model'] = value;
      }
    }

    res.json({
      success: true,
      config,
    });
  } catch (error) {
    console.error('[SystemZone API] Get llm-config failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get LLM config',
    });
  }
});

/**
 * PUT /api/systemzone/llm-config
 * Save LLM configuration to .env file in project root
 */
router.put('/llm-config', async (req: Request, res: Response): Promise<void> => {
  try {
    const { provider, model, apiKey, baseUrl } = req.body as LLMConfig;

    if (!provider && !model && !apiKey && !baseUrl) {
      res.status(400).json({
        success: false,
        error: 'At least one field is required: provider, model, apiKey, baseUrl',
      });
      return;
    }

    // Read existing .env if present
    let envContent = '';
    if (fs.existsSync(ENV_FILE_PATH)) {
      envContent = fs.readFileSync(ENV_FILE_PATH, 'utf-8');
    }

    const updates: Array<{ key: string; value: string }> = [];
    if (provider !== undefined) updates.push({ key: 'LLM_PROVIDER', value: provider });
    if (model !== undefined) updates.push({ key: 'LLM_MODEL', value: model });
    if (apiKey !== undefined) updates.push({ key: 'LLM_API_KEY', value: apiKey });
    if (baseUrl !== undefined) updates.push({ key: 'LLM_BASE_URL', value: baseUrl });

    // Update or append each key
    for (const { key, value } of updates) {
      const regex = new RegExp(`^${key}=.*`, 'm');
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        envContent += envContent.endsWith('\n') ? `${key}=${value}\n` : `\n${key}=${value}\n`;
      }
    }

    fs.writeFileSync(ENV_FILE_PATH, envContent, 'utf-8');

    // Hot-update process.env so Observer/Strategist pick up changes immediately
    for (const { key, value } of updates) {
      process.env[key] = value;
    }

    res.json({
      success: true,
      message: 'LLM config saved to .env',
      config: { provider, model, apiKey, baseUrl },
    });
  } catch (error) {
    console.error('[SystemZone API] Put llm-config failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save LLM config',
    });
  }
});

/**
 * POST /api/systemzone/llm-config/test-chat
 * Test chat with the current LLM configuration
 */
router.post('/llm-config/test-chat', async (req: Request, res: Response): Promise<void> => {
  try {
    const { message } = req.body as { message?: string };

    if (!message || typeof message !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Missing required field: message (must be a string)',
      });
      return;
    }

    const apiKey = process.env.LLM_API_KEY;
    const provider = process.env.LLM_PROVIDER || 'openai';
    const model = process.env.LLM_MODEL;
    const baseUrl = process.env.LLM_BASE_URL;

    if (!apiKey) {
      res.status(400).json({
        success: false,
        error: 'LLM not configured: missing API key',
      });
      return;
    }

    if (!model) {
      res.status(400).json({
        success: false,
        error: 'LLM not configured: missing model',
      });
      return;
    }

    const SYSTEM_PROMPT = 'You are a test assistant. Respond briefly.';

    if (provider === 'anthropic') {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic({
        apiKey,
        baseURL: baseUrl || undefined,
      });

      const response = await client.messages.create({
        model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: message }],
      });

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
      res.json({ success: true, response: text });
    } else {
      // Default to OpenAI-compatible
      const OpenAI = (await import('openai')).default;
      const client = new OpenAI({
        apiKey,
        baseURL: baseUrl || undefined,
      });

      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: message },
        ],
      });

      const text = response.choices[0]?.message?.content || '';
      res.json({ success: true, response: text });
    }
  } catch (error) {
    console.error('[SystemZone API] Test chat failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Test chat failed',
    });
  }
});

// ============================================
// Logs — receive log entries from frontend logger
// ============================================
router.post('/logs', async (req: Request, res: Response): Promise<void> => {
  try {
    const { entries } = req.body as { entries: Array<{ level: string; message: string; timestamp?: string; context?: string }> };
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        const ts = entry.timestamp ?? new Date().toISOString();
        const ctx = entry.context ? `[${entry.context}] ` : '';
        // Use console to mirror frontend logs on the backend
        switch (entry.level) {
          case 'error': console.error(`[SZ:ui ${ts}] ${ctx}${entry.message}`); break;
          case 'warn':  console.warn(`[SZ:ui ${ts}] ${ctx}${entry.message}`); break;
          default:      console.log(`[SZ:ui ${ts}] ${ctx}${entry.message}`); break;
        }
      }
    }
    res.json({ success: true, received: Array.isArray(entries) ? entries.length : 0 });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to receive logs' });
  }
});

export default router;