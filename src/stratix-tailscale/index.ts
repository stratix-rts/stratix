import { EmbeddedTailscale } from './EmbeddedTailscale';
import { TailscaleService } from './TailscaleService';
import type { TailscaleConfig } from './types';

export { TailscaleService } from './TailscaleService';
export { EmbeddedTailscale } from './EmbeddedTailscale';
export type {
  TailscaleStatus,
  TailscalePeer,
  TailscaleConfig,
  OpenClawNode,
  TailscaleEvent,
} from './types';
export type { TailscaleStatus as EmbeddedTailscaleStatus, OpenClawNode as EmbeddedOpenClawNode, TailscaleEvent as EmbeddedTailscaleEvent } from './EmbeddedTailscale';

export function createTailscaleService(config?: TailscaleConfig): TailscaleService {
  return new TailscaleService(config);
}

export function createEmbeddedTailscale(config?: import('./EmbeddedTailscale').TailscaleConfig): EmbeddedTailscale {
  return new EmbeddedTailscale(config);
}
