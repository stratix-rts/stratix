/**
 * Phaser UI Base Classes
 *
 * Unified component system for Phaser rendering
 */

export { UIComponentBase } from './UIComponent.base';
export { DOMComponentBase } from './DOMComponent.base';
export { ContainerComponentBase } from './ContainerComponent.base';
export { DOMContainer, createDOMContainer } from './DOMContainer';
export { domOverlayManager } from './DOMOverlayManager';

export type { UIComponentConfig, DOMComponentConfig, ContainerComponentConfig } from './types';
export type { ThemeName, ComponentTokenRef } from './types';
