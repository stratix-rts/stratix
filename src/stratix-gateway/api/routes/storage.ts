/**
 * 文件职责：**storage 读 API**（前后端分离 A3 / task_079）—— service 侧 SQLite 的**只读**门面。
 *   拓扑（docs/SERVICE-SPLIT-PLAN.md §2 目标拓扑 / 铁律 6）：SQLite 只由 service 进程打开写，
 *   其余进程（Electron 壳 / 浏览器 / 外部 client）经 HTTP 读 —— 本文件就是那条路的 HTTP 段。
 * 输入：service 侧的读取口（ServiceStorage 的读半边；缺省 = 端口未附着）。
 * 输出：两条 GET 路由（挂载点 /api/storage）：
 *   ① GET /api/storage/tasks/:id/output —— 任务输出全文（character_tasks.output）。
 *   ② GET /api/storage/chat/:characterId —— 某角色的对话历史（分页：limit + beforeId 游标）。
 * 禁止事项：
 *   1. 在这里写库 —— 本文件**只读**。写入一律走 service 侧的存储件（service/storage.ts）；
 *   2. 在这里造第二条数据源 —— 每一行都从库里现读（不缓存、不预聚合）；
 *   3. 编造数据 —— 库里没有就是没有（output 为 null / messages 为空数组），不返回假内容；
 *   4. 端口缺席时假装正常 —— 端口不在就 503 + 如实说明「存储未附着」（铁律 ④：绝不假装成功）。
 *
 * 分页口径（与 chat-history-dao 的窗口查询一致）：
 *   limit 缺省 50（抽屉窗口口径），窗口收紧到 [1, 200]；
 *   beforeId 缺省 = 最近 limit 条；给了 = 该游标**之前**的 limit 条（向前翻页）；
 *   游标不是正整数（0 / 负数 / 非数字）→ 400（如实报错，不悄悄换个语义继续跑）。
 *
 * @since v3.42（task_079 / service-split A3）。
 */

import { Router, type Request, type Response } from 'express';

import type { PersistedChatMessage } from '../../../app/services/persistence/chat-history-dao';

/**
 * 读口（service 侧存储件的读半边）。
 * why 只声明读的那几个方法：写口不进本文件的类型面 —— 类型即契约，
 *   一个「什么都能做」的端口会诱使后来者在只读路由里写库。
 */
export interface StorageReadPort {
  /** 任务输出全文；库里没有返回 null。 */
  readonly readTaskOutput: (taskId: string) => string | null;
  /** 某角色最近 limit 条对话（时间正序）。 */
  readonly loadChatMessages: (characterId: string, limit?: number) => PersistedChatMessage[];
  /** 某角色 beforeId 之前的 limit 条对话（向前翻页；时间正序）。 */
  readonly loadEarlierChatMessages: (
    characterId: string,
    beforeId: number,
    limit?: number
  ) => PersistedChatMessage[];
}

/** 对话历史窗口的缺省条数（与抽屉的 CHAT_HISTORY_LOAD_LIMIT 同口径）。 */
export const STORAGE_CHAT_PAGE_LIMIT = 50;
/** 对话历史窗口的硬上限（不信任外部传入的任意值 —— 与 IPC 校验层同一纪律）。 */
const MAX_CHAT_PAGE_LIMIT = 200;
/** 角色 id 长度上限（与存储件的守卫同口径）。 */
const MAX_CHARACTER_ID_LEN = 200;

/**
 * 取整并收紧到 [min, max]；非数字 / NaN 一律回落缺省值（外部输入不可信）。
 */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

/**
 * 严格解析正整数游标；不是正整数（0 / 负数 / 非数字 / 小数）一律返回 null（= 坏游标）。
 *
 * why 不用 clampInt 收紧游标：游标是**位置**不是**窗口** —— 把 0 悄悄夹成 1 等于
 *   换个语义继续跑（客户端拿到的是「另一个窗口」却以为是自己要的）。
 *   游标错了就该如实报错（400），让客户端重新取窗口。
 */
function parsePositiveInt(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

/**
 * 造 storage 读路由。
 *
 * @param port 读取口；null = 存储未附着（路由会如实报 503，不返回空态假装正常）。
 */
export function createStorageRoutes(port: StorageReadPort | null): Router {
  const router = Router();

  /**
   * GET /tasks/:id/output —— 任务输出全文。
   *
   * 为什么要这条：core 的 CharacterTask.output 只存摘要（上限 2000 字符），
   *   全文只在库里（docs/MCP-SPEC.md §2.3）。库与状态机是两份真相，
   *   经 API 取全文是「非 service 进程」的唯一合法路径。
   */
  router.get('/tasks/:id/output', (req: Request, res: Response): void => {
    if (!port) {
      res.status(503).json({ success: false, error: 'storage not attached' });
      return;
    }
    const taskId = String(req.params.id ?? '');
    if (taskId.length === 0 || taskId.length > 64) {
      res.status(400).json({ success: false, error: 'bad task id' });
      return;
    }
    try {
      const output = port.readTaskOutput(taskId);
      // 库里没有这一条 → output 为 null（200，不是 404 —— 「没落库」是常态，不是请求错误）。
      res.json({ success: true, data: { taskId, output } });
    } catch (error: unknown) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'failed to read task output',
      });
    }
  });

  /**
   * GET /chat/:characterId —— 某角色的对话历史（分页）。
   *
   * 查询参数：
   *   limit    —— 条数（缺省 50，收紧到 [1, 200]）；
   *   beforeId —— 游标（缺省 = 最近 limit 条；给了 = 该游标之前的 limit 条）。
   */
  router.get('/chat/:characterId', (req: Request, res: Response): void => {
    if (!port) {
      res.status(503).json({ success: false, error: 'storage not attached' });
      return;
    }
    const characterId = String(req.params.characterId ?? '');
    if (characterId.length === 0 || characterId.length > MAX_CHARACTER_ID_LEN) {
      res.status(400).json({ success: false, error: 'bad characterId' });
      return;
    }
    const limit = clampInt(req.query.limit, 1, MAX_CHAT_PAGE_LIMIT, STORAGE_CHAT_PAGE_LIMIT);
    const rawBeforeId = req.query.beforeId;
    const beforeId = rawBeforeId === undefined ? null : parsePositiveInt(rawBeforeId);
    if (rawBeforeId !== undefined && beforeId === null) {
      res.status(400).json({ success: false, error: 'bad beforeId' });
      return;
    }
    try {
      const messages =
        beforeId === null
          ? port.loadChatMessages(characterId, limit)
          : port.loadEarlierChatMessages(characterId, beforeId, limit);
      res.json({
        success: true,
        data: { characterId, limit, beforeId, messages },
      });
    } catch (error: unknown) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'failed to read chat history',
      });
    }
  });

  return router;
}

export default createStorageRoutes;
