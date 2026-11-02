/**
 * 文件职责：**会话域验收的服务进程**（v3.2a S7 / task_097）——
 *   以「独立进程」形态拉起 gateway（service + HTTP/MCP + world-sync 端点），
 *   并在**同一个进程**里补挂一段互聊夹具，供剧本制造「回合超时 → 会话 interrupted」。
 * 输入：环境变量（端口 / 数据目录 / 回合超时）。
 * 输出：stdout 一行 `SX_SERVICE_READY {json}`（含 pid 与端口）—— 剧本据此判定「起来了」。
 *
 * why 要这个夹具（而不能让剧本直接调 core）：
 *   互聊编排服务（app/services/agent-chat-service.ts）住在**渲染进程**（抽屉 DOM 在那儿），
 *   headless 的 service 进程里没有它 —— 而「互聊超时 → 会话显式 interrupted」这条链
 *   恰恰只有互聊服务走得到。于是本进程**按生产口径**把互聊服务装起来：
 *     - 视图口给一个只记录不渲染的空实现（端口是结构类型，不需要 DOM）；
 *     - 执行环给静默 adapter（子进程真跑、真的被看门狗杀）；
 *     - 会话写入面给一个绑**同一份 store + 同一个库连接**的 SessionManager。
 *   剧本经一条**测试专用**的 HTTP 路由触发互聊，其余一切（MCP / REST / world-sync）走产品口径。
 *
 * ★ 为什么夹具另建一个 SessionManager（而不是复用 service 内部那个）：
 *   gateway 的 startGatewayService 不把组合根的 session manager 露出来。
 *   本进程另建一个，绑的是**同一份 worldStore**（core/store 的进程内单例 ——
 *   service 侧组合根用的就是它）与**同一个库连接**（stratix-database 的进程内单例，
 *   createServiceStorage 复用它，不会开第二个连接）——
 *   于是两处写的是同一份 WorldState.sessions 与同一张 sessions / session_events 表。
 *   id 前缀不同（service 侧建 task_run / mission_run，本夹具建 peer_chat），不会撞主键。
 *
 * 禁止事项：
 *   1. 在这里改 core 状态 / 造数据 —— 本进程只负责「把服务拉起来 + 把互聊夹具装上」，真相由 core 裁决；
 *   2. 占用 7523 / 7524 / 9222 等在用端口 —— 端口全部由环境变量注入，默认走备用端口；
 *   3. 退出时留下子进程 —— gateway 的 standalone 模式注册了 SIGTERM/SIGINT 的优雅退出。
 *
 * 跑法（一般由 e2e 剧本拉起）：
 *   SX_SERVICE_PORT=7817 SX_WS_PORT=7818 SX_DATA_DIR=/tmp/xxx \
 *   STRATIX_PEER_TURN_TIMEOUT_MS=10000 npx tsx e2e-tests/session-domain/service-process.ts
 *
 * @since v3.2a S7（task_097）。
 */

import { createAgentChatService, resolvePeerTurnTimeoutMs, type AgentChatDrawerView } from '../../src/app/services/agent-chat-service';
import { createSessionPersister } from '../../src/app/services/persistence/session-persister';
import { worldStore } from '../../src/core/store';
import { createSessionManager } from '../../src/core/session';
import { startGatewayService } from '../../src/stratix-gateway';
import { createServiceStorage } from '../../src/stratix-gateway/service/storage';

import { createFakeTransportFactory } from '../service-resident/fake-cli';
import { createSilentTransportFactory } from './peer-cli';

/** HTTP / MCP / world-sync 端口（默认走备用端口，绝不碰 7523 / 7524 / 9222）。 */
const PORT = Number(process.env.SX_SERVICE_PORT ?? 7817);
/** 状态同步 WS 端口（与 HTTP 端口分开，避免占用用户实例的 3011）。 */
const WS_PORT = Number(process.env.SX_WS_PORT ?? 7818);
/** 数据目录（存档 / 纹理 / OpenClaw 配置）—— 剧本给一个临时目录，绝不碰用户的真实数据目录。 */
const DATA_DIR = process.env.SX_DATA_DIR ?? 'stratix-data';
/**
 * 互聊回合超时（ms）—— 走**产品口径**的覆盖链（环境变量 → resolvePeerTurnTimeoutMs → deps.timeoutMs）。
 * 下界 10s（resolvePeerTurnTimeoutMs 的钳位），故剧本默认给 10000。
 */
const PEER_TURN_TIMEOUT_MS = resolvePeerTurnTimeoutMs(
  process.env.STRATIX_PEER_TURN_TIMEOUT_MS
);

// ★ 环境变量先钉死：gateway 启动时会 load src/stratix-gateway/.env —— 那份文件里
//   PORT=7524 / WS_PORT=7525 正是**用户 dev 实例**的端口。dotenv 不覆盖已存在的环境变量，
//   所以这里先把两个端口写进 env，用户的实例就碰不到（否则本进程会跟用户实例抢 7525 → EADDRINUSE）。
process.env.PORT = String(PORT);
process.env.WS_PORT = String(WS_PORT);
process.env.BIND_ADDRESS = '127.0.0.1';
process.env.DATA_DIR = DATA_DIR;
// NocoDB 明确关掉（用户那份 .env 若开了，本进程不跟着开）。
process.env.NOCO_ENABLED = 'false';

/** 互聊夹具记下的气泡（诊断用：剧本可据此核对「中断气泡说了什么」）。 */
const peerMessages: Array<{ role: string; text: string }> = [];

/** 空视图口：只记录不渲染 —— 抽屉在 headless 进程里不存在，但端口是结构类型（不需要 DOM）。 */
const recordingView: AgentChatDrawerView = {
  addMessage: (message) => {
    peerMessages.push({ role: message.role, text: message.text });
  },
  appendPeerStream: (): void => undefined,
  finalizePeerStream: (): void => undefined,
  setPeerRound: (): void => undefined,
  endPeerChat: (): void => undefined,
};

async function main(): Promise<void> {
  const instance = await startGatewayService({
    port: PORT,
    bindAddress: '127.0.0.1',
    dataDir: DATA_DIR,
    mode: 'standalone',
    // 任务执行环的替身：echo 型 fake CLI adapter（task_084 那一支，保证派单可跑完）。
    serviceTransport: createFakeTransportFactory(),
  });

  // ===== 会话写入面（互聊夹具用）=====
  // 存储件复用**同一个进程内的库单例**（不另开连接，铁律 6 仍然成立：只有本进程写库）。
  const storage = await createServiceStorage({ dataDir: DATA_DIR });
  const sessionManager = createSessionManager({
    store: worldStore,
    persist: createSessionPersister(
      {
        upsertSession: storage.persistSession,
        appendSessionEvent: storage.persistSessionEvent,
      },
      (line) => console.warn(line)
    ),
  });

  // ===== 互聊编排（生产口径接线，视图口换成记录型空实现）=====
  const peerChat = createAgentChatService({
    view: recordingView,
    getState: () => worldStore.getState(),
    // 静默 adapter：回合跑起来但一个字不说 → 看门狗超时 → 回合中断。
    createTransport: createSilentTransportFactory(),
    // 会话 id 回写（与渲染侧同一口径：写进角色档案的 externalSessionId）。
    persistSessionId: (characterId, sessionId) => {
      worldStore.setState((current) => {
        const index = current.characters.findIndex((c) => c.id === characterId);
        if (index < 0) return current;
        const existing = current.characters[index];
        if (existing.externalSessionId === sessionId) return current;
        const characters = [...current.characters];
        characters[index] = { ...existing, externalSessionId: sessionId };
        return { ...current, characters };
      });
    },
    // 消息落库（与渲染侧同一口径：写 character_chat_messages 表）。
    persistMessage: (message) => {
      storage.persistChatMessage({
        characterId: message.characterId,
        role: message.role,
        text: message.text,
        sessionRef: message.sessionRef,
      });
    },
    // 会话域写入面：每场互聊一条 peer_chat 会话（开场建 + 全量事件 + 中断显式化）。
    sessions: sessionManager,
    timeoutMs: PEER_TURN_TIMEOUT_MS,
    logger: (line) => console.log(line),
  });

  // ===== 测试专用路由（不属于产品 API 面；只给本剧本触发互聊用）=====
  instance.app.post('/e2e/peer-chat', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const a = String(body.a ?? '');
    const b = String(body.b ?? '');
    const topic = String(body.topic ?? '');
    const rounds = Number(body.rounds ?? 1);
    if (!a || !b || !topic) {
      res.status(400).json({ ok: false, error: 'bad peer-chat args' });
      return;
    }
    peerMessages.length = 0;
    // 不 await：整场讨论（含那一段超时）要跑十几秒，回执先回，剧本随后轮询会话状态。
    void peerChat
      .start(a, b, topic, Number.isFinite(rounds) ? rounds : 1)
      .then(() => {
        console.log('[peer-chat] 讨论收束');
      })
      .catch((error: unknown) => {
        console.error('[peer-chat] 讨论异常：', error);
      });
    res.json({ ok: true, timeoutMs: PEER_TURN_TIMEOUT_MS });
  });

  instance.app.get('/e2e/peer-chat/state', (_req, res) => {
    res.json({ ok: true, running: peerChat.running, messages: peerMessages });
  });

  // 就绪标记：一行 JSON，剧本按前缀抓（不靠日志猜）。
  console.log(
    `SX_SERVICE_READY ${JSON.stringify({
      pid: process.pid,
      port: PORT,
      wsPort: WS_PORT,
      dataDir: DATA_DIR,
      peerTurnTimeoutMs: PEER_TURN_TIMEOUT_MS,
    })}`
  );

  // 挂住进程：gateway 的 standalone 模式已注册 SIGTERM / SIGINT（优雅收尾后 process.exit）。
  void instance;
}

main().catch((error: unknown) => {
  console.error('[session-domain-service] 启动失败：', error);
  process.exit(1);
});
