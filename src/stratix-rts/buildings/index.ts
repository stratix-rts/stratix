/**
 * Zone Building System - 公共导出
 */

export { Building } from './Building';
export { BuildingFactory } from './BuildingFactory';
export { Room } from './Room';
export { ROOM_SIZE } from './Room';

export {
  BuildingType,
  BuildingConfig,
  BUILDING_COLORS,
  BUILDING_NAMES,
  BUILDING_ICONS,
} from './types/BuildingType';

export type { BuildingState, RoomState } from './types/BuildingState';
export { AgentStateAnimator, AgentWorkState } from './AgentStateAnimator';
