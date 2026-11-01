/**
 * 文件职责：headless 组合根的 **node 冒烟脚本**（task_077 / service-split A1）——
 *   在纯 node 环境里 boot service（不开渲染进程），验证：
 *     ① boot 后 worldStore.getState() 可用（空世界但结构完整）；
 *     ② 经总线 emitCommand('mission.create') 后，任务真的落进 store（不是"命令发出去了"就算数）；
 *     ③ stop() 之后命令不再落地（runtime 真的退订了）；
 *     ④ 进程正常退出（没有残留订阅 / 定时器）。
 * 输入：无（自足脚本）。
 * 输出：逐条断言 + 一行 OK；任一断言失败即非零退出。
 * 禁止事项：
 *   1. 引入任何渲染层 / 宿主层依赖 —— 本脚本必须能 `tsx` 直跑；
 *   2. 往 store 里塞假数据来"证明"通路 —— 任务必须是经总线命令落地的；
 *   3. 留残余订阅不收 —— 收不干净就不会正常退出（本脚本的第四条断言就是看这个）。
 *
 * 跑法：npx tsx scripts/smoke-service.ts
 */

import { emitCommand } from '../src/core/bus';
import { createStratixService } from '../src/stratix-gateway/service';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`[smoke-service] 断言失败：${message}`);
    process.exit(1);
  }
}

function main(): void {
  // ===== boot =====
  const service = createStratixService();
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

main();
