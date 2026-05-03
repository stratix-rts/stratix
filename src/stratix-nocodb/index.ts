/**
 * Stratix NocoDB Integration Module
 *
 * Provides NocoDB service management for embedding NocoDB
 * as a data visualization layer within Stratix.
 *
 * @example
 * // Start NocoDB service
 * import { createNocoDBService } from './stratix-nocodb';
 * const service = createNocoDBService({ port: 8080 });
 * await service.start();
 */

export {
  NocoDBService,
  getNocoDBService,
  createNocoDBService,
  type NocoDBServiceOptions,
} from './NocoDBService';
