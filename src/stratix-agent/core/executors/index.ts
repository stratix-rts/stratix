import { SkillExecutor } from '../../types';
import { ZoneCoordinatorSkillExecutor } from '../ZoneCoordinatorSkillExecutor';

export { HttpSkillExecutor } from './HttpSkillExecutor';
export { BuiltinSkillExecutor } from './BuiltinSkillExecutor';
export { FileSystemSkillExecutor } from './FileSystemSkillExecutor';
export { CodeSandboxSkillExecutor } from './CodeSandboxSkillExecutor';
export { BashSkillExecutor } from './BashSkillExecutor';
export { ZoneSkillExecutor } from './ZoneSkillExecutor';
export { DefaultSkillExecutor } from './DefaultSkillExecutor';

import { HttpSkillExecutor } from './HttpSkillExecutor';
import { BuiltinSkillExecutor } from './BuiltinSkillExecutor';
import { FileSystemSkillExecutor } from './FileSystemSkillExecutor';
import { CodeSandboxSkillExecutor } from './CodeSandboxSkillExecutor';
import { BashSkillExecutor } from './BashSkillExecutor';
import { ZoneSkillExecutor } from './ZoneSkillExecutor';
import { DefaultSkillExecutor } from './DefaultSkillExecutor';

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
    case 'zone':
      return new ZoneSkillExecutor();
    case 'zone_coordinator':
      return new ZoneCoordinatorSkillExecutor();
    default:
      return new DefaultSkillExecutor();
  }
}
