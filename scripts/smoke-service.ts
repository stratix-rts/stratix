/**
 * 文件职责：headless 组合根的 **node 冒烟脚本**（task_077 / service-split A1；task_078 / A2 追加
 *   执行环演示段）—— 在纯 node 环境里 boot service（不开渲染进程），验证：
 *     ① boot 后 worldStore.getState() 可用（空世界但结构完整）；
 *     ② 经总线 emitCommand('mission.create') 后，任务真的落进 store（不是"命令发出去了"就算数）；
 *     ③ **执行环**（A2）：task.assign → queued → running → completed 全链在**本进程**跑通 ——
 *        子进程由 cli-transport 的 node-process 工厂直接拉起（不经渲染进程 / IPC）；
 *     ④ stop() 之后命令不再落地（runtime 真的退订了）；
 *     ⑤ 进程正常退出（没有残留订阅 / 定时器）。
 *     ⑥ **会话域**（task_093 / v3.2a S3）：建 → 追加 → **经总线中断** → 收尾，
 *        且**内存态（WorldState.sessions）与 SQLite（sessions / session_events 两张表）双侧可见**；
 *        world-sync 快照里也带着 sessions（会话随快照走，无需改协议）。
 * 输入：无（自足脚本；库建在临时目录里，跑完删掉）。
 * 输出：逐条断言 + 一行 OK；任一断言失败即非零退出。
 * 禁止事项：
 *   1. 引入任何渲染层 / 宿主层依赖 —— 本脚本必须能 `tsx` 直跑；
 *   2. 往 store 里塞假数据来"证明"通路 —— 任务必须是经总线命令 / manager 落地的；
 *   3. 调真 CLI（claude / codex …）—— 用 echo 型 fake adapter 当测试替身（把二进制换成本进程）；
 *   4. 留残余订阅不收 —— 收不干净就不会正常退出（本脚本的第四条断言就是看这个）。
 *
 * 跑法：npx tsx scripts/smoke-service.ts
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { emitCommand } from '../src/core/bus';
import { createCliTransport } from '../src/app/services/cli-transport/runtime';
import { createNodeProcessFactory } from '../src/app/services/cli-transport/node-process';
import type { CliAdapter } from '../src/app/services/cli-transport/transport';
import { createStratixService } from '../src/stratix-gateway/service';
import { createServiceStorage, type ServiceStorage } from '../src/stratix-gateway/service/storage';
import { createSnapshotMessage } from '../src/stratix-gateway/api/websocket/world-sync/protocol';
import { destroyDatabase } from '../src/stratix-database';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    console.error(`[smoke-service] 断言失败：${message}`);
    process.exit(1);
  }
}

/**
 * echo 型 fake adapter（测试替身）：二进制换成本进程自己（node），把 prompt 原样吐回来。
 * 走的是**真的** node-process 工厂 —— 子进程由本进程直接拉起（证明执行环不经 IPC）。
 */
const echoAdapter: CliAdapter = {
  kind: 'claude-code',
  binary: process.execPath,
  outputMode: 'text',
  buildArgs: (prompt: string) => [
    '-e',
    `process.stdout.write(${JSON.stringify(`echo:${prompt}`)})`,
  ],
  parseLine: () => [],
};

async function main(): Promise<void> {
  // ===== boot（执行环已接：service 进程内直接 spawn CLI；存储件已接：会话随写随落库）=====
  // 存储件建在临时目录里（不碰用户的真实库）：组合根拿到 storage 即自动接管会话落库口
  // （缺省范式：存储件在 → 接管；显式覆盖缺省；两者皆缺 = 不落库）。
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-smoke-service-'));
  const storage: ServiceStorage = await createServiceStorage({ dataDir });
  const service = createStratixService({
    storage,
    taskExecution: {
      createTransport: () => createCliTransport(echoAdapter, { factory: createNodeProcessFactory() }),
    },
  });
  const before = service.store.getState();
  assert(before !== undefined, 'boot 后 store.getState() 可用');
  assert(Array.isArray(before.missions), '初始状态含 missions 数组');
  assert(before.missions.length === 0, '初始状态无任务');
  assert(service.runtime.running, 'runtime 已接通');
  console.log(`[smoke-service] boot ok（missions=${before.missions.length}）`);

  // ===== 经总线派一条任务 =====
  emitCommand({ type: 'mission.create', title: '冒烟任务', unitIds: [] });
  const after = service.store.getState();
  assert(after.missions.length === 1, `mission.create 落地（实得 ${after.missions.length} 条）`);
  assert(after.missions[0]?.title === '冒烟任务', '任务标题正确');
  console.log(`[smoke-service] mission.create 落地 ok（id=${after.missions[0]?.id}）`);

  // ===== 执行环（task_078 / A2）：assign → queued → running → completed 全在本进程 =====
  const created = service.character.createCharacter({
    name: '冒烟角色',
    agentKind: 'claude-code',
    skinId: 'skin-default',
  });
  assert(created.ok, '角色建档成功');
  // 出队守门读 detectedAgents（真相源 = store；生产由探测器写入，service 侧探测接线归 A4）。
  service.store.setDetectedAgents([
    { kind: 'claude-code', tier: 'T1', installed: true, status: 'installed', version: null, path: null },
  ]);
  const task = service.task.assignTask({
    characterId: created.character.id,
    prompt: '在 service 进程里干活',
  });
  assert(task !== null, 'task.assign 落地（queued）');
  const deadline = Date.now() + 20_000;
  while ((service.store.getState().tasks ?? []).find((item) => item.id === task.id)?.status !== 'completed') {
    if (Date.now() > deadline) {
      console.error('[smoke-service] 断言失败：任务没在 service 进程内跑完（超时）');
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const finished = (service.store.getState().tasks ?? []).find((item) => item.id === task.id);
  assert(finished?.status === 'completed', '任务在 service 进程内跑完（completed）');
  assert(finished?.output.includes('在 service 进程里干活'), '任务输出带回执行结果');
  console.log(`[smoke-service] 执行环 ok（task=${task.id} → completed）`);

  // ===== 会话域（task_093 / v3.2a S3）：LITE 接线 + 手工全程 + 双侧可见 =====
  // ① LITE 接线核对：上面那个任务收尾时，task-service 已自动记了一条 task_run 会话
  //    （建 + 收尾两事件）—— 证明业务侧接线真的通了（不是只挂了个 manager）。
  const taskRunSessions = (service.store.getState().sessions ?? []).filter(
    (item) => item.kind === 'task_run'
  );
  assert(taskRunSessions.length === 1, `任务收尾自动记了一条 task_run 会话（实得 ${taskRunSessions.length} 条）`);
  assert(taskRunSessions[0]?.status === 'closed', 'task_run 会话已收尾（closed）');
  assert(taskRunSessions[0]?.eventCount === 2, `task_run 会话两事件（实得 ${taskRunSessions[0]?.eventCount}）`);

  // ② 手工全程：建 → 追加 → 中断（**经总线往返**）→ 收尾。
  const sessionRecord = service.session.createSession({
    kind: 'character_chat',
    participants: ['冒烟角色'],
    title: '冒烟会话',
  });
  assert(sessionRecord !== null, '会话建成');
  const sessionId = sessionRecord!.id;
  const appended = service.session.appendEvent(sessionId, { type: 'round', payload: { role: 'user' } });
  assert(appended !== null, '事件追加成功');
  assert(appended?.seq === 2, `事件序号连续（实得 seq=${appended?.seq}）`);
  // 中断走 HUD 命令通道：命令总线 → core runtime 裁决 → 会话状态迁移（与 mission / task 同一口径）。
  emitCommand({ type: 'session.interrupt', sessionId });
  const interrupted = (service.store.getState().sessions ?? []).find((item) => item.id === sessionId);
  assert(interrupted?.status === 'interrupted', `session.interrupt 经总线落地（实得 ${interrupted?.status}）`);
  const closed = service.session.closeSession(sessionId, '冒烟收尾');
  assert(closed?.status === 'closed', '会话已收尾（closed）');

  // ③ 双侧可见：内存态（WorldState.sessions）+ SQLite（sessions / session_events 两张表）。
  const memorySessions = service.store.getState().sessions ?? [];
  const dbSessions = storage.readSessions({});
  const dbEvents = storage.readSessionEvents(sessionId, {});
  const memorySession = memorySessions.find((item) => item.id === sessionId);
  const dbSession = dbSessions.find((item) => item.id === sessionId);
  assert(memorySession !== undefined, '内存态可见（WorldState.sessions 有这条会话）');
  assert(dbSession !== undefined, 'SQLite 侧可见（sessions 表有这条会话）');
  assert(dbSession?.status === 'closed', 'SQLite 侧状态与会话一致（closed）');
  assert(dbSession?.eventCount === 4, `SQLite 侧事件计数一致（实得 ${dbSession?.eventCount}）`);
  assert(dbEvents.length === 4, `SQLite 侧事件流四条（实得 ${dbEvents.length}）`);
  assert(
    dbEvents.map((event) => event.type).join(',') === 'created,round,interrupt,closed',
    `事件类型顺序正确（实得 ${dbEvents.map((event) => event.type).join(',')}）`
  );
  console.log(
    `[smoke-service] 会话双侧可见 ok（session=${sessionId}；内存 ${memorySessions.length} 条 / 库 ${dbSessions.length} 条；事件 ${dbEvents.length} 条）`
  );

  // ④ world-sync 快照：会话随快照走（toWireState 摊平的是 selectionGroups，其余字段整体透传）。
  const snapshot = createSnapshotMessage(1, service.store.getState());
  assert(Array.isArray(snapshot.state.sessions), 'world-sync 快照含 sessions 键');
  assert(
    (snapshot.state.sessions ?? []).some((item) => item.id === sessionId),
    'world-sync 快照里的 sessions 与内存态一致'
  );
  console.log(
    `[smoke-service] world-sync 快照含 sessions ok（${(snapshot.state.sessions ?? []).length} 条）`
  );

  // ===== 收干净：stop 之后命令不再落地 =====
  service.stop();
  assert(!service.runtime.running, 'stop 后 runtime 已停');
  emitCommand({ type: 'mission.create', title: '停机后的任务', unitIds: [] });
  assert(
    service.store.getState().missions.length === 1,
    'stop 后命令不再落地（runtime 已退订）'
  );
  console.log('[smoke-service] stop ok（命令不再落地）');

  console.log('[smoke-service] OK');
}

void main();
