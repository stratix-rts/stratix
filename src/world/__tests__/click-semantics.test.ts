/**
 * 单测：画布点击语义（@since v3.3，task_214 / IX-03）—— 单击 = 选中 / 双击 = 打开单独聊天框。
 *
 * 覆盖验收：
 *   ① 双击判定窗口复用 CAMERA_METRICS.doubleClickWindowMs 同源常量（不另立一套窗口）；
 *   ② 双击的第一击仍是单击选中（不产生第二种选中态）；
 *   ③ 双击后清空连击基准（连着三击不会变成「两次双击」）。
 *
 * why 是纯函数：画布判定住在 world/click-semantics.ts（零 Phaser 依赖）——
 *   场景本身在 node 下跑不起来（Phaser 需要 window/document），判定必须能独立单测。
 */

import { CAMERA_METRICS } from '../theme';
import { resolveCanvasClick, type CanvasClickDecision } from '../click-semantics';
import type { ClickStamp } from '../camera';

const BASE: ClickStamp = { unitId: 'u1', timeMs: 1000, x: 100, y: 200 };

function decide(previous: ClickStamp | null, current: ClickStamp): CanvasClickDecision {
  return resolveCanvasClick(previous, current);
}

describe('画布点击语义（task_214 / IX-03）', () => {
  test('没有上一次点击 → 单击选中', () => {
    const decision = decide(null, BASE);
    expect(decision.action).toBe('select');
    expect(decision.nextStamp).toEqual(BASE);
  });

  test('窗口内的第二击 → 双击开聊天框，且清空连击基准', () => {
    const decision = decide(BASE, { ...BASE, timeMs: BASE.timeMs + 100 });
    expect(decision.action).toBe('chat-open');
    expect(decision.nextStamp).toBeNull();
  });

  test('双击窗口取自唯一事实源 CAMERA_METRICS.doubleClickWindowMs（=320ms）', () => {
    expect(CAMERA_METRICS.doubleClickWindowMs).toBe(320);
    // 窗口内（含边界）⇒ 双击
    expect(
      decide(BASE, { ...BASE, timeMs: BASE.timeMs + CAMERA_METRICS.doubleClickWindowMs }).action,
    ).toBe('chat-open');
    // 窗口外 ⇒ 只算单击
    expect(
      decide(BASE, { ...BASE, timeMs: BASE.timeMs + CAMERA_METRICS.doubleClickWindowMs + 1 }).action,
    ).toBe('select');
  });

  test('不同单位 ⇒ 不是双击（两次独立的单击）', () => {
    expect(decide(BASE, { ...BASE, unitId: 'u2', timeMs: BASE.timeMs + 50 }).action).toBe('select');
  });

  test('位移超容差 ⇒ 不是双击', () => {
    const decision = decide(BASE, {
      ...BASE,
      timeMs: BASE.timeMs + 50,
      x: BASE.x + CAMERA_METRICS.doubleClickSlopPx + 1,
    });
    expect(decision.action).toBe('select');
    expect(decision.nextStamp?.unitId).toBe('u1');
  });

  test('双击的第一击仍是单击选中（不产生第二种选中态）', () => {
    const first = decide(null, BASE);
    expect(first.action).toBe('select');
    // 第一击的基准留给第二击比对 ⇒ 第二击才升级成双击
    expect(decide(first.nextStamp, { ...BASE, timeMs: BASE.timeMs + 120 }).action).toBe('chat-open');
  });
});
