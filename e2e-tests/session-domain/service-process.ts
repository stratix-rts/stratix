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
 *      （唯一的例外是 `/e2e/session/seed`：它只**造数据**，走真实写面 manager.appendEvent，
 *        被测的压缩能力一行都没被替身掉 —— 见该路由的注释）；
 *   2. 占用 7523 / 7524 / 9222 等在用端口 —— 端口全部由环境变量注入，默认走备用端口；
 *   3. 退出时留下子进程 —— gateway 的 standalone 模式注册了 SIGTERM/SIGINT 的优雅退出。
 *
 * ============ v3.2b-B9（task_108）追加的接线 ============
 *   六能力验收剧本要在同一进程里跑「超时中断 → 恢复续聊」这条链，故本夹具按**生产口径**
 *   补齐了三处接线（与 app/main/main-entry.ts 的组合根同一份实现，不另写一套）：
 *     ① 会话 manager 补**事件读口**（读库）—— 没有它，core 的 resume 会如实拒绝（不编造上下文）；
 *     ② 补**自动起名**（规则模式：env 无 LLM 三件套 → 规则版）；
 *     ③ 补 **@会话引用**解析器（校验存在性 + 有界读取 + 注入块）。
 *   另加三条测试专用路由（切替身模式 / 触发引擎级续聊 / 起名观测 / 长会话数据准备）。
 *
 * 跑法（一般由 e2e 剧本拉起）：
 *   SX_SERVICE_PORT=7817 SX_WS_PORT=7818 SX_DATA_DIR=/tmp/xxx \
 *   STRATIX_PEER_TURN_TIMEOUT_MS=10000 npx tsx e2e-tests/session-domain/service-process.ts
 *
 * @since v3.2a S7（task_097）。
 */

import { createAgentChatService, resolvePeerTurnTimeoutMs, type AgentChatDrawerView } from '../../src/app/services/agent-chat-service';
import { createTitleProviderFromEnv } from '../../src/app/services/llm-title-provider';
import { createSessionPersister } from '../../src/app/services/persistence/session-persister';
import { toSessionEventView } from '../../src/app/services/persistence/session-reader';
import { sessionCompressThresholdFromEnv } from '../../src/app/services/session-compress-config';
import { createSessionReferenceService } from '../../src/app/services/session-reference';
import { createSessionTitleService } from '../../src/app/services/session-title';
import { worldStore } from '../../src/core/store';
import { createSessionManager, type TitleProvider } from '../../src/core/session';
import { startGatewayService } from '../../src/stratix-gateway';
import { createServiceStorage } from '../../src/stratix-gateway/service/storage';

import { createFakeTransportFactory } from '../service-resident/fake-cli';
import { createSwitchableTransportFactory, type PeerCliMode } from './peer-cli';

/** HTTP / MCP / world-sync 端口（默认走备用端口，绝不碰 7523 / 7524 / 9222）。 */
const PORT = Number(process.env.SX_SERVICE_PORT ?? 7817);
/** 状态同步 WS 端口（与 HTTP 端口分开，避免占用用户实例的 7525）。 */
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

/**
 * 互聊替身的当前模式（@since v3.2b-B9 / task_108）——
 *   'silent' = 回合跑着但不说话（看门狗超时 → 会话 interrupted）；
 *   'echo'   = 回合把 prompt 原样回显（正常收束 → 续聊产出新事件 / 引用注入可见）。
 * 默认 'silent'（与 v3.2a S7 的剧本行为逐字一致 —— 老剧本不受影响）。
 */
let peerMode: PeerCliMode = process.env.SX_E2E_PEER_MODE === 'echo' ? 'echo' : 'silent';

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
    // 事件读口（@since v3.2b-B9 / task_108）—— 与 service 侧那个 manager 同一口径
    //   （createStratixService 的接线，见 src/stratix-gateway/service/stratix-service.ts）：
    //   **读库**（session_events 表）而不是读内存 —— 因为 resume 的回灌、fork 的复制、
    //   压缩的折叠取料都要**跨实例**看见事件（service 侧 manager 建的会话，本夹具也要能读）。
    //   why 这里必须接：core 的 manager 没有事件源就**如实拒绝** resume（不编造上下文）。
    read: {
      readSessionEvents: (
        sessionId: string,
        query: { readonly beforeSeq?: number; readonly limit: number }
      ) =>
        storage
          .readSessionEvents(sessionId, {
            ...(query.beforeSeq === undefined ? {} : { beforeSeq: query.beforeSeq }),
            limit: query.limit,
          })
          .map(toSessionEventView),
      // 向前读（压缩取「要折的那一段」用 —— 窗口口径读量随会话长度增长）。
      readSessionEventsAfter: (sessionId: string, afterSeq: number, limit: number) =>
        storage.readSessionEventsAfter(sessionId, afterSeq, limit).map(toSessionEventView),
    },
    // 长会话压缩阈值（env `SX_SESSION_COMPRESS_THRESHOLD`，缺省 200）——
    //   与 service 侧同一个解析函数（口径一致，不各写一份）。
    compressThreshold: sessionCompressThresholdFromEnv(),
  });

  // ===== 自动起名（@since v3.2b-B9 / task_108）—— 规则模式 =====
  // 起名实现按 env 三件套选（app/services/llm-title-provider.ts 的 createTitleProviderFromEnv）：
  //   这里给**空 env** → 必然落到规则版（无 LLM 配置 = 规则版，与生产「没配 env」的分支同一条）。
  // why 要在这里起名：起名是**旁路**（起完写回标题），剧本据此断言「规则模式起名生效」。
  const titleCalls: Array<{ kind: string; title: string }> = [];
  const baseTitleProvider = createTitleProviderFromEnv({ env: {} });
  const titleProvider: TitleProvider = {
    id: baseTitleProvider.id,
    generate: (seed) => {
      const title = baseTitleProvider.generate(seed);
      titleCalls.push({ kind: seed.kind, title: String(title) });
      return title;
    },
  };
  const titleService = createSessionTitleService({
    sessions: sessionManager,
    provider: titleProvider,
    logger: (line) => console.warn(line),
  });

  // ===== @会话引用解析（@since v3.2b-B9 / task_108）=====
  // 口径与生产组合根（app/main/main-entry.ts）一致：会话摘要读 worldStore，事件读事件源。
  const sessionReferenceService = createSessionReferenceService({
    readSession: (sessionId) =>
      worldStore.getState().sessions?.find((item) => item.id === sessionId) ?? null,
    readSessionEvents: (
      sessionId: string,
      options: { readonly beforeSeq?: number; readonly limit: number }
    ) =>
      storage
        .readSessionEvents(sessionId, {
          ...(options.beforeSeq === undefined ? {} : { beforeSeq: options.beforeSeq }),
          limit: options.limit,
        })
        .map(toSessionEventView),
    logger: (line) => console.warn(line),
  });

  // ===== 互聊编排（生产口径接线，视图口换成记录型空实现）=====
  const peerChat = createAgentChatService({
    view: recordingView,
    getState: () => worldStore.getState(),
    // 可切换 adapter：默认静默（回合跑起来但一个字不说 → 看门狗超时 → 回合中断）；
    //   剧本可切到回显模式（回合正常收束 → 续聊产出新事件 / 引用注入可见）。
    createTransport: createSwitchableTransportFactory(() => peerMode),
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
    // 自动起名（规则模式，异步旁路）。
    titles: titleService,
    // @会话引用解析器：议题里的 `@session_<id>` → 校验 + 读事件 + 拼注入块。
    references: sessionReferenceService,
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

  // ===== 测试专用路由（v3.2b-B9 / task_108 追加）=====

  // 切互聊替身的模式（静默 ⇄ 回显）—— 只改**替身**的行为，不碰任何被测能力。
  instance.app.post('/e2e/peer-mode', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const mode = String(body.mode ?? 'silent');
    peerMode = mode === 'echo' ? 'echo' : 'silent';
    res.json({ ok: true, mode: peerMode });
  });

  // 触发**互聊引擎**的续聊恢复（agent-chat-service.resume —— 生产里 `session.resume` 命令的落点，
  //   见 app/main/main-entry.ts 的 sessionResume 端口）。
  // why 走这条而不是 MCP 的 stratix_session_resume：MCP 那条是 **core 级**恢复
  //   （翻状态位 + 记 resumed 事件），而「回灌上文 + 重启轮转 + 续聊产出新事件」是引擎级的事
  //   —— 引擎住在互聊服务里（生产在渲染进程，本夹具在 service 进程里按生产口径装起来）。
  instance.app.post('/e2e/peer-resume', async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sessionId = String(body.sessionId ?? '');
    if (!sessionId) {
      res.status(400).json({ ok: false, error: 'bad sessionId' });
      return;
    }
    try {
      const outcome = await peerChat.resume(sessionId);
      res.json({
        ok: outcome.ok,
        code: outcome.code ?? null,
        reason: outcome.reason,
        sessionId: outcome.sessionId ?? null,
        replayedMessages: outcome.replayedMessages ?? null,
      });
    } catch (error: unknown) {
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // 起名观测口：起名实现用的是哪个 provider（'rules' / 'llm'）+ 每次起名算出的标题。
  instance.app.get('/e2e/titles', (_req, res) => {
    res.json({ ok: true, providerId: titleProvider.id, calls: titleCalls });
  });

  // 长会话数据准备（压缩验收用）：建一条会话并灌 N 条消息事件。
  // ★ 这条路由**只造数据**：走的是**真实写面**（manager.createSession / manager.appendEvent，
  //   事件真落库、真带 seq），被测的压缩能力（折叠 + 读取路由）一行都没被替身掉。
  // why 需要它：保留窗是 50 条（产品口径，不可配），要触发折叠就得有 50+ 条原文 ——
  //   靠互聊一轮轮聊出来要几十秒，灌数据是同一件事的快路径。
  instance.app.post('/e2e/session/seed', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const count = Math.max(0, Math.min(500, Number(body.count ?? 0)));
    const kind = String(body.kind ?? 'peer_chat') as 'peer_chat';
    const participants = String(body.participants ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    const record = sessionManager.createSession({
      kind,
      participants,
      firstMessage: String(body.topic ?? 'E2E 长会话数据准备'),
    });
    if (!record) {
      res.status(500).json({ ok: false, error: '建会话失败' });
      return;
    }
    for (let index = 0; index < count; index += 1) {
      sessionManager.appendEvent(record.id, {
        type: 'message',
        payload: { author: '用户', text: `第 ${index + 1} 条消息：${'内容'.repeat(20)}` },
      });
    }
    const latest = sessionManager.store.getState().sessions?.find((item) => item.id === record.id);
    res.json({ ok: true, sessionId: record.id, eventCount: latest?.eventCount ?? 0 });
  });

  // 就绪标记：一行 JSON，剧本按前缀抓（不靠日志猜）。
  console.log(
    `SX_SERVICE_READY ${JSON.stringify({
      pid: process.pid,
      port: PORT,
      wsPort: WS_PORT,
      dataDir: DATA_DIR,
      peerTurnTimeoutMs: PEER_TURN_TIMEOUT_MS,
      peerMode,
      compressThreshold: sessionCompressThresholdFromEnv(),
    })}`
  );

  // 挂住进程：gateway 的 standalone 模式已注册 SIGTERM / SIGINT（优雅收尾后 process.exit）。
  void instance;
}

main().catch((error: unknown) => {
  console.error('[session-domain-service] 启动失败：', error);
  process.exit(1);
});
