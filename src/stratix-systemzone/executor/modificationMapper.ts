import type { SystemZoneFileModification } from '../types';
import type { FileModification } from './types';

/**
 * 将 SystemZoneFileModification 映射为 executor 内部使用的 FileModification
 */
export function mapModification(m: SystemZoneFileModification): FileModification {
  return {
    type: m.type,
    path: m.path,
    content: m.content,
    description: m.description,
    ...(m.newPath ? { newPath: m.newPath } : {}),
    ...(m.diff ? { diff: m.diff } : {}),
  };
}

/**
 * 批量映射 SystemZoneFileModification[] → FileModification[]
 */
export function mapModifications(ms: SystemZoneFileModification[]): FileModification[] {
  return ms.map(mapModification);
}
