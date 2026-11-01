/**
 * 文件职责：headless 组合根的 **node 冒烟脚本**（task_077 / service-split A1；task_078 / A2 追加
 *   执行环演示段）—— 在纯 node 环境里 boot service（不开渲染进程），验证：
 *     ① boot 后 worldStore.getState() 可用（空世界但结构完整）；
 *     ② 经总线 emitCommand('mission.create') 后，任务真的落进 store（不是"命令发出去了"就算数）；
 *     ③ **执行环**（A2）：task.assign → queued → running → completed 全链在**本进程**跑通 ——
 *        子进程由 cli-transport 的 node-process 工厂直接拉起（不经渲染进程 / IPC）；
 *     ④ stop() 之后命令不再落地（runtime 真的退订了）；
 *     ⑤ 进程正常退出（没有残留订阅 / 定时器）。
 * 输入：无（自足脚本）。
 * 输出：逐条断言 + 一行 OK；任一断言失败即非零退出。
 * 禁止事项：
 *   1. 引入任何渲染层 / 宿主层依赖 —— 本脚本必须能 `tsx` 直跑；
 *   2. 往 store 里塞假数据来"证明"通路 —— 任务必须是经总线命令 / manager 落地的；
 *   3. 调真 CLI（claude / codex …）—— 用 echo 型 fake adapter 当测试替身（把二进制换成本进程）；
 *   4. 留残余订阅不收 —— 收不干净就不会正常退出（本脚本的第四条断言就是看这个）。
 *
 * 跑法：npx tsx scripts/smoke-service.ts
 */

import { emitCommand } from '../src/core/bus';
import { createCliTransport } from '../src/app/services/cli-transport/runtime';
import { createNodeProcessFactory } from '../src/app/services/cli-transport/node-process';
import type { CliAdapter } from '../src/app/services/cli-transport/transport';
import { createStratixService } from '../src/stratix-gateway/service';

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
  // ===== boot（执行环已接：service 进程内直接 spawn CLI）=====
  const service = createStratixService({
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
