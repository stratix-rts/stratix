import { getToken } from '@/design-system/config';

export const MAP_WIDTH = 1600;
export const MAP_HEIGHT = 960;
export const TILE_SIZE = 32;
export const DEFAULT_ZOOM = 1.2;
export const MIN_ZOOM = 0.8;
export const MAX_ZOOM = 2.0;

// 动态获取主题背景色
function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', '0x'));
}

export const BG_COLOR = () => hexToNumber(getToken('colors.background.base')); 
