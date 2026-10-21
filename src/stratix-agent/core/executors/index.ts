import { SkillExecutor } from '../../types';

export { HttpSkillExecutor } from './HttpSkillExecutor';
export { BuiltinSkillExecutor } from './BuiltinSkillExecutor';
export { FileSystemSkillExecutor } from './FileSystemSkillExecutor';
export { CodeSandboxSkillExecutor } from './CodeSandboxSkillExecutor';
export { BashSkillExecutor } from './BashSkillExecutor';
export { DefaultSkillExecutor } from './DefaultSkillExecutor';

import { BashSkillExecutor } from './BashSkillExecutor';
import { BuiltinSkillExecutor } from './BuiltinSkillExecutor';
import { CodeSandboxSkillExecutor } from './CodeSandboxSkillExecutor';
import { DefaultSkillExecutor } from './DefaultSkillExecutor';
import { FileSystemSkillExecutor } from './FileSystemSkillExecutor';
import { HttpSkillExecutor } from './HttpSkillExecutor';

function log(level: 'warn', message: string, ctx?: Record<string, unknown>): void {
  console[level](`[ExecutorFactory] ${message}`, ctx || '');
}

/**
 * Factory function to create a SkillExecutor by type.
 * Maintains backward-compatible signature.
 */
export function createExecutor(type: string): SkillExecutor {
  switch (type) {
    case 'http':
      return new HttpSkillExecutor();
    case 'builtin':
      return new BuiltinSkillExecutor();
    case 'fs':
      return new FileSystemSkillExecutor();
    case 'bash':
      return new BashSkillExecutor();
    case 'code_sandbox':
      return new CodeSandboxSkillExecutor();
    default:
      log('warn', `Unknown executor type "${type}", falling back to DefaultSkillExecutor`);
      return new DefaultSkillExecutor();
  }
}
