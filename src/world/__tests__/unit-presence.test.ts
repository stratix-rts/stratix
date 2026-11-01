/**
 * 单测：单位表现生命感纯逻辑（world/objects/unit-presence.ts，task_062）。
 *
 * 覆盖任务规格五个面：
 *   ① 呼吸参数生成：相位域 [0,2π)、确定性（同 id 同相位）、相位错开（50 单位不整齐划一）；
 *   ② tick 驱动矩阵：shouldBreathe 只看在线 + 有精灵（移动/忙碌不参与 —— 与 tween 属性面
 *      不相交是设计保证）；scaleY 全时域钳在 [base×0.98, base×1.02]；周期性；
 *   ③ 名字显隐规则：全局开关 × zoom 阈值矩阵；localStorage 读取口径（缺省开 / '0' 关 / 异常回落开）；
 *   ④ 说话气泡：alpha 脉动域与周期性；
 *   ⑤ 性能：50 单位一帧的计算成本打桩（断言单帧毫秒量级，预算 16.6ms 的零头都不到）。
 *
 * 本文件保持 node 环境可跑（被测源码零 Phaser、零 DOM —— import 期不碰 localStorage，
 * storage 经参数注入桩）。
 */

import type { UnitView } from '../../core/types';
import { STRATIX_NAMETAGS_TOGGLE_KEY } from '../../core/types';
import {
  BREATH_STYLE,
  breathPhaseFor,
  breathScaleY,
  NAMETAG_STYLE,
  nametagVisible,
  overlayVisible,
  OVERLAY_MIN_ZOOM,
  readNametagsToggle,
  shouldBreathe,
  SPEAKING_ALPHA_MIN,
  SPEAKING_PULSE_MS,
  speakingDotAlpha,
  type NametagStorage,
} from '../objects/unit-presence';

// ============================================================================
// 呼吸参数生成
// ============================================================================

describe('呼吸相位 breathPhaseFor', () => {
  test('相位落在 [0, 2π)，不含端点越界', () => {
    for (let i = 0; i < 200; i += 1) {
      const phase = breathPhaseFor(`unit_ch_${i}`);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(2 * Math.PI);
    }
  });

  test('确定性：同 id 永远同相位（节点重建不换相位、可重现）', () => {
    expect(breathPhaseFor('unit_ch_alpha')).toBe(breathPhaseFor('unit_ch_alpha'));
    expect(breathPhaseFor('u1')).toBe(breathPhaseFor('u1'));
  });

  test('相位错开：50 个单位不会整齐划一地同步呼吸（≥45 个不同相位、散布 ≥ π）', () => {
    const phases = Array.from({ length: 50 }, (_, i) => breathPhaseFor(`unit_ch_${i}`));
    expect(new Set(phases).size).toBeGreaterThanOrEqual(45);
    const spread = Math.max(...phases) - Math.min(...phases);
    expect(spread).toBeGreaterThan(Math.PI);
  });

  test('不同 id 不刻意对齐（相邻 id 的相位普遍不同）', () => {
    let differing = 0;
    for (let i = 1; i < 50; i += 1) {
      if (breathPhaseFor(`unit_ch_${i - 1}`) !== breathPhaseFor(`unit_ch_${i}`)) differing += 1;
    }
    // 哈希分布均匀：49 对里至少 40 对不同（允许极小概率碰撞，但绝不会大面积撞）。
    expect(differing).toBeGreaterThanOrEqual(40);
  });
});

// ============================================================================
// 呼吸 tick 驱动
// ============================================================================

describe('呼吸缩放 breathScaleY', () => {
  const BASE = 0.8; // UNIT_SPRITE_SCALE 口径（64px LPC 帧 → 51px 身高）

  test('全时域钳在 [base×0.98, base×1.02]（幅度边界，规格原文 0.98↔1.02）', () => {
    const phase = breathPhaseFor('unit_ch_test');
    for (let t = 0; t < BREATH_STYLE.periodMs * 2; t += 7) {
      const scale = breathScaleY(BASE, phase, t);
      expect(scale).toBeGreaterThanOrEqual(BASE * 0.98 - 1e-12);
      expect(scale).toBeLessThanOrEqual(BASE * 1.02 + 1e-12);
    }
  });

  test('能摸到两端：整个相位周期上确实到达过上下确界附近（活着，不是常数）', () => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let t = 0; t < BREATH_STYLE.periodMs * 3; t += 5) {
      const scale = breathScaleY(BASE, 0, t);
      min = Math.min(min, scale);
      max = Math.max(max, scale);
    }
    expect(max - min).toBeGreaterThan(BASE * 0.03); // 摆幅接近理论 0.04×base
  });

  test('周期性：t 与 t+period 的缩放一致（呼吸循环无缝）', () => {
    const phase = 1.234;
    for (let t = 0; t < BREATH_STYLE.periodMs; t += 97) {
      expect(breathScaleY(BASE, phase, t + BREATH_STYLE.periodMs)).toBeCloseTo(
        breathScaleY(BASE, phase, t),
        9
      );
    }
  });

  test('非法周期（≤0）回落基值，不出 NaN 尺度', () => {
    expect(breathScaleY(BASE, 0.5, 1000, 0)).toBe(BASE);
    expect(breathScaleY(BASE, 0.5, 1000, -100)).toBe(BASE);
    expect(Number.isNaN(breathScaleY(BASE, 0.5, 1000, 0))).toBe(false);
  });
});

describe('呼吸裁决矩阵 shouldBreathe', () => {
  test('在线 × 有精灵才呼吸；离线停（静止灰显更「死」）', () => {
    expect(shouldBreathe(true, true)).toBe(true);
    expect(shouldBreathe(true, false)).toBe(false); // 占位圆不呼吸（观感劣于静止）
    expect(shouldBreathe(false, true)).toBe(false); // 离线（task_054）呼吸停
    expect(shouldBreathe(false, false)).toBe(false);
  });

  test('谓词不含移动参数 —— 移动 / 忙碌 fx 期间呼吸照常（属性面不相交的设计保证）', () => {
    // shouldBreathe(online, hasSprite) 的签名里没有移动态：呼吸写 sprite.scaleY、
    // moveTo tween 写容器 x/y、task-fx 是独立 Container —— 叠加不冲突由属性面保证，
    // 这里固化「谓词无法表达移动」这一契约（加参数就是设计回退，测试会先红）。
    expect(shouldBreathe.length).toBe(2);
  });
});

// ============================================================================
// 名字显隐规则
// ============================================================================

describe('名字标签可见性 nametagVisible / overlayVisible', () => {
  test('开关 × zoom 矩阵：开且 zoom 达标才显示', () => {
    expect(nametagVisible(true, 1)).toBe(true); // 默认 zoom
    expect(nametagVisible(true, OVERLAY_MIN_ZOOM)).toBe(true); // 阈值上（含）→ 显示
    expect(nametagVisible(true, OVERLAY_MIN_ZOOM - 0.001)).toBe(false); // 阈值下 → 隐藏
    expect(nametagVisible(true, 0.25)).toBe(false); // 相机下限（小地图级）→ 糊成一片，藏
    expect(nametagVisible(true, 3)).toBe(true); // 相机上限 → 显示
    expect(nametagVisible(false, 1)).toBe(false); // 开关关 → 无条件藏
    expect(nametagVisible(false, 0.25)).toBe(false);
  });

  test('气泡共用可读性阈值 overlayVisible（名字开关不约束气泡 —— 它是聊天反馈不是标签）', () => {
    expect(overlayVisible(OVERLAY_MIN_ZOOM)).toBe(true);
    expect(overlayVisible(OVERLAY_MIN_ZOOM - 1e-9)).toBe(false);
  });
});

describe('开关读取 readNametagsToggle', () => {
  /** 打桩 storage：内存 map + 可选的抛错开关。 */
  function stubStorage(initial: Record<string, string> = {}, throwing = false): NametagStorage {
    const store = new Map(Object.entries(initial));
    return {
      getItem(key: string): string | null {
        if (throwing) throw new Error('storage blocked');
        return store.get(key) ?? null;
      },
    };
  }

  test('缺省开：无键 / 空 storage / 抛错 → 一律开（表现增强不绑架可用性）', () => {
    expect(readNametagsToggle(stubStorage())).toBe(true);
    expect(readNametagsToggle(null)).toBe(true);
    expect(readNametagsToggle(undefined)).toBe(true);
    expect(readNametagsToggle(stubStorage({}, true))).toBe(true);
  });

  test("'0' = 关；其它值（含 '1' / 乱码）= 开", () => {
    expect(readNametagsToggle(stubStorage({ [STRATIX_NAMETAGS_TOGGLE_KEY]: '0' }))).toBe(false);
    expect(readNametagsToggle(stubStorage({ [STRATIX_NAMETAGS_TOGGLE_KEY]: '1' }))).toBe(true);
    expect(readNametagsToggle(stubStorage({ [STRATIX_NAMETAGS_TOGGLE_KEY]: 'garbage' }))).toBe(true);
  });
});

// ============================================================================
// 说话气泡脉动
// ============================================================================

describe('说话气泡 alpha speakingDotAlpha', () => {
  test('全时域钳在 [SPEAKING_ALPHA_MIN, 1]', () => {
    for (let t = 0; t < SPEAKING_PULSE_MS * 3; t += 13) {
      const alpha = speakingDotAlpha(t);
      expect(alpha).toBeGreaterThanOrEqual(SPEAKING_ALPHA_MIN);
      expect(alpha).toBeLessThanOrEqual(1);
    }
  });

  test('周期性 + 有起伏（脉动，不是常亮）', () => {
    expect(speakingDotAlpha(0)).toBeCloseTo(speakingDotAlpha(SPEAKING_PULSE_MS), 9);
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let t = 0; t < SPEAKING_PULSE_MS; t += 15) {
      const alpha = speakingDotAlpha(t);
      min = Math.min(min, alpha);
      max = Math.max(max, alpha);
    }
    expect(max - min).toBeGreaterThan(0.2);
  });
});

// ============================================================================
// 性能：50 单位单帧成本（规格④，jsdom/node 打桩）
// ============================================================================

describe('性能：presence tick 纯计算成本（50 单位满帧预算）', () => {
  test('一帧 50 单位的呼吸 + 可见性计算在毫秒量级（预算 16.6ms 的零头）', () => {
    // 打桩 50 个单位（真实 id 形态），跑 1000 帧纯计算（presence tick 每帧对每单位做的事：
    // 一次呼吸三角函数缩放 + 两个可见性布尔 —— 渲染层只是把这些数字贴到已有显示对象上）。
    const units: { id: string; phase: number; online: boolean; hasLevel: boolean }[] = [];
    for (let i = 0; i < 50; i += 1) {
      units.push({
        id: `unit_ch_${i}`,
        phase: breathPhaseFor(`unit_ch_${i}`),
        online: i % 10 !== 0, // 混一点离线（走「复位」分支）
        hasLevel: i % 3 !== 0, // 混一点无 Lv 的
      });
    }
    const tagsOn = nametagVisible(true, 1);
    const bubblesOn = overlayVisible(1);

    const frames = 1000;
    const started = Date.now();
    for (let frame = 0; frame < frames; frame += 1) {
      const now = frame * BREATH_STYLE.tickMs;
      for (const unit of units) {
        // eslint-disable-next-line no-unused-expressions
        shouldBreathe(unit.online, true)
          ? breathScaleY(0.8, unit.phase, now)
          : 0.8; // 离线分支：复位基值（渲染层 setScale 幂等）
        // eslint-disable-next-line no-unused-expressions
        tagsOn && unit.hasLevel;
        // eslint-disable-next-line no-unused-expressions
        bubblesOn && frame;
      }
    }
    const perFrameMs = (Date.now() - started) / frames;

    // 断言单帧计算量级：50 单位 < 1ms（比 16.6ms 预算松一个量级以上 —— CI 机器抖动不误伤）。
    expect(perFrameMs).toBeLessThan(1);
  });

  test('tick 间隔 / 幅度常量守住规格口径（60ms 步进 + ±2%）', () => {
    expect(BREATH_STYLE.tickMs).toBeLessThanOrEqual(100);
    expect(BREATH_STYLE.amplitude).toBe(0.02);
    expect(NAMETAG_STYLE.yAboveUnit).toBeLessThan(-50); // 名字锚点在头顶之上（负 = 向上）
  });
});

// ============================================================================
// 附带口径：UnitView.level 数据面（老单位不误伤）
// ============================================================================

describe('UnitView.level 兼容（task_062 名字标签数据面）', () => {
  test('level 是可选字段：不带 level 的老快照不破类型（undefined → 渲染侧回落 null）', () => {
    const legacy: UnitView = { id: 'u1', name: '老单位', status: 'idle', missionId: null, power: 1 };
    expect(legacy.level ?? null).toBeNull(); // 只显名字，不编造数值
  });
});
