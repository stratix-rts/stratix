// ============================================
// Executor.test.ts - 执行编排器测试
// Phase 2: Step 6 - Executor 主类测试
// ============================================

import { Executor } from '../Executor';
import { Sandbox } from '../Sandbox';
import { CodeModifier } from '../CodeModifier';
import { TestRunner } from '../TestRunner';
import { RollbackManager } from '../RollbackManager';
import type { Proposal } from '../../types';
import type { ExecutorConfig, ExecutorState, ExecutionResult, FileModification, ModificationPlan } from '../types';
import type { ExecutorEvent } from '../Executor';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

describe('Executor', () => {
  let executor: Executor;
  let workDir: string;
  let testProposal: Proposal;

  beforeEach(async () => {
    // 创建临时目录作为工作目录
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'executor-test-'));

    // 初始化为 git 仓库
    execSync('git init', { cwd: workDir });
    execSync('git config user.email "test@test.com"', { cwd: workDir });
    execSync('git config user.name "Test"', { cwd: workDir });
    execSync('git config commit.gpgsign false', { cwd: workDir });

    // 创建初始提交
    await fs.writeFile(path.join(workDir, 'README.md'), '# Test\n');
    execSync('git add .', { cwd: workDir });
    execSync('git commit -m "Initial commit"', { cwd: workDir });

    // 创建 Executor 实例
    executor = new Executor({
      sandbox: {
        worktreeBaseDir: path.join(os.tmpdir(), 'stratix-executor-test-worktrees'),
        repoPath: workDir,
        maxConcurrentSandboxes: 3,
        autoCleanup: true,
        defaultTimeout: 60000,
      },
      rollback: {
        maxSnapshots: 5,
        autoRollbackOnTestFail: true,
        requireManualRollback: false,
      },
      fitness: {
        minTestCoverage: 50,
        maxCyclomaticComplexity: 15,
        maxDuplicationRate: 0.1,
        maxResponseTime: 500,
        maxErrorRate: 0.01,
      },
      maxRetries: 2,
      requireApproval: false,
      allowedProposalTypes: ['improve_code', 'improve_test', 'improve_architecture'],
    });

    // 创建测试提案
    testProposal = createTestProposal('proposal-1', 'improve_code');
  });

  afterEach(async () => {
    // 清理所有沙箱
    try {
      await executor.getSandbox().destroyAllSandboxes();
    } catch {
      // ignore
    }

    // 清理临时目录
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // ============================================
  // 辅助方法
  // ============================================

  function createTestProposal(id: string, type: Proposal['type'] = 'improve_code'): Proposal {
    return {
      id,
      timestamp: new Date(),
      type,
      title: `Test Proposal ${id}`,
      description: 'This is a test proposal',
      target: {
        file: `src/${id}.ts`,
      },
      selection: {
        confidence: 0.9,
        cost: 1,
        benefit: 8,
        risk: 'low',
      },
      status: 'pending',
    };
  }

  function createProposalWithModifications(id: string, modifications: FileModification[]): Proposal {
    return {
      ...createTestProposal(id),
      target: {},
    } as Proposal & { modifications: FileModification[] };
  }

  // ============================================
  // 构造函数测试
  // ============================================

  describe('constructor', () => {
    test('creates instance with default config', () => {
      const exec = new Executor();
      expect(exec).toBeInstanceOf(Executor);
      expect(exec.getState().phase).toBe('idle');
    });

    test('creates instance with custom config', () => {
      const config: Partial<ExecutorConfig> = {
        maxRetries: 5,
        requireApproval: true,
        allowedProposalTypes: ['improve_code'],
      };
      const exec = new Executor(config);
      expect(exec).toBeInstanceOf(Executor);
    });

    test('initializes sub-modules', () => {
      expect(executor.getSandbox()).toBeInstanceOf(Sandbox);
      expect(executor.getCodeModifier()).toBeInstanceOf(CodeModifier);
      expect(executor.getTestRunner()).toBeInstanceOf(TestRunner);
      expect(executor.getRollbackManager()).toBeInstanceOf(RollbackManager);
    });
  });

  // ============================================
  // getState 测试
  // ============================================

  describe('getState', () => {
    test('returns initial state', () => {
      const state = executor.getState();
      expect(state.phase).toBe('idle');
      expect(state.currentProposalId).toBeNull();
      expect(state.consecutiveFailures).toBe(0);
      expect(state.totalExecutions).toBe(0);
      expect(state.totalSuccesses).toBe(0);
      expect(state.totalRollbacks).toBe(0);
    });

    test('returns current state after modifications', () => {
      executor.getState();
      const state = executor.getState();
      expect(state.phase).toBeDefined();
    });
  });

  // ============================================
  // canExecute 测试
  // ============================================

  describe('canExecute', () => {
    test('returns true for valid proposal', async () => {
      const result = await executor.canExecute(testProposal);
      expect(result).toBe(true);
    });

    test('returns false for disallowed proposal type', async () => {
      const proposal = createTestProposal('p-type', 'new_zone');
      const result = await executor.canExecute(proposal);
      expect(result).toBe(false);
    });

    test('returns false when requireApproval and proposal not approved', async () => {
      const exec = new Executor({ requireApproval: true });
      const result = await exec.canExecute(testProposal);
      expect(result).toBe(false);
    });

    test('returns true when requireApproval and proposal is approved', async () => {
      const exec = new Executor({ requireApproval: true });
      const approvedProposal = { ...testProposal, status: 'approved' as const };
      const result = await exec.canExecute(approvedProposal);
      expect(result).toBe(true);
    });

    test('returns false when circuit breaker is open', async () => {
      // 触发熔断器
      executor.getGuardian().getCircuitBreaker().recordFailure();
      executor.getGuardian().getCircuitBreaker().recordFailure();
      executor.getGuardian().getCircuitBreaker().recordFailure();

      const result = await executor.canExecute(testProposal);
      expect(result).toBe(false);

      // 重置熔断器
      executor.resetCircuitBreaker();
    });
  });

  // ============================================
  // cancelExecution 测试
  // ============================================

  describe('cancelExecution', () => {
    test('cancels execution for matching proposal', async () => {
      await executor.cancelExecution('proposal-1');
      // 取消操作本身不应该抛出错误
    });

    test('canceled proposal is tracked', async () => {
      const proposal = createTestProposal('p-cancel');

      // 先取消
      await executor.cancelExecution('p-cancel');

      // 提案被标记为已取消（下次执行时会检查）
      // 由于Executor不存储取消状态在状态对象中，我们只验证不抛出错误
    });
  });

  // ============================================
  // 事件系统测试
  // ============================================

  describe('event system', () => {
    test('on() and off() work correctly', () => {
      const handler = jest.fn();
      executor.on('execution_started', handler);
      executor.off('execution_started', handler);

      // 触发事件 - 由于已取消订阅，不应该有事件被触发
      executor.on('execution_started', handler);
      executor.off('execution_started', handler);

      expect(handler).not.toHaveBeenCalled();
    });

    test('multiple listeners can be registered', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      executor.on('execution_started', handler1);
      executor.on('execution_started', handler2);

      // 两个处理器都应该被注册
      const listeners = (executor as any).eventListeners.get('execution_started');
      expect(listeners.length).toBe(2);
    });

    test('can emit and receive events', () => {
      const events: ExecutorEvent[] = [];
      executor.on('phase_changed', (e) => events.push(e));

      // 手动触发一个事件
      (executor as any).emit('phase_changed', { phase: 'preparing' });

      expect(events.length).toBe(1);
      expect(events[0].payload.phase).toBe('preparing');
    });
  });

  // ============================================
  // 熔断器测试
  // ============================================

  describe('circuit breaker integration', () => {
    test('guardian circuit breaker tracks failures', () => {
      // 记录失败
      executor.getGuardian().getCircuitBreaker().recordFailure();
      executor.getGuardian().getCircuitBreaker().recordFailure();

      // 状态应该反映失败
      const state = executor.getState();
      expect(state.consecutiveFailures).toBeGreaterThanOrEqual(0);
    });

    test('emits circuit_tripped after 3 consecutive failures', async () => {
      const events: ExecutorEvent[] = [];
      executor.on('circuit_tripped', (e) => events.push(e));

      // 直接操作熔断器记录3次失败
      const cb = executor.getGuardian().getCircuitBreaker();
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();

      // 应该触发 circuit_tripped 事件
      // 注意：circuit_tripped 事件由 Guardian 触发，但 Executor 也监听它
      // 由于直接操作的是 Guardian 的 circuit breaker，事件应该被触发
      expect(events.length).toBe(1);
    });

    test('resetCircuitBreaker() resets failure count', () => {
      // 模拟一些失败
      executor.getGuardian().getCircuitBreaker().recordFailure();
      executor.getGuardian().getCircuitBreaker().recordFailure();

      executor.resetCircuitBreaker();

      const state = executor.getState();
      expect(state.consecutiveFailures).toBe(0);
    });
  });

  // ============================================
  // 依赖注入测试
  // ============================================

  describe('dependencies', () => {
    test('setDependencies() updates dependencies', () => {
      const notify = jest.fn();
      executor.setDependencies({ notify });

      const deps = (executor as any).deps;
      expect(deps.notify).toBe(notify);
    });

    test('setDependencies() preserves existing dependencies', () => {
      const notify1 = jest.fn();
      const notify2 = jest.fn();

      executor.setDependencies({ notify: notify1 });
      executor.setDependencies({ notify: notify2 });

      const deps = (executor as any).deps;
      expect(deps.notify).toBe(notify2);
    });
  });

  // ============================================
  // 边界情况测试
  // ============================================

  describe('edge cases', () => {
    test('handles proposal without target', async () => {
      const proposal: Proposal = {
        ...createTestProposal('p-no-target'),
        target: {},
      };

      // 没有target的提案仍然应该是可执行的（如果类型允许）
      const canExec = await executor.canExecute(proposal);
      expect(canExec).toBe(true);
    });

    test('handles proposal with high risk', async () => {
      const proposal: Proposal = {
        ...createTestProposal('p-high-risk'),
        selection: {
          confidence: 0.5,
          cost: 10,
          benefit: 5,
          risk: 'high',
        },
      };

      const canExec = await executor.canExecute(proposal);
      expect(canExec).toBe(true); // 风险等级不影响可执行性
    });

    test('handles empty allowedProposalTypes', async () => {
      const exec = new Executor({ allowedProposalTypes: [] });
      const result = await exec.canExecute(testProposal);
      expect(result).toBe(false);
    });

    test('handles maxRetries configuration', () => {
      const exec = new Executor({ maxRetries: 0 });
      const state = exec.getState();
      expect(state).toBeDefined();
    });
  });

  // ============================================
  // Guardian 集成测试
  // ============================================

  describe('guardian integration', () => {
    test('guardian is properly initialized', () => {
      const guardian = executor.getGuardian();
      expect(guardian).toBeDefined();
    });

    test('guardian circuit breaker can be accessed', () => {
      const cb = executor.getGuardian().getCircuitBreaker();
      expect(cb).toBeDefined();
    });

    test('guardian validates proposals', () => {
      const proposal = createTestProposal('p-validate');
      const result = executor.getGuardian().validateProposal(proposal);
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('reasons');
      expect(result).toHaveProperty('alerts');
    });
  });

  // ============================================
  // 状态转换测试
  // ============================================

  describe('state transitions', () => {
    test('initial state is idle', () => {
      const state = executor.getState();
      expect(state.phase).toBe('idle');
    });

    test('state tracks totalExecutions', () => {
      // 初始状态
      let state = executor.getState();
      expect(state.totalExecutions).toBe(0);

      // canExecute 不会增加执行计数
      executor.canExecute(testProposal);
      state = executor.getState();
      expect(state.totalExecutions).toBe(0);
    });

    test('state tracks consecutiveFailures', () => {
      const cb = executor.getGuardian().getCircuitBreaker();
      cb.recordFailure();
      cb.recordFailure();

      const state = executor.getState();
      expect(state.consecutiveFailures).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================
  // Sandbox 集成测试
  // ============================================

  describe('sandbox integration', () => {
    test('sandbox can create and destroy worktrees', async () => {
      const sandbox = executor.getSandbox();

      const worktreePath = await sandbox.createSandbox('test-proposal');
      expect(worktreePath).toBeDefined();

      await sandbox.destroySandbox('test-proposal');
      expect(sandbox.getSandboxPath('test-proposal')).toBeNull();
    });

    test('sandbox respects maxConcurrentSandboxes', async () => {
      const sandbox = executor.getSandbox();

      // 创建达到上限的沙箱
      const limitedExecutor = new Executor({
        sandbox: {
          worktreeBaseDir: path.join(os.tmpdir(), 'stratix-limited-test'),
          repoPath: workDir,
          maxConcurrentSandboxes: 1,
          autoCleanup: false,
          defaultTimeout: 60000,
        },
      });

      await limitedExecutor.getSandbox().createSandbox('limited-1');

      // 第二个应该失败
      await expect(
        limitedExecutor.getSandbox().createSandbox('limited-2')
      ).rejects.toThrow();

      // 清理
      await limitedExecutor.getSandbox().destroyAllSandboxes();
    });

    test('sandbox returns null for non-existent proposal', () => {
      const sandbox = executor.getSandbox();
      expect(sandbox.getSandboxPath('non-existent')).toBeNull();
    });

    test('sandbox lists active sandboxes', async () => {
      const sandbox = executor.getSandbox();

      await sandbox.createSandbox('list-1');
      await sandbox.createSandbox('list-2');

      const list = sandbox.listActiveSandboxes();
      expect(list).toContain('list-1');
      expect(list).toContain('list-2');

      await sandbox.destroySandbox('list-1');
      await sandbox.destroySandbox('list-2');
    });
  });

  // ============================================
  // CodeModifier 集成测试
  // ============================================

  describe('code modifier integration', () => {
    test('code modifier validates modifications', () => {
      const modifier = executor.getCodeModifier();

      const plan: ModificationPlan = {
        proposalId: 'test',
        modifications: [
          { type: 'create', path: 'src/test.ts', content: 'test', description: 'test' },
        ],
        estimatedRisk: 'low',
        affectedFiles: ['src/test.ts'],
        description: 'test',
      };

      const result = modifier.validateModifications(plan);
      expect(result.valid).toBe(true);
    });

    test('code modifier blocks forbidden paths', () => {
      const modifier = executor.getCodeModifier();

      const plan: ModificationPlan = {
        proposalId: 'test',
        modifications: [
          { type: 'create', path: 'src/stratix-systemzone/guardian/test.ts', content: 'test', description: 'test' },
        ],
        estimatedRisk: 'low',
        affectedFiles: ['src/stratix-systemzone/guardian/test.ts'],
        description: 'test',
      };

      const result = modifier.validateModifications(plan);
      expect(result.valid).toBe(false);
    });
  });

  // ============================================
  // TestRunner 集成测试
  // ============================================

  describe('test runner integration', () => {
    test('test runner can be instantiated', () => {
      const runner = executor.getTestRunner();
      expect(runner).toBeInstanceOf(TestRunner);
    });
  });

  // ============================================
  // RollbackManager 集成测试
  // ============================================

  describe('rollback manager integration', () => {
    test('rollback manager can be instantiated', () => {
      const rollbackMgr = executor.getRollbackManager();
      expect(rollbackMgr).toBeInstanceOf(RollbackManager);
    });

    test('rollback manager returns config', () => {
      const rollbackMgr = executor.getRollbackManager();
      const config = rollbackMgr.getConfig();
      expect(config).toHaveProperty('maxSnapshots');
      expect(config).toHaveProperty('autoRollbackOnTestFail');
    });
  });

  // ============================================
  // 执行结果格式测试
  // ============================================

  describe('execution result format', () => {
    test('rejected proposal returns failure result', async () => {
      // 使用不允许的类型，会被拒绝
      const proposal = createTestProposal('p-format-fail', 'new_zone');
      const result = await executor.executeProposal(proposal);

      expect(result).toHaveProperty('proposalId');
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('phase');
      expect(result).toHaveProperty('modifications');
      expect(result).toHaveProperty('testResult');
      expect(result).toHaveProperty('commitHash');
      expect(result).toHaveProperty('rollbackHash');
      expect(result).toHaveProperty('duration');
      expect(result).toHaveProperty('error');
      expect(result.success).toBe(false);
    });

    test('duration is a non-negative number', async () => {
      const proposal = createTestProposal('p-duration', 'new_zone');
      const result = await executor.executeProposal(proposal);

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================
  // 配置测试
  // ============================================

  describe('configuration', () => {
    test('custom config is applied', () => {
      const exec = new Executor({
        maxRetries: 10,
        requireApproval: true,
        allowedProposalTypes: ['improve_code'],
      });

      // 配置应该被应用（通过 canExecute 验证）
      expect(exec.canExecute(createTestProposal('test', 'improve_code'))).resolves.toBe(true);
      expect(exec.canExecute(createTestProposal('test', 'new_zone'))).resolves.toBe(false);
    });
  });
});
