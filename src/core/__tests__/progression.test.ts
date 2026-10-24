/**
 * 单测：core/progression（task_040）—— 养成数值单一真相源的三块数据全路径穷举：
 *   1. 曲线（curve.ts）：生成公式对拍（每一档）、累计阈值一致性、经验 → 等级全路径
 *      （首档 / 中段 / 封顶 / 溢出 / 脏数据）、levelUpCheck（单级 / 跨多级 / 封顶 / 对账）；
 *   2. 权重（weights.ts）：来源全覆盖、全部 > 0（发射点契约 amount > 0）、
 *      迁移等价（与 app/services/exp-config 转发层恒等，见 progression-service.test.ts）；
 *   3. 解锁表（unlocks.ts）：门槛单调、无空洞（词表恰好各出现一次）、L1 含基础类别、
 *      L12 全量（含 rare_variants 标记位）、累计查询的边界夹取。
 *
 * 纯函数不打桩；表值是字面量，公式对拍测试防止「手改表漏一档」。
 */

import {
  EXP_TABLE,
  EXP_WEIGHTS,
  MAX_LEVEL,
  UNLOCKS,
  UNLOCK_KEYS,
  expSpanForLevel,
  expWeightFor,
  experienceIntoLevel,
  experienceToNextLevel,
  isMaxLevel,
  levelForExperience,
  levelUpCheck,
  newlyUnlockedBetween,
  totalExpForLevel,
  unlockLevelOf,
  unlockedCategoriesAt,
} from '../progression';
import type { ExpSource } from '../types';

// ============================================================================
// 1. 曲线：EXP_TABLE 对拍（生成规则：round5(100 × 1.5^(L-1))）
// ============================================================================

describe('EXP_TABLE：生成公式对拍（每一档）', () => {
  /** round5 = 四舍五入到最近的 5 的倍数（表值的唯一生成规则，见 curve.ts 文件头）。 */
  const round5 = (raw: number): number => Math.round(raw / 5) * 5;

  test('表覆盖 L1..L19 恰好 19 档（L20 封顶，没有 20→21 的跨度）', () => {
    expect(Object.keys(EXP_TABLE).map(Number).sort((a, b) => a - b)).toEqual(
      Array.from({ length: MAX_LEVEL - 1 }, (_, i) => i + 1)
    );
  });

  test('每一档都等于公式展开值：首档 100、×1.5 递增、四舍五入到 5 的倍数', () => {
    for (let level = 1; level <= MAX_LEVEL - 1; level += 1) {
      expect(EXP_TABLE[level]).toBe(round5(100 * 1.5 ** (level - 1)));
    }
  });

  test('首档与关键档（曲线手感锚点）：L1→2 = 100、L2→3 = 150、L3→4 = 225、L4→5 = 340（337.5 取整）', () => {
    expect(EXP_TABLE[1]).toBe(100);
    expect(EXP_TABLE[2]).toBe(150);
    expect(EXP_TABLE[3]).toBe(225);
    expect(EXP_TABLE[4]).toBe(340);
  });

  test('全部跨度为 5 的倍数且严格单调递增（前快后慢的成长手感）', () => {
    let previous = 0;
    for (let level = 1; level <= MAX_LEVEL - 1; level += 1) {
      const span = EXP_TABLE[level] as number;
      expect(span % 5).toBe(0);
      expect(span).toBeGreaterThan(previous);
      previous = span;
    }
  });

  test('MAX_LEVEL = 20（任务规格：L1→L20 封顶）', () => {
    expect(MAX_LEVEL).toBe(20);
  });
});

describe('totalExpForLevel / expSpanForLevel：累计与跨度查询', () => {
  test('累计阈值 = 前缀和：L1 = 0（新角色免费）、L2 = 100、L3 = 250、L20 = 443175', () => {
    expect(totalExpForLevel(1)).toBe(0);
    expect(totalExpForLevel(2)).toBe(100);
    expect(totalExpForLevel(3)).toBe(250);
    expect(totalExpForLevel(MAX_LEVEL)).toBe(
      Array.from({ length: MAX_LEVEL - 1 }, (_, i) => EXP_TABLE[i + 1] as number).reduce((a, b) => a + b, 0)
    );
  });

  test('span 查表：L1 → 100；封顶档（20）→ 0（没有下一级）；脏输入夹回合法区间', () => {
    expect(expSpanForLevel(1)).toBe(100);
    expect(expSpanForLevel(MAX_LEVEL)).toBe(0);
    expect(expSpanForLevel(MAX_LEVEL + 5)).toBe(0);
    expect(expSpanForLevel(0)).toBe(EXP_TABLE[1]); // <1 按 1
    expect(expSpanForLevel(Number.NaN)).toBe(EXP_TABLE[1]);
  });
});

describe('levelForExperience：经验 → 等级（首档 / 中段 / 封顶 / 脏数据）', () => {
  test('首档：0 → 1；99 → 1；100 → 2（恰好卡在阈值上立刻升级）', () => {
    expect(levelForExperience(0)).toBe(1);
    expect(levelForExperience(99)).toBe(1);
    expect(levelForExperience(100)).toBe(2);
  });

  test('中段：第二档区间（100..249）都是 2 级；250 = L3 起点', () => {
    expect(levelForExperience(101)).toBe(2);
    expect(levelForExperience(249)).toBe(2);
    expect(levelForExperience(250)).toBe(3);
  });

  test('中段（更靠后）：L12 起点 17105（全类别解锁的门槛级）', () => {
    expect(levelForExperience(totalExpForLevel(12) - 1)).toBe(11);
    expect(levelForExperience(totalExpForLevel(12))).toBe(12);
  });

  test('封顶：443174 → 19；443175 → 20；远超也停 20（经验继续累计是另一件事）', () => {
    expect(levelForExperience(totalExpForLevel(MAX_LEVEL) - 1)).toBe(MAX_LEVEL - 1);
    expect(levelForExperience(totalExpForLevel(MAX_LEVEL))).toBe(MAX_LEVEL);
    expect(levelForExperience(Number.MAX_SAFE_INTEGER)).toBe(MAX_LEVEL);
  });

  test('脏数据兜底：NaN / 负数 / Infinity 都落在 1 级，不产出 NaN 级', () => {
    expect(levelForExperience(Number.NaN)).toBe(1);
    expect(levelForExperience(-50)).toBe(1);
    expect(levelForExperience(Number.POSITIVE_INFINITY)).toBe(1);
  });

  test('isMaxLevel 与 levelForExperience 一致（不另立第二份判定）', () => {
    expect(isMaxLevel(MAX_LEVEL)).toBe(true);
    expect(isMaxLevel(MAX_LEVEL - 1)).toBe(false);
    expect(isMaxLevel(levelForExperience(Number.MAX_SAFE_INTEGER))).toBe(true);
  });
});

describe('本级进度 / 距下一级（曲线化语义：不再是取余）', () => {
  test('experienceIntoLevel：L2 区间内 130 → 30；跨档起点归 0；满级记 0', () => {
    expect(experienceIntoLevel(130)).toBe(30);
    expect(experienceIntoLevel(100)).toBe(0);
    expect(experienceIntoLevel(250)).toBe(0);
    expect(experienceIntoLevel(totalExpForLevel(MAX_LEVEL) + 12345)).toBe(0);
  });

  test('experienceToNextLevel：130 → 120（L2→3 需 150）；满级 null；0/负/NaN → 首档跨度', () => {
    expect(experienceToNextLevel(130)).toBe(120);
    expect(experienceToNextLevel(99)).toBe(1);
    expect(experienceToNextLevel(totalExpForLevel(MAX_LEVEL))).toBeNull();
    expect(experienceToNextLevel(0)).toBe(EXP_TABLE[1]);
    expect(experienceToNextLevel(Number.NaN)).toBe(EXP_TABLE[1]);
  });
});

describe('levelUpCheck：升级结算（纯函数，growth 状态机委托的数值底座）', () => {
  test('不到阈值：等级不变、leveledUp false、exp 原样返回', () => {
    expect(levelUpCheck(1, 30)).toEqual({ level: 1, exp: 30, leveledUp: false });
  });

  test('恰好阈值：100 → 2 级，leveledUp true', () => {
    expect(levelUpCheck(1, 100)).toEqual({ level: 2, exp: 100, leveledUp: true });
  });

  test('跨多级一次结算：300 经验 → 3 级（跨 2 级，一条结算不带中间级）', () => {
    expect(levelUpCheck(1, 300)).toEqual({ level: 3, exp: 300, leveledUp: true });
  });

  test('封顶溢出：L20 再加经验 → 等级停 20、exp 原样累计（溢出展示）、不再 leveledUp', () => {
    const settled = levelUpCheck(MAX_LEVEL, totalExpForLevel(MAX_LEVEL) + 999999);
    expect(settled).toEqual({ level: MAX_LEVEL, exp: totalExpForLevel(MAX_LEVEL) + 999999, leveledUp: false });
  });

  test('从 19 到 20 的一次结算（最后一段跨度生效）', () => {
    expect(levelUpCheck(19, totalExpForLevel(20))).toEqual({
      level: 20,
      exp: totalExpForLevel(20),
      leveledUp: true,
    });
  });

  test('对账降级：入参 level 5 / exp 10 → 结算回 1 级，leveledUp false（降级不算升级）', () => {
    expect(levelUpCheck(5, 20)).toEqual({ level: 1, exp: 20, leveledUp: false });
  });

  test('脏入参：level NaN 按 1 起、exp NaN 落 1 级，不产出 NaN', () => {
    expect(levelUpCheck(Number.NaN, 100)).toEqual({ level: 2, exp: 100, leveledUp: true });
    expect(levelUpCheck(1, Number.NaN)).toEqual({ level: 1, exp: Number.NaN, leveledUp: false });
  });
});

// ============================================================================
// 2. 权重表：来源全覆盖 + 全正数（发射点契约 amount > 0）
// ============================================================================

describe('EXP_WEIGHTS：经验来源权重（从 exp-config 迁来）', () => {
  const SOURCES: readonly ExpSource[] = ['task_completed', 'task_failed', 'chat_round'];

  test('三来源全覆盖（缺一个键 = 该来源发射时报 undefined，契约破损）', () => {
    expect(Object.keys(EXP_WEIGHTS).sort()).toEqual([...SOURCES].sort());
  });

  test('数值与 task_039 拍板一致：完成任务 50 / 失败安慰 10 / 一轮对话 5', () => {
    expect(EXP_WEIGHTS.task_completed).toBe(50);
    expect(EXP_WEIGHTS.task_failed).toBe(10);
    expect(EXP_WEIGHTS.chat_round).toBe(5);
  });

  test('全部 > 0：权重 ≤ 0 的语义是发射点整类不发（要关某来源改表，缺省三来源都得发）', () => {
    for (const source of SOURCES) {
      expect(EXP_WEIGHTS[source]).toBeGreaterThan(0);
    }
  });

  test('expWeightFor 查表等价（组合根把它注入两个发射点 —— 不许在查表函数里再写数值）', () => {
    for (const source of SOURCES) {
      expect(expWeightFor(source)).toBe(EXP_WEIGHTS[source]);
    }
  });

  test('量级参照：一个任务完成（50）恰好是首档跨度（100）的一半 —— 首屏成长反馈快', () => {
    expect(EXP_WEIGHTS.task_completed * 2).toBe(EXP_TABLE[1]);
  });
});

// ============================================================================
// 3. 解锁表：完整性 + 查询
// ============================================================================

describe('UNLOCKS：解锁表完整性（等级单调 / 无空洞 / L1 基础 / L12 全量）', () => {
  test('门槛等级升序：1 / 3 / 5 / 8 / 12，且都在 1..MAX_LEVEL 内', () => {
    const levels = Object.keys(UNLOCKS).map(Number);
    const ascending = [...levels].sort((a, b) => a - b);
    expect(levels).toEqual(ascending);
    expect(ascending).toEqual([1, 3, 5, 8, 12]);
    for (const level of levels) {
      expect(level).toBeGreaterThanOrEqual(1);
      expect(level).toBeLessThanOrEqual(MAX_LEVEL);
    }
  });

  test('无空洞：词表每个键恰好出现一次（不重复解锁、不缺席）', () => {
    const all = Object.values(UNLOCKS).flat();
    expect(new Set(all).size).toBe(all.length); // 无重复
    expect([...all].sort()).toEqual([...UNLOCK_KEYS].sort()); // 无缺席、无多余
  });

  test('每档非空（空档 = 门槛存在却什么都不解锁，纯噪音）', () => {
    for (const entries of Object.values(UNLOCKS)) {
      expect(entries.length).toBeGreaterThan(0);
    }
  });

  test('L1 含基础六件套：body/head/hair/eyes/ears/facial（建档即有的长相底子）', () => {
    expect(new Set(UNLOCKS[1] as string[])).toEqual(
      new Set(['body', 'head', 'hair', 'eyes', 'ears', 'facial'])
    );
  });

  test('档位内容按规格：L3 服装 / L5 饰品 / L8 武装 / L12 补全 + 稀有标记位', () => {
    expect(new Set(UNLOCKS[3] as string[])).toEqual(new Set(['torso', 'legs', 'feet']));
    expect(new Set(UNLOCKS[5] as string[])).toEqual(new Set(['hat', 'backpack']));
    expect(new Set(UNLOCKS[8] as string[])).toEqual(new Set(['weapon', 'shield', 'cape']));
    expect(new Set(UNLOCKS[12] as string[])).toEqual(
      new Set(['nose', 'arms', 'hands', 'neck', 'shoulders', 'wrists', 'quiver', 'shadow', 'rare_variants'])
    );
  });

  test('rare_variants 是标记位且只在 L12 出现（L12 前任何等级都拿不到）', () => {
    expect(UNLOCK_KEYS).toContain('rare_variants');
    const withRare = Object.entries(UNLOCKS).filter(([, keys]) =>
      (keys as readonly string[]).includes('rare_variants')
    );
    expect(withRare.map(([level]) => Number(level))).toEqual([12]);
  });
});

describe('unlockedCategoriesAt：累计查询（含该级当档）', () => {
  test('L1 = 基础六件套（建档底子，不存在一级都没解锁的角色）', () => {
    expect(unlockedCategoriesAt(1)).toEqual(['body', 'head', 'hair', 'eyes', 'ears', 'facial']);
  });

  test('门槛之间保持上一档集合：L2 与 L1 相同、L4 与 L3 相同', () => {
    expect(unlockedCategoriesAt(2)).toEqual(unlockedCategoriesAt(1));
    expect(unlockedCategoriesAt(4)).toEqual(unlockedCategoriesAt(3));
  });

  test('L3 累计 = 基础 + 服装；L12 / MAX = 全量（含 rare_variants）', () => {
    expect(unlockedCategoriesAt(3)).toEqual([...(UNLOCKS[1] as string[]), ...(UNLOCKS[3] as string[])]);
    expect(new Set(unlockedCategoriesAt(12))).toEqual(new Set(UNLOCK_KEYS));
    expect(unlockedCategoriesAt(MAX_LEVEL)).toEqual([...UNLOCK_KEYS]);
  });

  test('输出顺序稳定（按门槛升序、同档按表列顺序）—— UI 直接拿去渲染分组', () => {
    expect(unlockedCategoriesAt(MAX_LEVEL)).toEqual([...UNLOCK_KEYS]);
    expect(unlockedCategoriesAt(3).slice(0, 6)).toEqual([...(UNLOCKS[1] as readonly string[])]);
  });

  test('脏输入夹取：level < 1 按 1、超过 MAX 按 MAX、NaN 按 1', () => {
    expect(unlockedCategoriesAt(0)).toEqual(unlockedCategoriesAt(1));
    expect(unlockedCategoriesAt(-3)).toEqual(unlockedCategoriesAt(1));
    expect(unlockedCategoriesAt(MAX_LEVEL + 9)).toEqual(unlockedCategoriesAt(MAX_LEVEL));
    expect(unlockedCategoriesAt(Number.NaN)).toEqual(unlockedCategoriesAt(1));
    expect(unlockedCategoriesAt(3.9)).toEqual(unlockedCategoriesAt(3)); // 小数向下取整
  });
});

describe('unlockLevelOf / newlyUnlockedBetween：升级反馈查询（@since v3.20，task_041）', () => {
  test('unlockLevelOf：键 → 解锁门槛（与 UNLOCKS 表一致）', () => {
    expect(unlockLevelOf('body')).toBe(1);
    expect(unlockLevelOf('facial')).toBe(1);
    expect(unlockLevelOf('torso')).toBe(3);
    expect(unlockLevelOf('hat')).toBe(5);
    expect(unlockLevelOf('shield')).toBe(8);
    expect(unlockLevelOf('rare_variants')).toBe(12);
    // 词表外（防御漂移）：null —— 消费方按「不设门槛」处理，不抛错。
    expect(unlockLevelOf('tail')).toBeNull();
  });

  test('newlyUnlockedBetween：跨过门槛才非空（升级 toast 的裁决依据）', () => {
    // L1→L2：门槛之间，无新类别。
    expect(newlyUnlockedBetween(1, 2)).toEqual([]);
    // L2→L3：服装档。
    expect(newlyUnlockedBetween(2, 3)).toEqual(['torso', 'legs', 'feet']);
    // 门槛之内（L3→L4）无新解锁。
    expect(newlyUnlockedBetween(3, 4)).toEqual([]);
    // 连升跨多档：区间内所有门槛都算上。
    expect(newlyUnlockedBetween(4, 8)).toEqual(['hat', 'backpack', 'weapon', 'shield', 'cape']);
    // L11→L12：补全档 + rare_variants 标记位。
    expect(newlyUnlockedBetween(11, 12)).toEqual([
      'nose', 'arms', 'hands', 'neck', 'shoulders', 'wrists', 'quiver', 'shadow', 'rare_variants',
    ]);
  });

  test('newlyUnlockedBetween：非升级（to ≤ from）与脏输入兜底 —— 不越权追加', () => {
    expect(newlyUnlockedBetween(5, 5)).toEqual([]);
    expect(newlyUnlockedBetween(6, 5)).toEqual([]);
    // NaN 夹到 L1：from = 1（与 unlockedCategoriesAt 同一兜底口径），不是抛错。
    expect(newlyUnlockedBetween(Number.NaN, 3)).toEqual(['torso', 'legs', 'feet']);
    expect(newlyUnlockedBetween(2, MAX_LEVEL + 9)).toEqual(newlyUnlockedBetween(2, MAX_LEVEL));
    expect(newlyUnlockedBetween(2.9, 3.1)).toEqual(['torso', 'legs', 'feet']); // 小数向下取整
  });
});
