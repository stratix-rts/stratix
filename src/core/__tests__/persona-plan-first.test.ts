/**
 * 单测：personaPlanFirst 判定（task_049）—— 「先计划后执行」人设的两路识别。
 *
 * 两路共用一个词（PERSONA_PLAN_FIRST_MARKER = '先出计划'，判定口径唯一在
 * core/character/persona）：
 *   ① 手写路径：自由文本 persona 里写下「先出计划」（如 043 分节结构的 RULES 里手补一行）；
 *   ② 预设路径：persona-presets 的 plan-first 预设把标记写进 RULES 节 —— 该路径的断言在
 *      hud/__tests__/onboarding-screen.test.ts（预设库归属 hud，core 测试不跨层 import hud；
 *      这里只锁判定函数本身对「含 / 不含」的行为，预设侧锁「预设文本里确实有」）。
 */

import { personaPlanFirst, PERSONA_PLAN_FIRST_MARKER } from '../character/persona';

describe('personaPlanFirst（task_049：两路识别的判定函数）', () => {
  test('手写路径：persona 文本含 PERSONA_PLAN_FIRST_MARKER 即判定 plan-first', () => {
    const handWritten = [
      '# 角色定位 ROLE',
      '',
      '大项目执行者。',
      '',
      '# 行为规则 RULES',
      '',
      '- 先出计划，经批准后再执行',
    ].join('\n');
    expect(personaPlanFirst(handWritten)).toBe(true);
  });

  test('标记出现在任意分节都认（不限定 RULES 节 —— 判定只看短语本身）', () => {
    expect(personaPlanFirst('# 自主程度 AUTONOMY\n\n先出计划再动手')).toBe(true);
    expect(personaPlanFirst('开场白就写：先出计划')).toBe(true);
  });

  test('不含标记的 persona（无论结构多像）一律 false', () => {
    expect(personaPlanFirst('')).toBe(false);
    expect(personaPlanFirst('# 行为规则 RULES\n\n- 先读懂上下文再动手')).toBe(false);
    // 近义但不是标记词的不认 —— 口径是短语级精确包含，不做语义猜测
    expect(personaPlanFirst('先列个大纲看看')).toBe(false);
    expect(personaPlanFirst('计划先行，动手之前想清楚')).toBe(false);
  });

  test('标记词是导出常量（prompt 指令 / 判定 / 展示剥离三方共用同一个词）', () => {
    expect(PERSONA_PLAN_FIRST_MARKER).toBe('先出计划');
    expect(personaPlanFirst(PERSONA_PLAN_FIRST_MARKER)).toBe(true);
  });
});
