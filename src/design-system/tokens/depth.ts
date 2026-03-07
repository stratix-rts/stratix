/**
 * 深度层级系统
 * 
 * z-index 管理规范
 * 数值越大越靠上
 */

export const Depth = {
  // DepthToken 简化属性 (供 Vue UI 使用)
  base: 0,
  overlay: 2000,
  modal: 3000,
  popup: 4000,
  notification: 5000,

  // 游戏世界层 (0-999)
  WORLD_BASE: 0,
  WORLD_OBJECTS: 100,
  WORLD_AGENTS: 200,
  WORLD_EFFECTS: 300,
  
  // 游戏 UI 层 (1000-1999)
  UI_GROUND: 1000,
  UI_ZONE_HANDLES: 1100,
  UI_ZONE_MAIN: 1200,
  
  // 场景 UI 层 (2000-2999)
  UI_SCENE_BASE: 2000,
  UI_TOOLBAR: 2001,
  UI_STATUS_BAR: 2002,
  
  // 模态框层 (3000-3999)
  UI_MODAL_BASE: 3000,
  UI_MODAL_CONTENT: 3100,
  UI_MODAL_OVERLAY: 3200,
  
  // 弹出层 (4000-4999)
  UI_POPUP_BASE: 4000,
  UI_POPUP_ACTIVE: 4100,
  
  // 通知层 (5000-5999)
  UI_NOTIFICATION: 5000,
  
  // 调试层 (9000-9999)
  UI_DEBUG: 9000,
  UI_DEBUG_HIGHLIGHT: 9999,
} as const;

/**
 * 深度管理工具
 */
export class DepthManager {
  /** 获取子元素深度 */
  static getChildDepth(parentLayer: number, offset: number = 1): number {
    return parentLayer + offset;
  }
  
  /** 批量设置深度 */
  static setDepths(
    objects: Array<{ setDepth: (d: number) => void }>,
    layer: number
  ): void {
    objects.forEach((obj, index) => {
      obj.setDepth(layer + index);
    });
  }
  
  /** 获取层级名称 */
  static getLayerName(depth: number): string {
    const entries = Object.entries(Depth);
    for (let i = entries.length - 1; i >= 0; i--) {
      const [name, value] = entries[i];
      if (depth >= value) return name;
    }
    return 'UNKNOWN';
  }
}

/**
 * 深度层级常量（向后兼容）
 */
export const DEPTH_LAYERS = Depth;
