/**
 * Table / DataGrid 语义 Token
 */

import type { DesignSystemTokens } from '../types';

import type { TableSemanticToken } from './_generator';
import { generateTableSemantic } from './_generator';

export type { TableSemanticToken };

/**
 * 获取 Table 语义 Token（主题感知）
 */
export function getTableSemantic(theme: DesignSystemTokens): TableSemanticToken {
  return generateTableSemantic(theme.colors);
}

/**
 * 创建 Table CSS 变量
 */
export function generateTableCSSVariables(theme: DesignSystemTokens): string {
  const table = getTableSemantic(theme);
  return `
    --table-header-bg: ${table.headerBackground};
    --table-header-text: ${table.headerText};
    --table-row-bg: ${table.rowBackground};
    --table-row-alt-bg: ${table.rowBackgroundAlt};
    --table-row-hover: ${table.rowHover};
    --table-border: ${table.border};
    --table-text: ${table.text};
    --table-selected-bg: ${table.selectedBackground};
  `;
}

/**
 * 应用 Table 样式到 DOM 元素
 */
export function applyTableStyles(
  element: HTMLElement,
  token: TableSemanticToken
): void {
  if (!element) {
    console.warn('[applyTableStyles] element is required');
    return;
  }
  element.style.setProperty('--table-header-bg', token.headerBackground);
  element.style.setProperty('--table-header-text', token.headerText);
  element.style.setProperty('--table-row-bg', token.rowBackground);
  element.style.setProperty('--table-row-alt-bg', token.rowBackgroundAlt);
  element.style.setProperty('--table-row-hover', token.rowHover);
  element.style.setProperty('--table-border', token.border);
  element.style.setProperty('--table-text', token.text);
  element.style.setProperty('--table-selected-bg', token.selectedBackground);
}
