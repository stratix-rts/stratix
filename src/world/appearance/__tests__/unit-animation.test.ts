/**
 * 文件职责：**单位动画八态纯逻辑的单测**（task_075）——
 *   逐条固化 DEMO-PLAN §2 的规格：基态派生 / 待机三件套 / 工作态 / 卡住态 /
 *   完成态三拍 / 摸鱼 z 序列 / 选中环 / hover / 点击涟漪 / 相位错开。
 * 输入：appearance/unit-animation.ts（零 Phaser，node 环境直接跑）。
 * 输出：断言结果。
 * 禁止事项：
 *   1. import phaser —— 被测模块刻意零渲染依赖，这条断言本身就是纪律的一部分；
 *   2. 断言「具体像素坐标」之外的实现细节 —— 断言规格量与不变量（区间、顺序、连续性）。
 */

import {
  UNIT_ANIMATION_METRICS,
  VISUAL_METRICS,
} from '../../../core/theme/visual-spec';
import {
  UNIT_ANIMATION_STATES,
  UnitAnimationController,
  type UnitAnimationContext,
  type UnitAnimationState,
} from '../unit-animation';

const M = UNIT_ANIMATION_METRICS;

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

/** 造一个控制器（时间基准 = 首次 pose 的时刻）。 */
function controller(unitId = 'unit_a'): UnitAnimationController {
  return new UnitAnimationController(unitId);
}

// ============================================================================
// 基态派生
// ============================================================================

describe('基态派生（业务态 → 动画基态）', () => {
  it('忙 → 工作态', () => {
    expect(controller().pose(ctx({ status: 'busy' }), 0).base).toBe('working');
  });

  it('报错 → 卡住态', () => {
    expect(controller().pose(ctx({ status: 'error' }), 0).base).toBe('stuck');
  });

  it('空闲且有任务 → 待机态', () => {
    expect(controller().pose(ctx({ status: 'idle', hasMission: true }), 0).base).toBe('idle');
  });

  it('空闲且无任务 → 摸鱼态（规格：摸鱼态 = 无任务空闲）', () => {
    expect(controller().pose(ctx({ status: 'idle', hasMission: false }), 0).base).toBe('slacking');
  });

  it('离线 → 待机基态且生命感全停（bob/眨眼/天线都不动）', () => {
    const pose = controller().pose(ctx({ status: 'offline', online: false }), 1234);
    expect(pose.base).toBe('idle');
    expect(pose.bobOffsetY).toBe(0);
    expect(pose.eyeClose).toBe(0);
    expect(pose.antennaDeg).toBe(0);
  });
});

// ============================================================================
// 待机三件套
// ============================================================================

describe('待机三件套', () => {
  it('悬浮 bob：位移恒在 ±4px 内，且确实在动', () => {
    const anim = controller();
    let min = Infinity;
    let max = -Infinity;
    let moved = false;
    for (let t = 0; t <= 2000; t += 20) {
      const value = anim.pose(ctx(), t).bobOffsetY;
      min = Math.min(min, value);
      max = Math.max(max, value);
      if (Math.abs(value) > 0.01) moved = true;
    }
    expect(min).toBeGreaterThanOrEqual(-M.bob.amplitudePx - 0.001);
    expect(max).toBeLessThanOrEqual(M.bob.amplitudePx + 0.001);
    expect(max - min).toBeGreaterThan(M.bob.amplitudePx * 1.5); // 真的走满了一个正弦
    expect(moved).toBe(true);
  });

  it('bob 周期 = 2s（同相位两拍位移相同）', () => {
    const anim = controller();
    const a = anim.pose(ctx(), 300).bobOffsetY;
    const b = anim.pose(ctx(), 300 + M.bob.periodMs).bobOffsetY;
    expect(a).toBeCloseTo(b, 6);
  });

  it('天线摆动恒在 ±5° 内', () => {
    const anim = controller();
    for (let t = 0; t <= 4000; t += 25) {
      expect(Math.abs(anim.pose(ctx(), t).antennaDeg)).toBeLessThanOrEqual(M.antenna.amplitudeDeg + 1e-9);
    }
  });

  it('眨眼：每 3-6s 一次，闭眼窗口 120ms（眼睛压成横线）', () => {
    const anim = controller();
    const closed: number[] = [];
    let wasClosed = false;
    for (let t = 0; t <= 20000; t += 10) {
      const closedNow = anim.pose(ctx(), t).eyeClose >= 0.99;
      if (closedNow && !wasClosed) closed.push(t);
      wasClosed = closedNow;
    }
    expect(closed.length).toBeGreaterThanOrEqual(3);
    expect(closed.length).toBeLessThanOrEqual(7);
    for (let i = 1; i < closed.length; i += 1) {
      const gap = closed[i] - closed[i - 1];
      // 起点间隔 = 闭眼窗口（120ms）+ 随机间隔（3-6s）
      expect(gap).toBeGreaterThanOrEqual(M.blink.closedMs + M.blink.minIntervalMs - 1);
      expect(gap).toBeLessThanOrEqual(M.blink.closedMs + M.blink.maxIntervalMs + 1);
    }
  });

  it('眨眼期间 eyeClose 达到 1（完全闭眼），其余时刻为 0', () => {
    const anim = controller();
    let maxClose = 0;
    let sawOpen = false;
    for (let t = 0; t <= 10000; t += 10) {
      const close = anim.pose(ctx(), t).eyeClose;
      maxClose = Math.max(maxClose, close);
      if (close === 0) sawOpen = true;
    }
    expect(maxClose).toBe(1);
    expect(sawOpen).toBe(true);
  });
});

// ============================================================================
// 工作态
// ============================================================================

describe('工作态', () => {
  it('前倾 8° + 微颤 ±1px', () => {
    const anim = controller();
    let min = Infinity;
    let max = -Infinity;
    for (let t = 0; t <= 2000; t += 10) {
      const pose = anim.pose(ctx({ status: 'busy' }), t);
      expect(pose.leanDeg).toBe(M.working.leanDeg);
      min = Math.min(min, pose.tremorOffsetX);
      max = Math.max(max, pose.tremorOffsetX);
    }
    expect(min).toBeGreaterThanOrEqual(-M.working.tremorAmplitudePx - 1e-9);
    expect(max).toBeLessThanOrEqual(M.working.tremorAmplitudePx + 1e-9);
  });

  it('头顶进度弧 0→360° 循环，且严格在 [0,1)', () => {
    const anim = controller();
    const values: number[] = [];
    for (let t = 0; t <= M.working.arcPeriodMs; t += 100) {
      const arc = anim.pose(ctx({ status: 'busy' }), t).progressArc;
      expect(arc).not.toBeNull();
      values.push(arc as number);
    }
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    // 弧在转（不是常数），且一周期内大致走完一整圈。
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.8);
  });

  it('squash-stretch：命中 0.9 → 1.05 → 1.0 三个规格锚点', () => {
    const anim = controller();
    let min = Infinity;
    let max = -Infinity;
    let settled = false;
    for (let t = 0; t <= M.working.squashPeriodMs * 3; t += 10) {
      const scaleY = anim.pose(ctx({ status: 'busy' }), t).scaleY;
      min = Math.min(min, scaleY);
      max = Math.max(max, scaleY);
      if (Math.abs(scaleY - 1) < 0.002) settled = true;
    }
    expect(min).toBeCloseTo(M.working.squashMinScaleY, 2);
    expect(max).toBeCloseTo(M.working.squashMaxScaleY, 2);
    expect(settled).toBe(true);
  });

  it('squash 轨迹连续（无单帧跳变 —— 逐帧差不超过 0.05）', () => {
    const anim = controller();
    let previous = anim.pose(ctx({ status: 'busy' }), 0).scaleY;
    for (let t = 10; t <= M.working.squashPeriodMs * 2; t += 10) {
      const current = anim.pose(ctx({ status: 'busy' }), t).scaleY;
      expect(Math.abs(current - previous)).toBeLessThan(0.05);
      previous = current;
    }
  });
});

// ============================================================================
// 卡住态
// ============================================================================

describe('卡住态', () => {
  it('整体灰度 50%', () => {
    expect(controller().pose(ctx({ status: 'error' }), 0).grayscale).toBe(M.stuck.grayscale);
  });

  it('❗ 每 2s 弹跳一次：弹跳窗口内有位移、窗口外静止', () => {
    const anim = controller();
    let bounced = 0;
    for (let t = 0; t <= M.stuck.alertBouncePeriodMs * 3; t += 10) {
      const offset = anim.pose(ctx({ status: 'error' }), t).alertOffsetY;
      expect(offset).not.toBeNull();
      if ((offset as number) < -0.5) bounced += 1;
    }
    // 三个周期 → 三次弹跳（每次 400ms 窗口内有多帧为负位移）
    expect(bounced).toBeGreaterThan(6);
    expect(bounced).toBeLessThan(3 * M.stuck.alertBounceMs);
  });

  it('身体抖动与 ❗ 同步（同一时间窗内才有抖动）', () => {
    const anim = controller();
    let shakeOutside = 0;
    for (let t = 0; t <= M.stuck.alertBouncePeriodMs * 2; t += 10) {
      const pose = anim.pose(ctx({ status: 'error' }), t);
      const inBounce = (pose.alertOffsetY as number) < 0;
      if (!inBounce && Math.abs(pose.shakeOffsetX) > 1e-9) shakeOutside += 1;
      expect(Math.abs(pose.shakeOffsetX)).toBeLessThanOrEqual(M.stuck.shakeAmplitudePx + 1e-9);
    }
    expect(shakeOutside).toBe(0);
  });
});

// ============================================================================
// 完成态
// ============================================================================

describe('完成态', () => {
  it('三拍：squash → 跳 20px → 落地星尘', () => {
    const anim = controller();
    anim.triggerCompleted(0);
    const at = (t: number) => anim.pose(ctx(), t);
    // 第一拍：压扁
    expect(at(M.completed.squashMs * 0.9).scaleY).toBeLessThan(0.95);
    // 第二拍：起跳，峰值 20px
    const peak = at(M.completed.squashMs + M.completed.jumpMs / 2);
    expect(peak.jumpOffsetY).toBeCloseTo(-M.completed.jumpHeightPx, 0);
    expect(peak.scaleY).toBeGreaterThan(0.95);
    // 第三拍：落地，星尘出现
    const land = M.completed.squashMs + M.completed.jumpMs;
    expect(at(land + 10).dustProgress).not.toBeNull();
    expect(at(land + 10).jumpOffsetY).toBe(0);
    // 星尘播完即收
    expect(at(land + M.completed.dustMs + 10).dustProgress).toBeNull();
  });

  it('未触发时没有跳跃也没有星尘', () => {
    const pose = controller().pose(ctx(), 5000);
    expect(pose.dustProgress).toBeNull();
    expect(pose.jumpOffsetY).toBe(0);
  });
});

// ============================================================================
// 摸鱼态
// ============================================================================

describe('摸鱼态', () => {
  it('z→Z→Z 依次上升淡出，一个周期内最多三枚', () => {
    const anim = controller();
    let maxCount = 0;
    let sawFading = false;
    for (let t = 0; t <= M.slacking.periodMs * 2; t += 20) {
      const zzz = anim.pose(ctx({ status: 'idle', hasMission: false }), t).zzz;
      maxCount = Math.max(maxCount, zzz.length);
      expect(zzz.length).toBeLessThanOrEqual(3);
      for (const z of zzz) {
        expect(z.alpha).toBeGreaterThanOrEqual(0);
        expect(z.alpha).toBeLessThanOrEqual(1);
        if (z.alpha < 0.9) sawFading = true;
      }
    }
    expect(maxCount).toBeGreaterThan(0);
    expect(sawFading).toBe(true);
  });

  it('z 往上飘（offsetY 越晚越负）', () => {
    const anim = controller();
    const first = anim.pose(ctx({ status: 'idle', hasMission: false }), 100).zzz;
    expect(first.length).toBeGreaterThan(0);
    const z = first[0];
    const later = anim.pose(ctx({ status: 'idle', hasMission: false }), 100 + M.slacking.lifeMs / 2).zzz;
    const same = later.find((item) => item.index === z.index);
    expect(same).toBeDefined();
    expect((same as { offsetY: number }).offsetY).toBeLessThan(z.offsetY);
  });
});

// ============================================================================
// 选中 / hover / 点击
// ============================================================================

describe('选中 / hover / 点击', () => {
  it('选中：脚下虚线环，2s 转一圈', () => {
    const anim = controller();
    const a = anim.pose(ctx({ selected: true }), 0);
    const b = anim.pose(ctx({ selected: true }), M.selection.ringPeriodMs / 4);
    expect(a.selected).toBe(true);
    expect(b.selectionRingDeg - a.selectionRingDeg).toBeCloseTo(90, 3);
  });

  it('hover：放大 1.1x + 喷口微光', () => {
    const pose = controller().pose(ctx({ hovered: true }), 0);
    expect(pose.hoverScale).toBe(VISUAL_METRICS.hoverScale);
    expect(pose.thrusterGlow).toBe(1);
  });

  it('点击：白圈涟漪 200ms 内走完 0→1，并伴随 squash', () => {
    const anim = controller();
    anim.triggerClick(1000);
    expect(anim.pose(ctx(), 1000).clickRipple).toBe(0);
    const mid = anim.pose(ctx(), 1000 + M.click.rippleMs / 2);
    expect(mid.clickRipple).toBeCloseTo(0.5, 2);
    expect(mid.scaleY).toBeLessThan(1); // squash 一下
    expect(anim.pose(ctx(), 1000 + M.click.rippleMs + 10).clickRipple).toBeNull();
  });
});

// ============================================================================
// 相位错开（禁止全屏整齐划一）
// ============================================================================

describe('相位错开', () => {
  it('不同单位 id 的相位互不相同（50 个单位里绝大多数两两不同）', () => {
    const phases = new Set<number>();
    for (let i = 0; i < 50; i += 1) {
      phases.add(new UnitAnimationController(`unit_ch_${i}`).phase);
    }
    expect(phases.size).toBeGreaterThanOrEqual(45);
  });

  it('同一单位 id 永远同相位（可重现）', () => {
    expect(new UnitAnimationController('unit_x').phase).toBe(new UnitAnimationController('unit_x').phase);
  });

  it('同屏单位的工作进度弧不同步（相位错开传导到可见表现）', () => {
    const arcs = new Set<number>();
    for (let i = 0; i < 20; i += 1) {
      const anim = new UnitAnimationController(`unit_ch_${i}`);
      arcs.add(anim.pose(ctx({ status: 'busy' }), 1234).progressArc as number);
    }
    expect(arcs.size).toBeGreaterThanOrEqual(18);
  });

  it('同屏单位的 bob 不同步', () => {
    const offsets = new Set<number>();
    for (let i = 0; i < 20; i += 1) {
      const anim = new UnitAnimationController(`unit_ch_${i}`);
      offsets.add(Number(anim.pose(ctx(), 1234).bobOffsetY.toFixed(4)));
    }
    expect(offsets.size).toBeGreaterThanOrEqual(18);
  });
});

// ============================================================================
// 强制态（dev 逐态验收）
// ============================================================================

describe('强制态', () => {
  it('强制某一态时，叠加层一并裁决（强制「待机」= 干净的待机）', () => {
    const anim = controller();
    anim.setForcedState('idle', 0);
    const pose = anim.pose(ctx({ selected: true, hovered: true }), 1000);
    expect(pose.base).toBe('idle');
    expect(pose.selected).toBe(false);
    expect(pose.hovered).toBe(false);
  });

  it('强制「选中」出环、强制「hover」出放大', () => {
    const anim = controller();
    anim.setForcedState('selected', 0);
    expect(anim.pose(ctx(), 100).selected).toBe(true);
    anim.setForcedState('hover', 0);
    const hoverPose = anim.pose(ctx(), 100);
    expect(hoverPose.hovered).toBe(true);
    expect(hoverPose.hoverScale).toBe(VISUAL_METRICS.hoverScale);
  });

  it('强制「点击」时涟漪循环重放（dev 页能一直看见）', () => {
    const anim = controller();
    anim.setForcedState('clicked', 0);
    expect(anim.pose(ctx(), 10).clickRipple).not.toBeNull();
    expect(anim.pose(ctx(), M.click.rippleMs + 20).clickRipple).not.toBeNull();
  });

  it('强制「完成」时演出循环重放（dev 页能一直看见）', () => {
    const anim = controller();
    anim.setForcedState('completed', 0);
    const total = M.completed.squashMs + M.completed.jumpMs + M.completed.dustMs;
    // 演出放完 → 自动重起（这一拍正好落在重起后的 squash 上）。
    anim.pose(ctx(), total + 20);
    // 重起后的一个周期内，落地星尘照常出现。
    const replayed = anim.pose(ctx(), total + 20 + M.completed.squashMs + M.completed.jumpMs + 10);
    expect(replayed.dustProgress).not.toBeNull();
  });

  it('八态词表齐全且强制每一态都不抛错', () => {
    expect(UNIT_ANIMATION_STATES).toHaveLength(8);
    for (const state of UNIT_ANIMATION_STATES as readonly UnitAnimationState[]) {
      const anim = controller();
      anim.setForcedState(state, 0);
      expect(() => anim.pose(ctx(), 1000)).not.toThrow();
    }
  });
});
