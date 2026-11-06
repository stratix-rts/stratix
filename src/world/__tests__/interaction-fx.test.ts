/**
 * 单测：点击与指令特效的**纯算术**（world/objects/task-fx.ts 的交互特效段，task_077）。
 * 覆盖：
 *   - selectionWaveSchedule：命中单位每 40ms 一个位次（波浪式弹选择环）；
 *   - flowDashSegments：流动虚线的分段几何 + 渐变参数 t + offset 推进方向；
 *   - mixColorT：流线渐变取色；
 *   - cardFlipScaleX / cardFlipShowsFront：3D 翻卡的侧棱与换面；
 *   - easeBackOut / flagClothScale / flagPoleProgress：旗面弹性与旗杆升起；
 *   - footPulseRadius / footPulseAlpha：集火脉冲；
 *   - flowFadeAlpha：指令流线「800ms 后淡出」的尾段淡出。
 *
 * why 这些要单测：它们是**算出来的规格**（每 40ms、800ms、Back.Out）——
 *   画错一帧看不出来、算错了整段演出都不对，纯函数穷举断言最省事。
 *
 * @jest-environment node
 */

import { INTERACTION_FX_METRICS } from '../../core/theme/visual-spec';
import { SPEECH_EVENT_POOLS } from '../../core/theme/bubble-copy';
import {
  INTERACTION_FX_STYLE,
  cardFlipScaleX,
  cardFlipShowsFront,
  easeBackOut,
  flowDashSegments,
  flowFadeAlpha,
  flagClothScale,
  flagPoleProgress,
  footPulseAlpha,
  footPulseRadius,
  mixColorT,
  selectionWaveSchedule,
} from '../objects/task-fx';

describe('selectionWaveSchedule：命中单位每 40ms 一个位次', () => {
  test('位次按命中顺序排，延迟逐个加一个间隔', () => {
    const schedule = selectionWaveSchedule(['u1', 'u2', 'u3']);
    expect(schedule).toEqual([
      { unitId: 'u1', delayMs: 0 },
      { unitId: 'u2', delayMs: 40 },
      { unitId: 'u3', delayMs: 80 },
    ]);
  });

  test('间隔取自唯一事实源（INTERACTION_FX_METRICS.selectionWave.intervalMs = 40）', () => {
    expect(INTERACTION_FX_METRICS.selectionWave.intervalMs).toBe(40);
    const schedule = selectionWaveSchedule(['a', 'b']);
    expect(schedule[1]?.delayMs).toBe(INTERACTION_FX_METRICS.selectionWave.intervalMs);
  });

  test('没有命中 → 没有位次（不空转）', () => {
    expect(selectionWaveSchedule([])).toEqual([]);
  });
});

describe('flowDashSegments：流动虚线的分段几何', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 100, y: 0 };

  test('每段都在起点与终点之间，长度不超过一段虚线', () => {
    const segments = flowDashSegments(from, to, 0, 10, 8);
    expect(segments.length).toBeGreaterThan(0);
    for (const segment of segments) {
      expect(segment.x1).toBeGreaterThanOrEqual(0);
      expect(segment.x2).toBeLessThanOrEqual(100);
      expect(segment.x2 - segment.x1).toBeLessThanOrEqual(10 + 1e-9);
    }
  });

  test('渐变参数 t 沿线递增（青 → 目标色）', () => {
    const segments = flowDashSegments(from, to, 0, 10, 8);
    for (let index = 1; index < segments.length; index += 1) {
      expect(segments[index]!.t).toBeGreaterThan(segments[index - 1]!.t);
    }
    expect(segments[0]!.t).toBeLessThan(1);
    expect(segments[segments.length - 1]!.t).toBeGreaterThan(0);
  });

  test('offset 增大 → 虚线朝目标方向推进（缺口后移）', () => {
    const before = flowDashSegments(from, to, 0, 10, 8);
    // 偏移一整段虚线（10px）：首段实线被推到 gap 之后（起点从 0 移到 8）。
    const after = flowDashSegments(from, to, 10, 10, 8);
    expect(before[0]!.x1).toBeCloseTo(0, 5);
    expect(after[0]!.x1).toBeGreaterThan(before[0]!.x1);
  });

  test('零长度的线 → 没有段（不画零长度虚线）', () => {
    expect(flowDashSegments({ x: 5, y: 5 }, { x: 5, y: 5 }, 0, 10, 8)).toEqual([]);
  });
});

describe('mixColorT：流线渐变取色', () => {
  test('t=0 取 a，t=1 取 b，t=0.5 取中点', () => {
    expect(mixColorT(0x000000, 0xffffff, 0)).toBe(0x000000);
    expect(mixColorT(0x000000, 0xffffff, 1)).toBe(0xffffff);
    expect(mixColorT(0x000000, 0xffffff, 0.5)).toBe(0x808080);
  });

  test('t 越界 → 钳到端点', () => {
    expect(mixColorT(0x102030, 0x405060, -1)).toBe(0x102030);
    expect(mixColorT(0x102030, 0x405060, 2)).toBe(0x405060);
  });
});

describe('翻卡：3D 侧棱与换面', () => {
  test('scaleX：起点 1 → 中点 0（侧棱）→ 终点 1', () => {
    expect(cardFlipScaleX(0)).toBeCloseTo(1, 5);
    expect(cardFlipScaleX(0.5)).toBeCloseTo(0, 5);
    expect(cardFlipScaleX(1)).toBeCloseTo(1, 5);
  });

  test('过半换面：背面灰 → 正面亮 + 图标', () => {
    expect(cardFlipShowsFront(0.49)).toBe(false);
    expect(cardFlipShowsFront(0.5)).toBe(true);
    expect(cardFlipShowsFront(1)).toBe(true);
  });
});

describe('插旗：旗杆升起 + 旗面 Back.Out 弹性', () => {
  test('旗杆比例单调上升、终点为 1', () => {
    expect(flagPoleProgress(0)).toBe(0);
    expect(flagPoleProgress(0.5)).toBeGreaterThan(0.4);
    expect(flagPoleProgress(1)).toBe(1);
  });

  test('旗面 Back.Out：中途冲过头（>1），终点回到 1', () => {
    expect(flagClothScale(0)).toBe(0);
    const overshoot = flagClothScale(0.6);
    expect(overshoot).toBeGreaterThan(1);
    expect(flagClothScale(1)).toBeCloseTo(1, 5);
  });

  test('easeBackOut 是标准 Back.Out 曲线（起点 0、终点 1）', () => {
    expect(easeBackOut(0)).toBe(0);
    expect(easeBackOut(1)).toBeCloseTo(1, 5);
    expect(easeBackOut(0.7)).toBeGreaterThan(1);
  });
});

describe('集火脉冲与流线淡出', () => {
  test('脉冲环半径变大、透明度线性归零', () => {
    expect(footPulseRadius(0, 8, 30)).toBe(8);
    expect(footPulseRadius(1, 8, 30)).toBe(30);
    expect(footPulseAlpha(0)).toBe(1);
    expect(footPulseAlpha(1)).toBe(0);
  });

  test('流线：前段保持不透明，尾段淡出到 0（800ms 后淡出）', () => {
    const fadeRatio = INTERACTION_FX_METRICS.command.flowFadeMs / INTERACTION_FX_METRICS.command.flowDurationMs;
    expect(flowFadeAlpha(0, fadeRatio)).toBe(1);
    expect(flowFadeAlpha(0.5, fadeRatio)).toBe(1);
    expect(flowFadeAlpha(1, fadeRatio)).toBe(0);
  });
});

describe('交互特效的文案与样式', () => {
  test('气泡文案已迁到 core/theme/bubble-copy.ts（移动指令池 / 支援池，各 ≥4 条）', () => {
    // @since v3.3，task_219 / IX-06：常量「收到」/「来了来了」退役 ——
    //   同一句话反复出现像卡带 ⇒ 事件各有一池，随机抽。
    expect(SPEECH_EVENT_POOLS.move.length).toBeGreaterThanOrEqual(4);
    expect(SPEECH_EVENT_POOLS.support.length).toBeGreaterThanOrEqual(4);
    expect(SPEECH_EVENT_POOLS.move).not.toContain('收到');
    expect(SPEECH_EVENT_POOLS.support).not.toContain('来了来了');
  });

  test('样式：流线起点是青（我方主色），旗面是完成色', () => {
    expect(INTERACTION_FX_STYLE.flowStartColor).toBe(0x4fc3f7);
    expect(INTERACTION_FX_STYLE.flagClothColor).toBe(0x2ecc71);
  });
});
