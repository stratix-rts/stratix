/**
 * 文件职责：**任务生命周期 → 单位动画**的单测（task_141）——
 *   固化两条链：
 *   ① 相位板（appearance/task-animation.ts）：落板 / 过期 / 清理；
 *   ② 基态派生（appearance/unit-animation.ts 的 resolveBase）：任务相位 → 八态基态。
 * 输入：两个零 Phaser 的纯逻辑模块（node 环境直接跑）。
 * 输出：断言结果。
 * 禁止事项：
 *   1. import phaser —— 被测模块刻意零渲染依赖，这条断言本身就是纪律的一部分；
 *   2. 断言实现细节 —— 断言**状态映射**与不变量（相位、基态、互不干扰）。
 */

import { UNIT_ANIMATION_METRICS } from '../../../core/theme/visual-spec';
import {
  UnitAnimationController,
  type UnitAnimationContext,
  type UnitTaskPhase,
} from '../unit-animation';
import { TASK_ANIMATION_METRICS, TaskPhaseBoard } from '../task-animation';

/** 造一个业务态上下文（默认：在线、带着任务、没被选中也没被 hover）。 */
function ctx(patch: Partial<UnitAnimationContext> = {}): UnitAnimationContext {
  return {
    status: 'idle',
    online: true,
    hasMission: true,
    selected: false,
    hovered: false,
    ...patch,
  };
}

/** 造一个控制器。 */
function controller(unitId = 'unit_a'): UnitAnimationController {
  return new UnitAnimationController(unitId);
}

// ============================================================================
// 相位板
// ============================================================================

describe('任务相位板（TaskPhaseBoard）', () => {
  it('空板上的单位 = none', () => {
    const board = new TaskPhaseBoard();
    expect(board.phaseFor('u1', 0)).toBe('none');
  });

  it('开工 → running；失败 → failed（驻留，不自动过期）', () => {
    const board = new TaskPhaseBoard();
    board.setRunning('u1', 0);
    expect(board.phaseFor('u1', 0)).toBe('running');
    board.setFailed('u1', 100);
    expect(board.phaseFor('u1', 100)).toBe('failed');
    // 失败是驻留语义：很久之后仍在（❗ 一直挂着，直到下一条任务事件覆盖它）。
    expect(board.phaseFor('u1', 100_000)).toBe('failed');
  });

  it('完成 → completed，演完（TTL 到）自动回 none', () => {
    const board = new TaskPhaseBoard();
    board.setCompleted('u1', 0);
    expect(board.phaseFor('u1', 0)).toBe('completed');
    expect(board.phaseFor('u1', TASK_ANIMATION_METRICS.completedTtlMs - 1)).toBe('completed');
    // TTL 与庆祝演出的时长同源（压缩 + 起跳 + 星尘）。
    expect(TASK_ANIMATION_METRICS.completedTtlMs).toBe(
      UNIT_ANIMATION_METRICS.completed.squashMs +
        UNIT_ANIMATION_METRICS.completed.jumpMs +
        UNIT_ANIMATION_METRICS.completed.dustMs
    );
    expect(board.phaseFor('u1', TASK_ANIMATION_METRICS.completedTtlMs)).toBe('none');
  });

  it('clear → 撤相位（挂起不算忙）', () => {
    const board = new TaskPhaseBoard();
    board.setRunning('u1', 0);
    expect(board.clear('u1')).toBe(true);
    expect(board.phaseFor('u1', 10)).toBe('none');
  });

  it('两个单位互不干扰（一有一无）', () => {
    const board = new TaskPhaseBoard();
    board.setRunning('u_busy', 0);
    expect(board.phaseFor('u_busy', 0)).toBe('running');
    expect(board.phaseFor('u_idle', 0)).toBe('none');
    board.setFailed('u_busy', 10);
    expect(board.phaseFor('u_busy', 10)).toBe('failed');
    expect(board.phaseFor('u_idle', 10)).toBe('none');
  });

  it('相位数量有界（清干净后为 0）', () => {
    const board = new TaskPhaseBoard();
    board.setRunning('u1', 0);
    board.setRunning('u2', 0);
    expect(board.size).toBe(2);
    board.clearAll();
    expect(board.size).toBe(0);
  });
});

// ============================================================================
// 状态映射（任务相位 → 动画基态）
// ============================================================================

describe('任务生命周期 → 动画基态（状态映射）', () => {
  it('running → 工作态（前倾 + 微颤 + 头顶进度弧）', () => {
    const pose = controller().pose(ctx({ taskPhase: 'running' }), 0);
    expect(pose.base).toBe('working');
    expect(pose.progressArc).not.toBeNull();
    expect(pose.leanDeg).toBeGreaterThan(0);
  });

  it('completed → 待机基态（收工站直）+ 庆祝演出是正交瞬态', () => {
    const anim = controller();
    anim.triggerCompleted(0);
    // 200ms 落在起跳拍（压缩 150ms → 起跳 450ms）里。
    const pose = anim.pose(ctx({ taskPhase: 'completed' }), 200);
    expect(pose.base).toBe('idle');
    // 庆祝瞬态与基态正交：跳跃位移照样有。
    expect(pose.jumpOffsetY).toBeLessThan(0);
  });

  it('failed → 卡住态（灰度 + ❗ + 抖动）', () => {
    const pose = controller().pose(ctx({ taskPhase: 'failed' }), 100);
    expect(pose.base).toBe('stuck');
    expect(pose.grayscale).toBeGreaterThan(0);
    expect(pose.alertOffsetY).not.toBeNull();
  });

  it('none → 沿用 075 的老派生（无任务空闲 = 摸鱼态）', () => {
    const pose = controller().pose(ctx({ status: 'idle', hasMission: false, taskPhase: 'none' }), 0);
    expect(pose.base).toBe('slacking');
  });

  it('缺省 taskPhase（老调用方）→ 行为不变', () => {
    expect(controller().pose(ctx({ status: 'busy' }), 0).base).toBe('working');
    expect(controller().pose(ctx({ status: 'error' }), 0).base).toBe('stuck');
    expect(controller().pose(ctx({ hasMission: false }), 0).base).toBe('slacking');
  });

  it('离线盖过任务相位（生命感全停）', () => {
    const pose = controller().pose(ctx({ status: 'offline', online: false, taskPhase: 'failed' }), 0);
    expect(pose.base).toBe('idle');
    expect(pose.bobOffsetY).toBe(0);
  });

  it('任务在跑时 status 仍是 idle 也判工作态（相位是事件流的真相）', () => {
    expect(controller().pose(ctx({ status: 'idle', taskPhase: 'running' }), 0).base).toBe('working');
  });

  it('有别的任务在跑时，刚完成的任务不把单位拉回待机', () => {
    // status=busy（另一单还在跑）+ phase=completed（这单刚收工）→ 仍是工作态。
    const pose = controller().pose(ctx({ status: 'busy', taskPhase: 'completed' }), 0);
    expect(pose.base).toBe('working');
  });
});

// ============================================================================
// 端到端时间线（板 + 控制器一起演）
// ============================================================================

describe('一条任务的完整时间线', () => {
  it('派单 → 开工（工作）→ 完成（庆祝）→ 回静息', () => {
    const board = new TaskPhaseBoard();
    const anim = controller('unit_timeline');
    // hasMission=false = 无编组任务（普通派发就是这个口径）→ 静息 = 摸鱼态。
    const base = (nowMs: number): string => {
      const phase: UnitTaskPhase = board.phaseFor('unit_timeline', nowMs);
      return anim.pose(ctx({ hasMission: false, taskPhase: phase }), nowMs).base;
    };

    // 还没派单：静息（无任务空闲 = 摸鱼）。
    expect(base(0)).toBe('slacking');
    // 派单（queued）不进战场相位 —— 还没轮到它动。
    expect(base(100)).toBe('slacking');
    // 开工 → 工作态。
    board.setRunning('unit_timeline', 200);
    expect(base(200)).toBe('working');
    // 完成 → 收工站直 + 庆祝。
    board.setCompleted('unit_timeline', 5000);
    anim.triggerCompleted(5000);
    expect(base(5100)).toBe('idle');
    // 庆祝演完 → 回静息。
    expect(base(5000 + TASK_ANIMATION_METRICS.completedTtlMs)).toBe('slacking');
  });

  it('两个单位一有一无任务时状态互不干扰', () => {
    const board = new TaskPhaseBoard();
    const busy = controller('unit_busy');
    const idle = controller('unit_idle');
    board.setRunning('unit_busy', 0);
    const busyBase = busy.pose(ctx({ taskPhase: board.phaseFor('unit_busy', 0) }), 0).base;
    const idleBase = idle.pose(
      ctx({ hasMission: false, taskPhase: board.phaseFor('unit_idle', 0) }),
      0
    ).base;
    expect(busyBase).toBe('working');
    expect(idleBase).toBe('slacking');
  });
});
