/**
 * 文件职责：CDP 走查脚本的**公共封装** —— 连接 Electron 渲染页 + Runtime.evaluate helper。
 *
 * 为什么要它：仓库里所有 CDP 走查脚本都要干同一件事 —— 连 127.0.0.1:9222 的调试端口、
 * 找到 Stratix 页面、Runtime.evaluate 一段表达式。三份脚本各抄一遍样板必然漂移
 * （选择器改了只改一处、样板抄错一次就多一个静默失败点）。本文件是那一处。
 *
 * 输入：CDP_BASE 环境变量（默认 127.0.0.1:9222）。
 * 输出：一个 session 对象 —— evaluate(expr) 在页面里求值并返回**结构化值**（不是 JSON 串），
 *      close() 断连。
 *
 * 禁止事项：
 *   1. 在这里 import 任何仓库模块（src/**）—— 本目录是纯 JS 走查工具，跑在 node 里，
 *      不吃 vite/tsconfig 那一套；
 *   2. 引入 npm 依赖 —— 只用 node 内置的 fetch / WebSocket 全局；
 *   3. 猜页面状态 —— 页面态一律经 READ_STATE_EXPR 现取，不缓存。
 *
 * 约定（页面侧契约）：
 *   - 状态真源是 HUD 的 Agent 侧栏自定义元素 `<strat-agent-panel>`（AGENT_PANEL_SELECTOR），
 *     它的 lastState 就是 core 广播的 WorldState 全量快照；
 *   - 命令出口是同元素的 adapter.dispatch（HudCommand 单向通道，core/runtime.ts 转译）。
 */

/** CDP 调试端口地址（host:port）。可用环境变量 CDP_BASE 覆盖（换端口/换机器）。 */
export const CDP_BASE = process.env.CDP_BASE || '127.0.0.1:9222';

/** Agent 侧栏自定义元素选择器 —— 页面侧状态与命令的唯一入口。 */
export const AGENT_PANEL_SELECTOR = 'strat-agent-panel';

/** 目标页标题匹配（Electron 主窗口标题为 'Stratix'，dev 下带版本号 'Stratix v3'）。 */
export const PAGE_TITLE_PATTERN = /stratix/i;

/**
 * 单条 CDP 命令 / 握手的超时（ms）。
 * why 要有：CDP 自己不带超时 —— 页面崩了或 target 没了时，裸 await 会把走查脚本挂死，
 *   而挂死是最坏的失败形态（走查脚本的价值在于失败得响亮）。可用环境变量压。
 */
export const CDP_COMMAND_TIMEOUT_MS = Number(process.env.SX_CDP_TIMEOUT_MS || 30000);

/** CDP / 走查期错误（连接失败、页面侧抛异常……）。带 cause 以便上层看原始原因。 */
export class CdpError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'CdpError';
    this.cause = cause;
  }
}

/** 列出 CDP 下所有 target（页面/worker/…）。 */
export async function listTargets(base = CDP_BASE) {
  let res;
  try {
    res = await fetch(`http://${base}/json/list`);
  } catch (err) {
    throw new CdpError(
      `连不上 CDP ${base}（Electron 是否带 --remote-debugging-port 启动？）`,
      err
    );
  }
  if (!res.ok) throw new CdpError(`CDP /json/list 返回 HTTP ${res.status}`);
  return res.json();
}

/** 找到 Stratix 主页面 target。找不到时把可见 target 列进错误信息 —— 便于一眼看出是「没启动」还是「标题变了」。 */
export async function findPage(base = CDP_BASE, titlePattern = PAGE_TITLE_PATTERN) {
  const targets = await listTargets(base);
  const page = targets.find((t) => t.type === 'page' && titlePattern.test(t.title ?? ''));
  if (!page) {
    const seen = targets.map((t) => `${t.type}:${t.title}`).join(' | ') || '（无 target）';
    throw new CdpError(`CDP ${base} 上没找到 Stratix 页面；可见 target：${seen}`);
  }
  return page;
}

/**
 * 打开一个 CDP 会话（WebSocket + Runtime.evaluate）。
 * 返回 { page, evaluate, close }：
 *   - evaluate(expr) → 页面里求值 expr 的**结构化返回值**；页面侧抛异常则抛 CdpError；
 *   - close() → 断连（务必在 finally 里调，否则 node 进程会被挂住）。
 */
export function openSession(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return; // 非 JSON 帧（事件流）—— 本封装只等 id 匹配的回包，忽略即可
    }
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new CdpError(`CDP 回包错误：${msg.error.message}`));
      else resolve(msg.result);
    }
  };

  const opened = new Promise((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new CdpError('CDP WebSocket 连接失败'));
  });

  /**
   * 给「等不到就永远挂着」的 promise 兜一层超时。
   * why 必须有：CDP 的握手与回包都没有自带超时 —— 页面崩了 / target 没了的时候，
   *   裸 await 会把走查脚本挂到天荒地老（而不是报错退出）。走查脚本的价值在于
   *   「失败得响亮」，挂死是最坏的失败形态。
   */
  const withTimeout = (promise, label, timeoutMs = CDP_COMMAND_TIMEOUT_MS) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new CdpError(`CDP ${label} 超时（${timeoutMs}ms）`)),
        timeoutMs
      );
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });

  /**
   * 发一条 CDP 命令（Runtime 之外的域也能用 —— 例如 Input.dispatchMouseEvent 驱动画布交互）。
   * @param {string} method CDP 方法名
   * @param {object} [params] 方法参数
   */
  const send = async (method, params = {}) => {
    await withTimeout(opened, '连接');
    const id = ++seq;
    const reply = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    ws.send(JSON.stringify({ id, method, params }));
    const result = await withTimeout(reply, method);
    if (result?.error) {
      throw new CdpError(`CDP ${method} 失败：${result.error.message}`);
    }
    return result?.result;
  };

  const evaluate = async (expression) => {
    await withTimeout(opened, '连接');
    const id = ++seq;
    const reply = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    ws.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: {
          expression,
          returnByValue: true,
          awaitPromise: true,
          // 页面里若有同名局部变量，报错比静默取外层更容易定位
          includeCommandLineAPI: false,
        },
      })
    );
    const result = await withTimeout(reply, 'Runtime.evaluate');
    if (result.exceptionDetails) {
      const desc =
        result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        '未知页面异常';
      throw new CdpError(`页面侧求值失败：${String(desc).slice(0, 300)}`);
    }
    return result.result?.value;
  };

  return {
    page,
    evaluate,
    send,
    close() {
      try {
        ws.close();
      } catch {
        // 关闭失败不影响脚本结论，忽略
      }
    },
  };
}

/** 一步到位：找到 Stratix 页面并连上。返回同 openSession 的 session（多带 page 信息）。 */
export async function connectPage(options = {}) {
  const page = await findPage(options.base ?? CDP_BASE, options.titlePattern ?? PAGE_TITLE_PATTERN);
  return openSession(page);
}

/**
 * 页面侧：读 WorldState 快照。
 *
 * 口径（与 core 契约对齐，不猜）：
 *   - characters[].agentKind —— 角色绑定的 agent 种类（未绑定为 null）；
 *   - units[].missionId —— 单位当前承担的战场任务（空闲为 null）；
 *   - tasks[].status —— 角色任务相位（queued/running/awaiting_approval/completed/failed/cancelled）；
 *   - missions[].phase —— 战场任务相位（draft/pending/confirmed/running/done/cancelled）。
 */
export const READ_STATE_EXPR = `(() => {
  const panel = document.querySelector(${JSON.stringify(AGENT_PANEL_SELECTOR)});
  if (!panel) return { error: 'no-agent-panel' };
  const s = panel.lastState || panel._state;
  if (!s) return { error: 'no-state' };
  return {
    characters: (s.characters || []).map((c) => ({
      id: c.id,
      name: c.name,
      agentKind: c.agentKind ?? null,
      sessionId: c.externalSessionId ?? null,
      level: c.level ?? null,
    })),
    units: (s.units || []).map((u) => ({
      id: u.id,
      name: u.name,
      status: u.status,
      online: u.online ?? null,
      characterId: u.characterId ?? null,
      missionId: u.missionId ?? null,
    })),
    tasks: (s.tasks || []).map((t) => ({
      id: t.id,
      characterId: t.characterId,
      status: t.status,
      prompt: (t.prompt || '').slice(0, 80),
      missionId: t.missionId ?? null,
      output: (t.output || '').slice(0, 160),
    })),
    missions: (s.missions || []).map((m) => ({
      id: m.id,
      title: m.title,
      phase: m.phase,
      unitIds: m.unitIds || [],
    })),
    notices: (s.notices || []).slice(-5).map((n) => ({
      level: n.level,
      text: (n.text || '').slice(0, 120),
      source: n.source ?? null,
      missionId: n.missionId ?? null,
    })),
    detectedAgents: s.detectedAgents || [],
  };
})()`;

/**
 * 页面侧：派一条 HudCommand（走 adapter.dispatch，fire-and-forget）。
 * 失败以 { error } 形态返回（不抛）—— 命令通道的失败语义是 Notice/状态，不是异常。
 */
export function dispatchExpr(command) {
  return `(() => {
  const panel = document.querySelector(${JSON.stringify(AGENT_PANEL_SELECTOR)});
  if (!panel) return { error: 'no-agent-panel' };
  const adapter = panel.adapter;
  if (!adapter || typeof adapter.dispatch !== 'function') return { error: 'no-adapter' };
  try {
    adapter.dispatch(${JSON.stringify(command)});
    return { ok: true };
  } catch (e) {
    return { error: 'dispatch-failed: ' + (e && e.message ? e.message : String(e)) };
  }
})()`;
}

/** 终端 sleep（毫秒）。 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 轮询参数：间隔与超时都可由环境变量压（走查节奏因机器而异，写死等不起）。 */
export const POLL_INTERVAL_MS = Number(process.env.SX_POLL_INTERVAL_MS || 3000);
export const POLL_TIMEOUT_MS = Number(process.env.SX_TIMEOUT_MS || 300000);
