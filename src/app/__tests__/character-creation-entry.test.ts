/**
 * 集成测试：**新建角色三入口 → 建档向导必挂**（@since v3.3，task_226）。
 *
 * 依据：docs/DESIGN-character-creation.md §3.A（入口层无条件挂向导）与 §3.B（角色中心 CTA）。
 * 场景取**最坏情况**：0 角色 + detectedAgents 为空（agent 扫描未完成 / 零结果）。
 *   why 必须是这个场景：CC-B2 的根因就是「入口处一次定生死」—— service 侧检测逐条广播，
 *   用户点按钮的那一瞬间状态里可能一个 agent 都还没有。入口若因此拒绝挂向导，
 *   用户点「新建角色」就毫无反应（更糟：退到 0 角色的角色中心死胡同）。
 *   故口径：**入口只负责把面板挂起来**，能不能建由向导的扫描步自己呈现。
 *
 * 装配与生产同构：真的 onboarding host + 真的三个 HUD 入口
 *   （战场空态 CTA / 主屏顶栏「＋ 角色」/ 角色中心「＋ 新建角色」）。
 *   接线方式照抄组合根（app/main/main-entry.ts）：HUD 派事件 / 回调 → openCharacterWizard → reopen({force:true})。
 *
 * @since v3.3（task_228 · CC-03）：装配体提取到共用件 `helpers/creation-assembly.ts`
 *   （与 V1-V12 回归矩阵套件共用同一套装配 —— 两边一漂移，"入口可达"的结论就不可信）。
 *
 * @jest-environment jsdom
 */

import { assembleCreationFlow } from './helpers/creation-assembly';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('新建角色入口（task_226）：0 角色 + 0 agent 时向导必挂', () => {
  test('入口一：战场空态 CTA → 向导挂上', () => {
    const a = assembleCreationFlow();
    expect(a.wizard()).toBeNull();

    a.clickBattlefieldEmptyCta();

    expect(a.wizard()).not.toBeNull();
    a.unmount();
  });

  test('入口二：主屏顶栏「＋ 角色」→ 向导挂上', () => {
    const a = assembleCreationFlow();

    a.clickMainTopbarCreate();

    expect(a.wizard()).not.toBeNull();
    a.unmount();
  });

  test('入口三：角色中心空态 CTA → 向导挂上', () => {
    const a = assembleCreationFlow();

    a.clickCharacterCenterCta();

    expect(a.wizard()).not.toBeNull();
    a.unmount();
  });

  test('入口四：角色中心子屏顶栏常驻钮 → 向导挂上', () => {
    const a = assembleCreationFlow();

    a.clickCharacterCenterTopbar();

    expect(a.wizard()).not.toBeNull();
    a.unmount();
  });

  test('连续点多次 → 向导始终在（入口可达，不是一次性的）', () => {
    const a = assembleCreationFlow();

    a.clickBattlefieldEmptyCta();
    expect(a.wizard()).not.toBeNull();
    a.clickMainTopbarCreate();
    expect(a.wizard()).not.toBeNull();
    a.clickCharacterCenterCta();
    expect(a.wizard()).not.toBeNull();

    a.unmount();
  });
});
