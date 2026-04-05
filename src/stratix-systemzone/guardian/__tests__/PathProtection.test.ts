// ============================================
// PathProtection.test.ts - 路径保护单元测试
// Phase 1: Guardian 路径保护 + 熔断器
// ============================================

import { PathProtection } from '../PathProtection';
import type { PermissionMatrix, Proposal } from '../../types';

describe('PathProtection', () => {
  const createMockProposal = (file?: string): Proposal => ({
    id: 'proposal-1',
    timestamp: new Date(),
    type: 'improve_code',
    title: 'Test Proposal',
    description: 'Test description',
    target: { file },
    selection: { confidence: 0.8, cost: 5, benefit: 7, risk: 'medium' },
    status: 'pending',
  });

  describe('constructor', () => {
    test('uses default forbidden paths when no matrix provided', () => {
      const pp = new PathProtection();
      expect(pp.getForbiddenPaths()).toContain('**/payment/**');
      expect(pp.getForbiddenPaths()).toContain('**/permission/**');
      expect(pp.getForbiddenPaths()).toContain('**/.env*');
      expect(pp.getForbiddenPaths()).toContain('**/credentials/**');
    });

    test('uses default readonly paths when no matrix provided', () => {
      const pp = new PathProtection();
      expect(pp.getReadonlyPaths()).toContain('**/node_modules/**');
      expect(pp.getReadonlyPaths()).toContain('**/dist/**');
      expect(pp.getReadonlyPaths()).toContain('**/.git/**');
    });

    test('uses custom matrix forbidden paths', () => {
      const matrix: PermissionMatrix = {
        forbiddenPaths: ['**/secret/**', '**/admin/**'],
        readonlyPaths: [],
      };
      const pp = new PathProtection(matrix);
      expect(pp.getForbiddenPaths()).toEqual(['**/secret/**', '**/admin/**']);
    });

    test('uses custom matrix readonly paths', () => {
      const matrix: PermissionMatrix = {
        forbiddenPaths: [],
        readonlyPaths: ['**/logs/**', '**/cache/**'],
      };
      const pp = new PathProtection(matrix);
      expect(pp.getReadonlyPaths()).toEqual(['**/logs/**', '**/cache/**']);
    });

    test('returns copies of arrays, not originals', () => {
      const pp = new PathProtection();
      const paths1 = pp.getForbiddenPaths();
      const paths2 = pp.getForbiddenPaths();
      expect(paths1).not.toBe(paths2);
      expect(paths1).toEqual(paths2);
    });
  });

  describe('validateProposal', () => {
    describe('proposals without file target', () => {
      test('returns valid with allowed pathType', () => {
        const pp = new PathProtection();
        const proposal = createMockProposal(undefined);
        proposal.target.file = undefined;
        const result = pp.validateProposal(proposal);
        expect(result.valid).toBe(true);
        expect(result.pathType).toBe('allowed');
      });
    });

    describe('forbidden path detection', () => {
      test('blocks **/payment/** nested path', () => {
        const pp = new PathProtection();
        const proposal = createMockProposal('src/modules/payment/stripe/checkout.ts');
        const result = pp.validateProposal(proposal);
        expect(result.valid).toBe(false);
        expect(result.pathType).toBe('forbidden');
        expect(result.reason).toContain('**/payment/**');
      });

      test('blocks top-level payment/** path', () => {
        const pp = new PathProtection();
        const proposal = createMockProposal('payment/routes.ts');
        const result = pp.validateProposal(proposal);
        expect(result.valid).toBe(false);
        expect(result.pathType).toBe('forbidden');
      });

      test('blocks **/permission/** path', () => {
        const pp = new PathProtection();
        const proposal = createMockProposal('src/permission/auth.ts');
        const result = pp.validateProposal(proposal);
        expect(result.valid).toBe(false);
        expect(result.pathType).toBe('forbidden');
      });

      test('blocks **/.env* pattern for .env file', () => {
        const pp = new PathProtection();
        const proposal = createMockProposal('.env');
        const result = pp.validateProposal(proposal);
        expect(result.valid).toBe(false);
        expect(result.pathType).toBe('forbidden');
      });

      test('blocks **/.env* pattern for .env.production', () => {
        const pp = new PathProtection();
        const proposal = createMockProposal('.env.production');
        const result = pp.validateProposal(proposal);
        expect(result.valid).toBe(false);
        expect(result.pathType).toBe('forbidden');
      });

      test('blocks **/.env* pattern for .env.local', () => {
        const pp = new PathProtection();
        const proposal = createMockProposal('.env.local');
        const result = pp.validateProposal(proposal);
        expect(result.valid).toBe(false);
        expect(result.pathType).toBe('forbidden');
      });

      test('blocks **/credentials/** path', () => {
        const pp = new PathProtection();
        const proposal = createMockProposal('config/credentials/api.json');
        const result = pp.validateProposal(proposal);
        expect(result.valid).toBe(false);
        expect(result.pathType).toBe('forbidden');
      });

      test('returns reason with matching pattern', () => {
        const pp = new PathProtection();
        const proposal = createMockProposal('src/payment/service.ts');
        const result = pp.validateProposal(proposal);
        expect(result.reason).toContain('**/payment/**');
      });
    });

    describe('readonly path detection', () => {
      test('allows **/node_modules/** path with readonly type', () => {
        const pp = new PathProtection();
        const proposal = createMockProposal('node_modules/lodash/index.js');
        const result = pp.validateProposal(proposal);
        expect(result.valid).toBe(true);
        expect(result.pathType).toBe('readonly');
        expect(result.reason).toContain('readonly');
      });

      test('allows **/dist/** path with readonly type', () => {
        const pp = new PathProtection();
        const proposal = createMockProposal('dist/bundle.js');
        const result = pp.validateProposal(proposal);
        expect(result.valid).toBe(true);
        expect(result.pathType).toBe('readonly');
      });

      test('allows **/.git/** path with readonly type', () => {
        const pp = new PathProtection();
        const proposal = createMockProposal('.git/config');
        const result = pp.validateProposal(proposal);
        expect(result.valid).toBe(true);
        expect(result.pathType).toBe('readonly');
      });

      test('allows nested node_modules path', () => {
        const pp = new PathProtection();
        const proposal = createMockProposal('node_modules/@scope/package/lib/index.js');
        const result = pp.validateProposal(proposal);
        expect(result.valid).toBe(true);
        expect(result.pathType).toBe('readonly');
      });
    });

    describe('allowed path', () => {
      test('allows normal source file', () => {
        const pp = new PathProtection();
        const proposal = createMockProposal('src/components/Button.ts');
        const result = pp.validateProposal(proposal);
        expect(result.valid).toBe(true);
        expect(result.pathType).toBe('allowed');
      });

      test('allows src/utils/helpers.ts', () => {
        const pp = new PathProtection();
        const proposal = createMockProposal('src/utils/helpers.ts');
        const result = pp.validateProposal(proposal);
        expect(result.valid).toBe(true);
        expect(result.pathType).toBe('allowed');
      });

      test('allows test files', () => {
        const pp = new PathProtection();
        const proposal = createMockProposal('tests/unit/math.test.ts');
        const result = pp.validateProposal(proposal);
        expect(result.valid).toBe(true);
        expect(result.pathType).toBe('allowed');
      });

      test('allows config files not matching patterns', () => {
        const pp = new PathProtection();
        const proposal = createMockProposal('config/app.json');
        const result = pp.validateProposal(proposal);
        expect(result.valid).toBe(true);
        expect(result.pathType).toBe('allowed');
      });
    });

    describe('priority: forbidden > readonly > allowed', () => {
      test('forbidden takes precedence over readonly', () => {
        const matrix: PermissionMatrix = {
          forbiddenPaths: ['**/shared/**'],
          readonlyPaths: ['**/shared/**'],
        };
        const pp = new PathProtection(matrix);
        const proposal = createMockProposal('node/shared/utils.ts');
        const result = pp.validateProposal(proposal);
        expect(result.valid).toBe(false);
        expect(result.pathType).toBe('forbidden');
      });
    });
  });

  describe('matchesGlob', () => {
    describe('** glob pattern', () => {
      test('**/payment/** matches nested payment path', () => {
        const pp = new PathProtection();
        const proposal = createMockProposal('src/payment/stripe/checkout.ts');
        const result = pp.validateProposal(proposal);
        expect(result.valid).toBe(false);
      });

      test('** matches any characters including /', () => {
        const pp = new PathProtection();
        const proposal = createMockProposal('a/b/c/d/file.ts');
        expect(pp.validateProposal(proposal).valid).toBe(true);
      });
    });

    describe('single * glob pattern', () => {
      test('*.test matches single segment', () => {
        const matrix: PermissionMatrix = {
          forbiddenPaths: ['*.test'],
          readonlyPaths: [],
        };
        const pp = new PathProtection(matrix);
        expect(pp.validateProposal(createMockProposal('file.test')).valid).toBe(false);
        expect(pp.validateProposal(createMockProposal('dir/file.test')).valid).toBe(false); // regex matches substring
      });

      test('**/*.test matches nested .test files', () => {
        const matrix: PermissionMatrix = {
          forbiddenPaths: ['**/*.test'],
          readonlyPaths: [],
        };
        const pp = new PathProtection(matrix);
        expect(pp.validateProposal(createMockProposal('file.test')).valid).toBe(false);
        expect(pp.validateProposal(createMockProposal('dir/file.test')).valid).toBe(false);
        expect(pp.validateProposal(createMockProposal('a/b/file.test')).valid).toBe(false);
      });
    });

    describe('? glob pattern', () => {
      test('?.log matches single character', () => {
        const matrix: PermissionMatrix = {
          forbiddenPaths: ['?.log'],
          readonlyPaths: [],
        };
        const pp = new PathProtection(matrix);
        expect(pp.validateProposal(createMockProposal('a.log')).valid).toBe(false);
        expect(pp.validateProposal(createMockProposal('ab.log')).valid).toBe(false); // regex matches substring
      });
    });

    describe('escaped special characters', () => {
      test('.env matches literal dot', () => {
        const pp = new PathProtection();
        expect(pp.validateProposal(createMockProposal('.env')).valid).toBe(false);
        expect(pp.validateProposal(createMockProposal('env')).valid).toBe(true);
      });

      test('escapes $ in pattern', () => {
        const matrix: PermissionMatrix = {
          forbiddenPaths: ['$var'],
          readonlyPaths: [],
        };
        const pp = new PathProtection(matrix);
        expect(pp.validateProposal(createMockProposal('$var')).valid).toBe(false);
      });
    });

    describe('backslash normalization', () => {
      test('normalizes backslashes to forward slashes', () => {
        const pp = new PathProtection();
        // Using String.raw to simulate a path with backslashes
        const pathWithBackslash = 'src\\payment\\stripe.ts';
        expect(pp.validateProposal(createMockProposal(pathWithBackslash)).valid).toBe(false);
      });
    });
  });

  describe('addForbiddenPath', () => {
    test('adds new forbidden path', () => {
      const pp = new PathProtection();
      pp.addForbiddenPath('**/private/**');
      expect(pp.getForbiddenPaths()).toContain('**/private/**');
    });

    test('does not add duplicate path', () => {
      const pp = new PathProtection();
      const initial = pp.getForbiddenPaths().length;
      pp.addForbiddenPath('**/payment/**');
      expect(pp.getForbiddenPaths().length).toBe(initial);
    });

    test('newly added path takes effect immediately', () => {
      const pp = new PathProtection();
      pp.addForbiddenPath('**/private/**');
      const proposal = createMockProposal('src/private/secrets.ts');
      expect(pp.validateProposal(proposal).valid).toBe(false);
    });
  });

  describe('addReadonlyPath', () => {
    test('adds new readonly path', () => {
      const pp = new PathProtection();
      pp.addReadonlyPath('**/logs/**');
      expect(pp.getReadonlyPaths()).toContain('**/logs/**');
    });

    test('does not add duplicate path', () => {
      const pp = new PathProtection();
      const initial = pp.getReadonlyPaths().length;
      pp.addReadonlyPath('**/node_modules/**');
      expect(pp.getReadonlyPaths().length).toBe(initial);
    });

    test('newly added readonly path takes effect immediately', () => {
      const pp = new PathProtection();
      pp.addReadonlyPath('**/logs/**');
      const proposal = createMockProposal('var/logs/app.log');
      const result = pp.validateProposal(proposal);
      expect(result.valid).toBe(true);
      expect(result.pathType).toBe('readonly');
    });
  });

  describe('getForbiddenPaths', () => {
    test('returns copy of array', () => {
      const pp = new PathProtection();
      const paths = pp.getForbiddenPaths();
      paths.push('**/fake/**');
      expect(pp.getForbiddenPaths()).not.toContain('**/fake/**');
    });
  });

  describe('getReadonlyPaths', () => {
    test('returns copy of array', () => {
      const pp = new PathProtection();
      const paths = pp.getReadonlyPaths();
      paths.push('**/fake/**');
      expect(pp.getReadonlyPaths()).not.toContain('**/fake/**');
    });
  });

  describe('edge cases', () => {
    test('empty file path returns allowed', () => {
      const pp = new PathProtection();
      const proposal = createMockProposal('');
      expect(pp.validateProposal(proposal).valid).toBe(true);
    });

    test('path with only / returns allowed (not matching any pattern)', () => {
      const pp = new PathProtection();
      const proposal = createMockProposal('/');
      // Does not match forbidden or readonly patterns
      expect(pp.validateProposal(proposal).valid).toBe(true);
    });

    test('path with many slashes does not break matching', () => {
      const pp = new PathProtection();
      const proposal = createMockProposal('a/b/c/d/e/f/g/file.ts');
      expect(pp.validateProposal(proposal).valid).toBe(true);
    });

    test('path with no extension allowed', () => {
      const pp = new PathProtection();
      const proposal = createMockProposal('Makefile');
      expect(pp.validateProposal(proposal).valid).toBe(true);
    });
  });
});
