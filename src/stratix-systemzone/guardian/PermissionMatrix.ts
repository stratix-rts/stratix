// ============================================
// PermissionMatrix.ts - Permission Matrix Module
// Phase 1: Guardian Path Protection + Circuit Breaker
// ============================================

import type { Proposal, PermissionMatrix as PermissionMatrixType } from '../types';

/**
 * Permission check result
 */
export interface PermissionCheckResult {
  approved: boolean;
  reason?: string;
  requiresApproval: boolean;
}

/**
 * Permission Matrix Module
 * Phase 1: All proposals require user approval (autoExecuteThreshold: none)
 */
export class PermissionMatrixClass {
  private permissionMatrix: PermissionMatrixType;

  constructor(matrix?: PermissionMatrixType) {
    this.permissionMatrix = matrix ?? {
      forbiddenPaths: [],
      readonlyPaths: [],
    };
  }

  /**
   * Check proposal permission
   * Phase 1: All proposals require user approval
   */
  checkPermission(_proposal: Proposal): PermissionCheckResult {
    return {
      approved: false,
      reason: 'Phase 1: All proposals require user approval',
      requiresApproval: true,
    };
  }

  /**
   * Check action permission
   */
  async checkAction(
    action: string,
    _resource: string,
    _agentId: string
  ): Promise<PermissionCheckResult> {
    const writeActions = ['write', 'edit', 'modify', 'create', 'delete', 'execute'];
    const isWriteAction = writeActions.includes(action.toLowerCase());

    if (isWriteAction) {
      return {
        approved: false,
        reason: `Write action '${action}' requires user approval in Phase 1`,
        requiresApproval: true,
      };
    }

    return {
      approved: true,
      reason: `Read action '${action}' is allowed`,
      requiresApproval: false,
    };
  }

  /**
   * Get current permission matrix config
   */
  getMatrix(): PermissionMatrixType {
    return { ...this.permissionMatrix };
  }

  /**
   * Update permission matrix
   */
  updateMatrix(matrix: Partial<PermissionMatrixType>): void {
    this.permissionMatrix = {
      ...this.permissionMatrix,
      ...matrix,
    };
  }

  /**
   * Check if path is forbidden
   */
  isPathForbidden(filePath: string): boolean {
    const { forbiddenPaths } = this.permissionMatrix;
    if (!forbiddenPaths || forbiddenPaths.length === 0) {
      return false;
    }

    for (const pattern of forbiddenPaths) {
      if (this.matchesGlob(filePath, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if path is readonly
   */
  isPathReadonly(filePath: string): boolean {
    const { readonlyPaths } = this.permissionMatrix;
    if (!readonlyPaths || readonlyPaths.length === 0) {
      return false;
    }

    for (const pattern of readonlyPaths) {
      if (this.matchesGlob(filePath, pattern)) {
        return true;
      }
    }
    return false;
  }

  private matchesGlob(path: string, pattern: string): boolean {
    const regex = this.globToRegex(pattern);
    const normalizedPath = path.replace(/\\/g, '/');
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
}
