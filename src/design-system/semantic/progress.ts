/**
 * Progress / Loading 语义 Token
 */

import type { DesignSystemTokens } from '../types';

import type { ProgressSemanticToken } from './_generator';
import { generateProgressSemantic } from './_generator';

export type { ProgressSemanticToken };

/**
 * 获取 Progress 语义 Token（主题感知）
 */
export function getProgressSemantic(theme: DesignSystemTokens): ProgressSemanticToken {
  return generateProgressSemantic(theme.colors);
}

/**
 * 创建 Progress CSS 变量
 */
export function generateProgressCSSVariables(theme: DesignSystemTokens): string {
  const p = getProgressSemantic(theme);
  return `
    --progress-track: ${p.track};
    --progress-fill: ${p.fill};
    --progress-fill-success: ${p.fillSuccess};
    --progress-fill-warning: ${p.fillWarning};
    --progress-fill-danger: ${p.fillDanger};
    --progress-text: ${p.text};
    --progress-height: ${p.height};
    --progress-radius: ${p.borderRadius};
  `;
}

/**
 * 应用 Progress 样式到 DOM 元素
 */
export function applyProgressStyles(
  element: HTMLElement,
  token: ProgressSemanticToken
): void {
  if (!element) {
    console.warn('[applyProgressStyles] element is required');
    return;
  }
  element.style.backgroundColor = token.track;
  element.style.height = token.height;
  element.style.borderRadius = token.borderRadius;
  element.style.overflow = 'hidden';
}
