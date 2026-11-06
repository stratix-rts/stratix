/**
 * Stratix Electron 主进程
 *
 * 在 Electron 内部启动完整的 Gateway 服务，包括：
 * - Gateway HTTP 服务（仅本地访问）
 * - 数据存储服务（Electron userData 目录）
 * - Tailscale 集成
 * - OpenClaw 直连支持
 */

import fs from 'fs';
import path from 'path';

import { app, BrowserWindow, ipcMain, safeStorage, dialog } from 'electron';
import { ensureDirSync } from 'fs-extra';

import { entryHtmlPath, isRetiredLegacyFlagSet } from '../app/entry-paths';
import {
  detectAllAgents,
  detectCustomAgents,
  mergeDetectedAgents,
  verifyAgentRoster,
  T1_AGENT_DETECTION_TARGETS,
  type CustomDetectionTarget,
} from '../app/services/agent-detector';
import type { CliChatEventEnvelope, CliChatRunRequest } from '../app/services/chat-transport-bridge';
import { createTransportFor, createTransportForCustomAgent } from '../app/services/cli-transport';
import { createNodeExec } from '../app/services/node-exec';
// agent 健康事件表 IPC（@since v3.30，task_054）：DAO 与 game:saveHealthEvent 通道
// （写入时机在渲染层 health-monitor，这里只做形状校验 + 落库；insert 内部自带建表兑底）。
import {
  insertAgentHealthEvent,
  PERSISTED_AGENT_HEALTH_EVENTS,
  type AgentHealthEventInsert,
} from '../app/services/persistence/agent-health-dao';
// 角色池容量护栏（@since v3.3，task_205 / M2-08）：新角色进库前先过容量判定 ——
//   超限**拒新**（老行的改档照写），绝不让落库表跨副本无界增长。
import { filterCharactersWithinCapacity } from '../app/services/persistence/capacity-limits';
// 角色对话历史表 IPC（@since v3.15，task_036）：**读侧**两条通道（loadChatMessages /
// loadEarlierChatMessages）。写侧（saveChatMessage）已迁 service（A3 / task_079）—— 消息落库
// 由 service 进程的存储件独占写（service/storage.ts，铁律 6）。
import {
  ensureCharacterChatMessagesTable,
  loadChatMessages,
  loadEarlierChatMessages,
} from '../app/services/persistence/chat-history-dao';
// 自定义 agent 注册表（@since v3.32，task_056）：custom_agents 表 DAO + 四条 IPC 通道
//（list / create / delete / probe，见 setupIPC 的 customAgent: 段）。
import {
  deleteCustomAgent,
  ensureCustomAgentsTable,
  findCustomAgent,
  insertCustomAgent,
  loadCustomAgents,
  type CustomAgentDbLike,
  type PersistedCustomAgentRecord,
} from '../app/services/persistence/custom-agent-dao';
// 角色经验事件表 IPC（@since v3.36，task_061，schema v12）：exp_events 的**读侧**两条通道
// （loadExpEvents 按近窗读 / growthOverview 全场聚合）。写侧（saveExpEvent）已迁 service
// （A3 / task_079）—— 曲线真相源由 service 进程的存储件独占写（service/storage.ts，铁律 6）。
import {
  aggregateCharacterActivity,
  ensureExpEventsTable,
  loadExpEventsSince,
} from '../app/services/persistence/exp-event-dao';
import {
  ensureGameSaveTables,
  loadGameSnapshot,
  upsertCharacters,
  upsertUnitPositions,
  type PersistedCharacterRecord,
  type PersistedUnitPosition,
} from '../app/services/persistence/game-save-dao';
// 流水线表 IPC（@since v3.27，task_051）：DAO 与 game:savePipeline 通道。校验从严
// （IPC 是可信度最低的入口），坏形状一律拒（拒绝即回 {ok:false}，调用方只警告不阻断编排）。
import {
  ensurePipelinesTable,
  upsertPipeline,
  PERSISTED_PIPELINE_STATUSES,
  type PersistedPipelineRecord,
} from '../app/services/persistence/pipeline-record-dao';
// 外部会话引用表 IPC（@since v3.3，task_200 / N4b-1）：session_external_refs 的读写两条通道。
// 联合键 (external_session_id, instance_id) = design §3.4 R3 的判据（切副本后查不到 ⇒ 不能 resume）。
import {
  ensureSessionExternalRefsTable,
  findSessionExternalRefByCharacter,
  parseSessionExternalRefInsert,
  recordSessionExternalRef,
} from '../app/services/persistence/session-external-ref-dao';
// 角色任务表 IPC（@since v3.16，task_037）：**读侧**两条通道（loadTasks / taskStats）。
// 写侧（saveTask）已迁 service（A3 / task_079）—— 任务全文由 service 侧存储件独占写。
import {
  ensureCharacterTasksTable,
  loadRecentTasks,
  aggregateTaskStatusCounts,
} from '../app/services/persistence/task-record-dao';
import {
  canRegisterMoreCustomAgents,
  isAllowedCustomAgentCmd,
  validateCustomAgentDraft,
  MAX_CUSTOM_AGENTS,
  type CustomAgentValidationCode,
} from '../core/custom-agent';
import {
  AGENT_KINDS,
  MAX_EXTERNAL_SESSION_ID_LEN,
  customAgentIdOf,
  isBindableAgentKind,
  type AgentKind,
  type DetectedAgent,
} from '../core/types';
import { getDatabase } from '../stratix-database';
import { dataStoreService } from '../stratix-gateway/dataStoreService';
import { WebSocketOpenClawAdapter } from '../stratix-openclaw-adapter/WebSocketOpenClawAdapter';
import { EmbeddedTailscale } from '../stratix-tailscale/EmbeddedTailscale';

let mainWindow: BrowserWindow | null = null;
let tailscale: EmbeddedTailscale | null = null;
let activeOpenClawConnection: WebSocketOpenClawAdapter | null = null;
let userDataPath: string = '';
let texturesDir: string = '';
/**
 * 角色烘焙缓存目录（@since v3.3，task_195 / CP-01）。
 * why 落在 userData **顶层**（不在 data/ 下）：烘焙产物是**缓存**，不是业务数据 ——
 *   删掉整个目录就该能整体重建（DESIGN §2.2 纪律 3），单独放一处最省事。
 * why 不进仓库、不进 .stratix 契约目录：那是发布资产的归宿，缓存不属于那儿。
 */
let characterBakesDir: string = '';

// Development server ports to try when connecting to Vite dev server
const DEV_PORTS = [7523, 7524, 7525, 7526, 7527, 7528, 7529, 7530] as const;

// Backend server port (standalone backend started by electron:dev)
const BACKEND_PORT = 7524;

// ==================== 本地 CLI agent 检测（task_022） ====================
// 状态放主进程：只有 Node 侧能 spawn 子进程（渲染进程没有 child_process）。
// 检测结果经 IPC 交给渲染层并入 WorldState.detectedAgents（广播出口仍是 core/runtime.ts 的 store 订阅）。
let detectedAgents: DetectedAgent[] = [];
let detectionAbort: AbortController | null = null;

/**
 * 健康周期探测的在飞单例（@since v3.30，task_054）：agent:detected:probe 的串行化 ——
 * 渲染层 health-monitor 每 60s 调一次，但探测本身可能逐项吃超时（T1 五家最坏 5×10s）；
 * 同一轮重叠会让两个快照互踩（后归档的旧结果覆盖新结果）。同轮复用同一 promise。
 */
let healthProbeInFlight: Promise<DetectedAgent[]> | null = null;

// ==================== 角色对话 CLI transport（task_035）====================
// 状态放主进程：渲染层没有 child_process（nodeIntegration 关闭），子进程在这里拉起；
// 事件逐条推回渲染层（chat:event 信封，见 chat-transport-bridge.ts 的 CliChatEventEnvelope）。
// runId 由渲染层生成（全局唯一），abort 也按 runId 路由到对应的 AbortController。
//
// ★ @deprecated（前后端分离 C2 / task_085）—— **Electron main 不再是 CLI spawn 的归宿**。
//   新归属：service 进程（gateway 常驻 daemon）**直接** spawn CLI agent
//     （src/stratix-gateway/service/task-execution.ts，走 cli-transport 的 node-process 工厂，
//      不经任何 IPC 中转）。service 关掉 = agent 停机；Electron 关掉 = 只是视图没了。
//   本段（chat:run / chat:abort 两条 IPC 通道 + chatRuns 表）**只保留不删**（铁律 7 渐进迁移）：
//     它仍是「本地直连 dev 回退模式」的执行路径 —— 渲染进程不接 service 时，角色对话与任务执行
//     靠这两条通道把子进程拉到 Electron main 里跑。
//   迁移指引：
//     ① 生产 / 联调一律走 service（起 gateway 即带 service，`npm run dev:backend`）；
//        渲染侧改用远程模式开关 `STRATIX_REMOTE=1`（见 src/app/main/dev-flags.ts）。
//     ② 远程模式下这两条通道**不会被调用**（service 侧自己 spawn）—— Electron main 退化为纯视图壳。
//     ③ 待「本地直连模式」正式退役后，本段与 chat-transport-bridge 一起删除（不在本期）。
//   拓扑真相源：docs/SERVICE-SPLIT-PLAN.md §2（目标拓扑）+ §8（迁移期双模式）。
const chatRuns = new Map<string, AbortController>();

// Helper function for safe JSON parsing
function safeParseJson<T>(data: string, fallback: T): T {
  try {
    return JSON.parse(data) as T;
  } catch {
    return fallback;
  }
}

/**
 * 烘焙缓存键的文件名级校验（@since v3.3，task_195 / CP-01）。
 *
 * why 主进程要再校验一次：渲染层那边已经消毒过（world/appearance/bake-cache-key.ts 的
 *   sanitizeKeySegment），但**键会变成文件名** —— 一道纵深防御：只放行
 *   `[A-Za-z0-9._-]` 且不含连续点号（`..`），其余一律拒绝。
 *
 * @returns 合法且安全的键；非法返回 null。
 */
function sanitizeBakeKey(key: unknown): string | null {
  if (typeof key !== 'string') return null;
  if (key.length === 0 || key.length > 160) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(key)) return null;
  if (key.includes('..')) return null;
  return key;
}

/**
 * 烘焙元数据的**结构**校验（@since v3.3，task_196 / CP-02）。
 *
 * why 要在主进程也校验一遍：元数据是从磁盘读回来的 JSON —— 它可能**不是**我们写的那种
 *   （别人写的 / 写了一半 / 手工改过）。渲染层那边还会再按版本/键/指纹校验一遍（纵深防御），
 *   但主进程这道能当场把「坏文件」标成 corrupt，渲染层据此重烘修好，而不是拿它当命中用。
 */
function isBakedSheetMeta(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const meta = value as Record<string, unknown>;
  return (
    typeof meta.key === 'string' &&
    meta.key.length > 0 &&
    typeof meta.agentId === 'string' &&
    typeof meta.composerVersion === 'string' &&
    typeof meta.skinFingerprint === 'string' &&
    typeof meta.width === 'number' &&
    typeof meta.height === 'number' &&
    typeof meta.frameSize === 'number' &&
    Array.isArray(meta.animations)
  );
}

/**
 * 初始化所有服务
 */
async function initializeServices() {
  userDataPath = app.getPath('userData');
  // 1. 确定数据目录（Electron userData）
  const dataDir = path.join(userDataPath, 'data');
  console.log('[Electron] Data directory:', dataDir);

  // 设置纹理存储目录
  texturesDir = path.join(dataDir, 'textures');
  ensureDirSync(texturesDir);
  console.log('[Electron] Textures directory:', texturesDir);

  // 角色烘焙缓存目录（@since v3.3，task_195 / CP-01）：整精灵图 + atlas 元数据落这里。
  characterBakesDir = path.join(userDataPath, 'character-bakes');
  ensureDirSync(characterBakesDir);
  console.log('[Electron] Character bakes directory:', characterBakesDir);

  // 2. 初始化 DataStoreService
  await dataStoreService.initialize(dataDir);
  console.log('[Electron] DataStoreService initialized');

  // 3. 启动 Gateway 服务（嵌入式，仅本地访问）
  // Note: Gateway 服务已在 electron:dev 时通过 standalone backend 启动
  // 端口 7524 用于 OpenClaw 连接

  // 4. 启动 Tailscale
  tailscale = new EmbeddedTailscale({
    openClawPort: 18789,
    stateDir: path.join(dataDir, 'tailscale'),
    hostname: 'stratix',
    authKey: process.env.STRATIX_TAILSCALE_AUTH_KEY,
    healthCheckInterval: 60000,
  });
  
  const tailscaleStarted = await tailscale.start();
  if (tailscaleStarted) {
    tailscale.startHealthCheck();
    console.log('[Electron] Tailscale started');
  } else {
    console.error('[Electron] Tailscale failed to start - Tailscale features will be unavailable');
  }
}

/**
 * 创建主窗口
 *
 * 单入口（v3 Phase 3 / task_017）：只加载新游戏化 UI（入口 HTML = index.html，站点根；task_122 起）。
 * 旧 Vue 入口链已随 Zone 退役整体删除，原 STRATIX_LEGACY 回退开关随之失效 ——
 * 仍在环境里设了它的话这里只打印一句提示，回退手段是 git 历史（git checkout master / git revert），
 * 见 src/app/entry-paths.ts 的「回退策略变更」。
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'Stratix',
  });

  // 捕获渲染进程 console 日志到主进程 (只打印 error 级别)
  mainWindow.webContents.on('console-message', (event, level, message, _line, _sourceId) => {
    if (level >= 3) { // 0=verbose, 1=info, 2=warn, 3=error
      console.log(`[Renderer error]: ${message}`);
    }
  });

  // 当前生效入口（相对 vite root 的 HTML 路径）：dev 与正式产物共用同一个常量，避免两边各写一份
  const entryPath = entryHtmlPath();
  console.log(`[Electron] Entry: ${entryPath} (v3 new UI, 单入口)`);
  if (isRetiredLegacyFlagSet()) {
    console.warn(
      '[Electron] STRATIX_LEGACY 已失效：旧 Vue 入口链已退役（Zone 模型是旧链的地基），' +
      '本次仍加载新入口。回退请用 git 历史（git checkout master 或 git revert 该次提交）。'
    );
  }

  // 尝试从 Vite 开发服务器加载（端口 7523-7530）
  const loadDevUrl = async () => {
    const win = mainWindow;
    if (!win) return false;
    // 显式指定的 dev server（环境变量）优先于端口扫描。
    // why 需要它：端口扫描是「谁先占着 7523 就连谁」—— 实测场景（e2e 剧本）里别人的
    //   dev 实例正占着 7523，壳连过去就等于跑到别人的服务上去了。显式指址才可控。
    //   扫描失败（没响应）时回退到端口扫描，不让这一个开关成为单点故障。
    const explicitUrl = process.env.STRATIX_DEV_SERVER_URL;
    if (explicitUrl) {
      try {
        const response = await fetch(explicitUrl, { method: 'HEAD' });
        if (response.ok) {
          console.log('[Electron] Loading from Vite dev server (env):', explicitUrl);
          await win.loadURL(explicitUrl);
          // 不开 devtools：显式指址的场合（实测 / 远程壳）要的是安静的画面，不是调试面板。
          return true;
        }
        console.warn(`[Electron] STRATIX_DEV_SERVER_URL 无响应（HTTP ${response.status}），回退端口扫描`);
      } catch (err) {
        console.warn('[Electron] STRATIX_DEV_SERVER_URL 连不上，回退端口扫描:', err);
      }
    }
    for (const port of DEV_PORTS) {
      try {
        // why 带入口路径而不是只探端口根：入口 HTML 的路径由 entry-paths 说了算，
        // 不显式指向入口的话 electron:dev 会"连上了"却拿到 404。
        const url = `http://127.0.0.1:${port}/${entryPath}`;
        const response = await fetch(url, { method: 'HEAD' });
        if (response.ok) {
          console.log('[Electron] Loading from Vite dev server:', url);
          await win.loadURL(url);
          win.webContents.openDevTools();
          return true;
        }
      } catch {
        // 端口没有服务，继续尝试下一个
      }
    }
    return false;
  };

  // 尝试开发服务器，失败则加载本地文件
  loadDevUrl().then(success => {
    if (!success) {
      // 正式产物：dist/electron/electron → ../../frontend/<入口路径>（与 vite 多入口产物同构）
      const filePath = path.join(__dirname, '../../frontend', entryPath);
      console.log('[Electron] Loading from local file:', filePath);
      mainWindow!.loadFile(filePath);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * 启动本地 CLI agent 检测（task_022）。
 *
 * why 放主进程：只有 Node 侧能 spawn 子进程（渲染进程没有 child_process，且 nodeIntegration 关闭）。
 * 不阻塞启动：整轮探测是异步的，窗口照常加载；每探测完一项就把当前快照推给渲染层（渐进展示）。
 * 取消：退出前 abort（外层不再开始下一项；正在跑的那条由它自己的 10s 超时兜底）。
 */
function startAgentDetection(): void {
  const roster = verifyAgentRoster();
  if (!roster.ok) {
    console.error('[AgentDetector] 名单自检未通过：', roster.problems.join('；'));
  }
  detectionAbort = new AbortController();
  const execFn = createNodeExec();
  void detectAllAgents({
    execFn,
    signal: detectionAbort.signal,
    logger: (line) => console.log(line),
    onResult: (result) => {
      detectedAgents = mergeDetectedAgents(detectedAgents, result);
      broadcastDetectedAgents();
    },
  })
    .catch((error) => {
      console.error('[AgentDetector] 探测失败', error);
    })
    .finally(() => {
      // task_056：内置轮收尾后追加自定义注册轮（注册表空则零开销直过）。
      void probeCustomAgentsOnce(execFn, detectionAbort?.signal);
    });
}

/** 把 custom_agents 表读成探测目标列表（未初始化 / 读失败降级为空 —— 检测不能被注册表卡死）。 */
function loadCustomDetectionTargets(): CustomDetectionTarget[] {
  try {
    if (!dataStoreService.isInitialized()) return [];
    const db = getDatabase().getDatabase() as unknown as CustomAgentDbLike;
    ensureCustomAgentsTable(db);
    return loadCustomAgents(db).map((record) => ({
      id: record.id,
      name: record.name,
      probeCmd: record.probeCmd,
    }));
  } catch (error) {
    console.error('[CustomAgentDetector] 注册表读取失败，本轮跳过自定义探测', error);
    return [];
  }
}

/**
 * 跑一轮自定义注册探测（逐条 probeCmd 直跑；exit 0 = 在装，见 agent-detector 的 detectCustomAgent）。
 * 结果并入 detectedAgents 快照（自定义行 kind = `custom:<id>`）并推送 —— 与内置行同一广播面。
 * 返回本轮结果（健康探测轮的合成方也用它）。
 */
async function probeCustomAgentsOnce(
  execFn: ReturnType<typeof createNodeExec>,
  signal?: AbortSignal
): Promise<DetectedAgent[]> {
  const targets = loadCustomDetectionTargets();
  if (targets.length === 0) return [];
  return detectCustomAgents({
    execFn,
    targets,
    signal,
    logger: (line) => console.log(line),
    onResult: (result) => {
      detectedAgents = mergeDetectedAgents(detectedAgents, result);
      broadcastDetectedAgents();
    },
  });
}

/** 从检测快照里摘掉某个自定义注册的行（删除注册后用 —— 断检测，不动内置行）。 */
function dropCustomAgentRow(id: string): void {
  detectedAgents = detectedAgents.filter((agent) => customAgentIdOf(agent.kind) !== id);
}

/**
 * 跑一轮 T1 健康探测（@since v3.30，task_054）：渲染层 health-monitor 的周期探测后端。
 * 与启轮全量探测复用同一个 execFn / 快照缓存：逐项结果照样并入 detectedAgents 并推送
 * onUpdate（UI 的版末信息跟着刷新），resolve 把整轮结果交给渲染层做防抖判定。
 * 退出语义：不挂 detectionAbort（健康探测是常驻节奏，退出时进程都死了，无需优雅收尾）；
 * 单项超时由 detectAgent 自己的 10s 兑底，整轮有界。
 */
function runHealthProbeRound(): Promise<DetectedAgent[]> {
  healthProbeInFlight ??= (async () => {
    const execFn = createNodeExec();
    const builtin = await detectAllAgents({
      execFn,
      targets: T1_AGENT_DETECTION_TARGETS,
      logger: (line) => console.log(line),
      onResult: (result) => {
        detectedAgents = mergeDetectedAgents(detectedAgents, result);
        broadcastDetectedAgents();
      },
    });
    // task_056：自定义注册同座健康监测 —— 内置 T1 轮后追加自定义轮，合成一份快照回渲染层。
    const custom = await probeCustomAgentsOnce(execFn);
    return [...builtin, ...custom];
  })().finally(() => {
    healthProbeInFlight = null;
  });
  return healthProbeInFlight;
}

/** 把当前检测快照推给渲染层（渲染层并入 core 状态，由 core 广播 WorldState）。 */
function broadcastDetectedAgents(): void {
  if (!mainWindow) return;
  mainWindow.webContents.send('agent:detected:update', detectedAgents);
}

/**
 * 设置 IPC 处理程序
 */
function setupIPC() {
  // ==================== 本地 CLI agent 检测 IPC ====================
  // 渲染层启动时拉一次快照（补上「订阅之前就检测完」的那部分），之后靠推送更新。
  ipcMain.handle('agent:detected:snapshot', async () => detectedAgents);

  // 健康周期探测（@since v3.30，task_054）：渲染层 health-monitor 每 60s 按需拉一轮 T1 探测
  // （串行化在 runHealthProbeRound；结果逐项推送 onUpdate，resolve 给渲染层做防抖判定）。
  ipcMain.handle('agent:detected:probe', async () => runHealthProbeRound());

  // ==================== 游戏存档 IPC（@since v3.12，task_033）====================
  // 渲染层没有 Node 能力（sql.js 适配器需要 fs），持久化一律经这三条通道进主进程 DAO。
  // why 每条都查 isInitialized：setupIPC 虽在 initializeServices 之后，
  //   但 DAO 独立兜底建表（IF NOT EXISTS），初始化位序变化时也不至于炸出无提示的异常。
  ipcMain.handle('game:loadSnapshot', async () => {
    try {
      if (!dataStoreService.isInitialized()) return { ok: false, error: 'data store not initialized' };
      const db = getDatabase().getDatabase();
      ensureGameSaveTables(db);
      return { ok: true, ...loadGameSnapshot(db) };
    } catch (error: any) {
      console.error('[Electron] game:loadSnapshot failed:', error);
      return { ok: false, error: error?.message ?? String(error) };
    }
  });

  ipcMain.handle('game:saveCharacters', async (_event, records: PersistedCharacterRecord[]) => {
    try {
      if (!Array.isArray(records)) return { ok: false, error: 'records must be an array' };
      if (!dataStoreService.isInitialized()) return { ok: false, error: 'data store not initialized' };
      const db = getDatabase().getDatabase();
      ensureGameSaveTables(db);
      // 容量护栏（@since v3.3，task_205 / M2-08）：新行超上限 ⇒ 拒新（老行改档照写）。
      //   why 在这里判：这是渲染侧**唯一**的角色写库通道（写入路径 = 触发点）。
      const { accepted, rejected } = filterCharactersWithinCapacity(db, records);
      upsertCharacters(db, accepted);
      if (rejected.length > 0) {
        console.warn(
          `[Electron] game:saveCharacters 容量护栏拒新 ${rejected.length} 个角色（${rejected.join(', ')}）`
        );
      }
      return { ok: true, rejected: rejected.length };
    } catch (error: any) {
      console.error('[Electron] game:saveCharacters failed:', error);
      return { ok: false, error: error?.message ?? String(error) };
    }
  });

  ipcMain.handle('game:saveUnitPositions', async (_event, entries: PersistedUnitPosition[]) => {
    try {
      if (!Array.isArray(entries)) return { ok: false, error: 'entries must be an array' };
      if (!dataStoreService.isInitialized()) return { ok: false, error: 'data store not initialized' };
      const db = getDatabase().getDatabase();
      ensureGameSaveTables(db);
      // 副本归属（@since v3.3，task_210 / M2-11）：**归属随条目一起过来**（这一层拿不到活跃副本
      //   ⇒ 由渲染侧在坐标事件到达时盖上，见 game-save-coordinator）。
      //   why 选「载荷带归属」而不是「主进程自己取活跃副本」：后者要在主进程另建一份
      //   「当前是哪个副本」的状态（多一条同步通道 + 一份生命周期），口径会分裂到两个进程。
      //   DAO 层按 COALESCE 语义落库：来件没带归属就**不清**原值。
      upsertUnitPositions(db, entries);
      return { ok: true };
    } catch (error: any) {
      console.error('[Electron] game:saveUnitPositions failed:', error);
      return { ok: false, error: error?.message ?? String(error) };
    }
  });

  // ==================== 角色对话历史 IPC（@since v3.15，task_036）====================
  // 写侧已迁 service（A3 / task_079）：game:saveChatMessage 通道**退役** —— 消息落库由
  // service 进程的存储件独占写（src/stratix-gateway/service/storage.ts，铁律 6）。
  // 读侧保留：渲染层的历史回填仍经 preload 的 gameSave 面读本进程库（B 轨切读 API 后收尾）。
  ipcMain.handle('game:loadChatMessages', async (_event, characterId: unknown, limit: unknown) => {
    try {
      if (typeof characterId !== 'string' || characterId.length === 0 || characterId.length > 200) {
        return { ok: false, error: 'bad characterId' };
      }
      // 窗口收紧到 [1, 200]：缺省 50（抽屉口径），不信任渲染层传来的任意值。
      const messageWindow =
        typeof limit === 'number' && Number.isFinite(limit)
          ? Math.min(Math.max(Math.floor(limit), 1), 200)
          : 50;
      if (!dataStoreService.isInitialized()) return { ok: false, error: 'data store not initialized' };
      const db = getDatabase().getDatabase();
      ensureCharacterChatMessagesTable(db);
      return { ok: true, messages: loadChatMessages(db, characterId, messageWindow) };
    } catch (error: any) {
      console.error('[Electron] game:loadChatMessages failed:', error);
      return { ok: false, error: error?.message ?? String(error) };
    }
  });

  ipcMain.handle('game:loadEarlierChatMessages', async (_event, characterId: unknown, beforeId: unknown, limit: unknown) => {
    try {
      if (typeof characterId !== 'string' || characterId.length === 0 || characterId.length > 200) {
        return { ok: false, error: 'bad characterId' };
      }
      if (typeof beforeId !== 'number' || !Number.isSafeInteger(beforeId) || beforeId <= 0) {
        return { ok: false, error: 'bad beforeId' };
      }
      const messageWindow =
        typeof limit === 'number' && Number.isFinite(limit)
          ? Math.min(Math.max(Math.floor(limit), 1), 200)
          : 50;
      if (!dataStoreService.isInitialized()) return { ok: false, error: 'data store not initialized' };
      const db = getDatabase().getDatabase();
      ensureCharacterChatMessagesTable(db);
      return { ok: true, messages: loadEarlierChatMessages(db, characterId, beforeId, messageWindow) };
    } catch (error: any) {
      console.error('[Electron] game:loadEarlierChatMessages failed:', error);
      return { ok: false, error: error?.message ?? String(error) };
    }
  });

  // ==================== 角色任务记录 IPC（@since v3.16，task_037）====================
  // 写侧已迁 service（A3 / task_079）：game:saveTask 通道**退役** —— 任务全文（含 completed 的
  // 输出全文）由 service 进程的存储件独占写（src/stratix-gateway/service/storage.ts，铁律 6）。
  // 读侧保留：渲染层的历史列表仍经 preload 的 gameSave 面读本进程库（B 轨切读 API 后收尾）。
  ipcMain.handle('game:loadTasks', async (_event, characterId: unknown, limit: unknown) => {
    try {
      if (typeof characterId !== 'string' || characterId.length === 0 || characterId.length > 200) {
        return { ok: false, error: 'bad characterId' };
      }
      // 窗口收紧到 [1, 100]：缺省 20（038 队列可见性口径），不信任渲染层传来的任意值。
      const taskWindow =
        typeof limit === 'number' && Number.isFinite(limit)
          ? Math.min(Math.max(Math.floor(limit), 1), 100)
          : 20;
      if (!dataStoreService.isInitialized()) return { ok: false, error: 'data store not initialized' };
      const db = getDatabase().getDatabase();
      ensureCharacterTasksTable(db);
      return { ok: true, tasks: loadRecentTasks(db, characterId, taskWindow) };
    } catch (error: any) {
      console.error('[Electron] game:loadTasks failed:', error);
      return { ok: false, error: error?.message ?? String(error) };
    }
  });

  // ==================== 任务统计聚合 IPC（@since v3.26，task_050）====================
  // 派发智能推荐的数据源：全量按角色×状态 GROUP BY（无入参 —— 没有可校验的外部输入，
  // 主进程只兑底「库已初始化 + 表已就位」）。行数天然有界（角色数 × 6 态），
  // 渲染层（task-record 的统计提供口）拿去归约成每角色一行成功率/均值。
  ipcMain.handle('game:taskStats', async () => {
    try {
      if (!dataStoreService.isInitialized()) return { ok: false, error: 'data store not initialized' };
      const db = getDatabase().getDatabase();
      ensureCharacterTasksTable(db);
      return { ok: true, rows: aggregateTaskStatusCounts(db) };
    } catch (error: any) {
      console.error('[Electron] game:taskStats failed:', error);
      return { ok: false, error: error?.message ?? String(error) };
    }
  });

  // ==================== 流水线记录 IPC（@since v3.27，task_051）====================
  // 与 game:saveTask 同构：主进程 DAO 落 SQLite（pipelines 表，schema v8），渲染层经
  // preload 的 gameSave 扩展面调用。站任务的 pipeline_id 归属不走这里（复用 game:saveTask
  // 通道多带一列，见上面 savePipeline 入参校验注释）。校验从严：坏形状一律拒，
  // 调用方（makePipelinePersister）只警告不阻断编排回路。
  ipcMain.handle('game:savePipeline', async (_event, record: PersistedPipelineRecord) => {
    try {
      if (typeof record?.id !== 'string' || record.id.length === 0 || record.id.length > 64) {
        return { ok: false, error: 'bad id' };
      }
      if (typeof record?.name !== 'string' || record.name.length === 0 || record.name.length > 200) {
        return { ok: false, error: 'bad name' };
      }
      if (typeof record?.issue !== 'string' || record.issue.length > 200_000) {
        return { ok: false, error: 'bad issue' };
      }
      if (
        typeof record?.status !== 'string' ||
        !(PERSISTED_PIPELINE_STATUSES as readonly string[]).includes(record.status)
      ) {
        return { ok: false, error: `bad status: ${String(record?.status)}` };
      }
      // steps：站态 JSON（task_051）。三重校验：类型 / 体积上限 / 真的能 JSON.parse
      // （列里只存结构化 JSON，语义解读归渲染层，主进程不解析站相位）。
      if (typeof record?.steps !== 'string' || record.steps.length > 100_000) {
        return { ok: false, error: 'bad steps' };
      }
      try {
        JSON.parse(record.steps);
      } catch {
        return { ok: false, error: 'bad steps (not JSON)' };
      }
      if (typeof record?.createdAt !== 'number' || !Number.isFinite(record.createdAt)) {
        return { ok: false, error: 'bad createdAt' };
      }
      if (
        record?.finishedAt != null &&
        (typeof record.finishedAt !== 'number' || !Number.isFinite(record.finishedAt))
      ) {
        return { ok: false, error: 'bad finishedAt' };
      }
      if (!dataStoreService.isInitialized()) return { ok: false, error: 'data store not initialized' };
      const db = getDatabase().getDatabase();
      ensurePipelinesTable(db);
      upsertPipeline(db, record);
      return { ok: true };
    } catch (error: any) {
      console.error('[Electron] game:savePipeline failed:', error);
      return { ok: false, error: error?.message ?? String(error) };
    }
  });

  // ==================== agent 健康事件 IPC（@since v3.30，task_054）====================
  // 渲染层 health-monitor 随判定 / 审计逐条插入（offline / online 翻转 + transport exit
  // 异常 unhealthy）。与 game:savePipeline 同构：校验从严，坏形状一律拒（调用方
  // makeAgentHealthPersister 只警告不阻断监测回路）。
  ipcMain.handle('game:saveHealthEvent', async (_event, insert: AgentHealthEventInsert) => {
    try {
      if (typeof insert?.kind !== 'string' || !(AGENT_KINDS as readonly string[]).includes(insert.kind)) {
        return { ok: false, error: `bad kind: ${String(insert?.kind)}` };
      }
      if (
        typeof insert?.event !== 'string' ||
        !(PERSISTED_AGENT_HEALTH_EVENTS as readonly string[]).includes(insert.event)
      ) {
        return { ok: false, error: `bad event: ${String(insert?.event)}` };
      }
      if (typeof insert?.createdAt !== 'number' || !Number.isFinite(insert.createdAt)) {
        return { ok: false, error: 'bad createdAt' };
      }
      if (!dataStoreService.isInitialized()) return { ok: false, error: 'data store not initialized' };
      const db = getDatabase().getDatabase();
      insertAgentHealthEvent(db, insert);
      return { ok: true };
    } catch (error: any) {
      console.error('[Electron] game:saveHealthEvent failed:', error);
      return { ok: false, error: error?.message ?? String(error) };
    }
  });

  // ==================== 角色经验事件 IPC（@since v3.36，task_061，schema v12）====================
  // 写侧已迁 service（A3 / task_079）：game:saveExpEvent 通道**退役** —— exp_events（曲线真相源）
  // 由 service 进程的存储件独占写（src/stratix-gateway/service/storage.ts，铁律 6）。
  // 读侧保留两条：loadExpEvents（成长曲线按近窗读单角色）/ growthOverview（全场活跃度聚合）。
  ipcMain.handle('game:loadExpEvents', async (_event, characterId: string, sinceMs: number) => {
    try {
      if (typeof characterId !== 'string' || characterId.length === 0 || characterId.length > 200) {
        return { ok: false, error: 'bad characterId' };
      }
      if (typeof sinceMs !== 'number' || !Number.isFinite(sinceMs)) {
        return { ok: false, error: 'bad sinceMs' };
      }
      if (!dataStoreService.isInitialized()) return { ok: false, error: 'data store not initialized' };
      const db = getDatabase().getDatabase();
      ensureExpEventsTable(db);
      return { ok: true, events: loadExpEventsSince(db, characterId, sinceMs) };
    } catch (error: any) {
      console.error('[Electron] game:loadExpEvents failed:', error);
      return { ok: false, error: error?.message ?? String(error) };
    }
  });

  ipcMain.handle('game:growthOverview', async () => {
    try {
      if (!dataStoreService.isInitialized()) return { ok: false, error: 'data store not initialized' };
      const db = getDatabase().getDatabase();
      return { ok: true, rows: aggregateCharacterActivity(db) };
    } catch (error: any) {
      console.error('[Electron] game:growthOverview failed:', error);
      return { ok: false, error: error?.message ?? String(error) };
    }
  });

  // ==================== 外部会话引用 IPC（@since v3.3，task_200 / M2-03 N4b-1）===================
  // session_external_refs 表：externalSessionId（CLI 侧 resume 凭据）**独立于角色行**存放，
  // 主键 (external_session_id, instance_id) = design §3.4 R3 的判据：
  //   切副本后 B 副本查 (extId, B) 查不到 ⇒ resume 不可能（id 重写与副本归属彻底解耦）。
  // 写口 = 外部会话建立处（渲染层 chat-service 的 applySession）；读口 = 恢复种子（联合匹配）。
  // 参数校验从严（IPC 是可信度最低的入口）：脏形状一律拒（拒绝即回 {ok:false}，调用方只警告）。
  ipcMain.handle('game:saveSessionExternalRef', async (_event, ref: unknown) => {
    try {
      const parsed = parseSessionExternalRefInsert(ref);
      if (!parsed) return { ok: false, error: 'invalid session external ref' };
      if (!dataStoreService.isInitialized()) return { ok: false, error: 'data store not initialized' };
      const db = getDatabase().getDatabase();
      ensureSessionExternalRefsTable(db);
      recordSessionExternalRef(db, parsed);
      return { ok: true };
    } catch (error: any) {
      console.error('[Electron] game:saveSessionExternalRef failed:', error);
      return { ok: false, error: error?.message ?? String(error) };
    }
  });

  ipcMain.handle('game:loadSessionExternalRef', async (_event, characterId: unknown, instanceId: unknown) => {
    try {
      if (typeof characterId !== 'string' || characterId.length === 0) {
        return { ok: false, error: 'bad characterId' };
      }
      if (typeof instanceId !== 'string' || instanceId.length === 0) {
        return { ok: false, error: 'bad instanceId' };
      }
      if (!dataStoreService.isInitialized()) return { ok: false, error: 'data store not initialized' };
      const db = getDatabase().getDatabase();
      ensureSessionExternalRefsTable(db);
      const ref = findSessionExternalRefByCharacter(db, characterId, instanceId);
      return { ok: true, ...(ref ? { ref } : {}) };
    } catch (error: any) {
      console.error('[Electron] game:loadSessionExternalRef failed:', error);
      return { ok: false, error: error?.message ?? String(error) };
    }
  });

  // ==================== 角色对话 CLI transport IPC（task_035）===================
  // ★ @deprecated（前后端分离 C2 / task_085）—— CLI spawn 的职责已迁 service 进程。
  //   新归属：src/stratix-gateway/service/task-execution.ts（service 直接 spawn，不经 IPC）。
  //   本段只保留给「本地直连 dev 回退模式」，迁移指引见上方 chatRuns 处的说明。
  // 渲染层的 chat-service 经桥接层（chat-transport-bridge）调这两条通道：
  //   chat:run   —— 拉起一轮对话，事件经 chat:event 逐条推回，结束后补一条 end 信封；
  //   chat:abort —— 按 runId 中断（runtime 内部 killTree 杀整棵进程树）。
  // 参数校验从严：IPC 是渲染层可信度最低的入口，坏形状一律拒发（拒绝即回 {ok:false}，
  // 桥接层会把它转成 spawn_failed 错误事件，用户在抽屉里看到错误气泡而不是白屏）。
  ipcMain.handle('chat:run', async (_event, request: CliChatRunRequest) => {
    if (typeof request?.runId !== 'string' || request.runId.length === 0 || request.runId.length > 64) {
      return { ok: false, error: 'bad runId' };
    }
    if (typeof request?.kind !== 'string' || !isBindableAgentKind(request.kind)) {
      return { ok: false, error: `unknown agent kind: ${String(request?.kind)}` };
    }
    if (typeof request?.prompt !== 'string' || request.prompt.length === 0 || request.prompt.length > 200_000) {
      return { ok: false, error: 'bad prompt' };
    }
    if (
      request.sessionId != null &&
      (typeof request.sessionId !== 'string' || request.sessionId.length > MAX_EXTERNAL_SESSION_ID_LEN)
    ) {
      return { ok: false, error: 'bad sessionId' };
    }
    if (chatRuns.has(request.runId)) {
      return { ok: false, error: 'runId already active' };
    }
    // 超时收紧到 [10s, 10min]（渲染层缺省 180s；不信任渲染层传来的任意值）。
    const timeoutMs =
      typeof request.timeoutMs === 'number' && Number.isFinite(request.timeoutMs)
        ? Math.min(Math.max(Math.floor(request.timeoutMs), 10_000), 600_000)
        : 180_000;

    const runId = request.runId;
    const kind = request.kind as AgentKind;
    const controller = new AbortController();
    chatRuns.set(runId, controller);

    // 异步跑（invoke 立刻返回）；事件推到窗口销毁为止，结束必补 end（渲染层靠它收尾迭代器）。
    void (async () => {
      const send = (envelope: CliChatEventEnvelope): void => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send('chat:event', envelope);
      };
      try {
        // task_056：自定义段（custom:<id>）按注册行动态造 transport；注册行不在了 → 拒发（错误
        // 事件回渲染层）。内置五家照旧查静态注册表。sessionId 对自定义段强制置空：
        // 注册模板没有会话恢复语义，每轮新会话（渲染层 adapter 同一约定）。
        const customId = customAgentIdOf(request.kind);
        const transport =
          customId !== null
            ? (() => {
                const registration = dataStoreService.isInitialized()
                  ? (() => {
                      const db = getDatabase().getDatabase() as unknown as CustomAgentDbLike;
                      ensureCustomAgentsTable(db);
                      return findCustomAgent(db, customId);
                    })()
                  : null;
                if (!registration) throw new Error(`自定义 agent 注册不存在：${request.kind}`);
                return createTransportForCustomAgent(
                  {
                    id: registration.id,
                    runCmdTemplate: registration.runCmdTemplate,
                    outputParser: registration.outputParser,
                  },
                  { logger: (line) => console.log(`[chat:${runId}] ${line}`) }
                );
              })()
            : createTransportFor(kind, {}, { logger: (line) => console.log(`[chat:${runId}] ${line}`) });
        for await (const event of transport.spawn(request.prompt, {
          sessionId: customId !== null ? null : (request.sessionId ?? null),
          signal: controller.signal,
          timeoutMs,
        })) {
          send({ runId, event });
        }
      } catch (error: any) {
        // runtime 不该抛（内部全转 error 事件），这里兑底：失败也要让渲染层收到 error + end。
        console.error(`[chat:${runId}] transport 异常:`, error);
        send({ runId, event: { type: 'error', message: String(error?.message ?? error), code: 'cli_error' } });
      } finally {
        chatRuns.delete(runId);
        send({ runId, end: true });
      }
    })();

    return { ok: true };
  });

  ipcMain.handle('chat:abort', async (_event, runId: unknown) => {
    if (typeof runId !== 'string') return { ok: false };
    chatRuns.get(runId)?.abort();
    return { ok: true };
  });

  // ==================== 自定义 agent 注册 IPC（@since v3.32，task_056）====================
  // 向导扫描步「+ 添加自定义 agent」/ 设置屏的注册管理面。四条通道：
  //   customAgent:list   —— 全量注册行（扫描列表 / 设置列表的直接数据源）；
  //   customAgent:create —— 落库一条注册（core 白名单校验 + 查重 + 条数上限）并立刻探一轮；
  //   customAgent:delete —— 删注册行 + 摘检测行（**角色保留**：kind 还在角色档案里，只断检测）；
  //   customAgent:probe  —— 跑一条探测命令回结论（向导「测试」按钮：注册前先验命令能不能跑）。
  // 校验从严（IPC 是可信度最低的入口）：core/custom-agent.ts 的纯校验是唯一口径。
  ipcMain.handle('customAgent:list', async () => {
    try {
      if (!dataStoreService.isInitialized()) return { ok: true, agents: [] as PersistedCustomAgentRecord[] };
      const db = getDatabase().getDatabase() as unknown as CustomAgentDbLike;
      ensureCustomAgentsTable(db);
      return { ok: true, agents: loadCustomAgents(db) };
    } catch (error: any) {
      console.error('[Electron] customAgent:list failed:', error);
      return { ok: false, error: error?.message ?? String(error) };
    }
  });

  ipcMain.handle('customAgent:create', async (_event, draft: unknown) => {
    try {
      const validation = validateCustomAgentDraft(draft as never);
      if (!validation.ok) {
        // 显式断言失败分支：tsconfig.electron.json 没开 strict（strictNullChecks 关闭），
        // 此时 TS 不对 boolean 字面量判别联合做收窄，validation.code 直接报 TS2339。
        // 不给整个 electron 编译面开 strict（会引爆无关错误），故在此收窄一次。
        const code = (validation as { readonly ok: false; readonly code: CustomAgentValidationCode }).code;
        return { ok: false, code };
      }
      const { id, name, probeCmd, runCmdTemplate, outputParser } = validation.draft;
      if (!dataStoreService.isInitialized()) return { ok: false, error: 'data store not initialized' };
      const db = getDatabase().getDatabase() as unknown as CustomAgentDbLike;
      ensureCustomAgentsTable(db);
      const existing = loadCustomAgents(db);
      if (!canRegisterMoreCustomAgents(existing.length)) {
        return { ok: false, error: `注册条数已达上限（${MAX_CUSTOM_AGENTS}）` };
      }
      // 查重：id（slug）与名字都唯一 —— 扫描列表按 kind 去重，同名会静默覆盖对方。
      if (existing.some((row) => row.id === id)) return { ok: false, error: `注册 id 重复：${id}` };
      if (existing.some((row) => row.name === name)) return { ok: false, error: `名字重复：${name}` };
      insertCustomAgent(db, { id, name, probeCmd, runCmdTemplate, outputParser, createdAt: Date.now() });
      // 注册即探一轮（扫描列表立刻能看到「已装 / 未装」，不用等下一轮健康周期）。
      void probeCustomAgentsOnce(createNodeExec()).catch((error: unknown) => {
        console.error('[CustomAgentDetector] 注册后探测失败', error);
      });
      return { ok: true, agent: findCustomAgent(db, id) };
    } catch (error: any) {
      console.error('[Electron] customAgent:create failed:', error);
      return { ok: false, error: error?.message ?? String(error) };
    }
  });

  ipcMain.handle('customAgent:delete', async (_event, id: unknown) => {
    try {
      if (typeof id !== 'string' || id.length === 0 || id.length > 64 || !/^[a-z0-9-]+$/.test(id)) {
        return { ok: false, error: 'bad id' };
      }
      if (!dataStoreService.isInitialized()) return { ok: false, error: 'data store not initialized' };
      const db = getDatabase().getDatabase() as unknown as CustomAgentDbLike;
      ensureCustomAgentsTable(db);
      deleteCustomAgent(db, id);
      // 删除语义（task_056 规格⑤）：只断检测不删角色 —— 已建角色档案保留（kind 仍指向
      // custom:<id>，恢复口径见 game-save-coordinator：注册不在也照绑；检测行摘掉后
      // 该 kind 无检测结论，派任务/对话的守门按「未检出」拦，档案不丢）。
      dropCustomAgentRow(id);
      broadcastDetectedAgents();
      return { ok: true };
    } catch (error: any) {
      console.error('[Electron] customAgent:delete failed:', error);
      return { ok: false, error: error?.message ?? String(error) };
    }
  });

  ipcMain.handle('customAgent:probe', async (_event, probeCmd: unknown) => {
    try {
      if (typeof probeCmd !== 'string' || !isAllowedCustomAgentCmd(probeCmd)) {
        return { ok: false, error: '非法探测命令（白名单校验未过）' };
      }
      const argv = probeCmd.split(/\s+/).filter((token) => token.length > 0);
      const outcome = await createNodeExec()(argv[0], argv.slice(1), {
        timeoutMs: 10_000,
      });
      return {
        ok: true,
        exitCode: outcome.code,
        installed: outcome.code === 0,
        stdout: outcome.stdout.slice(0, 500),
        stderr: outcome.stderr.slice(0, 500),
      };
    } catch (error: any) {
      console.error('[Electron] customAgent:probe failed:', error);
      return { ok: false, error: error?.message ?? String(error) };
    }
  });

  // ==================== Dialog IPC ====================
  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: '选择文件夹',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }
    return { success: true, path: result.filePaths[0] };
  });

  // ==================== Texture IPC ====================
  ipcMain.handle('texture:upload', async (_event, { characterId, imageData, filename }) => {
    try {
      const matches = imageData.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
      if (!matches) {
        return { success: false, error: 'Invalid image data format' };
      }

      const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
      const textureFilename = filename || `${characterId}.${ext}`;
      const texturePath = path.join(texturesDir, textureFilename);

      const buffer = Buffer.from(matches[2], 'base64');
      fs.writeFileSync(texturePath, buffer);

      const stats = fs.statSync(texturePath);
      console.log(`[TextureService] Uploaded: ${textureFilename} (${stats.size} bytes)`);

      return {
        success: true,
        data: {
          filePath: textureFilename,
          size: stats.size,
          generatedAt: stats.mtimeMs,
        }
      };
    } catch (error: any) {
      console.error('[TextureService] Upload failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('texture:check', async (_event, filePath: string) => {
    try {
      const texturePath = path.join(texturesDir, filePath);

      if (fs.existsSync(texturePath)) {
        const stats = fs.statSync(texturePath);
        return {
          exists: true,
          url: `/textures/${filePath}`,
          size: stats.size,
          generatedAt: stats.mtimeMs
        };
      }

      return { exists: false, url: null };
    } catch (error) {
      console.error('[TextureService] Check failed:', error);
      return { exists: false, url: null };
    }
  });

  ipcMain.handle('texture:delete', async (_event, filePath: string) => {
    try {
      const texturePath = path.join(texturesDir, filePath);

      if (fs.existsSync(texturePath)) {
        fs.unlinkSync(texturePath);
        console.log(`[TextureService] Deleted: ${filePath}`);
      }

      return { success: true };
    } catch (error: any) {
      console.error('[TextureService] Delete failed:', error);
      return { success: false, error: error.message };
    }
  });

  // ==================== 角色烘焙缓存 IPC（task_195 / CP-01；task_196 / CP-02 补失败分类）====================
  // 产物：部件合成的一张整精灵图（PNG）+ atlas 元数据（JSON），落 userData/character-bakes/。
  // why 走 IPC：渲染进程没有文件系统（nodeIntegration 关闭），写盘只能在主进程。
  // why 键要再校验一次：键会变成文件名，主进程是最后一道防线（防目录穿越）。
  // why 失败要分类（kind）：渲染层要据此判失败面 ——
  //   corrupt = 缓存里的东西坏了（该重烘）；unavailable = 环境不配合（目录不可写 / 磁盘满）。
  ipcMain.handle('characterBake:read', async (_event, key: unknown) => {
    try {
      if (!characterBakesDir) return { ok: false, error: '缓存目录未初始化', kind: 'unavailable' };
      const safeKey = sanitizeBakeKey(key);
      if (!safeKey) return { ok: false, error: '非法的缓存键', kind: 'corrupt' };

      const pngPath = path.join(characterBakesDir, `${safeKey}.png`);
      const metaPath = path.join(characterBakesDir, `${safeKey}.json`);
      if (!fs.existsSync(pngPath) || !fs.existsSync(metaPath)) {
        return { ok: true, pngBase64: null, meta: null };
      }

      const pngBase64 = fs.readFileSync(pngPath).toString('base64');
      // 元数据 JSON 坏了 = 缓存坏了（kind: corrupt）—— 渲染层据此走「重烘修好」那条路。
      let meta: unknown;
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      } catch (parseError: any) {
        console.error('[CharacterBake] 元数据 JSON 损坏:', parseError);
        return { ok: false, error: '元数据 JSON 损坏', kind: 'corrupt' };
      }
      if (!isBakedSheetMeta(meta)) {
        return { ok: false, error: '元数据结构不合法', kind: 'corrupt' };
      }
      return { ok: true, pngBase64, meta };
    } catch (error: any) {
      console.error('[CharacterBake] 读取失败:', error);
      return { ok: false, error: error?.message ?? String(error), kind: 'unavailable' };
    }
  });

  ipcMain.handle(
    'characterBake:write',
    async (_event, key: unknown, pngBase64: unknown, meta: unknown) => {
      try {
        if (!characterBakesDir) return { ok: false, error: '缓存目录未初始化', kind: 'unavailable' };
        const safeKey = sanitizeBakeKey(key);
        if (!safeKey) return { ok: false, error: '非法的缓存键', kind: 'corrupt' };
        if (typeof pngBase64 !== 'string' || pngBase64.length === 0) {
          return { ok: false, error: '空的 PNG 数据', kind: 'corrupt' };
        }

        ensureDirSync(characterBakesDir);
        fs.writeFileSync(path.join(characterBakesDir, `${safeKey}.png`), Buffer.from(pngBase64, 'base64'));
        fs.writeFileSync(
          path.join(characterBakesDir, `${safeKey}.json`),
          JSON.stringify(meta ?? {}),
          'utf-8'
        );
        return { ok: true };
      } catch (error: any) {
        // 写不进去 = 环境不配合（目录不可写 / 磁盘满 / 只读卷）—— kind: unavailable。
        console.error('[CharacterBake] 写入失败:', error);
        return { ok: false, error: error?.message ?? String(error), kind: 'unavailable' };
      }
    }
  );

  ipcMain.handle('characterBake:clear', async () => {
    try {
      if (!characterBakesDir) return { ok: false, error: '缓存目录未初始化', kind: 'unavailable' };
      // 整体删目录（纪律 3：删缓存目录 ⇒ 下次触发全量重烘，无其他依赖）。
      fs.rmSync(characterBakesDir, { recursive: true, force: true });
      ensureDirSync(characterBakesDir);
      return { ok: true };
    } catch (error: any) {
      console.error('[CharacterBake] 清空失败:', error);
      return { ok: false, error: error?.message ?? String(error), kind: 'unavailable' };
    }
  });

  // ==================== Tailscale IPC ====================
  ipcMain.handle('tailscale:status', async () => {
    return tailscale?.getStatus() || null;
  });
  
  ipcMain.handle('tailscale:discover', async () => {
    if (!tailscale) return [];
    return tailscale.discoverOpenClawNodes();
  });
  
  ipcMain.handle('tailscale:nodes', async () => {
    return tailscale?.getOpenClawNodes() || [];
  });
  
  ipcMain.handle('tailscale:loginUrl', async () => {
    return tailscale?.getLoginURL() || null;
  });
  
  ipcMain.handle('tailscale:login', async (_event, authKey?: string) => {
    return tailscale?.login(authKey) || false;
  });
  
  ipcMain.handle('tailscale:isRunning', async () => {
    return tailscale?.isTailscaleRunning() || false;
  });
  
  ipcMain.handle('tailscale:needsAuth', async () => {
    return tailscale?.needsAuthentication() || false;
  });

  ipcMain.handle('tailscale:connectNode', async (_event, nodeId: string) => {
    if (!tailscale) return false;
    try {
      const nodes = await tailscale.discoverOpenClawNodes();
      const node = nodes.find((n: any) => n.peer?.id === nodeId || n.peer?.id === `pn_${nodeId}`);
      if (!node) {
        console.error('[Electron] Tailscale node not found:', nodeId);
        return false;
      }
      if (!node.healthy) {
        console.error('[Electron] Tailscale node not healthy:', node.url);
        return false;
      }
      // Configure the gateway's OpenClaw proxy with the node's endpoint
      const response = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/stratix/openclaw/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: node.url, apiKey: '' }),
      });
      const result = await response.json();
      return result.success === true || result.connected === true;
    } catch (error) {
      console.error('[Electron] tailscale:connectNode failed:', error);
      return false;
    }
  });
  
  // ==================== OpenClaw IPC ====================
  ipcMain.handle('openclaw:connect', async (_event, endpoint: string, config: any) => {
    try {
      if (activeOpenClawConnection) {
        await activeOpenClawConnection.disconnect();
      }
  
      const adapter = new WebSocketOpenClawAdapter({
        endpoint,
        accountId: config.accountId || 'stratix',
        apiKey: config.apiKey,
      });
  
      await adapter.connect();
      const status = await adapter.getStatus();
      
      if (status.connected) {
        activeOpenClawConnection = adapter;
        return { success: true, deviceId: adapter.getDeviceId() };
      } else {
        await adapter.disconnect();
        return { success: false, error: status.error };
      }
    } catch (error) {
      console.error('[Electron] OpenClaw connect failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Connection failed' };
    }
  });
  
  ipcMain.handle('openclaw:disconnect', async () => {
    if (activeOpenClawConnection) {
      await activeOpenClawConnection.disconnect();
      activeOpenClawConnection = null;
    }
    return { success: true };
  });

  ipcMain.handle('openclaw:sendMessage', async (_event, { message, sessionId }) => {
    try {
      const response = await fetch('http://127.0.0.1:7524/api/stratix/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, sessionId }),
      });
      return await response.json();
    } catch (error: any) {
      console.error('[Electron] openclaw:sendMessage failed:', error);
      return { code: 500, message: error.message, data: null };
    }
  });

  // ==================== 数据服务 IPC ====================
  ipcMain.handle('service:saveAgent', async (_event, config) => {
    return await dataStoreService.getStore().saveAgent(config);
  });
  
  ipcMain.handle('service:loadAgent', async (_event, id) => {
    return await dataStoreService.getStore().loadAgent(id);
  });
  
  ipcMain.handle('service:deleteAgent', async (_event, id) => {
    await dataStoreService.getStore().deleteAgent(id);
  });
  
  ipcMain.handle('service:listAgents', async () => {
    return await dataStoreService.getStore().listAgents();
  });
  
  ipcMain.handle('service:getOpenClawStatus', async () => {
    if (!activeOpenClawConnection) {
      return { connected: false, error: 'Not connected' };
    }
    
    const status = await activeOpenClawConnection.getStatus();
    return {
      connected: status.connected,
      endpoint: status.connected ? 'local' : undefined,
    };
  });
  
  // ==================== Custom Providers IPC ====================
  ipcMain.handle('config:saveCustomProviders', async (_event, configJson: string) => {
    try {
      const configPath = path.join(userDataPath, 'custom-providers.config.json');
      fs.writeFileSync(configPath, configJson, 'utf-8');
      return { success: true };
    } catch (error) {
      console.error('[Electron] Failed to save custom providers:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to save' };
    }
  });
  
  ipcMain.handle('config:loadCustomProviders', async () => {
    try {
      const configPath = path.join(userDataPath, 'custom-providers.config.json');
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        return { success: true, data: content };
      }
      return { success: true, data: null };
    } catch (error) {
      console.error('[Electron] Failed to load custom providers:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to load' };
    }
  });
  
  // ==================== API Key 加密存储 IPC ====================
  ipcMain.handle('apikey:save', async (_event, providerId: string, apiKey: string) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        return { success: false, error: 'Encryption not available' };
      }
      
      const encrypted = safeStorage.encryptString(apiKey);
      const keysPath = path.join(userDataPath, 'api-keys.encrypted');
      
      let keys: Record<string, string> = {};
      if (fs.existsSync(keysPath)) {
        const existing = fs.readFileSync(keysPath, 'utf-8');
        keys = safeParseJson(Buffer.from(existing, 'base64').toString('utf-8'), {});
      }

      keys[providerId] = encrypted.toString('base64');
      fs.writeFileSync(keysPath, Buffer.from(JSON.stringify(keys), 'utf-8').toString('base64'));
      
      return { success: true };
    } catch (error) {
      console.error('[Electron] Failed to save API key:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to save' };
    }
  });
  
  ipcMain.handle('apikey:load', async (_event, providerId: string) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        return { success: false, error: 'Encryption not available' };
      }
      
      const keysPath = path.join(userDataPath, 'api-keys.encrypted');
      if (!fs.existsSync(keysPath)) {
        return { success: true, data: null };
      }
      
      const keys = safeParseJson<Record<string, string>>(Buffer.from(fs.readFileSync(keysPath, 'utf-8'), 'base64').toString('utf-8'), {});
      const encrypted = keys[providerId];
      
      if (!encrypted) {
        return { success: true, data: null };
      }
      
      const decrypted = safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
      return { success: true, data: decrypted };
    } catch (error) {
      console.error('[Electron] Failed to load API key:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to load' };
    }
  });
  
  ipcMain.handle('apikey:delete', async (_event, providerId: string) => {
    try {
      const keysPath = path.join(userDataPath, 'api-keys.encrypted');
      if (!fs.existsSync(keysPath)) {
        return { success: true };
      }
      
      const keys = safeParseJson<Record<string, string>>(Buffer.from(fs.readFileSync(keysPath, 'utf-8'), 'base64').toString('utf-8'), {});
      delete keys[providerId];
      fs.writeFileSync(keysPath, Buffer.from(JSON.stringify(keys), 'utf-8').toString('base64'));
      
      return { success: true };
    } catch (error) {
      console.error('[Electron] Failed to delete API key:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to delete' };
    }
  });
  
  ipcMain.handle('apikey:list', async () => {
    try {
      const keysPath = path.join(userDataPath, 'api-keys.encrypted');
      if (!fs.existsSync(keysPath)) {
        return { success: true, data: [] };
      }
      
      const keys = safeParseJson<Record<string, string>>(Buffer.from(fs.readFileSync(keysPath, 'utf-8'), 'base64').toString('utf-8'), {});
      return { success: true, data: Object.keys(keys) };
    } catch (error) {
      console.error('[Electron] Failed to list API keys:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to list' };
    }
  });

  // ==================== Agent Platform IPC ====================
  const {
    registerWorkflowHandlers,
    registerProviderHandlers,
    registerExecutionHandlers,
  } = require('@/agent-platform/ipc');

  const workflowHandlers = registerWorkflowHandlers(userDataPath, fs, path);
  const providerHandlers = registerProviderHandlers();
  const executionHandlers = registerExecutionHandlers();

  for (const [channel, handler] of Object.entries(workflowHandlers)) {
    ipcMain.handle(channel, handler as (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any);
  }

  for (const [channel, handler] of Object.entries(providerHandlers)) {
    ipcMain.handle(channel, handler as (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any);
  }

  for (const [channel, handler] of Object.entries(executionHandlers)) {
    ipcMain.handle(channel, handler as (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any);
  }

  console.log('[Electron] Agent Platform IPC handlers registered');
}

/**
 * 启动应用
 */
app.whenReady().then(async () => {
  try {
    await initializeServices();
    setupIPC();
    createWindow();
    // 检测放在最后：窗口先建好，探测结果才有地方推（推不出去的快照由渲染层启动时拉取补上）。
    startAgentDetection();
  } catch (error) {
    console.error('[Electron] Failed to start:', error);
    app.quit();
  }
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

/**
 * 窗口关闭处理
 */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    tailscale?.stop();
    app.quit();
  }
});

/**
 * 应用退出前清理资源
 */
app.on('before-quit', () => {
  console.log('[Electron] Shutting down...');

  // 停止本地 agent 检测（不再开始下一项；正在跑的那条由它自己的超时兜底）
  detectionAbort?.abort();
  detectionAbort = null;

  // 中断在跑的角色对话（killTree 杀进程树；渲染层随后销毁，end 信封送不送得到都无所谓）
  for (const controller of chatRuns.values()) controller.abort();
  chatRuns.clear();
  // 停止 Tailscale
  tailscale?.stop().catch((err) => console.error('[Electron] Tailscale stop failed:', err));
  console.log('[Electron] Tailscale stopped');

  // 关闭 OpenClaw 连接
  if (activeOpenClawConnection) {
    activeOpenClawConnection.disconnect().catch((err) => console.error('[Electron] OpenClaw disconnect failed:', err));
    activeOpenClawConnection = null;
    console.log('[Electron] OpenClaw connection closed');
  }

  // 创建数据备份
  if (dataStoreService.isInitialized()) {
    dataStoreService.getBackupManager()?.createBackup().catch((err) => console.error('[Electron] Backup failed:', err));
  }
});
