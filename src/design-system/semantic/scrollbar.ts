/**
 * Scrollbar 语义 Token
 */

import type { DesignSystemTokens } from '../types';

import type { ScrollbarSemanticToken } from './_generator';
import { generateScrollbarSemantic } from './_generator';

export type { ScrollbarSemanticToken };

/**
 * 获取 Scrollbar 语义 Token（主题感知）
 */
export function getScrollbarSemantic(theme: DesignSystemTokens): ScrollbarSemanticToken {
  return generateScrollbarSemantic(theme.colors);
}

/**
 * 创建 Scrollbar CSS 变量
 */
export function generateScrollbarCSSVariables(theme: DesignSystemTokens): string {
  const sb = getScrollbarSemantic(theme);
  return `
    --scrollbar-track: ${sb.track};
    --scrollbar-thumb: ${sb.thumb};
    --scrollbar-thumb-hover: ${sb.thumbHover};
    --scrollbar-width: ${sb.width};
    --scrollbar-radius: ${sb.borderRadius};
  `;
}

/**
 * 生成 Scrollbar 全局 CSS 字符串（可直接注入到 style 标签）
 */
export function generateScrollbarCSS(theme: DesignSystemTokens): string {
  const sb = getScrollbarSemantic(theme);
  return `
    ::-webkit-scrollbar {
      width: ${sb.width};
      height: ${sb.width};
    }
    ::-webkit-scrollbar-track {
      background: ${sb.track};
      border-radius: ${sb.borderRadius};
    }
    ::-webkit-scrollbar-thumb {
      background: ${sb.thumb};
      border-radius: ${sb.borderRadius};
    }
    ::-webkit-scrollbar-thumb:hover {
      background: ${sb.thumbHover};
    }
  `;
}
