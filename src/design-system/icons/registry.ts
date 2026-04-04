/**
 * 图标注册表
 * 
 * 混合实现：
 * - SVG 用于 DOM 组件 (Lucide Icons)
 * - Graphics 用于 Phaser 组件
 * 
 * 所有图标本地化，支持离线使用
 */

import type { SVGIconPath, GraphicsIconRenderer } from '../types';

/**
 * SVG 图标路径注册表
 * 
 * Lucide Icons - https://lucide.dev
 * 尺寸：24x24
 * 许可证：ISC (MIT 兼容)
 * 
 * 使用脚本下载图标到本地:
 * scripts/download-icons.py
 */
export const SVGIconRegistry: Record<string, SVGIconPath> = {
  // Agent 相关
  'agent': '<path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/><path d="M4 11v-1a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M15 11v-1a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2Z"/><path d="M12 22v-9"/><path d="M9 17l3-3 3 3"/>',
  'agent-busy': '<path d="M12 2v4"/><path d="M12 18v4"/><path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="M4.93 19.07l2.83-2.83"/><path d="M16.24 7.76l2.83-2.83"/><circle cx="12" cy="12" r="5"/>',
  'agent-offline': '<path d="M12 2a2 2 0 0 1 2 2v2"/><path d="M4 11v-1a2 2 0 0 1 2-2h1"/><path d="M15 11v-1a2 2 0 0 1 2-2h1"/><path d="M12 22v-9"/><circle cx="12" cy="12" r="9" stroke-dasharray="4 2"/>',
  
  // 命令相关
  'move': '<path d="M5 9l4-4 4 4"/><path d="M9 5v14"/><path d="M19 9l-4 4-4-4"/>',
  'patrol': '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  'stop': '<rect x="3" y="3" width="18" height="18" rx="2"/>',
  'hold': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  'return': '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  
  // UI 相关
  'close': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'settings': '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  'check': '<path d="M20 6 9 17l-5-5"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'plus': '<path d="M5 12h14"/><path d="M12 5v14"/>',
  'minus': '<path d="M5 12h14"/>',
  'trash': '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  'edit': '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  'refresh': '<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/>',
  
  // 状态相关
  'success': '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/>',
  'warning': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  'error': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  'info': '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  
  // 文件相关
  'folder': '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>',
  'file': '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/>',
  'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  'upload': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  
  // 用户相关
  'user': '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  
  // 导航相关
  'home': '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  'search': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  'menu': '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
  'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'star': '<path d="M12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2Z"/>',
  'zap': '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  'shield': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  'rocket': '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  
  // 新增缺失图标
  'activity': '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  'bookmark': '<path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  'brain': '<path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/>',
  'clock': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  'cpu': '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3"/><path d="M15 1v3"/><path d="M9 20v3"/><path d="M15 20v3"/><path d="M20 9h3"/><path d="M20 14h3"/><path d="M1 9h3"/><path d="M1 14h3"/>',
  'file-text': '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/>',
  'filter': '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  'heart': '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  'save': '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
  'sliders-horizontal': '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
};

/**
 * 自定义图标 (Phaser Graphics 绘制)
 * 
 * 用于游戏内 UI，支持动态着色
 */
export const CustomIconRegistry: Record<string, GraphicsIconRenderer> = {
  'agent-writer': (graphics, size, color) => {
    // 羽毛笔图标 - 写作 Agent
    graphics.lineStyle(2, color);
    graphics.beginPath();
    graphics.moveTo(0, 0);
    graphics.quadraticCurveTo(10, -5, 20, 0);
    graphics.quadraticCurveTo(10, 5, 0, 0);
    graphics.closePath();
    graphics.strokePath();
  },
  
  'agent-dev': (graphics, size, color) => {
    // 代码图标 - 开发 Agent
    graphics.lineStyle(2, color);
    graphics.beginPath();
    graphics.moveTo(5, 8);
    graphics.lineTo(12, 16);
    graphics.lineTo(19, 8);
    graphics.strokePath();
  },
  
  'agent-analyst': (graphics, size, color) => {
    // 图表图标 - 分析 Agent
    graphics.lineStyle(2, color);
    graphics.strokeRect(0, 4, 6, 16);
    graphics.strokeRect(9, 8, 6, 12);
    graphics.strokeRect(18, 2, 6, 18);
  },
  
  'zone-gather': (graphics, size, color) => {
    // 采集区图标
    graphics.lineStyle(2, color);
    graphics.strokeCircle(0, 0, 12);
    graphics.fillCircle(0, 0, 4);
  },
  
  'zone-process': (graphics, size, color) => {
    // 处理区图标
    graphics.lineStyle(2, color);
    graphics.strokeRect(-10, -10, 20, 20);
    graphics.beginPath();
    graphics.moveTo(-5, 0);
    graphics.lineTo(0, -5);
    graphics.lineTo(5, 0);
    graphics.lineTo(0, 5);
    graphics.closePath();
    graphics.strokePath();
  },
};

/**
 * 图标尺寸映射
 */
export const IconSizes = {
  xs: 12,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
} as const;

/**
 * 获取 SVG 图标路径
 */
export function getIconPath(name: string): string | null {
  return SVGIconRegistry[name] || null;
}

/**
 * 获取自定义图标绘制函数
 */
export function getCustomIcon(name: string): GraphicsIconRenderer | null {
  return CustomIconRegistry[name] || null;
}

/**
 * 图标工具：生成 SVG HTML
 */
export function createSVGIcon(name: string, size: number = 24, color: string = 'currentColor'): string {
  const path = getIconPath(name);
  if (!path) return '';
  
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

/**
 * 图标工具：绘制 Phaser Graphics 图标
 */
export function drawIcon(
  graphics: any,
  name: string,
  x: number,
  y: number,
  size: number,
  color: string
): void {
  const icon = getCustomIcon(name);
  if (icon) {
    const originalX = graphics.x;
    const originalY = graphics.y;
    graphics.x = x;
    graphics.y = y;
    icon(graphics, size, color);
    graphics.x = originalX;
    graphics.y = originalY;
  }
}

/**
 * 获取图标的 viewBox 属性
 */
export function getIconViewBox(name: string): string {
  return '0 0 24 24';
}
