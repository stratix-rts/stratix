/**
 * 集成测试：**v3.4 功能对照表 —— 世界侧 7 项逐项断言**（task_095）。
 *
 * 依据：docs/hud-redesign-proposal.html §4「功能对照表（40/40，零删减）」。
 * 本文件覆盖世界层（Phaser 侧）7 项：
 *   F1 单位气泡 · G1 导演镜头三优先级 · G3 静默 8s 巡视 · G4 回放气泡减半 ·
 *   G5 框选/指令/翻卡/插旗/集火 · G6 单位动画八态 · G7 氛围彩蛋。
 * 另 33 项在别处（40 项一张表能逐条数清）：
 *   HUD 侧 32 项 → src/hud/__tests__/v34-feature-matrix.test.ts
 *   组合根 1 项（G8 主入口按钮组）→ src/app/__tests__/v34-main-entry-buttons.test.ts
 *
 * ============ 为什么在模块层断言而不是浏览器 ============
 *   世界层的这些功能**画在 Phaser 画布上** —— jsdom 没有 canvas 渲染，
 *   像素级的「画没画出来」量不出来。但每项功能的**决策**都在纯模块里
 *   （谁先冒泡、镜头给谁、气泡几拍一次、位次怎么排、八态怎么推导）——
 *   那些是纯函数 / 纯类，可以逐条断言，且比像素断言更早暴露回归。
 *   画布那一层由 e2e 演示剧本（e2e-tests/demo-flow.e2e.mjs）兜底。
 *
 * @jest-environment node
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  AMBIENCE_METRICS,
  DIRECTOR_METRICS,
  INTERACTION_FX_METRICS,
  REPLAY_METRICS,
  UNIT_ANIMATION_METRICS,
} from '../theme';
import {
  type CameraPose,
  type Viewport,
} from '../camera';
import { DirectorController, type DirectorHost } from '../camera/director';
import {
  DIRECTOR_EVENT_PRIORITY,
  isSilentSince,
  patrolPose,
} from '../camera/director-policy';
import { SPEECH_BUBBLE_SPEC } from '../speech-spec';
import { SpeechBubbleBoard, bubbleAnimationAt } from '../objects/speech-bubble';
import {
  INTERACTION_BUBBLE_TEXT,
  cardFlipShowsFront,
  flagPoleProgress,
  flowFadeAlpha,
  footPulseAlpha,
  footPulseRadius,
  selectionWaveSchedule,
} from '../objects/task-fx';
import {
  UNIT_ANIMATION_STATES,
  UnitAnimationController,
  type UnitAnimationContext,
  type UnitAnimationState,
} from '../appearance/unit-animation';
import {
  cloudSpawn,
  isWarmHour,
  nextCloudDelayMs,
} from '../objects/ambience-layout';

const BOUNDS = { x: 0, y: 0, width: 3200, height: 2400 };
const VIEWPORT: Viewport = { width: 1600, height: 900 };

/** 导演宿主的测试替身：记录镜头动作，并提供可推进的假时钟。 */
class FakeHost implements DirectorHost {
  readonly bounds = BOUNDS;
  nowMs = 0;
  readonly tweens: { pose: CameraPose; durationMs: number }[] = [];
  readonly placed: CameraPose[] = [];
  readonly timers: { at: number; fn: () => void }[] = [];

  readonly viewport = (): Viewport => VIEWPORT;
  readonly now = (): number => this.nowMs;

  tweenTo(pose: CameraPose, durationMs: number): void {
    this.tweens.push({ pose, durationMs });
  }

  place(pose: CameraPose): void {
    this.placed.push(pose);
  }

  schedule(ms: number, fn: () => void): () => void {
    const timer = { at: this.nowMs + ms, fn };
    this.timers.push(timer);
    return () => {
      const index = this.timers.indexOf(timer);
      if (index >= 0) this.timers.splice(index, 1);
    };
  }

  cancelTween(): void {
    /* 无补间的替身不做事 */
  }

  onManualRelease(): void {
    /* 手动让位由 director 自己记账 */
  }

  /** 推进时钟，并执行到点的延时回调。 */
  advance(ms: number): void {
    this.nowMs += ms;
    for (const timer of this.timers.filter((t) => t.at <= this.nowMs)) {
      const index = this.timers.indexOf(timer);
      if (index >= 0) this.timers.splice(index, 1);
      timer.fn();
    }
  }
}

function setupDirector(): { host: FakeHost; director: DirectorController } {
  const host = new FakeHost();
  const director = new DirectorController(host);
  return { host, director };
}

// ============================================================================
// F1 单位气泡说话
// ============================================================================

describe('§4 F1 · 单位气泡（世界层，规格不变）', () => {
  test('F1 单位气泡：同屏 ≤3、同单位 5s 冷却、寿命 4s —— 一条不减', () => {
    expect(SPEECH_BUBBLE_SPEC.maxOnScreen).toBe(3);
    expect(SPEECH_BUBBLE_SPEC.unitCooldownMs).toBe(5000);
    expect(SPEECH_BUBBLE_SPEC.lifeMs).toBe(4000);

    const board = new SpeechBubbleBoard({ random: () => 0.9 });
    expect(board.maxOnScreen).toBe(3);
    expect(board.cooldownMs).toBe(5000);

    // 同屏 3 个：第 4 个排队（不挤掉在屏的）。
    expect(board.request('u1', 'start', 0)).toBe('shown');
    expect(board.request('u2', 'complete', 0)).toBe('shown');
    expect(board.request('u3', 'error', 0)).toBe('shown');
    expect(board.request('u4', 'assigned', 0)).toBe('queued');
    expect(board.count()).toBe(3);
    expect(board.pendingCount()).toBe(1);

    // 同单位 5s 内不重复冒泡。
    expect(board.request('u1', 'complete', 1000)).toBe('cooldown');
    expect(board.request('u1', 'error', 4999)).toBe('cooldown');
    expect(board.count()).toBe(3);

    // 气泡动画：入场 Back.Out、退场 Cubic.In（相位曲线取自唯一事实源）。
    const entering = bubbleAnimationAt('entering', 0);
    const enteringEnd = bubbleAnimationAt('entering', SPEECH_BUBBLE_SPEC.enterDurationMs);
    expect(entering.scale).toBeLessThan(enteringEnd.scale);
    expect(enteringEnd.scale).toBeCloseTo(1, 5);
    const exiting = bubbleAnimationAt('exiting', SPEECH_BUBBLE_SPEC.exitDurationMs);
    expect(exiting.alpha).toBeCloseTo(0, 5);
    expect(exiting.riseY).toBeCloseTo(-SPEECH_BUBBLE_SPEC.exitRisePx, 5);
  });
});

// ============================================================================
// G1 导演镜头三优先级
// ============================================================================

describe('§4 G1 · 导演镜头三优先级（报错 > 完成 > 开工）', () => {
  test('G1 导演镜头三优先级：低优先级不抢镜头，高优先级立即接管', () => {
    // 优先级词表：报错 > 完成 > 开工。
    expect(DIRECTOR_EVENT_PRIORITY.failed).toBeGreaterThan(DIRECTOR_EVENT_PRIORITY.completed);
    expect(DIRECTOR_EVENT_PRIORITY.completed).toBeGreaterThan(DIRECTOR_EVENT_PRIORITY.started);

    const { host, director } = setupDirector();
    director.setEnabled(true);

    // 正在看「完成」时来了「开工」—— 不抢镜头。
    expect(director.receive('completed', { x: 100, y: 100 })).toBe(true);
    expect(host.tweens).toHaveLength(1);
    expect(director.receive('started', { x: 900, y: 900 })).toBe(false);
    expect(director.currentFocus?.kind).toBe('completed');

    // 来了「报错」—— 立即接管镜头。
    expect(director.receive('failed', { x: 900, y: 900 })).toBe(true);
    expect(host.tweens[1].pose.center).toEqual({ x: 900, y: 900 });
    expect(director.currentFocus?.kind).toBe('failed');

    // 取景口径取自唯一事实源：600ms 缓动 + 1.2x 聚焦 + 停留 3s。
    expect(host.tweens[0].durationMs).toBe(DIRECTOR_METRICS.moveDurationMs);
    expect(DIRECTOR_METRICS.moveDurationMs).toBe(600);
    expect(DIRECTOR_METRICS.focusZoom).toBe(1.2);
    expect(DIRECTOR_METRICS.holdMs).toBe(3000);
  });
});

// ============================================================================
// G3 静默 8s 巡视
// ============================================================================

describe('§4 G3 · 静默 8s 后缓慢巡视', () => {
  test('G3 静默 8s 巡视：静默判定严格 >8s，过了才进巡视相位', () => {
    expect(DIRECTOR_METRICS.silenceMs).toBe(8000);
    expect(isSilentSince(0, DIRECTOR_METRICS.silenceMs)).toBe(false);
    expect(isSilentSince(0, DIRECTOR_METRICS.silenceMs + 1)).toBe(true);
    expect(isSilentSince(null, 100_000)).toBe(false);

    const { host, director } = setupDirector();
    director.setEnabled(true);
    host.advance(DIRECTOR_METRICS.silenceMs);
    director.update();
    expect(host.placed).toHaveLength(0); // 满 8s 那一刻还不算静默

    host.advance(1);
    director.update();
    expect(host.placed.length).toBeGreaterThan(0);
    expect(director.currentPhase).toBe('patrol');
    expect(host.placed[0].zoom).toBe(DIRECTOR_METRICS.patrolZoom);

    // 巡视轨迹：慢速横向往返 + 纵向轻摆，相机中心不出世界边界。
    const pose = patrolPose(BOUNDS, VIEWPORT, DIRECTOR_METRICS.patrolZoom, 1000);
    expect(pose.center.x).toBeGreaterThanOrEqual(BOUNDS.x);
    expect(pose.center.x).toBeLessThanOrEqual(BOUNDS.x + BOUNDS.width);
  });
});

// ============================================================================
// G4 回放气泡减半
// ============================================================================

describe('§4 G4 · 回放气泡节流减半', () => {
  test('G4 回放气泡减半：节流常量是 2（每 2 拍才冒一次），节流闸门在场景里生效', () => {
    // 节流倍数取自唯一事实源（§4 G4「回放气泡减半」= 2）。
    expect(REPLAY_METRICS.bubbleEveryN).toBe(2);

    // 节流闸门住在场景里（Phaser 层，node 里起不来）——
    // 故用「读源码 + 断言闸门在」把它钉住：闸门被删 / 被改成不取常量，这里当场红。
    const scenePath = path.join(__dirname, '..', 'scenes', 'BattlefieldScene.ts');
    const scene = fs.readFileSync(scenePath, 'utf-8');
    expect(scene).toContain('this.replayBubbleTick % REPLAY_METRICS.bubbleEveryN !== 0');

    // 半频语义 = 每 N 拍放行一次（N=2 → 奇数拍冒泡，偶数拍静默）。
    let tick = 0;
    const bubbled: number[] = [];
    for (let beat = 1; beat <= 6; beat += 1) {
      tick += 1;
      if (tick % REPLAY_METRICS.bubbleEveryN !== 0) continue;
      bubbled.push(beat);
    }
    expect(bubbled).toEqual([2, 4, 6]);
  });
});

// ============================================================================
// G5 框选 / 指令 / 翻卡 / 插旗 / 集火
// ============================================================================

describe('§4 G5 · 框选 / 指令 / 翻卡 / 插旗 / 集火特效', () => {
  test('G5 交互特效：波浪 40ms 一个、指令流 800ms 淡出、翻卡 / 插旗 / 集火参数齐全', () => {
    // 框选：命中单位按 40ms 一个依次起拍。
    expect(INTERACTION_FX_METRICS.selectionWave.intervalMs).toBe(40);
    expect(selectionWaveSchedule(['u1', 'u2', 'u3'])).toEqual([
      { unitId: 'u1', delayMs: 0 },
      { unitId: 'u2', delayMs: 40 },
      { unitId: 'u3', delayMs: 80 },
    ]);

    // 指令：流动虚线 800ms 后淡出（fadeRatio = 淡出段 / 全程）。
    expect(INTERACTION_FX_METRICS.command.flowDurationMs).toBe(800);
    const fadeRatio =
      INTERACTION_FX_METRICS.command.flowFadeMs / INTERACTION_FX_METRICS.command.flowDurationMs;
    expect(flowFadeAlpha(0, fadeRatio)).toBe(1);
    expect(flowFadeAlpha(0.5, fadeRatio)).toBe(1);
    expect(flowFadeAlpha(1, fadeRatio)).toBe(0);

    // 翻卡：420ms 翻完，过半就露出正面。
    expect(INTERACTION_FX_METRICS.cardFlip.durationMs).toBe(420);
    expect(INTERACTION_FX_METRICS.cardFlip.holdMs).toBe(900);
    expect(cardFlipShowsFront(0.49)).toBe(false);
    expect(cardFlipShowsFront(0.5)).toBe(true);

    // 插旗：旗杆 500ms 升起（1-(1-x)^3），旗面 Back.Out。
    expect(INTERACTION_FX_METRICS.flag.poleDurationMs).toBe(500);
    expect(flagPoleProgress(0)).toBe(0);
    expect(flagPoleProgress(1)).toBeCloseTo(1, 5);
    expect(flagPoleProgress(0.5)).toBeGreaterThan(0.8);

    // 集火：脚下脉冲环 8 → 30px，320ms，透明度线性收。
    expect(INTERACTION_FX_METRICS.focusFire.pulseDurationMs).toBe(320);
    expect(footPulseRadius(0, 8, 30)).toBe(8);
    expect(footPulseRadius(1, 8, 30)).toBe(30);
    expect(footPulseAlpha(0)).toBe(1);
    expect(footPulseAlpha(1)).toBe(0);

    // 集火 / 指令的文案（战场气泡）。
    expect(INTERACTION_BUBBLE_TEXT.command).toBe('收到');
    expect(INTERACTION_BUBBLE_TEXT.focus).toBe('来了来了');
  });
});

// ============================================================================
// G6 单位动画八态
// ============================================================================

describe('§4 G6 · 单位动画八态', () => {
  const ctx = (): UnitAnimationContext => ({
    status: 'idle',
    online: true,
    hasMission: true,
    selected: false,
    hovered: false,
  });

  test('G6 单位动画八态：八态齐全，每一态都能算出位姿（不抛错）', () => {
    expect(UNIT_ANIMATION_STATES).toHaveLength(8);
    expect(UNIT_ANIMATION_STATES).toEqual([
      'idle',
      'working',
      'stuck',
      'completed',
      'slacking',
      'selected',
      'hover',
      'clicked',
    ]);

    for (const state of UNIT_ANIMATION_STATES as readonly UnitAnimationState[]) {
      const anim = new UnitAnimationController('u-1');
      anim.setForcedState(state, 0);
      expect(() => anim.pose(ctx(), 1000)).not.toThrow();
    }
  });

  test('G6 单位动画八态：完成三拍（压扁 → 跳 20px → 落地星尘）', () => {
    const M = UNIT_ANIMATION_METRICS.completed;
    const anim = new UnitAnimationController('u-1');
    anim.triggerCompleted(0);

    const at = (t: number) => anim.pose(ctx(), t);
    expect(at(M.squashMs * 0.9).scaleY).toBeLessThan(0.95);
    const peak = at(M.squashMs + M.jumpMs / 2);
    expect(peak.jumpOffsetY).toBeCloseTo(-M.jumpHeightPx, 0);
    expect(M.jumpHeightPx).toBe(20);
    const land = M.squashMs + M.jumpMs;
    expect(at(land + 10).dustProgress).not.toBeNull();
  });
});

// ============================================================================
// G7 氛围彩蛋
// ============================================================================

describe('§4 G7 · 氛围彩蛋（漂云 / 入夜暖格）', () => {
  test('G7 氛围彩蛋：漂云 30–60s 一朵、慢速飘过、入夜暖格 19 点起', () => {
    // 漂云间隔：30–60s（随机源取两端即两端值）。
    expect(AMBIENCE_METRICS.cloudIntervalMs).toEqual({ min: 30_000, max: 60_000 });
    expect(nextCloudDelayMs(() => 0)).toBe(30_000);
    expect(nextCloudDelayMs(() => 1)).toBe(60_000);

    // 行程时长 = 距离 / 速度（慢速飘过，不是一闪而过）。
    const plan = cloudSpawn(BOUNDS, AMBIENCE_METRICS.cloudSizePx.width, AMBIENCE_METRICS.cloudSpeedPxPerSec, () => 0.2);
    const distance = Math.abs(plan.endX - plan.startX);
    expect(plan.travelMs).toBeCloseTo((distance / AMBIENCE_METRICS.cloudSpeedPxPerSec) * 1000, 6);
    expect(plan.travelMs).toBeGreaterThan(30_000);

    // 入夜暖格：18 点不入夜、19 点起入夜、23 点仍在夜里、0 点不算（跨天不在本段内）。
    expect(AMBIENCE_METRICS.warmHours).toEqual({ start: 19, end: 24 });
    expect(isWarmHour(18)).toBe(false);
    expect(isWarmHour(19)).toBe(true);
    expect(isWarmHour(23)).toBe(true);
    expect(isWarmHour(0)).toBe(false);
  });
});
