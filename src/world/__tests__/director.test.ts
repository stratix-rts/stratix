/**
 * 单测：导演模式（world/camera/director.ts + director-policy.ts，task_081）。
 * 覆盖验收标准中的「三优先级镜头切换」「静默 8s 后巡视漂移」「手动介入自动退出」：
 *   - 开工 / 完成 / 报错 → 600ms 缓动到事件点、zoom 1.2x、停留 3s 后回全景；
 *   - 优先级：报错 > 完成 > 开工；同级取最新（低优先级事件不抢镜头）；
 *   - 报错附加红色渐晕脉冲；
 *   - 事件静默 > 8s → 缓慢巡视漂移 pan；
 *   - 手动介入 → 导演退出（并撤销在飞的补间），关闭后完全恢复手动。
 *
 * 这些模块刻意零 Phaser 依赖（导演通过 DirectorHost 注入镜头能力），
 * 故在 jest 的 node 环境直接跑。
 */

import {
  type CameraPose,
  type Viewport,
} from '../camera';
import { DirectorController, type DirectorHost } from '../camera/director';
import { DIRECTOR_METRICS } from '../theme';
import {
  DIRECTOR_EVENT_PRIORITY,
  isSilentSince,
  patrolPose,
  resolveFocus,
} from '../camera/director-policy';

const BOUNDS = { x: 0, y: 0, width: 3200, height: 2400 };
const VIEWPORT: Viewport = { width: 1600, height: 900 };

interface ScheduledTimer {
  readonly at: number;
  readonly fn: () => void;
}

/** 导演宿主的测试替身：记录镜头动作，并提供可推进的假时钟。 */
class FakeHost implements DirectorHost {
  readonly bounds = BOUNDS;
  nowMs = 0;
  readonly tweens: { pose: CameraPose; durationMs: number }[] = [];
  readonly placed: CameraPose[] = [];
  readonly timers: ScheduledTimer[] = [];
  pulses = 0;
  releases = 0;
  tweenCancels = 0;

  readonly viewport = (): Viewport => VIEWPORT;
  readonly now = (): number => this.nowMs;

  tweenTo(pose: CameraPose, durationMs: number): void {
    this.tweens.push({ pose, durationMs });
  }

  place(pose: CameraPose): void {
    this.placed.push(pose);
  }

  schedule(ms: number, fn: () => void): () => void {
    const timer: ScheduledTimer = { at: this.nowMs + ms, fn };
    this.timers.push(timer);
    return () => {
      const index = this.timers.indexOf(timer);
      if (index >= 0) this.timers.splice(index, 1);
    };
  }

  cancelTween(): void {
    this.tweenCancels += 1;
  }

  pulseError(): void {
    this.pulses += 1;
  }

  onManualRelease(): void {
    this.releases += 1;
  }

  /** 推进时钟，并执行到点的延时回调（场景时钟的替身）。 */
  advance(ms: number): void {
    this.nowMs += ms;
    const due = this.timers.filter((timer) => timer.at <= this.nowMs);
    for (const timer of due) {
      const index = this.timers.indexOf(timer);
      if (index >= 0) this.timers.splice(index, 1);
      timer.fn();
    }
  }
}

function setup(): { host: FakeHost; director: DirectorController } {
  const host = new FakeHost();
  const director = new DirectorController(host);
  return { host, director };
}

describe('导演模式 · 事件 → 镜头', () => {
  test('开工事件：600ms 缓动到事件点、zoom 1.2x', () => {
    const { host, director } = setup();
    director.setEnabled(true);

    expect(director.receive('started', { x: 800, y: 600 })).toBe(true);
    expect(host.tweens).toHaveLength(1);
    expect(host.tweens[0].pose.center).toEqual({ x: 800, y: 600 });
    expect(host.tweens[0].pose.zoom).toBe(DIRECTOR_METRICS.focusZoom);
    expect(host.tweens[0].durationMs).toBe(600);
  });

  test('报错事件：镜头就位 + 红色渐晕脉冲一次（呼吸 2 次由渐晕层负责）', () => {
    const { host, director } = setup();
    director.setEnabled(true);

    expect(director.receive('failed', { x: 100, y: 200 })).toBe(true);
    expect(host.pulses).toBe(1);
    expect(host.tweens).toHaveLength(1);
  });

  test('开工 / 完成不触发渐晕（只有报错有）', () => {
    const { host, director } = setup();
    director.setEnabled(true);
    director.receive('started', { x: 10, y: 10 });
    director.receive('completed', { x: 20, y: 20 });
    expect(host.pulses).toBe(0);
  });

  test('停留 3s 后回全景（回全景也是一次 600ms 缓动）', () => {
    const { host, director } = setup();
    director.setEnabled(true);
    director.receive('started', { x: 800, y: 600 });
    expect(host.tweens).toHaveLength(1);

    host.advance(DIRECTOR_METRICS.moveDurationMs + DIRECTOR_METRICS.holdMs);
    expect(host.tweens).toHaveLength(2);
    // 回全景：中心落在战场正中，缩放是「整个战场装进视口」的那一档。
    const overview = host.tweens[1].pose;
    expect(overview.center.x).toBeCloseTo(BOUNDS.width / 2, 6);
    expect(overview.center.y).toBeCloseTo(BOUNDS.height / 2, 6);
    expect(overview.zoom).toBeLessThan(1);

    host.advance(DIRECTOR_METRICS.moveDurationMs);
    expect(director.currentPhase).toBe('idle');
    expect(director.currentFocus).toBeNull();
  });
});

describe('导演模式 · 三优先级（报错 > 完成 > 开工；同级取最新）', () => {
  test('优先级表：报错 3 / 完成 2 / 开工 1', () => {
    expect(DIRECTOR_EVENT_PRIORITY.failed).toBeGreaterThan(DIRECTOR_EVENT_PRIORITY.completed);
    expect(DIRECTOR_EVENT_PRIORITY.completed).toBeGreaterThan(DIRECTOR_EVENT_PRIORITY.started);
  });

  test('低优先级事件不抢镜头（正在看完成时来了开工）', () => {
    const { host, director } = setup();
    director.setEnabled(true);
    director.receive('completed', { x: 100, y: 100 });
    expect(host.tweens).toHaveLength(1);

    expect(director.receive('started', { x: 900, y: 900 })).toBe(false);
    expect(host.tweens).toHaveLength(1);
    expect(director.currentFocus?.kind).toBe('completed');
  });

  test('高优先级事件立即接管（正在看完成时来了报错）', () => {
    const { host, director } = setup();
    director.setEnabled(true);
    director.receive('completed', { x: 100, y: 100 });

    expect(director.receive('failed', { x: 900, y: 900 })).toBe(true);
    expect(host.tweens).toHaveLength(2);
    expect(host.tweens[1].pose.center).toEqual({ x: 900, y: 900 });
    expect(host.pulses).toBe(1);
    expect(director.currentFocus?.kind).toBe('failed');
  });

  test('同级取最新（连续两个完成事件跟随后来的那个）', () => {
    const { host, director } = setup();
    director.setEnabled(true);
    director.receive('completed', { x: 100, y: 100 });
    director.receive('completed', { x: 700, y: 500 });

    expect(host.tweens).toHaveLength(2);
    expect(host.tweens[1].pose.center).toEqual({ x: 700, y: 500 });
    expect(director.currentFocus?.target).toEqual({ x: 700, y: 500 });
  });

  test('纯策略 resolveFocus：无焦点时任何等级都能起手；低等级返回 null', () => {
    expect(resolveFocus(null, { kind: 'started', target: { x: 0, y: 0 }, at: 1 })).not.toBeNull();
    const current = resolveFocus(null, { kind: 'failed', target: { x: 0, y: 0 }, at: 1 });
    expect(resolveFocus(current, { kind: 'started', target: { x: 1, y: 1 }, at: 2 })).toBeNull();
  });
});

describe('导演模式 · 静默巡视', () => {
  test('静默超过 8s 后镜头缓慢漂移（巡视）', () => {
    const { host, director } = setup();
    director.setEnabled(true);

    host.advance(DIRECTOR_METRICS.silenceMs);
    director.update();
    expect(host.placed).toHaveLength(0);

    host.advance(1);
    director.update();
    expect(host.placed.length).toBeGreaterThan(0);
    expect(director.currentPhase).toBe('patrol');
    expect(host.placed[0].zoom).toBe(DIRECTOR_METRICS.patrolZoom);
  });

  test('巡视位置始终在战场内（相机不会漂到地图外）', () => {
    const pose = patrolPose(BOUNDS, VIEWPORT, DIRECTOR_METRICS.patrolZoom, 12_345);
    expect(pose.center.x).toBeGreaterThanOrEqual(BOUNDS.x);
    expect(pose.center.x).toBeLessThanOrEqual(BOUNDS.x + BOUNDS.width);
    expect(pose.center.y).toBeGreaterThanOrEqual(BOUNDS.y);
    expect(pose.center.y).toBeLessThanOrEqual(BOUNDS.y + BOUNDS.height);
  });

  test('巡视是「漂移」不是「跳」：相邻两次的位置变化很小', () => {
    const a = patrolPose(BOUNDS, VIEWPORT, DIRECTOR_METRICS.patrolZoom, 1000);
    const b = patrolPose(BOUNDS, VIEWPORT, DIRECTOR_METRICS.patrolZoom, 1100);
    const moved = Math.hypot(b.center.x - a.center.x, b.center.y - a.center.y);
    expect(moved).toBeLessThan(DIRECTOR_METRICS.patrolSpeedPxPerSec * 0.2);
  });

  test('事件到达后静默计时重置（不再巡视）', () => {
    const { host, director } = setup();
    director.setEnabled(true);
    host.advance(DIRECTOR_METRICS.silenceMs + 1);
    director.update();
    expect(host.placed.length).toBeGreaterThan(0);

    const placedBefore = host.placed.length;
    director.receive('started', { x: 400, y: 400 });
    host.advance(100);
    director.update();
    expect(host.placed.length).toBe(placedBefore);
  });

  test('静默判定：超过 8s 才算静默', () => {
    expect(isSilentSince(0, DIRECTOR_METRICS.silenceMs)).toBe(false);
    expect(isSilentSince(0, DIRECTOR_METRICS.silenceMs + 1)).toBe(true);
    expect(isSilentSince(null, 100_000)).toBe(false);
  });
});

describe('导演模式 · 手动优先与关闭', () => {
  test('手动介入：导演退出 + 通知外部 + 撤销在飞的补间', () => {
    const { host, director } = setup();
    director.setEnabled(true);
    director.receive('failed', { x: 100, y: 100 });

    director.releaseByManual();
    expect(director.isEnabled).toBe(false);
    expect(host.releases).toBe(1);
    expect(host.tweenCancels).toBeGreaterThan(0);
  });

  test('手动介入后不再响应事件（完全交还手动）', () => {
    const { host, director } = setup();
    director.setEnabled(true);
    director.releaseByManual();
    const tweensBefore = host.tweens.length;

    expect(director.receive('started', { x: 10, y: 10 })).toBe(false);
    expect(host.tweens).toHaveLength(tweensBefore);
  });

  test('关闭导演：停手、撤补间、之后不再动镜头', () => {
    const { host, director } = setup();
    director.setEnabled(true);
    director.receive('started', { x: 100, y: 100 });

    director.setEnabled(false);
    expect(director.isEnabled).toBe(false);
    expect(director.currentPhase).toBe('off');
    expect(host.tweenCancels).toBeGreaterThan(0);

    const tweensBefore = host.tweens.length;
    expect(director.receive('started', { x: 200, y: 200 })).toBe(false);
    expect(host.tweens).toHaveLength(tweensBefore);
  });

  test('关闭后到了回全景的时点也不会再动镜头', () => {
    const { host, director } = setup();
    director.setEnabled(true);
    director.receive('started', { x: 100, y: 100 });
    director.setEnabled(false);

    host.advance(DIRECTOR_METRICS.moveDurationMs + DIRECTOR_METRICS.holdMs);
    expect(host.tweens).toHaveLength(1);
  });

  test('重复设置同一开关值不做事（事件回环不抖动）', () => {
    const { director } = setup();
    director.setEnabled(true);
    director.setEnabled(true);
    expect(director.isEnabled).toBe(true);
    director.setEnabled(false);
    director.setEnabled(false);
    expect(director.isEnabled).toBe(false);
  });

  test('导演未开启时不响应事件', () => {
    const { host, director } = setup();
    expect(director.receive('failed', { x: 1, y: 1 })).toBe(false);
    expect(host.tweens).toHaveLength(0);
    expect(host.pulses).toBe(0);
  });
});
