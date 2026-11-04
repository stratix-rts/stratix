/**
 * 单测：**入场 / 下场的走位参数**（world/objects/unit-entrance.ts）。
 *
 * why 单独测：这一层是**纯函数**（零 Phaser、零 DOM）—— 起点、朝向算错，
 *   战场上就是"单位从屏幕外瞬移进来"（走位白做）或"单位贴着地面层爬"（看不见）。
 *   这两种错在肉眼手测里极难定位，所以在这里锁死。
 */

import {
  UNIT_ENTRANCE_DURATION_MS,
  UNIT_ENTRANCE_MARGIN,
  UNIT_EXIT_DURATION_MS,
  entranceDirection,
  entranceStartPosition,
} from '../objects/unit-entrance';

/** 一块可视区域（相当于镜头当前看到的世界矩形）。 */
const VIEW = { x: 100, y: 200, width: 1440, height: 900 };

describe('入场走位：起点', () => {
  test('起点在可视区域**外沿**（左右两侧交替）', () => {
    const target = { x: 800, y: 600 };

    const even = entranceStartPosition(target, VIEW, 0);
    const odd = entranceStartPosition(target, VIEW, 1);

    expect(even.x).toBe(VIEW.x - UNIT_ENTRANCE_MARGIN);
    expect(odd.x).toBe(VIEW.x + VIEW.width + UNIT_ENTRANCE_MARGIN);
  });

  test('序号奇偶决定左右交替（入场有纵深，不挤成一条线）', () => {
    const target = { x: 800, y: 600 };

    expect(entranceStartPosition(target, VIEW, 0).x).toBeLessThan(VIEW.x);
    expect(entranceStartPosition(target, VIEW, 1).x).toBeGreaterThan(VIEW.x + VIEW.width);
    expect(entranceStartPosition(target, VIEW, 2).x).toBeLessThan(VIEW.x);
  });

  test('纵向跟随目标格位（不歪到别的高度去）', () => {
    const target = { x: 800, y: 600 };

    expect(entranceStartPosition(target, VIEW, 0).y).toBe(600);
  });

  test('目标贴边时纵向被夹回可视区域内（别贴着地面层爬）', () => {
    const above = entranceStartPosition({ x: 800, y: 0 }, VIEW, 0);
    const below = entranceStartPosition({ x: 800, y: 99999 }, VIEW, 0);

    expect(above.y).toBeGreaterThanOrEqual(VIEW.y);
    expect(below.y).toBeLessThanOrEqual(VIEW.y + VIEW.height);
  });
});

describe('入场走位：朝向', () => {
  test('从左往右走 → 朝右（3）', () => {
    expect(entranceDirection({ x: 0, y: 100 }, { x: 500, y: 100 })).toBe(3);
  });

  test('从右往左走 → 朝左（1）', () => {
    expect(entranceDirection({ x: 500, y: 100 }, { x: 0, y: 100 })).toBe(1);
  });

  test('纵向差更大时 → 朝上（0）/ 朝下（2）', () => {
    expect(entranceDirection({ x: 100, y: 500 }, { x: 100, y: 0 })).toBe(0);
    expect(entranceDirection({ x: 100, y: 0 }, { x: 100, y: 500 })).toBe(2);
  });

  test('横向差占优时纵向不翻转（斜着走也取主方向）', () => {
    expect(entranceDirection({ x: 0, y: 0 }, { x: 400, y: 300 })).toBe(3);
  });
});

describe('入场 / 下场时长（有界，不许无限拖）', () => {
  test('入场 800ms 级、下场 260ms 级', () => {
    expect(UNIT_ENTRANCE_DURATION_MS).toBe(800);
    expect(UNIT_EXIT_DURATION_MS).toBe(260);
  });

  test('入场时长在"用户看得见"与"不打断操作"之间（0.4s ~ 1.5s）', () => {
    expect(UNIT_ENTRANCE_DURATION_MS).toBeGreaterThanOrEqual(400);
    expect(UNIT_ENTRANCE_DURATION_MS).toBeLessThanOrEqual(1500);
  });

  test('外扩距离为正（起点真的在可视区之外）', () => {
    expect(UNIT_ENTRANCE_MARGIN).toBeGreaterThan(0);
  });
});
