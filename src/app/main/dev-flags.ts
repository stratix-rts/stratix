/**
 * 文件职责：渲染进程侧的**开发期开关**读取 —— 目前只有首启向导的强制开关。
 *   来源：.long-run-agent/tasks/task_026.md「开发期开关 STRATIX_ONBOARDING_FORCE=1 每次启动触发向导」。
 * 输入：构建期注入的常量（vite define）+ 运行时环境变量（Electron preload 透传 process.env）。
 * 输出：布尔值（开关是否打开）。
 * 禁止事项：
 *   1. import electron —— 渲染层 bundle 里不能有 electron 模块（preload 的形状在这里重新声明一份）；
 *   2. import *.css / 任何 UI 依赖 —— 本模块只读开关；
 *   3. 直接用 import.meta.env —— 本仓库的 tsc 构建走 CommonJS（tsconfig.json），
 *      import.meta 在那里编译不过（TS1343），故改用 vite define 注入的常量。
 *
 * ★ 为什么两处来源都读：
 *   - **构建期常量**（vite define）：dev server 启动时与 vite 进程同环境，
 *     `STRATIX_ONBOARDING_FORCE=1 npm run dev` 立刻生效；
 *   - **运行时环境变量**（Electron preload 透传）：已打包 / 已启动的 Electron 应用
 *     也能按环境变量触发，不必重新构建。
 *   两处都没有 → 开关关闭（正常首启逻辑）。
 */

/**
 * 构建期注入的开关值（vite define 注入字符串 '1' 或 ''）。
 * why 用 `declare const` 而不是 import.meta.env：tsc（CommonJS 构建）不认 import.meta。
 */
declare const __STRATIX_ONBOARDING_FORCE__: string | undefined;

/** preload 透传的环境变量形状（与 src/electron/preload.ts 的 ElectronAPI.env 对应）。 */
interface RuntimeEnvHost {
  readonly electronAPI?: {
    readonly env?: { readonly STRATIX_ONBOARDING_FORCE?: string | null };
  };
}

/** 读运行时环境变量（Electron）；非浏览器 / 无 preload 时返回 null。 */
function readRuntimeFlag(): string | null {
  if (typeof window === 'undefined') return null;
  const host = window as unknown as RuntimeEnvHost;
  return host.electronAPI?.env?.STRATIX_ONBOARDING_FORCE ?? null;
}

/**
 * 首启向导是否被强制触发。
 * 取值口径：严格等于 '1' 才算开（'true' / 'yes' 不认 —— 开关只有一个明确姿势，少一种歧义）。
 */
export function isOnboardingForced(): boolean {
  const buildTime = typeof __STRATIX_ONBOARDING_FORCE__ === 'string' ? __STRATIX_ONBOARDING_FORCE__ : '';
  if (buildTime === '1') return true;
  return readRuntimeFlag() === '1';
}
