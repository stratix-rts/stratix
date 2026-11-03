/**
 * 集成测试：**v3.4 功能对照表 —— 组合根 1 项（G8 主入口按钮组）**（task_095）。
 *
 * 依据：docs/hud-redesign-proposal.html §4「功能对照表（40/40，零删减）」G8 行：
 *   「主入口按钮组 / 组合根 / 组合根（不变）/ 原样」。
 * 另 39 项在别处（40 项一张表能逐条数清）：
 *   HUD 侧 32 项 → src/hud/__tests__/v34-feature-matrix.test.ts
 *   世界侧 7 项  → src/world/__tests__/v34-feature-matrix.test.ts
 *
 * ============ G8 到底指什么（口径澄清）============
 *   proposal §1.1 的现状功能清单把 G8 写成「主入口按钮组（↗ 回放 / ⟳ 重置）」，
 *   落点标 `main-entry.ts`、参考标 §11 —— 但 §11 是 DEMO-PLAN 的「任务链拆分」，
 *   不是按钮规格；而「↗」「⟳」两个字形在整个产品代码与全部 git 历史里**零命中**：
 *   这一对字形从来没有落地过，是 proposal 行文里的示意图。
 *   产品里真实存在的两个「一键入口」是：
 *     · ↗ 回放 → 当日回放的「▶ 60 秒看完今天」按钮（§4 D4，已在控制岛内可达）；
 *     · ⟳ 重置 → 设置屏的「重置编组」按钮（主屏 ⋯ 菜单 → 去设置 → 可点）。
 *   所以本文件按**实际存在的两个一键入口**来断言 G8（「原样」= 位置与形态不变，
 *   仍在组合根挂出来的 HUD 里），字形对本身的缺位登记在 task_095 的「未尽事项」里。
 *
 * ============ 为什么读文件而不是渲染断言 ============
 *   组合根（main-entry.ts）是 vite build 的唯一装配脚本 —— 它把哪些件挂上、
 *   挂在哪个宿主上，错了会在打包产物里静默复现。仓库里已有同类先例
 *   （src/app/__tests__/main-layout.test.ts 读入口 HTML / 装配脚本守骨架契约）。
 *   这里守的是同一类契约：**一键入口确实被组合根挂上了**，不是「应该在那儿」。
 */

import * as fs from 'fs';
import * as path from 'path';

const APP_DIR = path.join(__dirname, '..');
const MAIN_ENTRY = path.join(APP_DIR, 'main', 'main-entry.ts');
const SETTINGS_SCREEN = path.join(APP_DIR, '..', 'hud', 'screens', 'settings-screen.ts');
const DAY_REPLAY = path.join(APP_DIR, '..', 'hud', 'components', 'replay', 'day-replay.ts');

const mainEntry = fs.readFileSync(MAIN_ENTRY, 'utf-8');
const settingsScreen = fs.readFileSync(SETTINGS_SCREEN, 'utf-8');
const dayReplay = fs.readFileSync(DAY_REPLAY, 'utf-8');

describe('§4 G8 · 主入口按钮组（组合根，位置与形态不变）', () => {
  test('G8-1 回放入口：组合根把回放控制器与时间戳角标挂上（↗ 回放 的实际落点）', () => {
    // 组合根建回放控制器（读当天事件流 → 发节拍 → 角标）。
    expect(mainEntry).toContain('createReplayController');
    // 组合根挂回放时间戳角标（左上 Z5）。
    expect(mainEntry).toContain('mountReplayClock');
    // 回放条本体挂在主屏的控制岛里（§4 D1 已迁岛）—— 组合根经 createMainScreen 挂上。
    expect(mainEntry).toContain('createMainScreen');
  });

  test('G8-2 回放一键入口：控制岛里的「▶ 60 秒看完今天」按钮仍可达', () => {
    expect(dayReplay).toContain('data-role="play"');
    expect(dayReplay).toContain('▶ 60 秒看完今天');
  });

  test('G8-3 重置入口：设置屏的「重置编组」按钮仍在（⟳ 重置 的实际落点）', () => {
    expect(settingsScreen).toContain("label: '重置编组'");
    expect(settingsScreen).toContain("buttonLabel: '重置编组'");
    // 动作按钮按 buttonLabel 渲染（不是死文字 —— 入口真的能点）。
    expect(settingsScreen).toContain('buttonLabel}');
  });

  test('G8-4 入口可达路径：主屏 ⋯ 菜单 → 去设置（ui.navigate settings）→ 设置屏', () => {
    // 主屏的「去设置」是 ui.navigate settings（§4 A12）。
    expect(mainEntry).toContain('createMainScreen');
    const mainScreen = fs.readFileSync(
      path.join(APP_DIR, '..', 'hud', 'screens', 'main-screen.ts'),
      'utf-8'
    );
    expect(mainScreen).toContain("type: 'ui.navigate', screen: 'settings'");
  });
});
