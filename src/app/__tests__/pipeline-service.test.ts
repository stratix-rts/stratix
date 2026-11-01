/**
 * 单测：流水线编排器（app/services/pipeline-service.ts，task_051）。
 *
 * 驱动说明：与 task-service.test.ts 同一策略 —— **真实 bus**（resetBus 隔离）+ 真实
 * task manager（站任务的六态相位与 FIFO 就是真状态机的行为，mock 它等于把编排器测不到）。
 * 收尾信号走**主路**（handleTaskSettled，全文字段）与**兜底路**（bus 事件 + 微任务）两条
 * 分别断言。持久化回调用录制数组（不 mock 数据语义 —— 落了什么由断言读完）。
 *
 * 覆盖（task_051 ⑥）：成功链 / 中断链（尾站失败 / 中段失败后续 skipped）/ 角色缺失跳站 /
 * 取消断链 / 指定目标入队 / 终态判定 / feed 读数 / 落库序列。
 */

import { beforeEach, describe, expect, it } from '@jest/globals';

import { emitWorldEvent, resetBus } from '../../core/bus';
import { createTaskManager } from '../../core/task';
import { createStore as createCoreStore } from '../../core/store';
import type { AgentKind, CharacterView, WorldState } from '../../core/types';
import { createPipelineService, type PipelinePersistRecord } from '../services/pipeline-service';
import type { TaskPersistRecord } from '../services/task-service';

// ============================================================================
// 夹具
// ============================================================================

function makeCharacter(id: string, name: string, agentKind: AgentKind): CharacterView {
  return { id, name, persona: '', level: 1, experience: 0, agentKind, skinId: null, externalSessionId: null };
}

const characterA = makeCharacter('ch-1', '实现者', 'claude-code');
const characterB = makeCharacter('ch-2', '评审员', 'kimi');
const characterC = makeCharacter('ch-3', '分析师', 'openclaw');

function makeState(characters: readonly CharacterView[]): WorldState {
  return {
    units: [],
    missions: [],
    selection: { unitIds: [], previewUnitIds: [], revision: 0 },
    characters: [...characters],
    notices: [],
    links: [],
    messages: [],
  };
}

interface SpecStep {
  kind?: AgentKind;
  characterId?: string;
  promptTemplate: string;
}

interface Harness {
  run(name: string, issue: string, steps: readonly SpecStep[]): string | null;
  /** 主路收尾信号（task-service 的 onTaskSettled 同款载荷）。 */
  settle(taskId: string, status: 'completed' | 'failed', output: string): void;
  /** 总线直发事件（兜底路 / 取消路径用）。 */
  emit(event: Parameters<typeof emitWorldEvent>[0]): void;
  /** 指定角色当前在途（非终态）任务 —— 六态相位真相面，不 mock。 */
  taskOf(characterId: string): { id: string; prompt: string; status: string } | null;
  persisted: PipelinePersistRecord[];
  stamped: Array<{ taskId: string; pipelineId: string }>;
  feed(): ReturnType<ReturnType<typeof createPipelineService>['feed']['snapshot']>;
  notifications: number;
}

function makeHarness(characters: readonly CharacterView[]): Harness {
  const store = createCoreStore();
  store.setState(() => makeState(characters));
  const taskManager = createTaskManager({ store });
  const persisted: PipelinePersistRecord[] = [];
  const stamped: Array<{ taskId: string; pipelineId: string }> = [];
  let notifications = 0;
  const service = createPipelineService({
    getState: () => store.getState(),
    taskManager,
    persistPipeline: (record) => persisted.push(record),
    stampTask: (record, pipelineId) => stamped.push({ taskId: record.id, pipelineId }),
    createId: (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`,
    now: () => 1_700_000_000_000,
  });
  service.feed.subscribe(() => {
    notifications += 1;
  });
  service.start();
  const state = (): WorldState => store.getState();
  return {
    run: (name, issue, steps) =>
      service.runPipeline(
        {
          name,
          steps: steps.map((step) => ({ kind: step.kind, characterId: step.characterId, promptTemplate: step.promptTemplate })),
        },
        issue
      ),
    settle: (taskId, status, output) => {
      // 与生产时序一致：task-service 先驱动真状态机（六态相位真相），再经 onTaskSettled
      // 回流编排器（本测试的主路 = 直接调 handleTaskSettled）。
      // complete 需要 running 相位（机器约束）—— 先 start；fail 从任意非终态可达。
      if (status === 'completed') {
        taskManager.startTask(taskId);
        taskManager.completeTask(taskId, output);
      } else {
        taskManager.failTask(taskId, output);
      }
      const task = (state().tasks ?? []).find((entry) => entry.id === taskId);
      const record: TaskPersistRecord = {
        id: taskId,
        characterId: task?.characterId ?? 'ch-1',
        prompt: task?.prompt ?? '',
        status,
        output,
        createdAt: task?.createdAt ?? 0,
        startedAt: task?.startedAt ?? 0,
        endedAt: task?.endedAt ?? 0,
      };
      service.handleTaskSettled(record);
    },
    emit: (event) => emitWorldEvent(event),
    taskOf: (characterId) => {
      const tasks = state().tasks ?? [];
      const task = tasks.find(
        (entry) =>
          entry.characterId === characterId &&
          entry.status !== 'completed' &&
          entry.status !== 'failed' &&
          entry.status !== 'cancelled'
      );
      return task ? { id: task.id, prompt: task.prompt, status: task.status } : null;
    },
    persisted,
    stamped,
    feed: () => service.feed.snapshot(),
    get notifications() {
      return notifications;
    },
  };
}

import type { CharacterTask } from '../../core/types';

/** 总线 task.* 事件载荷的 CharacterTask 快照（六态全字段 —— bus 事件契约不裁字段）。 */
function taskSnapshot(id: string, prompt: string, status: CharacterTask['status'], output = ''): CharacterTask {
  return { id, characterId: 'ch-1', prompt, status, createdAt: 0, startedAt: null, endedAt: null, output };
}

describe('编排器站序（task_051）', () => {
  beforeEach(() => {
    resetBus();
  });

  it('成功链：一站 completed → 下一站带全文 prev_output 渲染并派发 → 全线 completed', () => {
    const h = makeHarness([characterA, characterB]);
    const id = h.run('实现+审阅', '修复登录页', [
      { kind: 'claude-code', promptTemplate: '实现：{{task}}' },
      { kind: 'kimi', promptTemplate: '审阅：\n{{prev_output}}' },
    ]);
    expect(id).toBeTruthy();

    // 站 1 已入列：指定 targetCharacterId 直达 ch-1 的队列（与普通任务共用 FIFO）。
    const first = h.taskOf('ch-1');
    expect(first).not.toBeNull();
    expect(first!.prompt).toBe('实现：修复登录页');
    expect(h.stamped.some((entry) => entry.taskId === first!.id && entry.pipelineId === id)).toBe(true);

    // 主路收尾（全文）：站 1 completed → 站 2 自动渲染派发。
    h.settle(first!.id, 'completed', '全文实现输出甲乙丙丁');
    const second = h.taskOf('ch-2');
    expect(second).not.toBeNull();
    expect(second!.prompt.startsWith('审阅：\n')).toBe(true);
    expect(second!.prompt).toContain('全文实现输出甲乙丙丁');

    // feed 读数：站相位实时（1 完成 / 2 排队）。
    const running = h.feed()!.find((run) => run.id === id)!;
    expect(running.status).toBe('running');
    expect(running.steps.map((step) => step.phase)).toEqual(['completed', 'queued']);

    h.settle(second!.id, 'completed', 'LGTM');
    const done = h.feed()!.find((run) => run.id === id)!;
    expect(done.status).toBe('completed');
    expect(done.steps.map((step) => step.phase)).toEqual(['completed', 'completed']);
    // 落库序列：发起 running → 站1入列 → 站1完成 → 站2入列 → 整线 completed（≥ 4 次 upsert）。
    expect(h.persisted.at(-1)).toMatchObject({ id, status: 'completed', finishedAt: expect.any(Number) });
    expect(h.persisted.length).toBeGreaterThanOrEqual(4);
    // feed 通知确实在推（面板实时读数的驱动面）。
    expect(h.notifications).toBeGreaterThanOrEqual(4);
  });

  it('中断链（尾站失败）：整线终态 failed，前站保持 completed', () => {
    const h = makeHarness([characterA, characterB]);
    const id = h.run('断链', '议题', [
      { kind: 'claude-code', promptTemplate: 'a {{task}}' },
      { kind: 'kimi', promptTemplate: 'b {{prev_output}}' },
    ]);
    const first = h.taskOf('ch-1')!;
    h.settle(first.id, 'completed', '一站产出');
    const second = h.taskOf('ch-2')!;
    h.settle(second.id, 'failed', 'agent 未安装');

    const failed = h.feed()!.find((run) => run.id === id)!;
    expect(failed.status).toBe('failed');
    expect(failed.steps.map((step) => step.phase)).toEqual(['completed', 'failed']);
    expect(h.persisted.at(-1)).toMatchObject({ id, status: 'failed' });
  });

  it('中断链（三站）：站 2 failed → 站 3 skipped（断链历史可见）', () => {
    const h = makeHarness([characterA, characterB, characterC]);
    const id = h.run('三站', '议题', [
      { kind: 'claude-code', promptTemplate: 'a {{task}}' },
      { kind: 'kimi', promptTemplate: 'b {{prev_output}}' },
      { kind: 'openclaw', promptTemplate: 'c {{prev_output}}' },
    ]);
    const first = h.taskOf('ch-1')!;
    h.settle(first.id, 'completed', '一');
    const second = h.taskOf('ch-2')!;
    h.settle(second.id, 'failed', '炸了');

    const failed = h.feed()!.find((run) => run.id === id)!;
    expect(failed.status).toBe('failed');
    expect(failed.steps.map((step) => step.phase)).toEqual(['completed', 'failed', 'skipped']);
  });

  it('角色缺失跳站：kind 无在档角色 → 该站 skipped、线继续走完 → 终态 completed；跳过站不更新 prev_output', () => {
    const h = makeHarness([characterA]); // 没有任何 kimi / openclaw 角色
    const id = h.run('缺人', '议题', [
      { kind: 'claude-code', promptTemplate: 'a {{task}}' },
      { kind: 'kimi', promptTemplate: 'b {{prev_output}}' },
      { kind: 'claude-code', promptTemplate: 'c {{prev_output}}' },
    ]);
    // 站 1 正常派发；站 2 无 kimi → 跳过。
    const first = h.taskOf('ch-1')!;
    expect(first.prompt).toBe('a 议题');
    h.settle(first.id, 'completed', '一');
    // 站 3 也是 ch-1（新任务），prev_output 仍取站 1 的输出（跳过站不更新它）。
    const thirdTask = h.taskOf('ch-1')!;
    expect(thirdTask.prompt.startsWith('c ')).toBe(true);
    expect(thirdTask.prompt).toContain('一');
    h.settle(thirdTask.id, 'completed', '三');

    const done = h.feed()!.find((run) => run.id === id)!;
    expect(done.status).toBe('completed');
    expect(done.steps.map((step) => step.phase)).toEqual(['completed', 'skipped', 'completed']);
    // 全跳过的 degenerate 线也走 completed（缺人不缺流程，终态判定不数 skipped）。
    const allSkipId = h.run('全跳', '议题', [{ kind: 'kimi', promptTemplate: 'x' }]);
    expect(h.feed()!.find((run) => run.id === allSkipId)!.status).toBe('completed');
  });

  it('显式 characterId 不在档也跳站（点名错了 ≠ 断链）', () => {
    const h = makeHarness([characterA]);
    const id = h.run('点名错', '议题', [
      { characterId: 'ghost', promptTemplate: 'x' },
      { kind: 'claude-code', promptTemplate: 'a {{task}}' },
    ]);
    const task = h.taskOf('ch-1')!;
    h.settle(task.id, 'completed', 'done');
    const run = h.feed()!.find((entry) => entry.id === id)!;
    expect(run.status).toBe('completed');
    expect(run.steps.map((step) => step.phase)).toEqual(['skipped', 'completed']);
  });

  it('取消断链：站任务排队时被 cancel → 整线 failed（取消无 settle 回流，走总线同步处理）', () => {
    const h = makeHarness([characterA]);
    const id = h.run('被取消', '议题', [{ kind: 'claude-code', promptTemplate: 'a {{task}}' }]);
    const first = h.taskOf('ch-1')!;
    expect(first.status).toBe('queued');
    h.emit({ type: 'task.cancelled', task: taskSnapshot(first.id, first.prompt, 'cancelled') });
    const failed = h.feed()!.find((run) => run.id === id)!;
    expect(failed.status).toBe('failed');
    expect(failed.steps[0].phase).toBe('failed');
  });

  it('兜底路：总线 task.completed 后微任务结算（组合根没接主路也能走站，prev=摘要）', async () => {
    const h = makeHarness([characterA, characterB]);
    h.run('兜底', '议题', [
      { kind: 'claude-code', promptTemplate: 'a {{task}}' },
      { kind: 'kimi', promptTemplate: 'b {{prev_output}}' },
    ]);
    const first = h.taskOf('ch-1')!;
    // 不走 h.settle（主路）—— 直接总线事件，模拟组合根没接 onTaskSettled 的降级。
    h.emit({ type: 'task.completed', task: taskSnapshot(first.id, first.prompt, 'completed', '摘要输出') });
    await Promise.resolve();
    await Promise.resolve();
    const second = h.taskOf('ch-2');
    expect(second).not.toBeNull();
    expect(second!.prompt).toContain('摘要输出');
  });

  it('两路竞速幂等：主路 settle 全文先到，总线兜底微任务不重推进（第二站只拿全文）', async () => {
    const h = makeHarness([characterA, characterB]);
    h.run('竞速', '议题', [
      { kind: 'claude-code', promptTemplate: 'a {{task}}' },
      { kind: 'kimi', promptTemplate: 'b {{prev_output}}' },
    ]);
    const first = h.taskOf('ch-1')!;
    // 主路（同步，全文）先到 …
    h.settle(first.id, 'completed', '全文输出');
    // … 总线兜底（微任务，摘要）后到 —— 幂等闸：不重结算（第二站已带全文，不被摘要覆盖）。
    h.emit({ type: 'task.completed', task: taskSnapshot(first.id, first.prompt, 'completed', '摘要') });
    await Promise.resolve();
    await Promise.resolve();
    const second = h.taskOf('ch-2')!;
    expect(second!.prompt).toContain('全文输出');
  });

  it('入队指定目标：站任务落点名角色的队列（targetCharacterId 直达，非 kind 解析顺位）', () => {
    const h = makeHarness([characterA, characterB]);
    h.run('点名', '议题', [{ characterId: 'ch-2', promptTemplate: 'x {{task}}' }]);
    expect(h.taskOf('ch-2')).not.toBeNull();
    expect(h.taskOf('ch-1')).toBeNull();
  });

  it('坏规格：空 steps / 空议题也返回 id 并落一条 failed 线（看得见，不静默丢）', () => {
    const h = makeHarness([characterA]);
    const id = h.run('空线', '   ', []);
    expect(id).toBeTruthy();
    const failed = h.feed()!.find((run) => run.id === id)!;
    expect(failed.status).toBe('failed');
    expect(h.persisted.at(-1)).toMatchObject({ id, status: 'failed' });
  });

  it('feed 快照：没有线时为 null；线的步骤 JSON 落库含站序相位', () => {
    const h = makeHarness([characterA]);
    expect(h.feed()).toBeNull();
    const id = h.run('落库', '议题', [{ kind: 'claude-code', promptTemplate: 'a {{task}}' }]);
    const running = [...h.persisted].reverse().find((record) => record.id === id && record.status === 'running');
    expect(running).toBeTruthy();
    const steps = JSON.parse(running!.steps) as Array<{ phase: string; prompt: string }>;
    expect(steps).toHaveLength(1);
    expect(steps[0].phase).toBe('queued');
    expect(steps[0].prompt).toBe('a 议题');
  });
});
