/**
 * Stratix NocoDB Integration Module
 *
 * Provides NocoDB service management and Vue components for
 * embedding NocoDB as a data visualization layer within Stratix.
 *
 * @example
 * // Start NocoDB service
 * import { createNocoDBService } from './stratix-nocodb';
 * const service = createNocoDBService({ port: 8080 });
 * await service.start();
 */

// Re-export types and classes
export {
  NocoDBService,
  getNocoDBService,
  createNocoDBService,
  type NocoDBServiceOptions,
} from './NocoDBService';

// Re-export Vue components
export { default as NocoDBViewer } from './NocoDBViewer.vue';
