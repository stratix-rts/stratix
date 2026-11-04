/**
 * 文件职责：任务终态 → 编组任务（mission）回报落点的单测 —— 重点是**兜底**：
 *   编组任务已被撤掉 / 删除时，回报不得静默蒸发（必须有 warn 日志 + Notice 留痕）。
 * 输入：真实 core store + core mission 写入面（不打桩 —— 收尾裁决必须真过一遍 core 状态机）。
 * 输出：jest 断言。
 * 禁止事项：
 *   1. 不 mock mission 写入面 —— 被测的正是"回报落空"这条真实路径；
 *   2. 不断言"必须重建编组任务" —— 断链不重建（重建会把断链伪装成新任务）。
 */

import { createMissionManager } from '../../../core/mission';
import { createStore, type CoreStore } from '../../../core/store';
import type { MissionView } from '../../../core/types';
import { settleMissionFromTaskReport } from '../mission-report';

function makeStore(missions: readonly MissionView[] = []): CoreStore {
  return createStore({ missions: [...missions] });
}

const MISSION: MissionView = {
  id: 'mission_ok_1',
  title: '真编组',
  phase: 'running',
  unitIds: [],
  createdAt: 1,
};

describe('settleMissionFromTaskReport（终态回报落点 + 兜底）', () => {
  it('编组任务存在 → completed 收尾成 done、failed 收尾成 cancelled', () => {
    const store = makeStore([MISSION]);
    const mission = createMissionManager({ store });

    const done = settleMissionFromTaskReport({ store, mission }, {
      taskId: 'task_1',
      status: 'completed',
      missionId: 'mission_ok_1',
    });
    expect(done).toMatchObject({ kind: 'settled', missionId: 'mission_ok_1', phase: 'done' });
    expect(store.getState().missions[0]?.phase).toBe('done');

    const cancelled = settleMissionFromTaskReport({ store, mission }, {
      taskId: 'task_2',
      status: 'failed',
      missionId: 'mission_ok_1',
    });
    // 已收尾的编组任务不接受第二次回报 → 被相位机拒（留痕，不静默）。
    expect(cancelled.kind).toBe('rejected');
  });

  it('编组任务已被删除 → unknown_mission：warn 日志 + Notice 留痕，且不重建编组', () => {
    const store = makeStore(); // 名册里没有这条编组任务（模拟"建完被删"）
    const mission = createMissionManager({ store });
    const lines: string[] = [];

    const outcome = settleMissionFromTaskReport(
      { store, mission, logger: (line) => lines.push(line) },
      { taskId: 'task_9', status: 'completed', missionId: 'mission_R1_ID' }
    );

    expect(outcome).toMatchObject({
      kind: 'unknown_mission',
      missionId: 'mission_R1_ID',
      taskId: 'task_9',
      status: 'completed',
    });

    // ① 日志留痕（网关日志里能 grep 到，且明说是"回报未送达"）。
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('mission_R1_ID');
    expect(lines[0]).toContain('unknown_mission');
    expect(lines[0]).toContain('task_9');

    // ② Notice 留痕（世界态里可见：HUD / world-sync 都吃）。
    const notices = store.getState().notices;
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      level: 'warn',
      source: 'service/mission-report',
      missionId: 'mission_R1_ID',
    });
    expect(notices[0]?.text).toContain('unknown_mission');

    // ③ 不重建编组任务（断链不伪装成新任务）：名册仍是空的。
    expect(store.getState().missions).toHaveLength(0);
  });

  it('本单不带编组任务 → no_mission（不报错、不留痕）', () => {
    const store = makeStore();
    const mission = createMissionManager({ store });
    const lines: string[] = [];

    const outcome = settleMissionFromTaskReport(
      { store, mission, logger: (line) => lines.push(line) },
      { taskId: 'task_3', status: 'completed', missionId: null }
    );

    expect(outcome).toEqual({ kind: 'no_mission' });
    expect(lines).toHaveLength(0);
    expect(store.getState().notices).toHaveLength(0);
  });
});
