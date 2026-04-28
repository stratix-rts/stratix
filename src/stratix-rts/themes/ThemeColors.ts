/**
 * ThemeColors - Runtime design system color reader for Phaser
 *
 * Reads CSS custom properties (--ds-*) from document.documentElement
 * and converts to Phaser numeric color format.
 * Also supports reduced motion preferences.
 */

import Phaser from 'phaser';

let _reducedMotion: boolean | null = null;
let _reducedMotionListeners: Array<(reduced: boolean) => void> = [];

function checkReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function initReducedMotionListener(): void {
  if (typeof window === 'undefined') return;
  const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
  const handler = (e: MediaQueryListEvent | MediaQueryList) => {
    const reduced = 'matches' in e ? e.matches : (e as MediaQueryList).matches;
    _reducedMotion = reduced;
    _reducedMotionListeners.forEach(cb => cb(reduced));
  };
  // Modern API
  if (mql.addEventListener) {
    mql.addEventListener('change', handler);
  }
  _reducedMotion = mql.matches;
}

/** Get a design system color from CSS variable --ds-* */
export function getDSColor(varName: string): number {
  if (typeof window === 'undefined' || !document?.documentElement) {
    return 0xffffff;
  }
  const fullName = varName.startsWith('--') ? varName : `--ds-${varName}`;
  const style = window.getComputedStyle(document.documentElement);
  const color = style.getPropertyValue(fullName).trim();
  if (!color) {
    return 0xffffff;
  }
  return Phaser.Display.Color.HexStringToColor(color).color;
}

/** Check if reduced motion is preferred */
export function isReducedMotion(): boolean {
  if (_reducedMotion === null) {
    _reducedMotion = checkReducedMotion();
  }
  return _reducedMotion;
}

/** Subscribe to reduced motion changes */
export function onReducedMotionChange(callback: (reduced: boolean) => void): () => void {
  _reducedMotionListeners.push(callback);
  return () => {
    const idx = _reducedMotionListeners.indexOf(callback);
    if (idx >= 0) _reducedMotionListeners.splice(idx, 1);
  };
}

/** Initialize theme listeners (call once from scene) */
export function initThemeRuntime(): void {
  initReducedMotionListener();
}

/** Get theme-aware glow color from brand primary */
export function getBrandGlowColor(): number {
  return getDSColor('color-primary');
}

/** Get status color by name */
export function getStatusColor(status: 'success' | 'warning' | 'danger' | 'info' | 'idle'): number {
  const map: Record<string, string> = {
    success: '--ds-status-success',
    warning: '--ds-status-warning',
    danger: '--ds-status-danger',
    info: '--ds-status-info',
    idle: '--ds-text-muted',
  };
  return getDSColor(map[status] || '--ds-color-primary');
}

/** Apply glow effect to a graphics object (single frame) */
export function drawGlowRing(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  radius: number,
  color: number,
  alpha: number,
  layers: number = 3
): void {
  for (let i = layers; i >= 0; i--) {
    const layerAlpha = alpha * (0.25 - i * 0.06);
    const layerWidth = 2 + i * 2;
    if (layerAlpha <= 0) continue;
    graphics.lineStyle(layerWidth, color, layerAlpha);
    graphics.strokeCircle(x, y, radius + i * 2);
  }
}
