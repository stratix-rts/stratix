/**
 * Avatar 语义 Token
 */

import type { DesignSystemTokens } from '../types';

import type { AvatarSemanticToken } from './_generator';
import { generateAvatarSemantic } from './_generator';

export type { AvatarSemanticToken };

/**
 * 获取 Avatar 语义 Token（主题感知）
 */
export function getAvatarSemantic(theme: DesignSystemTokens): AvatarSemanticToken {
  return generateAvatarSemantic(theme.colors);
}

/**
 * 创建 Avatar CSS 变量
 */
export function generateAvatarCSSVariables(theme: DesignSystemTokens): string {
  const avatar = getAvatarSemantic(theme);
  return `
    --avatar-bg: ${avatar.background};
    --avatar-text: ${avatar.text};
    --avatar-border: ${avatar.border};
    --avatar-radius: ${avatar.borderRadius};
    --avatar-placeholder-bg: ${avatar.placeholderBackground};
    --avatar-placeholder-text: ${avatar.placeholderText};
  `;
}

/**
 * 应用 Avatar 样式到 DOM 元素
 */
export function applyAvatarStyles(
  element: HTMLElement,
  token: AvatarSemanticToken
): void {
  if (!element) {
    console.warn('[applyAvatarStyles] element is required');
    return;
  }
  element.style.backgroundColor = token.background;
  element.style.color = token.text;
  element.style.border = token.border;
  element.style.borderRadius = token.borderRadius;
  element.style.display = 'inline-flex';
  element.style.alignItems = 'center';
  element.style.justifyContent = 'center';
  element.style.overflow = 'hidden';
}
