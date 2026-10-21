/**
 * 文件职责：v3 新旧两个渲染入口的**唯一定义处** —— 入口 HTML 的相对路径 + 回退开关判定。
 *   方案来源：docs/REFACTOR_PLAN_V3.md §2「app/ 两个渲染入口（new / legacy）」+ §6 Phase 3「入口双轨切换」。
 * 输入：一个 env 形态的键值表（默认取 process.env）。
 * 输出：当前应当加载的入口 HTML 相对路径（相对 vite root；构建产物目录结构与之同构）。
 * 禁止事项：
 *   1. import electron / vue / phaser / core —— 本模块被 electron 主进程（commonjs）与 vite 配置共同消费，
 *      必须保持零依赖的纯常量 + 纯函数，否则 vite 配置会被渲染侧依赖拖垮；
 *   2. 在本模块里拼 URL 或拼文件绝对路径 —— "http://host:port/x" 与 "dist/frontend/x" 的拼法差异
 *      留在各自消费方（渲染进程 URL 由主进程决定，文件路径由 __dirname 决定）；
 *   3. 读 .env / dotenv —— 开关只认进程环境变量，配置文件留给后续任务（当前没有配置文件这一层）；
 *   4. 删掉 legacy 常量 —— Phase 3 之后 legacy 仍需保留一个版本周期的回退能力（§6「legacy 挂隐藏入口保留一个版本周期」）。
 */

/** 旧入口：仓库根 index.html → src/main.ts（Vue 应用）。文件与行为都不改，只是不再默认加载。 */
export const LEGACY_ENTRY_HTML = 'index.html';

/** 新入口：src/app/main/index.html（core runtime + world BattlefieldScene + hud main-screen 同屏装配）。 */
export const NEW_ENTRY_HTML = 'src/app/main/index.html';

/** 回退开关的环境变量名：置为 '1' 时加载 legacy 入口（默认走新入口）。 */
export const LEGACY_ENV_FLAG = 'STRATIX_LEGACY';

/** 最小 env 形态：只要求"字符串键 → 字符串值"，不绑 node 的 ProcessEnv 类型（vite 配置侧也能用）。 */
type EnvLike = Record<string, string | undefined>;

/**
 * 是否走 legacy 入口：只有显式 `'1'` 才算。
 * why 严格相等而不是宽松真值判断：`STRATIX_LEGACY=0` / `=false` 这类写法必须仍然表示"用新入口"，
 * 宽松判定会把 `0` 判成 true，回退开关就会反过来坑人。
 */
export function isLegacyEntry(env: EnvLike = process.env): boolean {
  return env[LEGACY_ENV_FLAG] === '1';
}

/** 当前生效的入口 HTML 相对路径（相对 vite root；dist/frontend 下同构）。 */
export function entryHtmlPath(env: EnvLike = process.env): string {
  return isLegacyEntry(env) ? LEGACY_ENTRY_HTML : NEW_ENTRY_HTML;
}