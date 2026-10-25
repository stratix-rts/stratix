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
  mergeDetectedAgents,
  verifyAgentRoster,
} from '../app/services/agent-detector';
import { createNodeExec } from '../app/services/node-exec';
import { createTransportFor } from '../app/services/cli-transport';
import type { CliChatEventEnvelope, CliChatRunRequest } from '../app/services/chat-transport-bridge';
import {
  ensureGameSaveTables,
  loadGameSnapshot,
  upsertCharacters,
  upsertUnitPositions,
  type PersistedCharacterRecord,
  type PersistedUnitPosition,
} from '../app/services/persistence/game-save-dao';
import {
  ensureCharacterChatMessagesTable,
  insertChatMessage,
  loadChatMessages,
  PERSISTED_CHAT_ROLES,
  type ChatMessageInsert,
} from '../app/services/persistence/chat-history-dao';
import {
  ensureCharacterTasksTable,
  loadRecentTasks,
  PERSISTED_TASK_STATUSES,
  upsertTask,
  type PersistedTaskRecord,
} from '../app/services/persistence/task-record-dao';
import { AGENT_KINDS, MAX_EXTERNAL_SESSION_ID_LEN, type AgentKind, type DetectedAgent } from '../core/types';
import { getDatabase } from '../stratix-database';
import { dataStoreService } from '../stratix-gateway/dataStoreService';
import { WebSocketOpenClawAdapter } from '../stratix-openclaw-adapter/WebSocketOpenClawAdapter';
import { EmbeddedTailscale } from '../stratix-tailscale/EmbeddedTailscale';

let mainWindow: BrowserWindow | null = null;
let tailscale: EmbeddedTailscale | null = null;
let activeOpenClawConnection: WebSocketOpenClawAdapter | null = null;
let userDataPath: string = '';
let texturesDir: string = '';

// Development server ports to try when connecting to Vite dev server
const DEV_PORTS = [7523, 7524, 7525, 7526, 7527, 7528, 7529, 7530] as const;

// Backend server port (standalone backend started by electron:dev)
const BACKEND_PORT = 7524;

// ==================== 本地 CLI agent 检测（task_022） ====================
// 状态放主进程：只有 Node 侧能 spawn 子进程（渲染进程没有 child_process）。
// 检测结果经 IPC 交给渲染层并入 WorldState.detectedAgents（广播出口仍是 core/runtime.ts 的 store 订阅）。
let detectedAgents: DetectedAgent[] = [];
let detectionAbort: AbortController | null = null;

// ==================== 角色对话 CLI transport（task_035）====================
// 状态放主进程：渲染层没有 child_process（nodeIntegration 关闭），子进程在这里拉起；
// 事件逐条推回渲染层（chat:event 信封，见 chat-transport-bridge.ts 的 CliChatEventEnvelope）。
// runId 由渲染层生成（全局唯一），abort 也按 runId 路由到对应的 AbortController。
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
 * 单入口（v3 Phase 3 / task_017）：只加载新游戏化 UI（src/app/main/index.html）。
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
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (level >= 3) { // 0=verbose, 1=info, 2=warn, 3=error
      console.log(`[Renderer error]: ${message}`);
    }
  });

  // 当前生效入口（相对 vite root 的 HTML 路径）：dev 与正式产物共用同一个常量，避免两边各写一份
  const entryPath = entryHtmlPath();
  console.log(`[Electron] Entry: ${entryPath} (v3 new UI, 单入口)`);
  if (isRetiredLegacyFlagSet()) {
    console.warn(
      '[Electron] STRATIX_LEGACY 已失效：旧 Vue 入口链随 task_017 退役（Zone 模型是旧链的地基），' +
      '本次仍加载新入口。回退请用 git 历史（git checkout master 或 git revert 该次提交）。'
    );
  }

  // 尝试从 Vite 开发服务器加载（端口 7523-7530）
  const loadDevUrl = async () => {
    const win = mainWindow;
    if (!win) return false;
    for (const port of DEV_PORTS) {
      try {
        // why 带入口路径而不是只探端口根：单入口后 dev server 的端口根没有 index.html，
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
  }).catch((error) => {
    console.error('[AgentDetector] 探测失败', error);
  });
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
      upsertCharacters(db, records);
      return { ok: true };
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
      upsertUnitPositions(db, entries);
      return { ok: true };
    } catch (error: any) {
      console.error('[Electron] game:saveUnitPositions failed:', error);
      return { ok: false, error: error?.message ?? String(error) };
    }
  });

  // ==================== 角色对话历史 IPC（@since v3.15，task_036）====================
  // 与 game-save 三条同构：主进程 DAO 落 SQLite，渲染层经 preload 的 gameSave 扩展面调用。
  // 校验从严（IPC 是可信度最低的入口）：坏形状一律拒（拒绝即回 {ok:false}，调用方只警告不阻断对话）。
  ipcMain.handle('game:saveChatMessage', async (_event, message: ChatMessageInsert) => {
    try {
      if (typeof message?.characterId !== 'string' || message.characterId.length === 0 || message.characterId.length > 200) {
        return { ok: false, error: 'bad characterId' };
      }
      if (typeof message?.role !== 'string' || !(PERSISTED_CHAT_ROLES as readonly string[]).includes(message.role)) {
        return { ok: false, error: `bad role: ${String(message?.role)}` };
      }
      if (typeof message?.content !== 'string' || message.content.length === 0 || message.content.length > 200_000) {
        return { ok: false, error: 'bad content' };
      }
      if (
        message.sessionRef != null &&
        (typeof message.sessionRef !== 'string' || message.sessionRef.length > MAX_EXTERNAL_SESSION_ID_LEN)
      ) {
        return { ok: false, error: 'bad sessionRef' };
      }
      if (typeof message?.createdAt !== 'number' || !Number.isFinite(message.createdAt)) {
        return { ok: false, error: 'bad createdAt' };
      }
      if (!dataStoreService.isInitialized()) return { ok: false, error: 'data store not initialized' };
      const db = getDatabase().getDatabase();
      ensureCharacterChatMessagesTable(db);
      insertChatMessage(db, message);
      return { ok: true };
    } catch (error: any) {
      console.error('[Electron] game:saveChatMessage failed:', error);
      return { ok: false, error: error?.message ?? String(error) };
    }
  });

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

  // ==================== 角色任务记录 IPC（@since v3.16，task_037）====================
  // 与 game:saveChatMessage 同构：主进程 DAO 落 SQLite（character_tasks 表，schema v4），
  // 渲染层经 preload 的 gameSave 扩展面调用。校验从严（IPC 是可信度最低的入口）：
  // 坏形状一律拒（拒绝即回 {ok:false}，调用方只警告不阻断任务执行回路）。
  ipcMain.handle('game:saveTask', async (_event, record: PersistedTaskRecord) => {
    try {
      if (typeof record?.id !== 'string' || record.id.length === 0 || record.id.length > 64) {
        return { ok: false, error: 'bad id' };
      }
      if (typeof record?.characterId !== 'string' || record.characterId.length === 0 || record.characterId.length > 200) {
        return { ok: false, error: 'bad characterId' };
      }
      if (typeof record?.prompt !== 'string' || record.prompt.length === 0 || record.prompt.length > 200_000) {
        return { ok: false, error: 'bad prompt' };
      }
      if (typeof record?.status !== 'string' || !(PERSISTED_TASK_STATUSES as readonly string[]).includes(record.status)) {
        return { ok: false, error: `bad status: ${String(record?.status)}` };
      }
      if (typeof record?.output !== 'string' || record.output.length > 200_000) {
        return { ok: false, error: 'bad output' };
      }
      if (typeof record?.createdAt !== 'number' || !Number.isFinite(record.createdAt)) {
        return { ok: false, error: 'bad createdAt' };
      }
      for (const field of ['startedAt', 'endedAt'] as const) {
        const value = record[field];
        if (value != null && (typeof value !== 'number' || !Number.isFinite(value))) {
          return { ok: false, error: `bad ${field}` };
        }
      }
      // 成果物（task_048）：可选 JSON 字符串（'' / 缺省 = 无）。三重校验：类型 / 体积上限 /
      // 真的能 JSON.parse（列里只存结构化 JSON，读侧 parseTaskArtifactsJson 坏形状降级纯文本）。
      if (record?.artifacts != null) {
        if (typeof record.artifacts !== 'string' || record.artifacts.length > 100_000) {
          return { ok: false, error: 'bad artifacts' };
        }
        try {
          JSON.parse(record.artifacts);
        } catch {
          return { ok: false, error: 'bad artifacts (not JSON)' };
        }
      }
      // 计划草稿（task_049）：可选纯文本（'' / 缺省 = 无）。只验类型与体积上限 ——
      // 内容裁决（标记行剥离 / 截断）在渲染层 task-service / core 状态机，主进程不重复。
      if (record?.plan != null && (typeof record.plan !== 'string' || record.plan.length > 200_000)) {
        return { ok: false, error: 'bad plan' };
      }
      if (!dataStoreService.isInitialized()) return { ok: false, error: 'data store not initialized' };
      const db = getDatabase().getDatabase();
      ensureCharacterTasksTable(db);
      upsertTask(db, record);
      return { ok: true };
    } catch (error: any) {
      console.error('[Electron] game:saveTask failed:', error);
      return { ok: false, error: error?.message ?? String(error) };
    }
  });

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

  // ==================== 角色对话 CLI transport IPC（task_035）===================
  // 渲染层的 chat-service 经桥接层（chat-transport-bridge）调这两条通道：
  //   chat:run   —— 拉起一轮对话，事件经 chat:event 逐条推回，结束后补一条 end 信封；
  //   chat:abort —— 按 runId 中断（runtime 内部 killTree 杀整棵进程树）。
  // 参数校验从严：IPC 是渲染层可信度最低的入口，坏形状一律拒发（拒绝即回 {ok:false}，
  // 桥接层会把它转成 spawn_failed 错误事件，用户在抽屉里看到错误气泡而不是白屏）。
  ipcMain.handle('chat:run', async (_event, request: CliChatRunRequest) => {
    if (typeof request?.runId !== 'string' || request.runId.length === 0 || request.runId.length > 64) {
      return { ok: false, error: 'bad runId' };
    }
    if (typeof request?.kind !== 'string' || !(AGENT_KINDS as readonly string[]).includes(request.kind)) {
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
        const transport = createTransportFor(kind, {}, { logger: (line) => console.log(`[chat:${runId}] ${line}`) });
        for await (const event of transport.spawn(request.prompt, {
          sessionId: request.sessionId ?? null,
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
