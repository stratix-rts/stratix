/**
 * 文件职责：LPC 素材的**基址解析**（纯函数，零 DOM 依赖，可在 node 下单测）。
 *   任务：.long-run-agent/tasks/task_027.md「素材不挪动，SPRITESHEET_BASE_PATH 指向 dist/frontend/spritesheets」。
 * 输入：一段 base URI（通常是 document.baseURI）+ 入口 HTML 相对站点根的目录层数。
 * 输出：素材根的绝对 URL（末尾不带斜杠）。
 * 禁止事项：
 *   1. 碰 document / window —— 本文件是纯函数，DOM 绑定在 src/app/services/appearance-environment.ts；
 *   2. 硬编码站点根路径 —— 入口 HTML 位置一变，基址就得跟着变（见 ENTRY_DEPTH 的用法）；
 *   3. 猜素材是否存在 —— 拼不拼得出来由浏览器报错，不在这里探测。
 *
 * ★ 为什么需要它（素材静态服务方案）：
 *   LPC 素材 1.3G，**不挪动、不复制、不入库**：真源 `assets/spritesheets/`（.gitignore 排除），
 *   vite `publicDir: 'assets'` 把它挂在站点根：
 *     - dev（http://127.0.0.1:7523/）：基址 = http://127.0.0.1:7523/spritesheets
 *     - 构建产物：http 部署时基址 = <站点根>/spritesheets（publicDir 被拷进 dist/frontend/）
 *     - electron 正式包（file://…/dist/frontend/index.html）：
 *       基址 = file://…/dist/frontend/spritesheets
 *   三种场景**同一条相对规则**即可覆盖：入口 HTML 就在站点根（task_122 起），
 *   素材在站点根下一层（spritesheets/）→ 相对基址 = 'spritesheets'。
 *   file:// 下绝对路径 '/spritesheets' 会被解析到文件系统根，所以正式包必须走相对基址。
 */

/**
 * 入口 HTML 相对**站点根**的目录层数（默认 0 = 入口就在站点根，task_122 起）。
 * 事实源是 src/app/entry-paths.ts 的 NEW_ENTRY_HTML；调用方（app 层绑定）应从那里取，
 * 这里只作为"按默认入口布局"的兜底值。两处不一致时由单测断言（见 __tests__/spritesheet-path.test.ts）。
 */
export const DEFAULT_ENTRY_DEPTH = 0;

/**
 * 素材根的相对目录名（相对站点根）。
 */
export const SPRITESHEET_DIR_NAME = 'spritesheets';

/**
 * 按"入口深度"算出素材根的**相对** URL 片段（不带前导斜杠），如 'spritesheets'（入口在站点根时）。
 * @param depth 入口 HTML 相对站点根的目录层数。
 */
export function spritesheetRelativeBase(depth: number = DEFAULT_ENTRY_DEPTH): string {
  const levels = Math.max(0, Math.floor(depth));
  return `${'../'.repeat(levels)}${SPRITESHEET_DIR_NAME}`;
}

/**
 * 把 base URI 解析成素材根的绝对 URL。
 *
 * @param baseUri 页面基址（如 document.baseURI）。
 * @param depth 入口 HTML 相对站点根的目录层数。
 * @returns 素材根 URL（末尾无斜杠），如 'http://127.0.0.1:7523/spritesheets'。
 *
 * why 用相对规则而不是"http 就用绝对路径、file:// 才特殊"：
 *   两条分支要维护两个真相（还得判断协议），而相对规则在 http 与 file:// 下是同一条 ——
 *   URL 解析会把 '../' 归一化，dev 的 '/' 与 prod 的 '/dist/frontend/index.html'
 *   都能落回各自的站点根。
 */
export function spritesheetBaseUrl(
  baseUri: string,
  depth: number = DEFAULT_ENTRY_DEPTH
): string {
  return new URL(spritesheetRelativeBase(depth), baseUri).href.replace(/\/+$/, '');
}

/**
 * 拼出一条素材图片的 URL。
 *
 * @param baseUrl 素材根 URL（spritesheetBaseUrl 的产物）。
 * @param relativePath 相对素材根的路径（形如 'body/bodies/male/walk/light.png'）。
 */
export function spritesheetImageUrl(baseUrl: string, relativePath: string): string {
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const trimmedPath = relativePath.replace(/^\/+/, '');
  return `${trimmedBase}/${trimmedPath}`;
}
