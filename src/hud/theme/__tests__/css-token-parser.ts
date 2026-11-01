/**
 * 测试辅助：读 / 解析 token 样式表里的 `--srf-*` 声明。
 *
 * 为什么不 import *.css：jest 没配 css transform（moduleFileExtensions 里没有 css），
 * 样式表一律 fs 直读 —— 与 theme-controller.test.ts / settings-screen.test.ts 的做法一致。
 * 本文件不是测试用例（jest testMatch 只收 *.test.ts）。
 */

import * as fs from 'fs';
import * as path from 'path';

/** theme/ 目录绝对路径。 */
export const THEME_DIR = path.join(__dirname, '..');

/** 读一份 token 样式表的原文。 */
export function readTokenCss(file: string): string {
  return fs.readFileSync(path.join(THEME_DIR, file), 'utf-8');
}

/** 样式表文件是否存在。 */
export function tokenCssExists(file: string): boolean {
  return fs.existsSync(path.join(THEME_DIR, file));
}

/**
 * 解析出 `--srf-*` 声明：名字 → 值。
 * 只认「行首（可带缩进）就是 --srf-xxx:」的声明，注释里提到的变量名不会被误收。
 */
export function parseTokenCss(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  const re = /^\s*(--srf-[a-z0-9-]+)\s*:\s*([^;]+);/gm;
  let match = re.exec(css);
  while (match !== null) {
    tokens.set(match[1], match[2].trim());
    match = re.exec(css);
  }
  return tokens;
}
