/**
 * 文件职责：精灵特效素材（sheet PNG + atlas JSON）的**基址解析**（纯函数，零 DOM 依赖）。
 *   素材真源在 assets/fx/<skin>/（vite publicDir = 'assets' → 挂在站点根的 /fx/ 下）。
 * 输入：一段 base URI（通常是 document.baseURI）+ 入口 HTML 相对站点根的目录层数。
 * 输出：特效素材根的绝对 URL，以及拼出的单文件 URL。
 * 禁止事项：
 *   1. 碰 document / window —— DOM 绑定在 app 层（main-entry 的 preBoot）与 dev 入口；
 *   2. 硬编码站点根路径 —— 入口 HTML 位置一变，基址就得跟着变（与 spritesheet-path.ts 同纪律）；
 *   3. 猜素材是否存在 —— 拼不拼得出来由浏览器报错，不在这里探测。
 *
 * ★ 为什么必须有这一层（task_161）：
 *   特效素材挂在 publicDir 下，dev 是 http://127.0.0.1:7523/fx/...，
 *   electron 正式包是 file://…/dist/frontend/fx/... —— 两条路径的**唯一共性**是
 *   「相对入口 HTML 解析」；绝对路径 '/fx/...' 在 file:// 下会被解析到文件系统根（取不到）。
 *   dev 验收页住在 src/world/dev/ 下（比站点根深 2 层），相对规则同样覆盖 ——
 *   深度由调用方按入口位置给（本模块只认数字）。
 *
 * 平行实现：LPC 素材的同款解析在 appearance/spritesheet-path.ts（素材根 = spritesheets/）。
 *   两处各写各的，是因为素材根目录名与约定不同（spritesheets vs fx）；共用的只有
 *   「../ 逐层回退 + URL 归一化」这条规则本身。
 */

/** 特效素材根的相对目录名（相对站点根）。 */
export const FX_DIR_NAME = 'fx';

/**
 * game.registry 里的键名：特效素材根的绝对 URL（由 app 层 / dev 入口在 preBoot 注入）。
 *
 * why 走 registry 而不是场景自己算：world 零 DOM（铁律），document.baseURI 只有组合根能碰；
 *   场景自己算 URL 就得读 DOM —— 那要一条"world 允许摸 DOM"的例外，不值得。
 */
export const FX_ASSET_BASE_URL_KEY = 'srf:fx-asset-base-url';

/**
 * 入口 HTML 相对**站点根**的目录层数（默认 0 = 入口就在站点根）。
 * 事实源是 src/app/entry-paths.ts 的 NEW_ENTRY_HTML；调用方（app 层 / dev 入口）应从那里取，
 * 这里只作为"按默认入口布局"的兜底值。
 */
export const DEFAULT_ENTRY_DEPTH = 0;

/**
 * 按"入口深度"算出特效素材根的**相对** URL 片段（不带前导斜杠）。
 * @param depth 入口 HTML 相对站点根的目录层数。
 */
export function fxRelativeBase(depth: number = DEFAULT_ENTRY_DEPTH): string {
  const levels = Math.max(0, Math.floor(depth));
  return `${'../'.repeat(levels)}${FX_DIR_NAME}`;
}

/**
 * 把 base URI 解析成特效素材根的**绝对** URL（末尾无斜杠）。
 *
 * @param baseUri 页面基址（如 document.baseURI）。
 * @param depth 入口 HTML 相对站点根的目录层数。
 */
export function fxBaseUrl(baseUri: string, depth: number = DEFAULT_ENTRY_DEPTH): string {
  return new URL(fxRelativeBase(depth), baseUri).href.replace(/\/+$/, '');
}

/**
 * 拼出一条特效素材文件的 URL。
 *
 * @param baseUrl 素材根 URL（fxBaseUrl 的产物）。
 * @param relativePath 相对素材根的路径（形如 'default/celebrate.png'）。
 */
export function fxAssetUrl(baseUrl: string, relativePath: string): string {
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const trimmedPath = relativePath.replace(/^\/+/, '');
  return `${trimmedBase}/${trimmedPath}`;
}
