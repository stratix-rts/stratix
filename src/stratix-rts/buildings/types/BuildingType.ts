/**
 * BuildingType - 建筑类型枚举与配置
 * 每种建筑类型对应一种 Zone 功能，有独特的配色和名称
 */

export enum BuildingType {
  DataCenter = 'data-center',
  Workshop = 'workshop',
  Studio = 'studio',
  Library = 'library',
  Command = 'command',
}

/** 建筑类型对应的填充颜色 */
export const BUILDING_COLORS: Record<BuildingType, number> = {
  [BuildingType.DataCenter]: 0x6366f1, // 紫色
  [BuildingType.Workshop]: 0xf59e0b,   // 橙色
  [BuildingType.Studio]: 0x10b981,     // 绿色
  [BuildingType.Library]: 0x3b82f6,    // 蓝色
  [BuildingType.Command]: 0xef4444,    // 红色
};

/** 建筑类型对应的中文名称 */
export const BUILDING_NAMES: Record<BuildingType, string> = {
  [BuildingType.DataCenter]: '数据机房',
  [BuildingType.Workshop]: '开发工坊',
  [BuildingType.Studio]: '创意画室',
  [BuildingType.Library]: '编辑书房',
  [BuildingType.Command]: '指挥中心',
};

/** 建筑类型对应的图标（emoji） */
export const BUILDING_ICONS: Record<BuildingType, string> = {
  [BuildingType.DataCenter]: '🖥️',
  [BuildingType.Workshop]: '🔧',
  [BuildingType.Studio]: '🎨',
  [BuildingType.Library]: '📚',
  [BuildingType.Command]: '📡',
};

/** 建筑配置接口 */
export interface BuildingConfig {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly buildingType: BuildingType;
  readonly name?: string;
}
