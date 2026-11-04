/**
 * 单元测试：像素皮肤的真像素字体（@since v3.8，task_134）——
 *   ① URL 解析在三种部署形态下都落在正确位置（dev http / 构建产物 http / 正式包 file://）；
 *   ② @font-face 规则声明的族名与 token 栈首位一致（否则「栈头命中」不成立）；
 *   ③ 字体资产与 OFL 许可证副本都在仓库里，且体积在预算内（≤ 400 KB）。
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  DEFAULT_PIXEL_FONT_DEPTH,
  PIXEL_FONT_FAMILY,
  PIXEL_FONT_FILE,
  pixelFontFaceCss,
  pixelFontRelativePath,
  pixelFontUrl,
} from '../pixel-font';

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const FONT_DIR = path.join(REPO_ROOT, 'assets', 'fonts');
const FONT_PATH = path.join(FONT_DIR, PIXEL_FONT_FILE);

/** 像素皮肤的 token 表（字体栈的事实源）。 */
const pixelTokens = fs.readFileSync(
  path.join(__dirname, '..', 'tokens-pixel.css'),
  'utf-8'
);

describe('pixel-font（Fusion Pixel 内嵌像素字体）', () => {
  it('相对路径按入口深度回退（入口在站点根 = 0 层）', () => {
    expect(DEFAULT_PIXEL_FONT_DEPTH).toBe(0);
    expect(pixelFontRelativePath(0)).toBe(`fonts/${PIXEL_FONT_FILE}`);
    expect(pixelFontRelativePath(2)).toBe(`../../fonts/${PIXEL_FONT_FILE}`);
    // 负深度不产生 '../'（避免拼出越界路径）
    expect(pixelFontRelativePath(-3)).toBe(`fonts/${PIXEL_FONT_FILE}`);
  });

  it('dev（http）与正式包（file://）都落在站点根下的 fonts/', () => {
    expect(pixelFontUrl('http://127.0.0.1:7523/index.html', 0)).toBe(
      `http://127.0.0.1:7523/fonts/${PIXEL_FONT_FILE}`
    );
    expect(pixelFontUrl('file:///app/dist/frontend/index.html', 0)).toBe(
      `file:///app/dist/frontend/fonts/${PIXEL_FONT_FILE}`
    );
    // 嵌套 dev 页（src/app/dev/xxx.html = 3 层）回退三层
    expect(pixelFontUrl('http://127.0.0.1:7523/src/app/dev/hello-loop.html', 3)).toBe(
      `http://127.0.0.1:7523/fonts/${PIXEL_FONT_FILE}`
    );
  });

  it('base URI 不可解析时退回相对路径（不抛）', () => {
    expect(pixelFontUrl('not a url')).toBe(`fonts/${PIXEL_FONT_FILE}`);
  });

  it('@font-face 声明的族名与像素 token 栈首位一致', () => {
    const css = pixelFontFaceCss('http://127.0.0.1:7523/fonts/x.woff2');
    expect(css).toContain(`font-family: "${PIXEL_FONT_FAMILY}"`);
    expect(css).toContain('url("http://127.0.0.1:7523/fonts/x.woff2") format("woff2")');
    expect(css).toContain('font-display: swap');
    // 栈头必须是 Fusion Pixel —— 否则「字体命中」只是加载了却没用上
    expect(pixelTokens).toContain(`--srf-font-ui: "${PIXEL_FONT_FAMILY}"`);
    expect(pixelTokens).toContain(`--srf-font-mono: "${PIXEL_FONT_FAMILY}"`);
  });

  it('现代皮肤（tokens-default.css）的字体栈不含内嵌像素字体', () => {
    const modernTokens = fs.readFileSync(
      path.join(__dirname, '..', 'tokens-default.css'),
      'utf-8'
    );
    expect(modernTokens).not.toContain(PIXEL_FONT_FAMILY);
  });

  it('仓库里有字体资产与 OFL 许可证副本，且体积 ≤ 400KB', () => {
    expect(fs.existsSync(FONT_PATH)).toBe(true);
    expect(fs.existsSync(path.join(FONT_DIR, 'OFL-FusionPixel.txt'))).toBe(true);
    const bytes = fs.statSync(FONT_PATH).size;
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(400 * 1024);
  });
});
