// PathProtection.ts
import { Proposal, PermissionMatrix } from '../types';

const DEFAULT_FORBIDDEN_PATHS = [
  '**/payment/**',
  '**/permission/**',
  '**/.env*',
  '**/credentials/**',
];

const DEFAULT_READONLY_PATHS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.git/**',
];

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  pathType?: 'forbidden' | 'readonly' | 'allowed';
}

export class PathProtection {
  private forbiddenPatterns: string[];
  private readonlyPatterns: string[];

  constructor(matrix?: PermissionMatrix) {
    this.forbiddenPatterns = matrix?.forbiddenPaths ?? DEFAULT_FORBIDDEN_PATHS;
    this.readonlyPatterns = matrix?.readonlyPaths ?? DEFAULT_READONLY_PATHS;
  }

  validateProposal(proposal: Proposal): ValidationResult {
    if (!proposal.target.file) {
      return { valid: true, pathType: 'allowed' };
    }
    const targetPath = proposal.target.file;
    for (const pattern of this.forbiddenPatterns) {
      if (this.matchesGlob(targetPath, pattern)) {
        return { valid: false, reason: `Path matches protected pattern: ${pattern}`, pathType: 'forbidden' };
      }
    }
    for (const pattern of this.readonlyPatterns) {
      if (this.matchesGlob(targetPath, pattern)) {
        return { valid: true, reason: `Path matches readonly pattern: ${pattern}`, pathType: 'readonly' };
      }
    }
    return { valid: true, pathType: 'allowed' };
  }

  private matchesGlob(path: string, pattern: string): boolean {
    const normalizedPath = path.replace(/\\/g, '/');
    const regex = this.globToRegex(pattern);
    return regex.test(normalizedPath) || regex.test(path);
  }

  private globToRegex(glob: string): RegExp {
    let result = '';
    let i = 0;
    while (i < glob.length) {
      const ch = glob[i];
      if (ch === '*' && glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          result += '.*';
          i += 3;
        } else {
          result += '.*';
          i += 2;
        }
      } else if (ch === '*') {
        result += '[^/]*';
        i += 1;
      } else if (ch === '?') {
        result += '.';
        i += 1;
      } else if (ch === '.') {
        result += '\\.';
        i += 1;
      } else if (ch === '$') {
        result += '\\$';
        i += 1;
      } else {
        result += ch;
        i += 1;
      }
    }
    return new RegExp(result, 'i');
  }

  addForbiddenPath(pattern: string): void {
    if (!this.forbiddenPatterns.includes(pattern)) {
      this.forbiddenPatterns.push(pattern);
    }
  }

  addReadonlyPath(pattern: string): void {
    if (!this.readonlyPatterns.includes(pattern)) {
      this.readonlyPatterns.push(pattern);
    }
  }

  getForbiddenPaths(): string[] {
    return [...this.forbiddenPatterns];
  }

  getReadonlyPaths(): string[] {
    return [...this.readonlyPatterns];
  }
}
