/**
 * 文件职责：渲染进程侧的**开关 / 调参**读取 —— 首启向导强制开关 + 远程模式开关（B3 / task_083）
 *   + 互聊回合超时（task_090）。
 *   来源：.long-run-agent/tasks/task_026.md「开发期开关 STRATIX_ONBOARDING_FORCE=1 每次启动触发向导」；
 *   远程模式来源：.long-run-agent/tasks/task_083.md「装配开关：本地直连 dev 模式保留 / 远程模式新增」；
 *   默认值反转见 task_153（缺省即开 = 连本地网关是默认，见 isRemoteModeEnabled 的说明）；
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
 * **远程模式（= world-sync 连接）**是否开启（前后端分离 B3 / task_083；
 *   @since v3.10，task_153 **默认反转**）。
 *
 * 开启后：Electron 壳 / 浏览器页退化为**纯视图客户端** —— 状态来自 service 的
 *   world-sync 全量快照，写（hud 命令）走 `command.forward` 回 service 的 core 裁决（铁律 1/2）。
 *
 * ============ 为什么默认值反了（task_153）============
 *   原口径是「默认关、显式 `STRATIX_REMOTE=1` 才开」（task_083 的迁移期设定）。
 *   实测反馈是：**功能上似乎未能联通，看不到 agent** —— 浏览器开 7523 不连网关，
 *   网关里的角色 / 任务 / 编组全流不进来，战场恒空。
 *   根因不是「连不上」，而是「压根没发起连接」：**默认值本身是错的**。
 *   故产品语义反转为：**连本地网关是默认（缺省即开），连不上才降级**（横幅 + 自动重连，
 *   见 remote-store 的指数退避重连与 app/services/gateway-link.ts 的三级态）。
 *
 * ============ 取值口径 ============
 *   · 缺省（两路来源都没给）→ **开**（新默认）。
 *   · 显式关：`'0'` / `'off'` / `'false'` / `'no'`（大小写与首尾空白不敏感）→ 关。
 *     —— 这是**测试口 / 本地直连回退口**：老路径（本地直连，铁律 7 的旧路径全程可用）
 *       一行 `STRATIX_REMOTE=0 npm run dev` 就能回到。
 *   · 其余非空值（含 `'1'`）→ 开。
 *   · URL 覆盖（`?stratix-remote=0|1`）优先于上面两路 —— 测试口，见 readUrlOverride。
 *   优先级：URL > 运行时环境变量（Electron preload 透传）> 构建期常量（vite define）> 缺省（开）。
 */
export function isRemoteModeEnabled(): boolean {
  const url = readUrlOverride();
  if (url !== null) return !isSwitchOff(url);
  const runtime = readRuntimeEnv('STRATIX_REMOTE');
  if (runtime !== null && runtime.trim() !== '') return !isSwitchOff(runtime);
  const buildTime = typeof __STRATIX_REMOTE__ === 'string' ? __STRATIX_REMOTE__ : '';
  if (buildTime.trim() !== '') return !isSwitchOff(buildTime);
  return true; // 缺省即开（task_153 的产品语义反转）
}

/**
 * URL 覆盖（**测试口**）：`?stratix-remote=0` → 强制关（本地直连），`?stratix-remote=1` → 强制开。
 *
 * why 需要它（task_153）：默认反转成「连本地网关」之后，**依赖本地直连形态**的 e2e 剧本
 *   （空战场 / 首启向导：本地模式才 0 角色）就没法直接跑在共享的 dev 实例上了 ——
 *   而重启 dev 实例改环境变量会波及别的剧本。这里给一个**进程内**的开关：
 *   同一台 dev server 上按 URL 切模式，谁也不打扰谁。
 *
 * 优先级：URL > 运行时环境变量 > 构建期常量 > 缺省（开）。
 */
function readUrlOverride(): string | null {
  if (typeof window === 'undefined') return null;
  const search = window.location?.search;
  if (typeof search !== 'string' || search === '') return null;
  try {
    return new URLSearchParams(search).get('stratix-remote');
  } catch {
    return null;
  }
}

/**
 * 开关的「显式关」取值判定。
 * why 认多种写法：dev 手册里 `0` / `off` / `false` / `no` 都出现过 —— 认不全就会有人
 *   以为关了其实还开着（本地直连路径与 world-sync 路径同时存在 = 第二份真相，铁律 1）。
 */
function isSwitchOff(raw: string): boolean {
  const value = raw.trim().toLowerCase();
  return value === '0' || value === 'off' || value === 'false' || value === 'no';
}

/**
 * 远程模式（world-sync）的端点地址（B3 / task_083；@since v3.10，task_153 默认指本地网关）。
 *
 * 优先级：运行时环境变量 > 构建期常量 > 缺省（**本机 gateway 的 HTTP server + 协议路径**，
 *   即 ws://127.0.0.1:7524/ws/world-sync —— 见 remote-store 的 DEFAULT_WORLD_SYNC_URL）。
 * why 运行时优先：同一个构建产物要能指向不同的 service 实例（C1 剧本按需起服务）。
 * why 缺省是本地网关（task_153）：「连本地网关是默认」—— 端点不该还要人配一次。
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
