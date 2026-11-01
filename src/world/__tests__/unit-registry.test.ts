/**
 * 单测：单位对账与命中判定（world/objects/unit-object.ts + world/objects/unit-registry.ts）。
 *
 * 这两个模块保持零 Phaser 依赖，所以可以在 jest 的 node 环境下直接跑。
 * 重点守卫一条容易写反的铁律：**core 的 UnitView 不含坐标，位置由世界层自治，同步绝不能重置它。**
 */

import type { UnitView } from '../../core/types';
import { UnitRegistry } from '../objects/unit-registry';

const WORLD = { x: 0, y: 0, width: 2000, height: 1000 };

function unit(id: string, patch: Partial<UnitView> = {}): UnitView {
  return { id, name: id, status: 'idle', missionId: null, power: 1, ...patch };
}

function createRegistry(): UnitRegistry {
  return new UnitRegistry({ worldBounds: WORLD, hitRadius: 20 });
}

describe('sync —— 对账', () => {
  test('新单位被创建并落位在战场范围内', () => {
    const registry = createRegistry();
    const result = registry.sync([unit('u1'), unit('u2')]);

    expect(result.added).toEqual(['u1', 'u2']);
    expect(registry.size).toBe(2);

    for (const object of registry.list()) {
      const { x, y } = object.position;
      expect(x).toBeGreaterThanOrEqual(WORLD.x);
      expect(y).toBeGreaterThanOrEqual(WORLD.y);
      expect(x).toBeLessThanOrEqual(WORLD.x + WORLD.width);
      expect(y).toBeLessThanOrEqual(WORLD.y + WORLD.height);
    }
  });

  test('新单位之间不会挤在同一格上', () => {
    const registry = createRegistry();
    registry.sync([unit('u1'), unit('u2'), unit('u3')]);

    const positions = registry.list().map((o) => `${o.position.x},${o.position.y}`);
    expect(new Set(positions).size).toBe(3);
  });

  test('第一个新单位落在战场中心（默认镜头就能看见它）', () => {
    // @since v3.9（task_026）：落位从中心向外铺 —— 建完角色若落在战场角落，
    // 用户在画面上根本看不到，等于"角色没进战场"。
    const registry = createRegistry();

    registry.sync([unit('u1')]);

    const { x, y } = registry.get('u1')?.position ?? { x: -1, y: -1 };
    expect(x).toBe(WORLD.x + WORLD.width / 2);
    expect(y).toBe(WORLD.y + WORLD.height / 2);
  });

  test('后续单位以战场中心为轴左右交替铺开（不被推到右半边）', () => {
    // @since v3.9（task_026）：默认镜头右半边压着 HUD 右栏（半透明面板），
    // 单向向右铺的单位会被面板压暗 —— 角色的皮肤色就看不清了。
    const registry = createRegistry();

    registry.sync([unit('u1'), unit('u2'), unit('u3'), unit('u4')]);

    const centerX = WORLD.x + WORLD.width / 2;
    const xs = registry.list().map((o) => o.position.x);
    // 既有中心上的单位，也有中心左边的单位 → 至少有一个落在中心左侧。
    expect(xs.some((x) => x < centerX)).toBe(true);
    expect(xs.some((x) => x === centerX)).toBe(true);
    // 每个单位都不重复占格。
    expect(new Set(registry.list().map((o) => `${o.position.x},${o.position.y}`)).size).toBe(4);
  });

  test('广播里消失的单位被移除（state 发的是完整快照）', () => {
    const registry = createRegistry();
    registry.sync([unit('u1'), unit('u2')]);
    const result = registry.sync([unit('u2')]);

    expect(result.removed).toEqual(['u1']);
    expect(registry.size).toBe(1);
    expect(registry.get('u1')).toBeUndefined();
  });

  test('业务态变化才算 updated，完全相同的快照不算', () => {
    const registry = createRegistry();
    registry.sync([unit('u1', { status: 'idle' })]);

    expect(registry.sync([unit('u1', { status: 'idle' })]).updated).toEqual([]);
    expect(registry.sync([unit('u1', { status: 'busy' })]).updated).toEqual(['u1']);
    expect(registry.get('u1')?.status).toBe('busy');
  });

  test('★ 同步业务态不得重置位置（坐标真相在世界层，core 每次广播都没有坐标）', () => {
    const registry = createRegistry();
    registry.sync([unit('u1')]);

    const moved = registry.get('u1')?.position ?? { x: -1, y: -1 };
    registry.get('u1')?.setPosition(800, 700);

    // 换一个 id 不同、状态也不同的新快照再次广播
    registry.sync([unit('u1', { status: 'busy', name: '改名了', power: 99, missionId: 'm1' })]);

    expect(registry.get('u1')?.position).toEqual({ x: 800, y: 700 });
    expect(registry.get('u1')?.status).toBe('busy');
    expect(registry.get('u1')?.power).toBe(99);
    // 旧对象确实被移动过，确保上面的断言不是"从未动过"造成的假阳性
    expect(moved).not.toEqual({ x: 800, y: 700 });
  });

  test('落位槽位用满后回绕，不会把单位放到战场外', () => {
    const registry = new UnitRegistry({ worldBounds: { x: 0, y: 0, width: 300, height: 300 } });
    registry.sync(Array.from({ length: 80 }, (_, i) => unit(`u${i}`)));

    expect(registry.size).toBe(80);
    for (const object of registry.list()) {
      expect(object.position.x).toBeGreaterThanOrEqual(0);
      expect(object.position.x).toBeLessThanOrEqual(300);
      expect(object.position.y).toBeGreaterThanOrEqual(0);
      expect(object.position.y).toBeLessThanOrEqual(300);
    }
  });
});

describe('命中判定', () => {
  test('queryBounds 返回与矩形相交的单位（相交即可，不要求完全包含）', () => {
    const registry = createRegistry();
    registry.sync([unit('u1'), unit('u2')]);
    const positions = registry.list().map((o) => o.position);
    registry.get('u1')?.setPosition(100, 100);
    registry.get('u2')?.setPosition(1500, 900);

    const hits = registry.queryBounds({ x: 50, y: 50, width: 200, height: 200 });
    expect(hits).toEqual(['u1']);
    expect(positions.length).toBe(2);
  });

  test('框选结果按落位顺序稳定输出', () => {
    const registry = createRegistry();
    registry.sync([unit('u1'), unit('u2'), unit('u3')]);
    registry.list().forEach((o, i) => o.setPosition(100 + i * 10, 100));

    expect(registry.queryBounds({ x: 0, y: 0, width: 500, height: 500 })).toEqual(['u1', 'u2', 'u3']);
  });

  test('hitTest 返回最上层（后加入）的那一个', () => {
    const registry = createRegistry();
    registry.sync([unit('under'), unit('over')]);
    registry.get('under')?.setPosition(500, 500);
    registry.get('over')?.setPosition(505, 505); // 与上一个重叠，且后加入

    expect(registry.hitTest({ x: 502, y: 502 })?.id).toBe('over');
  });

  test('点在命中半径外返回 null', () => {
    const registry = createRegistry();
    registry.sync([unit('u1')]);
    registry.get('u1')?.setPosition(100, 100);

    expect(registry.hitTest({ x: 100, y: 100 })?.id).toBe('u1');
    expect(registry.hitTest({ x: 500, y: 500 })).toBeNull();
  });

  test('空战场查询不炸', () => {
    const registry = createRegistry();
    expect(registry.queryBounds({ x: 0, y: 0, width: 100, height: 100 })).toEqual([]);
    expect(registry.hitTest({ x: 0, y: 0 })).toBeNull();
  });
});

describe('destroy', () => {
  test('清空全部单位', () => {
    const registry = createRegistry();
    registry.sync([unit('u1'), unit('u2')]);
    registry.destroy();

    expect(registry.size).toBe(0);
    expect(registry.list()).toEqual([]);
  });
});

// ============================================================================
// 恢复站位（@since v3.12，task_033）：unit_positions 表恢复的坐标优先于网格落位
// ============================================================================

describe('恢复站位（restoredPositions）', () => {
  test('有记录的单位按记录落位，无记录的沿用网格落位', () => {
    const registry = createRegistry();
    registry.applyRestoredPositions(new Map([['u1', { x: 123, y: 456 }]]));
    const result = registry.sync([unit('u1'), unit('u2')]);

    expect(result.added).toEqual(['u1', 'u2']);
    expect(registry.get('u1')?.position).toEqual({ x: 123, y: 456 });
    // u2 没记录 → 网格落位（战场中心起步），且不与恢复位重叠语义冲突
    const u2 = registry.get('u2')?.position;
    expect(u2).toBeDefined();
    expect(u2).not.toEqual({ x: 123, y: 456 });
  });

  test('构造器选项与 applyRestoredPositions 两条注入路径等效', () => {
    const viaCtor = new UnitRegistry({ worldBounds: WORLD, restoredPositions: new Map([['u1', { x: 7, y: 8 }]]) });
    viaCtor.sync([unit('u1')]);
    expect(viaCtor.get('u1')?.position).toEqual({ x: 7, y: 8 });
  });

  test('传 undefined 是 no-op：不清空已注入的种子（dev 页不该能抹掉生产侧注入）', () => {
    const registry = createRegistry();
    registry.applyRestoredPositions(new Map([['u1', { x: 7, y: 8 }]]));
    registry.applyRestoredPositions(undefined);
    registry.sync([unit('u1')]);

    expect(registry.get('u1')?.position).toEqual({ x: 7, y: 8 });
  });

  test('恢复位可以超出默认网格（持久化坐标是历史事实，不做落位钳制）', () => {
    const registry = createRegistry();
    registry.applyRestoredPositions(new Map([['u1', { x: -9999, y: 9999 }]]));
    registry.sync([unit('u1')]);

    expect(registry.get('u1')?.position).toEqual({ x: -9999, y: 9999 });
  });

  test('destroy 清掉种子：重启场景后不残留旧坐标', () => {
    const registry = createRegistry();
    registry.applyRestoredPositions(new Map([['u1', { x: 7, y: 8 }]]));
    registry.destroy();
    registry.sync([unit('u1')]);

    // 种子没了 → 落回战场中心（网格落位的第一个位置）
    expect(registry.get('u1')?.position).toEqual({ x: WORLD.x + WORLD.width / 2, y: WORLD.y + WORLD.height / 2 });
  });
});

// ============================================================================
// 在线位镜像（@since v3.30，task_054，agent 健康监测）：UnitObject.online 缺省 true
//（老档 / 未探测不误伤），online 翻转算对账变化（灰显样式跟着广播走）。规格⑤「灰显」的
// world 侧数据前提；Phaser 侧的 alpha / tint 应用在 unit-layer（要真场景，见渲染层）。
// ============================================================================

describe('online —— 在线位镜像（task_054）', () => {
  test('缺省在线：不带 online 字段的单位 online=true（老档不误伤）', () => {
    const registry = createRegistry();
    registry.sync([unit('u1')]);
    expect(registry.get('u1')?.online).toBe(true);
  });

  test('掉线镜像：online=false 透传；恢复 true 透传', () => {
    const registry = createRegistry();
    registry.sync([unit('u1', { online: false })]);
    expect(registry.get('u1')?.online).toBe(false);

    registry.sync([unit('u1', { online: true })]);
    expect(registry.get('u1')?.online).toBe(true);
  });

  test('在线位翻转算对账变化（updated），相同快照不算', () => {
    const registry = createRegistry();
    registry.sync([unit('u1')]);
    expect(registry.sync([unit('u1')]).updated).toEqual([]); // 相同 → 不算

    expect(registry.sync([unit('u1', { online: false })]).updated).toEqual(['u1']); // 掉线
    expect(registry.sync([unit('u1', { online: true })]).updated).toEqual(['u1']); // 恢复
    expect(registry.sync([unit('u1', { online: true })]).updated).toEqual([]); // 稳定
  });

  test('掉线不重置位置（同业务态同步纪律：位置真相在世界层）', () => {
    const registry = createRegistry();
    registry.sync([unit('u1')]);
    const before = registry.get('u1')?.position;
    registry.sync([unit('u1', { online: false })]);
    const after = registry.get('u1')?.position;
    expect(after).toEqual(before);
  });
});

// ============================================================================
// 等级镜像（@since v3.37，task_062，名字标签数据面）：UnitObject.level 缺省 null
//（老单位 / 非 character 单位不编造数值）；等级翻转算对账变化（名字标签的 Lv 小字
// 跟着刷新 —— 渲染侧应用在 unit-layer，要真场景，见渲染层）。
// ============================================================================

describe('level —— 等级镜像（task_062 名字标签数据面）', () => {
  test('缺省 null：不带 level 字段的单位不编造数值', () => {
    const registry = createRegistry();
    registry.sync([unit('u1')]);
    expect(registry.get('u1')?.level).toBeNull();
  });

  test('带 level 透传；升级翻转算对账变化，相同快照不算', () => {
    const registry = createRegistry();
    registry.sync([unit('u1', { level: 3 })]);
    expect(registry.get('u1')?.level).toBe(3);

    expect(registry.sync([unit('u1', { level: 3 })]).updated).toEqual([]); // 同级 → 不算
    expect(registry.sync([unit('u1', { level: 4 })]).updated).toEqual(['u1']); // 升级 → 刷新
    expect(registry.get('u1')?.level).toBe(4);

    // 有 → 无（角色解绑等异常路径）：翻转也算变化，回落 null 只显名字。
    expect(registry.sync([unit('u1')]).updated).toEqual(['u1']);
    expect(registry.get('u1')?.level).toBeNull();
  });
});
