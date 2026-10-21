/**
 * 文件职责：v3 渲染入口 HTML 相对路径的**唯一定义处**。
 *   方案来源：docs/REFACTOR_PLAN_V3.md §2「app/ 两个渲染入口（new / legacy）」+ §6 Phase 3「切换与退役」。
 * 输出：应当加载的入口 HTML 相对路径（相对 vite root；构建产物目录结构与之同构）。
 * 禁止事项：
 *   1. import electron / vue / phaser / core —— 本模块被 electron 主进程（commonjs）与 vite 配置共同消费，
 *      必须保持零依赖的纯常量，否则 vite 配置会被渲染侧依赖拖垮；
 *   2. 在本模块里拼 URL 或拼文件绝对路径 —— "http://host:port/x" 与 "dist/frontend/x" 的拼法差异
 *      留在各自消费方（渲染进程 URL 由主进程决定，文件路径由 __dirname 决定）；
 *   3. 读 .env / dotenv。
 */

/**
 * 新入口（也是当前**唯一**入口）：src/app/main/index.html
 * （core runtime + world BattlefieldScene + hud main-screen 同屏装配）。
 *
 * ## 回退策略变更（task_017，原 STRATIX_LEGACY 开关已下线）
 * 旧入口（index.html → src/main.ts → App.vue → stratix-rts 的 Vue 战场链）随本任务整体退役，
 * 死开关 `STRATIX_LEGACY` 已从代码中删除 —— 留着只会让人以为"设个环境变量就能回去"，实际没有任何产物可加载。
 * 退役原因：旧链的战场场景本身就是 Zone 模型（Zone 即建筑 / 任务区 / 单位移动目标），
 * D5「Zone 整体砍掉」与"保住旧链"互斥，只能二选一。
 * **回退手段改为 git 历史**：`git checkout master`（或 `git revert` 本次提交）即可回到旧版可运行状态，
 * 详见 docs/REFACTOR_PLAN_V3.md §6 Phase 3。electron 主进程检测到 STRATIX_LEGACY 时会打印该提示。
 */
export const NEW_ENTRY_HTML = 'src/app/main/index.html';

/** 已退役的回退开关环境变量名：仅用于"用户还留着旧环境变量时给一句提示"，不再参与入口判定。 */
export const RETIRED_LEGACY_ENV_FLAG = 'STRATIX_LEGACY';

/**
 * 当前生效的入口 HTML 相对路径（相对 vite root；dist/frontend 下同构）。
 * 单入口后是常量函数，但保留函数形态：electron 主进程与 vite 配置共用同一份路径来源，避免两边各写一份字符串。
 */
export function entryHtmlPath(): string {
  return NEW_ENTRY_HTML;
}

/** 已退役的回退开关是否仍被设置（供主进程打印提示用；不改变入口判定）。 */
export function isRetiredLegacyFlagSet(env: Record<string, string | undefined> = process.env): boolean {
  return env[RETIRED_LEGACY_ENV_FLAG] !== undefined;
}