/**
 * 文件职责：渲染进程侧的**开关 / 调参**读取 —— 首启向导强制开关 + 远程模式开关（B3 / task_083）
 *   + 互聊回合超时（task_090）。
 *   来源：.long-run-agent/tasks/task_026.md「开发期开关 STRATIX_ONBOARDING_FORCE=1 每次启动触发向导」；
 *   远程模式来源：.long-run-agent/tasks/task_083.md「装配开关：本地直连 dev 模式保留 / 远程模式新增，默认关」；
 *   互聊超时来源：.long-run-agent/tasks/task_090.md「互聊回合超时可配（STRATIX_PEER_TURN_TIMEOUT_MS）」。
 * 输入：构建期注入的常量（vite define）+ 运行时环境变量（Electron preload 透传 process.env）。
 * 输出：布尔值（开关是否打开）+ 远程模式的数据源地址 + 互聊回合超时的原始串。
 * 禁止事项：
 *   1. import electron —— 渲染层 bundle 里不能有 electron 模块（preload 的形状在这里重新声明一份）；
 *   2. import *.css / 任何 UI 依赖 —— 本模块只读开关；
 *   3. 直接用 import.meta.env —— 本仓库的 tsc 构建走 CommonJS（tsconfig.json），
 *      import.meta 在那里编译不过（TS1343），故改用 vite define 注入的常量；
 *   4. 在这里做数值解析 / 钳位 —— 本模块只搬运**原始串**，解析口径归
 *      app/services/agent-chat-service.ts 的 resolvePeerTurnTimeoutMs（纯函数、可单测）。
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

/**
 * 构建期注入的远程模式开关（B3 / task_083）。
 * why 与向导开关同一口径：构建期常量 + 运行时环境变量两处都读（已打包的 Electron 也要能开）。
 */
declare const __STRATIX_REMOTE__: string | undefined;

/** 构建期注入的 world-sync 端点地址（B3 / task_083；空串 = 用缺省地址）。 */
declare const __STRATIX_WORLD_SYNC_URL__: string | undefined;

/**
 * 构建期注入的互聊回合超时（task_090；空串 = 未设置 → 用缺省 120s）。
 * why 也要构建期这一路：纯浏览器 dev（npm run dev，不起 Electron）没有 preload 通道，
 *   只有 vite define 能把 shell 里的环境变量带进渲染层。
 */
declare const __STRATIX_PEER_TURN_TIMEOUT_MS__: string | undefined;

/**
 * 构建期注入的 LLM 自动起名配置（task_104；空串 = 未设置 → 规则版起名）。
 * why 也要构建期这一路：纯浏览器 dev（npm run dev，不起 Electron）没有 preload 通道，
 *   只有 vite define 能把 shell 里的环境变量带进渲染层。
 */
declare const __STRATIX_TITLE_LLM_URL__: string | undefined;
declare const __STRATIX_TITLE_LLM_KEY__: string | undefined;
declare const __STRATIX_TITLE_LLM_MODEL__: string | undefined;

/**
 * 构建期注入的长会话压缩阈值（@since v3.48，task_106 / v3.2b-B7；空串 = 未设置 → 用缺省 200）。
 * why 也要构建期这一路：纯浏览器 dev（npm run dev，不起 Electron）没有 preload 通道，
 *   只有 vite define 能把 shell 里的环境变量带进渲染层。
 */
declare const __STRATIX_SESSION_COMPRESS_THRESHOLD__: string | undefined;

/** preload 透传的环境变量形状（与 src/electron/preload.ts 的 ElectronAPI.env 对应）。 */
interface RuntimeEnvHost {
  readonly electronAPI?: {
    readonly env?: {
      readonly STRATIX_ONBOARDING_FORCE?: string | null;
      readonly STRATIX_REMOTE?: string | null;
      readonly STRATIX_WORLD_SYNC_URL?: string | null;
      readonly STRATIX_PEER_TURN_TIMEOUT_MS?: string | null;
      readonly SX_TITLE_LLM_URL?: string | null;
      readonly SX_TITLE_LLM_KEY?: string | null;
      readonly SX_TITLE_LLM_MODEL?: string | null;
      readonly SX_SESSION_COMPRESS_THRESHOLD?: string | null;
    };
  };
}

/** preload 透传的环境变量名（运行时那一路的键名集合）。 */
type RuntimeEnvName =
  | 'STRATIX_ONBOARDING_FORCE'
  | 'STRATIX_REMOTE'
  | 'STRATIX_WORLD_SYNC_URL'
  | 'STRATIX_PEER_TURN_TIMEOUT_MS'
  | 'SX_TITLE_LLM_URL'
  | 'SX_TITLE_LLM_KEY'
  | 'SX_TITLE_LLM_MODEL'
  | 'SX_SESSION_COMPRESS_THRESHOLD';

/** 读运行时环境变量（Electron）；非浏览器 / 无 preload 时返回 null。 */
function readRuntimeEnv(name: RuntimeEnvName): string | null {
  if (typeof window === 'undefined') return null;
  const host = window as unknown as RuntimeEnvHost;
  return host.electronAPI?.env?.[name] ?? null;
}

/**
 * 首启向导是否被强制触发。
 * 取值口径：严格等于 '1' 才算开（'true' / 'yes' 不认 —— 开关只有一个明确姿势，少一种歧义）。
 */
export function isOnboardingForced(): boolean {
  const buildTime = typeof __STRATIX_ONBOARDING_FORCE__ === 'string' ? __STRATIX_ONBOARDING_FORCE__ : '';
  if (buildTime === '1') return true;
  return readRuntimeEnv('STRATIX_ONBOARDING_FORCE') === '1';
}

/**
 * 用户是否要求减少动效（@since v3.8，task_140）。
 *
 * why 在 app 层判：world 层零 DOM —— `matchMedia` 只有组合根能碰；
 *   world 侧只读一个布尔标志（见 world/motion.ts）。
 *
 * 取值口径：系统设置里的「减少动态效果」开着 → true。
 * 读不出来（老浏览器 / 非浏览器环境）→ false（照常放动画，别误伤）。
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

/**
 * **远程模式**是否开启（前后端分离 B3 / task_083）。
 *
 * 开启后：Electron 壳退化为**纯视图客户端** —— 状态来自 service 的 world-sync 全量快照，
 *   写（hud 命令）走 `command.forward` 回 service 的 core 裁决（铁律 1/2）。
 *
 * 取值口径：严格等于 '1' 才算开 —— 与向导开关同一姿势。
 * why 默认关：本地直连是 dev 回退模式（铁律 7 —— 旧路径全程可用），远程模式由 C1 剧本显式开。
 */
export function isRemoteModeEnabled(): boolean {
  const buildTime = typeof __STRATIX_REMOTE__ === 'string' ? __STRATIX_REMOTE__ : '';
  if (buildTime === '1') return true;
  return readRuntimeEnv('STRATIX_REMOTE') === '1';
}

/**
 * 远程模式的 world-sync 端点地址（B3 / task_083）。
 *
 * 优先级：运行时环境变量 > 构建期常量 > 缺省（gateway 的 HTTP server + 协议路径）。
 * why 运行时优先：同一个构建产物要能指向不同的 service 实例（C1 剧本按需起服务）。
 */
export function remoteWorldSyncUrl(fallbackUrl: string): string {
  const runtime = readRuntimeEnv('STRATIX_WORLD_SYNC_URL');
  if (runtime) return runtime;
  const buildTime = typeof __STRATIX_WORLD_SYNC_URL__ === 'string' ? __STRATIX_WORLD_SYNC_URL__ : '';
  if (buildTime !== '') return buildTime;
  return fallbackUrl;
}

/**
 * **互聊单回合超时**的原始环境值（task_090）。
 *
 * 优先级：运行时环境变量（Electron preload 透传）> 构建期常量（vite define）。
 * why 运行时优先：同一个构建产物要能按启动时的环境变量调超时（长研究型议题要更久）。
 *
 * 返回 null = 未设置 → 调用方用缺省 120s（DEFAULT_PEER_TURN_TIMEOUT_MS）。
 * why 只返回原始串：本模块不解析数值（解析 + 钳位归 resolvePeerTurnTimeoutMs，纯函数可单测）。
 */
export function peerTurnTimeoutRaw(): string | null {
  const runtime = readRuntimeEnv('STRATIX_PEER_TURN_TIMEOUT_MS');
  if (runtime) return runtime;
  const buildTime =
    typeof __STRATIX_PEER_TURN_TIMEOUT_MS__ === 'string' ? __STRATIX_PEER_TURN_TIMEOUT_MS__ : '';
  return buildTime !== '' ? buildTime : null;
}

/**
 * LLM 自动起名的 env（@since v3.47，task_104）——
 *   三个键：SX_TITLE_LLM_URL / SX_TITLE_LLM_KEY / SX_TITLE_LLM_MODEL。
 *
 * 优先级：运行时环境变量（Electron preload 透传）> 构建期常量（vite define）。
 * why 运行时优先：同一个构建产物要能按启动时的环境变量换起名后端（本地配一次即可）。
 *
 * 返回**原始串**（不解析、不校验完整性）：三件套齐不齐由
 *   app/services/llm-title-provider.ts 的 resolveTitleLlmConfig 判定（缺任一 → 规则版）。
 * 缺省的键不出现（undefined）—— 调用方按"没配"处理。
 */
export function titleLlmEnv(): Record<string, string | undefined> {
  const pick = (runtime: string | null, buildTime: string | undefined): string | undefined => {
    if (runtime !== null && runtime.trim() !== '') return runtime;
    if (typeof buildTime === 'string' && buildTime.trim() !== '') return buildTime;
    return undefined;
  };
  return {
    SX_TITLE_LLM_URL: pick(
      readRuntimeEnv('SX_TITLE_LLM_URL'),
      typeof __STRATIX_TITLE_LLM_URL__ === 'string' ? __STRATIX_TITLE_LLM_URL__ : undefined
    ),
    SX_TITLE_LLM_KEY: pick(
      readRuntimeEnv('SX_TITLE_LLM_KEY'),
      typeof __STRATIX_TITLE_LLM_KEY__ === 'string' ? __STRATIX_TITLE_LLM_KEY__ : undefined
    ),
    SX_TITLE_LLM_MODEL: pick(
      readRuntimeEnv('SX_TITLE_LLM_MODEL'),
      typeof __STRATIX_TITLE_LLM_MODEL__ === 'string' ? __STRATIX_TITLE_LLM_MODEL__ : undefined
    ),
  };
}

/**
 * **长会话压缩阈值**的原始环境值（@since v3.48，task_106 / v3.2b-B7）——
 *   env `SX_SESSION_COMPRESS_THRESHOLD`（事件条数；不设置 = 用缺省 200）。
 *
 * 优先级：运行时环境变量（Electron preload 透传）> 构建期常量（vite define）。
 * why 运行时优先：同一个构建产物要能按启动时的环境变量调压缩阈值（长任务会话更早折叠）。
 *
 * 返回**原始串**（不解析、不钳位）：解析口径归 app/services/session-compress-config.ts
 *   的 resolveSessionCompressThreshold（纯函数、可单测）。
 */
export function sessionCompressThresholdRaw(): string | null {
  const runtime = readRuntimeEnv('SX_SESSION_COMPRESS_THRESHOLD');
  if (runtime) return runtime;
  const buildTime =
    typeof __STRATIX_SESSION_COMPRESS_THRESHOLD__ === 'string'
      ? __STRATIX_SESSION_COMPRESS_THRESHOLD__
      : '';
  return buildTime !== '' ? buildTime : null;
}
