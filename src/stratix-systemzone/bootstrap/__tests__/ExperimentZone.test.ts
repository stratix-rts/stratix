/**
 * ExperimentZone.test.ts - 实验区管理测试
 * Phase 4: P4-07 - 实验区 Zone 管理测试
 */

import { EventEmitter } from 'events';

// -------------------------------------------------------------------------
// Mock Interfaces
// -------------------------------------------------------------------------

interface MockWorktreeManager {
  create: jest.Mock<Promise<void>, [string, string, string?]>;
  remove: jest.Mock<Promise<void>, [string]>;
  exists: jest.Mock<boolean, [string]>;
  list: jest.Mock<Array<{ path: string; branch: string }>, []>;
}

interface MockExperimentStore {
  save: jest.Mock<Promise<void>, [any]>;
  findById: jest.Mock<Promise<any | null>, [string]>;
  findByProposalId: jest.Mock<Promise<any | null>, [string]>;
  findByStatus: jest.Mock<Promise<any[]>, [string]>;
  findAll: jest.Mock<Promise<any[]>, []>;
  delete: jest.Mock<Promise<void>, [string]>;
  updateStatus: jest.Mock<Promise<void>, [string, string]>;
  updateResult: jest.Mock<Promise<void>, [string, any]>;
}

// -------------------------------------------------------------------------
// Mock Factories
// -------------------------------------------------------------------------

const createMockWorktreeManager = (): MockWorktreeManager => ({
  create: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined),
  exists: jest.fn().mockReturnValue(true),
  list: jest.fn().mockReturnValue([]),
});

const createMockStore = (): MockExperimentStore => ({
  save: jest.fn().mockResolvedValue(undefined),
  findById: jest.fn().mockResolvedValue(null),
  findByProposalId: jest.fn().mockResolvedValue(null),
  findByStatus: jest.fn().mockResolvedValue([]),
  findAll: jest.fn().mockResolvedValue([]),
  delete: jest.fn().mockResolvedValue(undefined),
  updateStatus: jest.fn().mockResolvedValue(undefined),
  updateResult: jest.fn().mockResolvedValue(undefined),
});

// -------------------------------------------------------------------------
// Test Helpers
// -------------------------------------------------------------------------

const createMockProposal = (overrides: Partial<{
  id: string;
  category: string;
  target: string;
  description: string;
  estimatedImpact: number;
  estimatedRisk: number;
  estimatedEffort: 'low' | 'medium' | 'high';
  source: 'scanner' | 'fitness' | 'external' | 'lesson';
  data: Record<string, unknown>;
}> = {}): any => ({
  id: 'proposal-1',
  category: 'test',
  target: 'src/utils.ts',
  description: 'Add tests for utils module',
  estimatedImpact: 70,
  estimatedRisk: 20,
  estimatedEffort: 'low',
  source: 'scanner',
  data: {},
  ...overrides,
});

const createMockImpactEvaluation = (proposalId: string): any => ({
  proposalId,
  before: {
    timestamp: new Date(),
    testCoverage: 60,
    testPassRate: 90,
    typeErrors: 5,
    lintErrors: 10,
    bundleSize: 1000,
    responseTime: 100,
    fitnessScore: 70,
  },
  after: {
    timestamp: new Date(),
    testCoverage: 75,
    testPassRate: 95,
    typeErrors: 3,
    lintErrors: 5,
    bundleSize: 1000,
    responseTime: 95,
    fitnessScore: 80,
  },
  deltas: {
    testCoverage: 15,
    testPassRate: 5,
    typeErrors: -2,
    lintErrors: -5,
    bundleSize: 0,
    responseTime: -5,
    fitnessScore: 10,
  },
  overallImpact: 25,
  recommendation: 'keep',
});

const createMockExperiment = (overrides: Partial<{
  id: string;
  name: string;
  description: string;
  status: string;
  proposalId: string;
  branchName: string;
  worktreePath: string;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  result: any;
  parentZoneId: string;
}> = {}): any => ({
  id: 'exp-1',
  name: 'Experiment: Test experiment',
  description: 'Test experiment description',
  status: 'proposed',
  proposalId: 'proposal-1',
  branchName: 'experiment/proposal-123',
  worktreePath: '.worktrees/exp-1',
  createdAt: new Date(),
  startedAt: null,
  completedAt: null,
  result: null,
  parentZoneId: 'system-zone-1',
  ...overrides,
});

// -------------------------------------------------------------------------
// Imports
// -------------------------------------------------------------------------

import {
  ExperimentZoneManager,
  InMemoryExperimentStore,
  GitWorktreeManager,
} from '../ExperimentZone';
import type { ExperimentStatus, ExperimentZone } from '../types';

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------

describe('ExperimentZoneManager', () => {
  let mockWorktreeManager: MockWorktreeManager;
  let mockStore: MockExperimentStore;
  let manager: ExperimentZoneManager;
  const parentZoneId = 'system-zone-1';

  beforeEach(() => {
    jest.clearAllMocks();
    mockWorktreeManager = createMockWorktreeManager();
    mockStore = createMockStore();
    manager = new ExperimentZoneManager(parentZoneId, {
      worktreeManager: mockWorktreeManager as any,
      store: mockStore as any,
      config: {
        worktreeBasePath: '.worktrees',
        repoRoot: '/tmp/test-repo',
        maxConcurrentExperiments: 5,
        defaultMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
      },
    });
  });

  describe('createExperiment()', () => {
    it('creates experiment with correct properties', async () => {
      const proposal = createMockProposal();
      mockStore.findByProposalId.mockResolvedValue(null);
      mockStore.findByStatus.mockResolvedValue([]);
      mockWorktreeManager.create.mockResolvedValue(undefined);

      const experiment = await manager.createExperiment(proposal);

      expect(experiment).toHaveProperty('id');
      expect(experiment).toHaveProperty('name');
      expect(experiment.status).toBe('proposed');
      expect(experiment.proposalId).toBe(proposal.id);
      expect(experiment.parentZoneId).toBe(parentZoneId);
      expect(experiment.branchName).toMatch(/^experiment\//);
      expect(experiment.worktreePath).toContain('.worktrees');
    });

    it('calls worktreeManager.create with correct arguments', async () => {
      const proposal = createMockProposal({ id: 'test-proposal' });
      mockStore.findByProposalId.mockResolvedValue(null);
      mockStore.findByStatus.mockResolvedValue([]);
      mockWorktreeManager.create.mockResolvedValue(undefined);

      await manager.createExperiment(proposal);

      const callArgs = mockWorktreeManager.create.mock.calls[0];
      expect(callArgs[0]).toContain('.worktrees/');
      expect(callArgs[1]).toMatch(/^experiment\//);
    });

    it('saves experiment to store', async () => {
      const proposal = createMockProposal();
      mockStore.findByProposalId.mockResolvedValue(null);
      mockStore.findByStatus.mockResolvedValue([]);

      await manager.createExperiment(proposal);

      expect(mockStore.save).toHaveBeenCalledWith(
        expect.objectContaining({
          proposalId: proposal.id,
          status: 'proposed',
          parentZoneId,
        })
      );
    });

    it('throws if proposal already has experiment', async () => {
      const proposal = createMockProposal();
      const existingExp = createMockExperiment({ proposalId: proposal.id });
      mockStore.findByProposalId.mockResolvedValue(existingExp);

      await expect(manager.createExperiment(proposal)).rejects.toThrow(
        `Experiment for proposal ${proposal.id} already exists`
      );
    });

    it('throws if max concurrent experiments reached', async () => {
      const proposal = createMockProposal();
      mockStore.findByProposalId.mockResolvedValue(null);
      mockStore.findByStatus.mockResolvedValue([
        createMockExperiment({ status: 'running' }),
        createMockExperiment({ status: 'running' }),
        createMockExperiment({ status: 'running' }),
        createMockExperiment({ status: 'running' }),
        createMockExperiment({ status: 'running' }),
      ]);

      await expect(manager.createExperiment(proposal)).rejects.toThrow(
        'Maximum concurrent experiments'
      );
    });

    it('throws if worktree creation fails', async () => {
      const proposal = createMockProposal();
      mockStore.findByProposalId.mockResolvedValue(null);
      mockStore.findByStatus.mockResolvedValue([]);
      mockWorktreeManager.create.mockRejectedValue(new Error('Git error'));

      await expect(manager.createExperiment(proposal)).rejects.toThrow('Failed to create worktree');
    });
  });

  describe('startExperiment()', () => {
    it('updates status to running', async () => {
      const experiment = createMockExperiment({ status: 'proposed' });
      mockStore.findById.mockResolvedValue(experiment);
      mockWorktreeManager.exists.mockReturnValue(true);

      await manager.startExperiment(experiment.id);

      expect(mockStore.updateStatus).toHaveBeenCalledWith(experiment.id, 'running');
    });

    it('throws if experiment not found', async () => {
      mockStore.findById.mockResolvedValue(null);

      await expect(manager.startExperiment('nonexistent')).rejects.toThrow(
        'Experiment not found'
      );
    });

    it('throws if experiment not in proposed status', async () => {
      const experiment = createMockExperiment({ status: 'running' });
      mockStore.findById.mockResolvedValue(experiment);

      await expect(manager.startExperiment(experiment.id)).rejects.toThrow(
        'Cannot start experiment in status: running'
      );
    });

    it('recreates worktree if it does not exist', async () => {
      const experiment = createMockExperiment({ status: 'proposed' });
      mockStore.findById.mockResolvedValue(experiment);
      mockWorktreeManager.exists.mockReturnValue(false);
      mockWorktreeManager.create.mockResolvedValue(undefined);

      await manager.startExperiment(experiment.id);

      expect(mockWorktreeManager.create).toHaveBeenCalledWith(
        experiment.worktreePath,
        experiment.branchName
      );
    });
  });

  describe('completeExperiment()', () => {
    it('updates status to completed with result', async () => {
      const experiment = createMockExperiment({ status: 'running' });
      const result = createMockImpactEvaluation(experiment.proposalId);
      mockStore.findById.mockResolvedValue(experiment);

      await manager.completeExperiment(experiment.id, result);

      expect(mockStore.updateStatus).toHaveBeenCalledWith(experiment.id, 'completed');
      expect(mockStore.updateResult).toHaveBeenCalledWith(experiment.id, result);
    });

    it('throws if experiment not found', async () => {
      mockStore.findById.mockResolvedValue(null);

      await expect(
        manager.completeExperiment('nonexistent', createMockImpactEvaluation('p1'))
      ).rejects.toThrow('Experiment not found');
    });

    it('throws if experiment not in running status', async () => {
      const experiment = createMockExperiment({ status: 'proposed' });
      mockStore.findById.mockResolvedValue(experiment);

      await expect(
        manager.completeExperiment(experiment.id, createMockImpactEvaluation(experiment.proposalId))
      ).rejects.toThrow('Cannot complete experiment in status: proposed');
    });
  });

  describe('cancelExperiment()', () => {
    it('updates status to cancelled and removes worktree', async () => {
      const experiment = createMockExperiment({ status: 'running' });
      mockStore.findById.mockResolvedValue(experiment);
      mockWorktreeManager.remove.mockResolvedValue(undefined);

      await manager.cancelExperiment(experiment.id);

      expect(mockWorktreeManager.remove).toHaveBeenCalledWith(experiment.worktreePath);
      expect(mockStore.updateStatus).toHaveBeenCalledWith(experiment.id, 'cancelled');
    });

    it('throws if experiment not found', async () => {
      mockStore.findById.mockResolvedValue(null);

      await expect(manager.cancelExperiment('nonexistent')).rejects.toThrow(
        'Experiment not found'
      );
    });

    it('throws if experiment already completed', async () => {
      const experiment = createMockExperiment({ status: 'completed' });
      mockStore.findById.mockResolvedValue(experiment);

      await expect(manager.cancelExperiment(experiment.id)).rejects.toThrow(
        'Cannot cancel experiment in status: completed'
      );
    });

    it('throws if experiment already cancelled', async () => {
      const experiment = createMockExperiment({ status: 'cancelled' });
      mockStore.findById.mockResolvedValue(experiment);

      await expect(manager.cancelExperiment(experiment.id)).rejects.toThrow(
        'Cannot cancel experiment in status: cancelled'
      );
    });
  });

  describe('listExperiments()', () => {
    it('returns all experiments when no status specified', async () => {
      const experiments = [
        createMockExperiment({ id: 'exp-1' }),
        createMockExperiment({ id: 'exp-2', status: 'running' }),
      ];
      mockStore.findAll.mockResolvedValue(experiments);

      const result = await manager.listExperiments();

      expect(result).toHaveLength(2);
      expect(mockStore.findAll).toHaveBeenCalled();
    });

    it('filters by status when specified', async () => {
      const running = [createMockExperiment({ id: 'exp-1', status: 'running' })];
      mockStore.findByStatus.mockResolvedValue(running);

      const result = await manager.listExperiments('running');

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('running');
      expect(mockStore.findByStatus).toHaveBeenCalledWith('running');
    });

    it('returns empty array when no experiments', async () => {
      mockStore.findAll.mockResolvedValue([]);

      const result = await manager.listExperiments();

      expect(result).toHaveLength(0);
    });
  });

  describe('getExperiment()', () => {
    it('returns experiment by id', async () => {
      const experiment = createMockExperiment();
      mockStore.findById.mockResolvedValue(experiment);

      const result = await manager.getExperiment(experiment.id);

      expect(result).toEqual(experiment);
      expect(mockStore.findById).toHaveBeenCalledWith(experiment.id);
    });

    it('returns null if not found', async () => {
      mockStore.findById.mockResolvedValue(null);

      const result = await manager.getExperiment('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('cleanupCompleted()', () => {
    it('removes experiments older than maxAge', async () => {
      const oldExperiment = createMockExperiment({
        id: 'exp-old',
        status: 'completed',
        completedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
      });
      mockStore.findByStatus.mockResolvedValue([oldExperiment]);

      const cleaned = await manager.cleanupCompleted(7 * 24 * 60 * 60 * 1000); // 7 days

      expect(cleaned).toBe(1);
      expect(mockWorktreeManager.remove).toHaveBeenCalledWith(oldExperiment.worktreePath);
      expect(mockStore.delete).toHaveBeenCalledWith(oldExperiment.id);
    });

    it('keeps experiments newer than maxAge', async () => {
      const recentExperiment = createMockExperiment({
        id: 'exp-recent',
        status: 'completed',
        completedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
      });
      mockStore.findByStatus.mockResolvedValue([recentExperiment]);

      const cleaned = await manager.cleanupCompleted(7 * 24 * 60 * 60 * 1000);

      expect(cleaned).toBe(0);
      expect(mockStore.delete).not.toHaveBeenCalled();
    });

    it('uses default maxAge when not specified', async () => {
      mockStore.findByStatus.mockResolvedValue([]);

      await manager.cleanupCompleted();

      // Should be called with default 7 days
      expect(mockStore.findByStatus).toHaveBeenCalledWith('completed');
    });

    it('handles experiments without completedAt', async () => {
      const experiment = createMockExperiment({
        id: 'exp-no-date',
        status: 'completed',
        completedAt: null,
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
      });
      mockStore.findByStatus.mockResolvedValue([experiment]);

      const cleaned = await manager.cleanupCompleted(7 * 24 * 60 * 60 * 1000);

      expect(cleaned).toBe(1);
    });
  });

  describe('getRunningCount()', () => {
    it('returns count of running experiments', async () => {
      mockStore.findByStatus.mockResolvedValue([
        createMockExperiment({ status: 'running' }),
        createMockExperiment({ status: 'running' }),
      ]);

      const count = await manager.getRunningCount();

      expect(count).toBe(2);
      expect(mockStore.findByStatus).toHaveBeenCalledWith('running');
    });
  });

  describe('getStats()', () => {
    it('returns correct counts per status', async () => {
      mockStore.findAll.mockResolvedValue([
        createMockExperiment({ id: '1', status: 'proposed' }),
        createMockExperiment({ id: '2', status: 'running' }),
        createMockExperiment({ id: '3', status: 'completed' }),
        createMockExperiment({ id: '4', status: 'failed' }),
        createMockExperiment({ id: '5', status: 'cancelled' }),
      ]);

      const stats = await manager.getStats();

      expect(stats.total).toBe(5);
      expect(stats.proposed).toBe(1);
      expect(stats.running).toBe(1);
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.cancelled).toBe(1);
    });
  });
});

describe('InMemoryExperimentStore', () => {
  let store: InMemoryExperimentStore;

  beforeEach(() => {
    store = new InMemoryExperimentStore();
  });

  describe('save() and findById()', () => {
    it('saves and retrieves experiment', async () => {
      const experiment = createMockExperiment();

      await store.save(experiment);
      const found = await store.findById(experiment.id);

      expect(found).toEqual(experiment);
    });

    it('returns null for nonexistent id', async () => {
      const found = await store.findById('nonexistent');

      expect(found).toBeNull();
    });
  });

  describe('findByProposalId()', () => {
    it('finds experiment by proposal id', async () => {
      const experiment = createMockExperiment({ proposalId: 'proposal-x' });
      await store.save(experiment);

      const found = await store.findByProposalId('proposal-x');

      expect(found?.proposalId).toBe('proposal-x');
    });

    it('returns null if not found', async () => {
      const found = await store.findByProposalId('nonexistent');

      expect(found).toBeNull();
    });
  });

  describe('findByStatus()', () => {
    it('filters experiments by status', async () => {
      await store.save(createMockExperiment({ id: '1', status: 'running' }));
      await store.save(createMockExperiment({ id: '2', status: 'running' }));
      await store.save(createMockExperiment({ id: '3', status: 'completed' }));

      const running = await store.findByStatus('running');
      const completed = await store.findByStatus('completed');

      expect(running).toHaveLength(2);
      expect(completed).toHaveLength(1);
    });
  });

  describe('delete()', () => {
    it('removes experiment', async () => {
      const experiment = createMockExperiment();
      await store.save(experiment);

      await store.delete(experiment.id);

      const found = await store.findById(experiment.id);
      expect(found).toBeNull();
    });
  });

  describe('updateStatus()', () => {
    it('updates experiment status', async () => {
      const experiment = createMockExperiment({ status: 'proposed' });
      await store.save(experiment);

      await store.updateStatus(experiment.id, 'running');

      const updated = await store.findById(experiment.id);
      expect(updated?.status).toBe('running');
    });

    it('sets startedAt when transitioning to running', async () => {
      const experiment = createMockExperiment({ status: 'proposed', startedAt: null });
      await store.save(experiment);

      await store.updateStatus(experiment.id, 'running');

      const updated = await store.findById(experiment.id);
      expect(updated?.startedAt).toBeInstanceOf(Date);
    });

    it('sets completedAt when transitioning to terminal status', async () => {
      const experiment = createMockExperiment({ status: 'running', completedAt: null });
      await store.save(experiment);

      await store.updateStatus(experiment.id, 'completed');

      const updated = await store.findById(experiment.id);
      expect(updated?.completedAt).toBeInstanceOf(Date);
    });
  });

  describe('updateResult()', () => {
    it('updates experiment result', async () => {
      const experiment = createMockExperiment();
      await store.save(experiment);

      const result = createMockImpactEvaluation(experiment.proposalId);
      await store.updateResult(experiment.id, result);

      const updated = await store.findById(experiment.id);
      expect(updated?.result).toEqual(result);
    });
  });
});

describe('GitWorktreeManager', () => {
  // Note: GitWorktreeManager requires actual git repo for full testing
  // These tests verify the interface contract

  it('is instantiable', () => {
    expect(() => new GitWorktreeManager('/tmp')).not.toThrow();
  });

  it('exists returns boolean', () => {
    const manager = new GitWorktreeManager('/tmp');
    expect(typeof manager.exists('/nonexistent')).toBe('boolean');
  });

  it('list returns array', () => {
    const manager = new GitWorktreeManager('/tmp');
    expect(Array.isArray(manager.list())).toBe(true);
  });
});
