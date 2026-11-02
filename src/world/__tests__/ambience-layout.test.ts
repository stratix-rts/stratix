/**
 * 单测：氛围彩蛋的纯口径（world/objects/ambience-layout.ts，task_079）。
 * 覆盖验收标准中的「云漂移不穿帮」与「真实时间 19-24 点背景网格微微变暖」：
 *   - 小云的出现间隔落在 30-60s；出场点在画面外；行程时长 = 距离 / 速度；
 *   - 某一时刻的云位置在起点与终点之间（不穿帮：不会瞬移、不会倒退）；
 *   - 变暖配色：暖度 0 = 原色，暖度 1 = 向暖色混合；
 *   - 入夜时段判定：19 点起、24 点止。
 *
 * @jest-environment node
 */

import {
  cloudSpawn,
  cloudX,
  isWarmHour,
  nextCloudDelayMs,
  warmColor,
} from '../objects/ambience-layout';

const BOUNDS = { x: 0, y: 0, width: 3200, height: 2400 };

describe('小云：出场间隔 30-60s', () => {
  test('随机源取下界 → 30s；取上界 → 60s', () => {
    expect(nextCloudDelayMs(() => 0)).toBe(30_000);
    expect(nextCloudDelayMs(() => 1)).toBe(60_000);
  });

  test('任意随机源的结果都落在 30-60s 区间内', () => {
    for (const roll of [0.13, 0.37, 0.5, 0.91]) {
      const delay = nextCloudDelayMs(() => roll);
      expect(delay).toBeGreaterThanOrEqual(30_000);
      expect(delay).toBeLessThanOrEqual(60_000);
    }
  });
});

describe('小云：出场与漂移', () => {
  test('起点在画面外，终点在另一侧之外；纵向贴着上/下边缘', () => {
    const plan = cloudSpawn(BOUNDS, 140, 55, () => 0.2);
    expect(plan.startX).toBeLessThan(BOUNDS.x);
    expect(plan.endX).toBeGreaterThan(BOUNDS.x + BOUNDS.width);
    expect(plan.y).toBeGreaterThanOrEqual(BOUNDS.y);
    expect(plan.y).toBeLessThanOrEqual(BOUNDS.y + BOUNDS.height);
  });

  test('行程时长 = 距离 / 速度（慢速漂过，不是一闪而过）', () => {
    const plan = cloudSpawn(BOUNDS, 140, 55, () => 0.2);
    const distance = Math.abs(plan.endX - plan.startX);
    expect(plan.travelMs).toBeCloseTo((distance / 55) * 1000, 6);
    // 慢速：横穿全场至少 30s
    expect(plan.travelMs).toBeGreaterThan(30_000);
  });

  test('任意时刻的位置在起点与终点之间（不穿帮：不倒退、不瞬移）', () => {
    const plan = cloudSpawn(BOUNDS, 140, 55, () => 0.2);
    let previous = cloudX(plan, 0);
    for (let elapsed = 500; elapsed <= plan.travelMs; elapsed += 500) {
      const current = cloudX(plan, elapsed);
      if (plan.direction === 1) expect(current).toBeGreaterThan(previous);
      else expect(current).toBeLessThan(previous);
      previous = current;
    }
    // 走完全程恰好落在终点（不多不少）
    expect(cloudX(plan, plan.travelMs)).toBeCloseTo(plan.endX, 6);
  });

  test('反向漂移：起点在另一侧之外', () => {
    const plan = cloudSpawn(BOUNDS, 140, 55, () => 0.9);
    expect(plan.direction).toBe(-1);
    expect(plan.startX).toBeGreaterThan(BOUNDS.x + BOUNDS.width);
    expect(plan.endX).toBeLessThan(BOUNDS.x);
  });
});

describe('入夜变暖：格网配色', () => {
  test('暖度 0 → 原色不动', () => {
    expect(warmColor(0x1a2140, 0xf0a020, 0, 0.28)).toBe(0x1a2140);
  });

  test('暖度 1 → 向暖色混合（红通道上升、蓝通道下降）', () => {
    const warm = warmColor(0x1a2140, 0xf0a020, 1, 0.28);
    const baseR = (0x1a2140 >> 16) & 0xff;
    const warmR = (warm >> 16) & 0xff;
    const baseB = 0x1a2140 & 0xff;
    const warmB = warm & 0xff;
    expect(warmR).toBeGreaterThan(baseR);
    expect(warmB).toBeLessThan(baseB);
  });

  test('暖度是「微微」的：混合量远小于整色替换', () => {
    const warm = warmColor(0x1a2140, 0xf0a020, 1, 0.28);
    expect(warm).not.toBe(0xf0a020);
  });
});

describe('入夜时段：真实本地时间 19-24 点', () => {
  test('18 点不入夜；19 点起入夜；23 点仍在夜里；0 点不算', () => {
    expect(isWarmHour(18)).toBe(false);
    expect(isWarmHour(19)).toBe(true);
    expect(isWarmHour(23)).toBe(true);
    expect(isWarmHour(0)).toBe(false);
  });

  test('非法小时数（NaN）→ 不入夜（不把相机/画面带进怪状态）', () => {
    expect(isWarmHour(Number.NaN)).toBe(false);
  });
});
