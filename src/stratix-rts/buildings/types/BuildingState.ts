/**
 * BuildingState - 建筑和格子间的状态枚举
 */

/** 建筑整体状态 */
export type BuildingState = 'empty' | 'active' | 'busy' | 'full' | 'error';

/** 格子间状态 */
export type RoomState = 'empty' | 'occupied';
