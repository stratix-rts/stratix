/**
 * UI Component Types (基础层)
 *
 * 注意：core/types/component.types.ts 包含扩展版本（含 reactiveTheme, data 等）
 */

/**
 * UI Component Config（基础版）
 */
export interface UIComponentConfig {
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly padding?: number;
  readonly depth?: number;
  readonly visible?: boolean;
  readonly className?: string;
}

/**
 * DOM Component Config
 */
export interface DOMComponentConfig extends UIComponentConfig {
  html?: string;
  styles?: string;
  cssUrl?: string;
}

/**
 * Container Component Config
 */
export interface ContainerComponentConfig extends UIComponentConfig {
  background?: {
    enabled?: boolean;
    color?: number;
    alpha?: number;
    borderRadius?: number;
    borderThickness?: number;
    borderColor?: number;
  };
}

/**
 * Theme Reference
 */
export type ThemeName = 'cyberpunk' | 'minimal' | 'professional';

/**
 * Component Token Reference
 */
export interface ComponentTokenRef {
  theme: ThemeName;
  path: string;
}
