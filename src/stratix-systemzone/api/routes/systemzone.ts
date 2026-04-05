// ============================================
// SystemZone API Routes
// Phase 1: Step 6 - API 路由 + 认证
// ============================================

import { Router, Request, Response } from 'express';

import { Observer } from '../../observer/Observer';
import { Strategist } from '../../strategist/Strategist';
import { Guardian } from '../../guardian/Guardian';
import { Executor } from '../../executor/Executor';
import { FitnessEvaluator } from '../../fitness/FitnessEvaluator';

import type { UserInput, Insight, Proposal, ProposalStatus, UserInputType } from '../../types';
import type { ObserverPipelineConfig } from '../../observer/types';
import type { ScannerConfig, ProposalMapperConfig } from '../../strategist/types';
import type { StrategistLLMEnhancerConfig } from '../../strategist/StrategistLLMEnhancer';
import type { ExecutionResult } from '../../executor/types';

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

// ------------------------------------------------
// Helper functions
// ------------------------------------------------

function getDefaultOwnerId(req: Request): string {
  return req.ownerId || 'default-user';
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
        confidence: i.confidence,
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
        type: i.type,
        content: i.content,
        entities: i.entities,
        confidence: i.confidence,
        archived: i.archived,
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

export default router;