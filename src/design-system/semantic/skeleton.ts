/**
 * Skeleton 语义 Token
 */

import type { DesignSystemTokens } from '../types';

import type { SkeletonSemanticToken } from './_generator';
import { generateSkeletonSemantic } from './_generator';

export type { SkeletonSemanticToken };

/**
 * 获取 Skeleton 语义 Token（主题感知）
 */
export function getSkeletonSemantic(theme: DesignSystemTokens): SkeletonSemanticToken {
  return generateSkeletonSemantic(theme.colors);
}

/**
 * 创建 Skeleton CSS 变量
 */
export function generateSkeletonCSSVariables(theme: DesignSystemTokens): string {
  const s = getSkeletonSemantic(theme);
  return `
    --skeleton-base: ${s.base};
    --skeleton-highlight: ${s.highlight};
    --skeleton-radius: ${s.borderRadius};
    --skeleton-shimmer-duration: ${s.shimmerDuration}ms;
  `;
}

/**
 * 应用 Skeleton 样式到 DOM 元素
 */
export function applySkeletonStyles(
  element: HTMLElement,
  token: SkeletonSemanticToken
): void {
  if (!element) {
    console.warn('[applySkeletonStyles] element is required');
    return;
  }
  element.style.backgroundColor = token.base;
  element.style.borderRadius = token.borderRadius;
}
