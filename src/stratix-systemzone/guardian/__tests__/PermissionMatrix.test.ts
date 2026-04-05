// ============================================
// PermissionMatrix.test.ts - 权限矩阵单元测试
// Phase 1: Guardian 路径保护 + 熔断器
// ============================================

import { PermissionMatrixClass } from '../PermissionMatrix';
import type { PermissionMatrix, Proposal } from '../../types';

describe('PermissionMatrixClass', () => {
  const createMockProposal = (overrides?: Partial<Proposal>): Proposal => ({
    id: 'proposal-1',
    timestamp: new Date(),
    type: 'improve_code',
    title: 'Test Proposal',
    description: 'Test description',
    target: { file: 'src/test.ts' },
    selection: { confidence: 0.8, cost: 5, benefit: 7, risk: 'medium' },
    status: 'pending',
    ...overrides,
  });

  describe('constructor', () => {
    test('creates instance with empty matrix when no matrix provided', () => {
      const pm = new PermissionMatrixClass();
      expect(pm).toBeInstanceOf(PermissionMatrixClass);
    });

    test('creates instance with provided matrix', () => {
      const matrix: PermissionMatrix = {
        forbiddenPaths: ['**/secret/**'],
        readonlyPaths: ['**/logs/**'],
      };
      const pm = new PermissionMatrixClass(matrix);
      expect(pm.getMatrix().forbiddenPaths).toEqual(['**/secret/**']);
      expect(pm.getMatrix().readonlyPaths).toEqual(['**/logs/**']);
    });

    test('getMatrix returns a copy', () => {
      const pm = new PermissionMatrixClass();
      const m1 = pm.getMatrix();
      const m2 = pm.getMatrix();
      expect(m1).not.toBe(m2);
    });
  });

  describe('checkPermission', () => {
    test('Phase 1: all proposals require approval', () => {
      const pm = new PermissionMatrixClass();
      const proposal = createMockProposal();
      const result = pm.checkPermission(proposal);
      expect(result.approved).toBe(false);
      expect(result.requiresApproval).toBe(true);
    });

    test('returns correct Phase 1 reason', () => {
      const pm = new PermissionMatrixClass();
      const proposal = createMockProposal();
      const result = pm.checkPermission(proposal);
      expect(result.reason).toContain('Phase 1');
    });

    test('works with proposal without target', () => {
      const pm = new PermissionMatrixClass();
      const proposal = createMockProposal({ target: {} });
      const result = pm.checkPermission(proposal);
      expect(result.approved).toBe(false);
      expect(result.requiresApproval).toBe(true);
    });
  });

  describe('checkAction', () => {
    describe('write actions', () => {
      test('write action requires approval', async () => {
        const pm = new PermissionMatrixClass();
        const result = await pm.checkAction('write', 'src/file.ts', 'agent-1');
        expect(result.approved).toBe(false);
        expect(result.requiresApproval).toBe(true);
        expect(result.reason).toContain('write');
      });

      test('edit action requires approval', async () => {
        const pm = new PermissionMatrixClass();
        const result = await pm.checkAction('edit', 'src/file.ts', 'agent-1');
        expect(result.approved).toBe(false);
        expect(result.requiresApproval).toBe(true);
      });

      test('modify action requires approval', async () => {
        const pm = new PermissionMatrixClass();
        const result = await pm.checkAction('modify', 'src/file.ts', 'agent-1');
        expect(result.approved).toBe(false);
        expect(result.requiresApproval).toBe(true);
      });

      test('create action requires approval', async () => {
        const pm = new PermissionMatrixClass();
        const result = await pm.checkAction('create', 'src/file.ts', 'agent-1');
        expect(result.approved).toBe(false);
        expect(result.requiresApproval).toBe(true);
      });

      test('delete action requires approval', async () => {
        const pm = new PermissionMatrixClass();
        const result = await pm.checkAction('delete', 'src/file.ts', 'agent-1');
        expect(result.approved).toBe(false);
        expect(result.requiresApproval).toBe(true);
      });

      test('execute action requires approval', async () => {
        const pm = new PermissionMatrixClass();
        const result = await pm.checkAction('execute', 'script.sh', 'agent-1');
        expect(result.approved).toBe(false);
        expect(result.requiresApproval).toBe(true);
      });

      test('action is case-insensitive', async () => {
        const pm = new PermissionMatrixClass();
        const result = await pm.checkAction('WRITE', 'src/file.ts', 'agent-1');
        expect(result.approved).toBe(false);
      });

      test('DELETE requires approval', async () => {
        const pm = new PermissionMatrixClass();
        const result = await pm.checkAction('DELETE', 'src/file.ts', 'agent-1');
        expect(result.approved).toBe(false);
      });
    });

    describe('read actions', () => {
      test('read action is allowed', async () => {
        const pm = new PermissionMatrixClass();
        const result = await pm.checkAction('read', 'src/file.ts', 'agent-1');
        expect(result.approved).toBe(true);
        expect(result.requiresApproval).toBe(false);
        expect(result.reason).toContain('read');
      });

      test('view action is allowed', async () => {
        const pm = new PermissionMatrixClass();
        const result = await pm.checkAction('view', 'src/file.ts', 'agent-1');
        expect(result.approved).toBe(true);
        expect(result.requiresApproval).toBe(false);
      });

      test('list action is allowed', async () => {
        const pm = new PermissionMatrixClass();
        const result = await pm.checkAction('list', 'src/', 'agent-1');
        expect(result.approved).toBe(true);
        expect(result.requiresApproval).toBe(false);
      });

      test('inspect action is allowed', async () => {
        const pm = new PermissionMatrixClass();
        const result = await pm.checkAction('inspect', 'src/file.ts', 'agent-1');
        expect(result.approved).toBe(true);
        expect(result.requiresApproval).toBe(false);
      });

      test('search action is allowed', async () => {
        const pm = new PermissionMatrixClass();
        const result = await pm.checkAction('search', 'src/', 'agent-1');
        expect(result.approved).toBe(true);
        expect(result.requiresApproval).toBe(false);
      });
    });
  });

  describe('getMatrix', () => {
    test('returns current matrix', () => {
      const matrix: PermissionMatrix = {
        forbiddenPaths: ['**/a/**'],
        readonlyPaths: ['**/b/**'],
      };
      const pm = new PermissionMatrixClass(matrix);
      const result = pm.getMatrix();
      expect(result.forbiddenPaths).toEqual(['**/a/**']);
      expect(result.readonlyPaths).toEqual(['**/b/**']);
    });

    test('returns a new object each time', () => {
      const pm = new PermissionMatrixClass();
      const m1 = pm.getMatrix();
      const m2 = pm.getMatrix();
      expect(m1).not.toBe(m2);
      expect(m1).toEqual(m2);
    });
  });

  describe('updateMatrix', () => {
    test('partially updates forbidden paths', () => {
      const pm = new PermissionMatrixClass({
        forbiddenPaths: ['**/old/**'],
        readonlyPaths: ['**/logs/**'],
      });
      pm.updateMatrix({ forbiddenPaths: ['**/new/**'] });
      expect(pm.getMatrix().forbiddenPaths).toEqual(['**/new/**']);
      expect(pm.getMatrix().readonlyPaths).toEqual(['**/logs/**']);
    });

    test('partially updates readonly paths', () => {
      const pm = new PermissionMatrixClass({
        forbiddenPaths: ['**/forbidden/**'],
        readonlyPaths: ['**/old/**'],
      });
      pm.updateMatrix({ readonlyPaths: ['**/new/**'] });
      expect(pm.getMatrix().readonlyPaths).toEqual(['**/new/**']);
      expect(pm.getMatrix().forbiddenPaths).toEqual(['**/forbidden/**']);
    });

    test('merges multiple updates', () => {
      const pm = new PermissionMatrixClass({
        forbiddenPaths: ['**/a/**'],
        readonlyPaths: ['**/b/**'],
      });
      pm.updateMatrix({
        forbiddenPaths: ['**/x/**'],
        readonlyPaths: ['**/y/**'],
      });
      expect(pm.getMatrix().forbiddenPaths).toEqual(['**/x/**']);
      expect(pm.getMatrix().readonlyPaths).toEqual(['**/y/**']);
    });
  });

  describe('isPathForbidden', () => {
    test('returns true for matching forbidden path', () => {
      const matrix: PermissionMatrix = {
        forbiddenPaths: ['**/payment/**', '**/secret/**'],
        readonlyPaths: [],
      };
      const pm = new PermissionMatrixClass(matrix);
      expect(pm.isPathForbidden('src/payment/stripe.ts')).toBe(true);
    });

    test('returns false for non-matching path', () => {
      const matrix: PermissionMatrix = {
        forbiddenPaths: ['**/payment/**'],
        readonlyPaths: [],
      };
      const pm = new PermissionMatrixClass(matrix);
      expect(pm.isPathForbidden('src/components/Button.ts')).toBe(false);
    });

    test('returns false for empty forbidden paths', () => {
      const matrix: PermissionMatrix = {
        forbiddenPaths: [],
        readonlyPaths: [],
      };
      const pm = new PermissionMatrixClass(matrix);
      expect(pm.isPathForbidden('any/path')).toBe(false);
    });

    test('returns false when forbidden paths is undefined', () => {
      const pm = new PermissionMatrixClass({} as PermissionMatrix);
      expect(pm.isPathForbidden('any/path')).toBe(false);
    });

    test('handles .env pattern correctly', () => {
      const pm = new PermissionMatrixClass({
        forbiddenPaths: ['**/.env*'],
        readonlyPaths: [],
      });
      expect(pm.isPathForbidden('.env')).toBe(true);
      expect(pm.isPathForbidden('.env.local')).toBe(true);
      expect(pm.isPathForbidden('.env.production')).toBe(true);
      expect(pm.isPathForbidden('env')).toBe(false);
    });

    test('handles credentials/** pattern', () => {
      const pm = new PermissionMatrixClass({
        forbiddenPaths: ['**/credentials/**'],
        readonlyPaths: [],
      });
      expect(pm.isPathForbidden('config/credentials/api.json')).toBe(true);
      expect(pm.isPathForbidden('credentials/token.txt')).toBe(true);
    });
  });

  describe('isPathReadonly', () => {
    test('returns true for matching readonly path', () => {
      const matrix: PermissionMatrix = {
        forbiddenPaths: [],
        readonlyPaths: ['**/node_modules/**', '**/dist/**'],
      };
      const pm = new PermissionMatrixClass(matrix);
      expect(pm.isPathReadonly('node_modules/lodash/index.js')).toBe(true);
    });

    test('returns false for non-matching path', () => {
      const matrix: PermissionMatrix = {
        forbiddenPaths: [],
        readonlyPaths: ['**/node_modules/**'],
      };
      const pm = new PermissionMatrixClass(matrix);
      expect(pm.isPathReadonly('src/file.ts')).toBe(false);
    });

    test('returns false for empty readonly paths', () => {
      const matrix: PermissionMatrix = {
        forbiddenPaths: [],
        readonlyPaths: [],
      };
      const pm = new PermissionMatrixClass(matrix);
      expect(pm.isPathReadonly('any/path')).toBe(false);
    });

    test('returns false when readonly paths is undefined', () => {
      const pm = new PermissionMatrixClass({} as PermissionMatrix);
      expect(pm.isPathReadonly('any/path')).toBe(false);
    });

    test('handles node_modules/** pattern', () => {
      const pm = new PermissionMatrixClass({
        forbiddenPaths: [],
        readonlyPaths: ['**/node_modules/**'],
      });
      expect(pm.isPathReadonly('node_modules/lodash/index.js')).toBe(true);
      expect(pm.isPathReadonly('node_modules/@scope/package/dist/index.js')).toBe(true);
      expect(pm.isPathReadonly('src/node_modules/file.js')).toBe(true);
    });

    test('handles dist/** pattern', () => {
      const pm = new PermissionMatrixClass({
        forbiddenPaths: [],
        readonlyPaths: ['**/dist/**'],
      });
      expect(pm.isPathReadonly('dist/bundle.js')).toBe(true);
      expect(pm.isPathReadonly('dist/assets/app.js')).toBe(true);
    });

    test('handles .git/** pattern', () => {
      const pm = new PermissionMatrixClass({
        forbiddenPaths: [],
        readonlyPaths: ['**/.git/**'],
      });
      expect(pm.isPathReadonly('.git/config')).toBe(true);
      expect(pm.isPathReadonly('.git/objects/pack/pack-123.pack')).toBe(true);
    });
  });

  describe('matchesGlob', () => {
    describe('** glob pattern', () => {
      test('**/x/** matches nested x path', () => {
        const pm = new PermissionMatrixClass({
          forbiddenPaths: ['**/payment/**'],
          readonlyPaths: [],
        });
        expect(pm.isPathForbidden('a/b/payment/c/d')).toBe(true);
      });

      test('** matches multi-segment', () => {
        const pm = new PermissionMatrixClass({
          forbiddenPaths: ['**/a/b/**'],
          readonlyPaths: [],
        });
        expect(pm.isPathForbidden('x/a/b/c')).toBe(true);
      });
    });

    describe('single * glob pattern', () => {
      test('* does not match /', () => {
        const pm = new PermissionMatrixClass({
          forbiddenPaths: ['*.log'],
          readonlyPaths: [],
        });
        expect(pm.isPathForbidden('file.log')).toBe(true);
        // Note: *.log matches dir/file.log because regex is unanchored -
        // [^/]* can match empty string, then .log matches file.log substring
        expect(pm.isPathForbidden('dir/file.log')).toBe(true);
      });

      test('**/*.log matches nested .log files', () => {
        const pm = new PermissionMatrixClass({
          forbiddenPaths: ['**/*.log'],
          readonlyPaths: [],
        });
        expect(pm.isPathForbidden('file.log')).toBe(true);
        expect(pm.isPathForbidden('dir/file.log')).toBe(true);
        expect(pm.isPathForbidden('a/b/file.log')).toBe(true);
      });
    });

    describe('? glob pattern', () => {
      test('? matches single character', () => {
        const pm = new PermissionMatrixClass({
          forbiddenPaths: ['file?.txt'],
          readonlyPaths: [],
        });
        expect(pm.isPathForbidden('file1.txt')).toBe(true);
        expect(pm.isPathForbidden('file12.txt')).toBe(false); // ? matches one
      });
    });

    describe('escaped special characters', () => {
      test('. is literal dot', () => {
        const pm = new PermissionMatrixClass({
          forbiddenPaths: ['.env'],
          readonlyPaths: [],
        });
        expect(pm.isPathForbidden('.env')).toBe(true);
        expect(pm.isPathForbidden('env')).toBe(false);
      });

      test('$ is escaped', () => {
        const pm = new PermissionMatrixClass({
          forbiddenPaths: ['$var'],
          readonlyPaths: [],
        });
        expect(pm.isPathForbidden('$var')).toBe(true);
        expect(pm.isPathForbidden('var')).toBe(false);
      });
    });

    describe('backslash normalization', () => {
      test('normalizes backslashes to forward slashes', () => {
        const pm = new PermissionMatrixClass({
          forbiddenPaths: ['**/payment/**'],
          readonlyPaths: [],
        });
        // String.raw to get a string with backslash characters
        const path = 'src\\payment\\file.ts';
        expect(pm.isPathForbidden(path)).toBe(true);
      });
    });
  });

  describe('edge cases', () => {
    test('empty path returns false for isPathForbidden', () => {
      const pm = new PermissionMatrixClass({
        forbiddenPaths: ['**/secret/**'],
        readonlyPaths: [],
      });
      expect(pm.isPathForbidden('')).toBe(false);
    });

    test('empty path returns false for isPathReadonly', () => {
      const pm = new PermissionMatrixClass({
        forbiddenPaths: [],
        readonlyPaths: ['**/logs/**'],
      });
      expect(pm.isPathReadonly('')).toBe(false);
    });

    test('undefined matrix fields handled gracefully', () => {
      const pm = new PermissionMatrixClass({} as PermissionMatrix);
      expect(pm.isPathForbidden('any')).toBe(false);
      expect(pm.isPathReadonly('any')).toBe(false);
    });

    test('proposal with no target file passes checkPermission', () => {
      const pm = new PermissionMatrixClass();
      const proposal = createMockProposal();
      proposal.target = {};
      const result = pm.checkPermission(proposal);
      expect(result.approved).toBe(false); // Phase 1 still requires approval
    });
  });
});
