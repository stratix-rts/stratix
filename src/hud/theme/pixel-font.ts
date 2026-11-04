/**
 * 文件职责：像素皮肤的**真像素字体**（Fusion Pixel 缝合像素字体）—— 字体族名、文件位置、
 *   运行时 URL 解析与 @font-face 规则生成。
 *   来源：.long-run-agent/tasks/task_134.md「像素皮肤细节 A —— 商免像素字体内嵌 + 真实命中」。
 *   字体：Fusion Pixel 12px Mono zh-Hans Regular（TakWolf/fusion-pixel-font，**OFL 1.1 = 可商用**），
 *     子集 6928 码位 / 175 KB，资产在 `assets/fonts/`（许可证副本同目录，见该目录 README）。
 *
 * 输入：base URI（通常是 document.baseURI）+ 入口 HTML 相对站点根的目录层数。
 * 输出：@font-face 规则字符串（拼进像素皮肤的样式表源）与字体的绝对 URL。
 *
 * 禁止事项：
 *   1. 硬编码站点根路径（'/fonts/...'）—— 正式包走 file://，绝对路径会被解析到文件系统根；
 *      必须走**相对**基址（与 src/world/appearance/spritesheet-path.ts 同一套规则）；
 *   2. 把 @font-face 写进现代皮肤 —— 字体只在像素皮肤生效（现代皮肤零影响）；
 *   3. 碰 document / window —— 本模块是纯函数，DOM 绑定在调用方（组合根 / dev 入口）；
 *   4. 引入 npm 依赖 —— 字体是**资产文件**，子集化工具链是本地脚本（scripts/build-pixel-font-subset.py）。
 *
 * ★ 为什么 @font-face 由运行时拼，而不是写在 CSS 文件里（关键决策）：
 *   像素皮肤的样式表是**运行时注入的 <style> 文本**（theme-controller 按皮肤 id 整张启停）。
 *   若把 `url('fonts/xxx.woff2')` 写死在 CSS 文件里：
 *     - vite 构建期会把它当**源码相对路径**去解析 → 解析不到就留原文（构建告警），
 *       解析到了则改写成产物内的哈希资源路径（相对 **JS chunk** 目录，而浏览器按**文档**目录解析 → 404）；
 *   运行时用 document.baseURI 拼出绝对 URL，则 dev（http）/ 构建产物（http）/ 正式包（file://）
 *   三种场景**同一条相对规则**覆盖 —— 与素材基址的既有做法一致。
 */

/**
 * CSS 侧的字体族名（@font-face 里声明的名字，与字体内部 name 表里的
 * `Fusion Pixel 12px Mono zh-Hans` 是两个东西：CSS 只认这里声明的族名）。
 */
export const PIXEL_FONT_FAMILY = 'Fusion Pixel';

/** 字体目录名（相对站点根；vite publicDir = assets/ → 站点根下的 fonts/）。 */
export const PIXEL_FONT_DIR = 'fonts';

/** 字体文件名（assets/fonts/ 下）。 */
export const PIXEL_FONT_FILE = 'fusion-pixel-12px-zh-hans.woff2';

/**
 * 入口 HTML 相对站点根的默认层数（0 = 入口就在站点根）。
 * 事实源在 app/entry-paths.ts（ENTRY_PATH_DEPTH）；本模块只作为「默认入口布局」的兜底值。
 */
export const DEFAULT_PIXEL_FONT_DEPTH = 0;

/**
 * 按「入口深度」算出字体文件的**相对**路径片段（不带前导斜杠）。
 * @param depth 入口 HTML 相对站点根的目录层数。
 */
export function pixelFontRelativePath(depth: number = DEFAULT_PIXEL_FONT_DEPTH): string {
  const levels = Math.max(0, Math.floor(depth));
  return `${'../'.repeat(levels)}${PIXEL_FONT_DIR}/${PIXEL_FONT_FILE}`;
}

/**
 * 把 base URI 解析成字体的绝对 URL。
 *
 * @param baseUri 页面基址（如 document.baseURI）。
 * @param depth 入口 HTML 相对站点根的目录层数。
 * @returns 字体 URL；base URI 不可解析时退回相对路径（浏览器按文档基址自行解析）。
 *
 * why 用相对规则而不是「http 用绝对路径、file:// 才特殊」：
 *   两条分支要维护两个真相，而相对规则在 http 与 file:// 下是同一条 ——
 *   dev: http://127.0.0.1:7523/fonts/xxx.woff2
 *   正式包: file://…/dist/frontend/fonts/xxx.woff2
 */
export function pixelFontUrl(
  baseUri: string,
  depth: number = DEFAULT_PIXEL_FONT_DEPTH
): string {
  try {
    return new URL(pixelFontRelativePath(depth), baseUri).href;
  } catch {
    return pixelFontRelativePath(depth);
  }
}

/**
 * 生成 @font-face 规则（拼进像素皮肤的样式表源）。
 *
 * why 走 font-display: swap：字体是本地资产（175 KB），加载极快；swap 让首帧先显示回退字体，
 *   不会出现「文字凭空消失几秒」的 block 行为。
 */
export function pixelFontFaceCss(fontUrl: string): string {
  return [
    '@font-face {',
    `  font-family: "${PIXEL_FONT_FAMILY}";`,
    `  src: url("${fontUrl}") format("woff2");`,
    '  font-weight: 400;',
    '  font-style: normal;',
    '  font-display: swap;',
    '}',
  ].join('\n');
}
