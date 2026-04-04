/**
 * UI Component Types
 */

/**
 * UI Component Config
 */
export interface UIComponentConfig {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  padding?: number;
  depth?: number;
  visible?: boolean;
  className?: string;
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
