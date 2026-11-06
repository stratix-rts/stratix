/**
 * 测试职责：**气泡说话系统的纯逻辑层**（task_076 / DEMO-PLAN.md §3）——
 *   频率控制板（同屏 ≤3 / 排队与「旧的优先收」/ 同单位 5s 冷却 / 存活 4s 自动收）、
 *   出入场动画曲线（Back.Out 250ms / 上浮 10px + 淡出 300ms）、文本排版（最大宽 160px / 最多 2 行 / 省略号）。
 * 输入：被测模块 src/world/objects/speech-bubble.ts（零 Phaser）+ src/world/speech-spec.ts。
 * 输出：断言（无返回值）。
 * 禁止事项：
 *   1. import phaser —— 本层刻意不依赖渲染引擎，node 单测直接跑；
 *   2. 用真实时间 —— 时钟与随机全部注入，推进相位靠显式 tick；
 *   3. 断言渲染对象 —— 渲染层（objects/speech-bubble-layer.ts）是 Phaser 表现，不在单测范围。
 */

import { VISUAL_METRICS } from '../../core/theme/visual-spec';
import { SPEECH_STATE_POOLS } from '../../core/theme/bubble-copy';
import { SPEECH_BUBBLE_SPEC } from '../speech-spec';
import {
  SpeechBubbleBoard,
  bubbleAnimationAt,
  layoutSpeechText,
  type BubbleAnimationFrame,
} from '../objects/speech-bubble';

const FIXED_RANDOM = (): number => 0.9; // 0.9 > 0.2 → 永远走本类句库，不进彩蛋

describe('speech-spec 规格常量', () => {
  it('视觉口径对齐规格（最大宽 160 / 13px 白字 / 圆角 / 最多 2 行 / 黑底 85%）', () => {
    expect(SPEECH_BUBBLE_SPEC.maxWidthPx).toBe(160);
    expect(SPEECH_BUBBLE_SPEC.fontSizePx).toBe(13);
    expect(SPEECH_BUBBLE_SPEC.textColor).toBe('#ffffff');
    expect(SPEECH_BUBBLE_SPEC.backdropColor).toBe('#000000');
    expect(SPEECH_BUBBLE_SPEC.backdropAlpha).toBe(0.85);
    expect(SPEECH_BUBBLE_SPEC.maxLines).toBe(2);
    expect(SPEECH_BUBBLE_SPEC.cornerRadiusPx).toBeGreaterThan(0);
  });

  it('时长口径取自唯一事实源（入场 Back.Out 250ms / 出场 Cubic.In 300ms）', () => {
    expect(VISUAL_METRICS.enter.ease).toBe('Back.Out');
    expect(VISUAL_METRICS.exit.ease).toBe('Cubic.In');
    expect(SPEECH_BUBBLE_SPEC.enterDurationMs).toBe(VISUAL_METRICS.enter.durationMs);
    expect(SPEECH_BUBBLE_SPEC.exitDurationMs).toBe(VISUAL_METRICS.exit.durationMs);
    expect(SPEECH_BUBBLE_SPEC.enterDurationMs).toBe(250);
    expect(SPEECH_BUBBLE_SPEC.exitDurationMs).toBe(300);
  });

  it('频率口径对齐规格（同屏 ≤3 / 同单位 5s / 存活 4s / 上浮 10px）', () => {
    expect(SPEECH_BUBBLE_SPEC.maxOnScreen).toBe(3);
    expect(SPEECH_BUBBLE_SPEC.unitCooldownMs).toBe(5000);
    expect(SPEECH_BUBBLE_SPEC.lifeMs).toBe(4000);
    expect(SPEECH_BUBBLE_SPEC.exitRisePx).toBe(10);
  });
});

describe('SpeechBubbleBoard 频率控制', () => {
  it('首个请求立刻冒泡，气泡内容来自对应句库', () => {
    const board = new SpeechBubbleBoard({ random: FIXED_RANDOM });
    expect(board.request('u1', 'working', 0)).toBe('shown');
    const bubbles = board.bubbles();
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]?.unitId).toBe('u1');
    expect(bubbles[0]?.kind).toBe('working');
    expect(bubbles[0]?.phase).toBe('entering');
    // 抽到的句子来自「工作中」状态池（具体是哪一句取决于注入的随机源）。
    expect(SPEECH_STATE_POOLS.working).toContain(bubbles[0]?.text);
  });

  it('同屏最多 3 个：第 4 个排队，不挤掉新的', () => {
    const board = new SpeechBubbleBoard({ random: FIXED_RANDOM });
    expect(board.request('u1', 'working', 0)).toBe('shown');
    expect(board.request('u2', 'complete', 0)).toBe('shown');
    expect(board.request('u3', 'error', 0)).toBe('shown');
    expect(board.request('u4', 'thinking', 0)).toBe('queued');
    expect(board.count()).toBe(3);
    expect(board.pendingCount()).toBe(1);
    // 排队的那条还没上屏。
    expect(board.bubbles().map((b) => b.unitId)).not.toContain('u4');
  });

  it('「旧的优先收」：最旧的一枚先退场，位置让给排队的那条', () => {
    const board = new SpeechBubbleBoard({ random: FIXED_RANDOM });
    board.request('u1', 'working', 0);
    board.request('u2', 'complete', 0);
    board.request('u3', 'error', 0);
    board.request('u4', 'thinking', 0);

    // 退场中：最旧的一枚进入 exiting，但仍然占位（≤3 是硬上限）。
    expect(board.bubbles().find((b) => b.unitId === 'u1')?.phase).toBe('exiting');
    expect(board.count()).toBe(3);

    // 退场走完（300ms）→ 位置让出来 → 排队的那条提升。
    board.tick(300);
    expect(board.bubbles().find((b) => b.unitId === 'u1')).toBeUndefined();
    expect(board.bubbles().find((b) => b.unitId === 'u4')).toBeDefined();
    expect(board.count()).toBe(3);
    expect(board.pendingCount()).toBe(0);
  });

  it('同单位 5s 内不重复冒泡（冷却）', () => {
    const board = new SpeechBubbleBoard({ random: FIXED_RANDOM });
    expect(board.request('u1', 'working', 0)).toBe('shown');
    expect(board.request('u1', 'complete', 1000)).toBe('cooldown');
    expect(board.request('u1', 'error', 4999)).toBe('cooldown');
    expect(board.count()).toBe(1);
  });

  it('同单位冷却满 5s 后可以再说一次', () => {
    const board = new SpeechBubbleBoard({ random: FIXED_RANDOM });
    board.request('u1', 'working', 0);
    expect(board.request('u1', 'complete', 5000)).toBe('shown');
    expect(board.count()).toBe(2);
  });

  it('冷却只挡同一个单位，不影响别的单位', () => {
    const board = new SpeechBubbleBoard({ random: FIXED_RANDOM });
    board.request('u1', 'working', 0);
    expect(board.request('u2', 'working', 100)).toBe('shown');
  });

  it('排队中的请求在提升时再查一次冷却（期间它自己又说过了 → 直接丢，不补说）', () => {
    const board = new SpeechBubbleBoard({ random: FIXED_RANDOM, maxOnScreen: 1 });
    board.request('u1', 'working', 0); // 上屏
    board.request('u2', 'complete', 0); // 同屏满了 → 排队
    board.request('u2', 'error', 0); // 同单位的第二条 → 也排队
    // u1 退场完 → u2 提升冒泡（此刻起 u2 进入 5s 冷却）。
    board.tick(300);
    expect(board.bubbles().some((b) => b.unitId === 'u2')).toBe(true);
    // u2 的气泡存活 4s 后自动收起、退场 300ms 后移除 —— 那时那条排队的 u2 才轮到；
    // 但 u2 还在 5s 冷却里 → 提升时直接丢掉，不补说。
    for (let t = 400; t <= 5600; t += 100) board.tick(t);
    expect(board.bubbles().some((b) => b.unitId === 'u2')).toBe(false);
    expect(board.pendingCount()).toBe(0);
  });

  it('存活 4s 自动收起（到点进入退场，退场完移除）', () => {
    const board = new SpeechBubbleBoard({ random: FIXED_RANDOM });
    board.request('u1', 'working', 0);
    board.tick(250);
    expect(board.bubbles()[0]?.phase).toBe('alive');
    board.tick(3999);
    expect(board.bubbles()[0]?.phase).toBe('alive');
    board.tick(4000);
    expect(board.bubbles()[0]?.phase).toBe('exiting');
    board.tick(4300);
    expect(board.bubbles()).toHaveLength(0);
  });

  it('显式文案气泡按原话说（不抽句库）', () => {
    const board = new SpeechBubbleBoard({ random: FIXED_RANDOM });
    expect(board.requestText('u1', '收到', 0)).toBe('shown');
    const bubble = board.bubbles()[0];
    expect(bubble?.text).toBe('收到');
    expect(bubble?.kind).toBeNull();
  });

  it('单位离场：它的气泡与排队请求一并清掉', () => {
    const board = new SpeechBubbleBoard({ random: FIXED_RANDOM, maxOnScreen: 1 });
    board.request('u1', 'working', 0);
    board.request('u2', 'complete', 0);
    board.clearUnit('u2');
    expect(board.pendingCount()).toBe(0);
    board.clearUnit('u1');
    expect(board.count()).toBe(0);
  });

  it('队列有界：超出上限时丢最老的一条排队请求', () => {
    const board = new SpeechBubbleBoard({ random: FIXED_RANDOM, maxOnScreen: 1, maxQueue: 2 });
    board.request('u1', 'working', 0);
    expect(board.request('u2', 'complete', 0)).toBe('queued');
    expect(board.request('u3', 'error', 0)).toBe('queued');
    // 队列已满 → 丢最老的一条排队请求（u2），u3 留在队里。
    expect(board.request('u4', 'thinking', 0)).toBe('dropped');
    expect(board.pendingCount()).toBe(1);
  });
});

describe('bubbleAnimationAt 出入场曲线', () => {
  const spec = {
    enterDurationMs: 250,
    exitDurationMs: 300,
    exitRisePx: 10,
  };

  it('入场：scale 0→1（Back.Out），锚点在尾巴（不做位移）', () => {
    const start = bubbleAnimationAt('entering', 0, spec);
    expect(start.scale).toBeCloseTo(0, 10);
    expect(start.alpha).toBe(1);
    expect(start.riseY).toBe(0);
    const end = bubbleAnimationAt('entering', 250, spec);
    expect(end.scale).toBe(1);
    expect(end.alpha).toBe(1);
    expect(end.riseY).toBe(0);
  });

  it('入场是 Back.Out 曲线：中途会冲过头（scale > 1）再回落', () => {
    const overshoot = bubbleAnimationAt('entering', 175, spec);
    expect(overshoot.scale).toBeGreaterThan(1);
    expect(overshoot.scale).toBeLessThan(2);
  });

  it('驻留：scale 1 / alpha 1 / 无位移', () => {
    const frame = bubbleAnimationAt('alive', 1000, spec);
    expect(frame).toEqual({ scale: 1, alpha: 1, riseY: 0 });
  });

  it('出场：上浮 10px + alpha→0（Cubic.In），300ms 走完', () => {
    const start = bubbleAnimationAt('exiting', 0, spec);
    expect(start.alpha).toBe(1);
    expect(start.riseY).toBeCloseTo(0, 10);
    expect(start.scale).toBe(1);
    const end = bubbleAnimationAt('exiting', 300, spec);
    expect(end.alpha).toBe(0);
    expect(end.riseY).toBe(-10);
    expect(end.scale).toBe(1);
  });

  it('出场中途：上浮距离在 0 与 -10 之间，透明度递减', () => {
    const mid = bubbleAnimationAt('exiting', 150, spec);
    expect(mid.riseY).toBeLessThan(0);
    expect(mid.riseY).toBeGreaterThan(-10);
    expect(mid.alpha).toBeGreaterThan(0);
    expect(mid.alpha).toBeLessThan(1);
  });

  it('曲线对超出区间的时刻是钳住的（不会 scale 溢出）', () => {
    const before = bubbleAnimationAt('entering', -100, spec);
    expect(before.scale).toBeCloseTo(0, 10);
    const after = bubbleAnimationAt('exiting', 9999, spec);
    expect(after.alpha).toBe(0);
    expect(after.riseY).toBe(-10);
  });
});

describe('layoutSpeechText 文本排版', () => {
  // 假量尺：每个字 10px。
  const measure = (candidate: string): number => candidate.length * 10;
  const maxWidth = 60; // → 每行 6 个字

  it('短句一行放下，不截断', () => {
    const layout = layoutSpeechText('搞定！', measure, maxWidth, 2);
    expect(layout.lines).toEqual(['搞定！']);
    expect(layout.truncated).toBe(false);
  });

  it('长句按字断行（中文没有空格，不会顶破宽度）', () => {
    const layout = layoutSpeechText('一二三四五六七八九十', measure, maxWidth, 2);
    expect(layout.lines).toEqual(['一二三四五六', '七八九十']);
    expect(layout.truncated).toBe(false);
    for (const line of layout.lines) expect(measure(line)).toBeLessThanOrEqual(maxWidth);
  });

  it('超出 2 行则截断并补省略号', () => {
    const layout = layoutSpeechText('一二三四五六七八九十十一十二', measure, maxWidth, 2);
    expect(layout.lines).toHaveLength(2);
    expect(layout.truncated).toBe(true);
    expect(layout.lines[1]?.endsWith('…')).toBe(true);
    expect(measure(layout.lines[1] ?? '')).toBeLessThanOrEqual(maxWidth);
  });

  it('截断时保留的原文是前缀（话没被改写，只是读不全）', () => {
    const text = '一二三四五六七八九十';
    const layout = layoutSpeechText(text, measure, maxWidth, 1);
    expect(layout.truncated).toBe(true);
    expect(layout.lines).toHaveLength(1);
    expect(text.startsWith((layout.lines[0] ?? '').replace('…', ''))).toBe(true);
  });

  it('默认排版口径取自气泡规格（最大宽 160 / 最多 2 行）', () => {
    expect(SPEECH_BUBBLE_SPEC.maxWidthPx).toBe(160);
    expect(SPEECH_BUBBLE_SPEC.maxLines).toBe(2);
  });
});

describe('气泡板与动画的接缝', () => {
  it('板子的进出时长与规格一致（渲染层据此推进相位）', () => {
    const board = new SpeechBubbleBoard({ random: FIXED_RANDOM });
    expect(board.enterDurationMs).toBe(SPEECH_BUBBLE_SPEC.enterDurationMs);
    expect(board.exitDurationMs).toBe(SPEECH_BUBBLE_SPEC.exitDurationMs);
  });

  it('板子进入驻留的时刻 = 入场时长', () => {
    const board = new SpeechBubbleBoard({ random: FIXED_RANDOM });
    board.request('u1', 'working', 0);
    board.tick(249);
    expect(board.bubbles()[0]?.phase).toBe('entering');
    board.tick(250);
    expect(board.bubbles()[0]?.phase).toBe('alive');
  });

  it('按规格参数渲染出的入场帧起点是 scale 0（尾巴锚点）', () => {
    const frame: BubbleAnimationFrame = bubbleAnimationAt('entering', 0);
    expect(frame.scale).toBeCloseTo(0, 10);
  });
});
