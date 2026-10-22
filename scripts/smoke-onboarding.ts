/**
 * 首启向导**全流程手测**脚本（@since v3.9，task_026）。
 *   目的：把"人工点一遍向导"变成可复现的脚本 —— 验收要求"dev 手测向导全流程留截图路径记录"，
 *   本脚本就是那份记录的生成器（截图落在 tests/screenshots/ 下）。
 *   走的是**真链路**：Electron 主进程真探测本机 CLI agent（不 mock）→ IPC → core 状态 → 向导屏，
 *   走完向导后角色真落库、战场真出现带皮肤色的单位。
 * 用法：
 *   npm run build            # 构建前端（渲染层产物）
 *   npm run build:electron   # 构建 Electron 主进程 + preload
 *   npx tsx scripts/smoke-onboarding.ts
 * 退出码：0 = 全流程通过；非 0 = 某一步没走到（控制台会说明停在哪一步）。
 */

import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const SHOT_DIR = path.join(ROOT, 'tests', 'screenshots');

/** 步骤之间的等待（毫秒）：给 Phaser 渲染与状态广播留出余量。 */
const STEP_WAIT_MS = 400;

function shotPath(name: string): string {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  return path.join(SHOT_DIR, name);
}

/** 向导屏内的定位器（Playwright 的 CSS 选择器会穿透 open shadow root）。 */
function wizard(page: Page) {
  return page.locator('strat-onboarding-screen');
}

async function main(): Promise<void> {
  const app: ElectronApplication = await electron.launch({
    args: ['.'],
    cwd: ROOT,
    // 开发期开关：每次启动都触发向导（走查用；不靠"恰好没有角色"来触发，手测才可复现）。
    env: { ...process.env, STRATIX_ONBOARDING_FORCE: '1' },
  });

  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // 固定窗口尺寸：Playwright 拉起的窗口初始尺寸不定，尺寸漂移会让战场画布与 HUD 浮层
    // 对不齐（截图里单位被面板压住），走查前先摆正。
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.setSize(1600, 1000);
      win?.center();
    });
    await page.waitForTimeout(1200);

    // —— ① 扫描报告：等检测结果真的到达，且整轮扫描跑完 ——
    await wizard(page).waitFor({ state: 'attached', timeout: 60_000 });
    await wizard(page).locator('[data-role="scan-row"]').first().waitFor({ timeout: 60_000 });
    // 名单逐条探测，等"扫描完成"再往下走（否则只会给已探到的 agent 建档）。
    await wizard(page).locator('[data-role="scan-status"][data-complete="true"]').waitFor({ timeout: 120_000 });
    const scanRows = await wizard(page).locator('[data-role="scan-row"]').count();
    console.log(`[smoke] 扫描报告行数：${scanRows}`);
    await page.screenshot({ path: shotPath('onboarding-01-scan.png') });

    // —— ② 起名 + 皮肤 ——
    await wizard(page).locator('[data-action="next"]').click();
    const nameInputs = wizard(page).locator('[data-role="name-input"]');
    const identityCount = await nameInputs.count();
    console.log(`[smoke] 可建档的 agent 数：${identityCount}`);
    if (identityCount === 0) {
      throw new Error('没有可建档的已装 agent（本机没装 T1 的 CLI agent）—— 无法走完向导');
    }
    await nameInputs.first().fill('Neo');
    await page.waitForTimeout(STEP_WAIT_MS);
    await page.screenshot({ path: shotPath('onboarding-02-identity.png') });

    // —— ③ 人设生成：每题选第一个选项 ——
    await wizard(page).locator('[data-action="next"]').click();
    const questions = wizard(page).locator('[data-role="question"]');
    const questionCount = await questions.count();
    for (let i = 0; i < questionCount; i += 1) {
      await questions.nth(i).locator('[data-role="option"]').first().click();
    }
    await page.waitForTimeout(STEP_WAIT_MS);
    await page.screenshot({ path: shotPath('onboarding-03-persona.png') });

    // —— ④ 确认 → 建档 ——
    await wizard(page).locator('[data-action="next"]').click();
    await page.waitForTimeout(STEP_WAIT_MS);
    await page.screenshot({ path: shotPath('onboarding-04-confirm.png') });

    await wizard(page).locator('[data-action="submit"]').click();
    // 覆盖层收起 = 宿主收到了完成事件。
    await wizard(page).waitFor({ state: 'detached', timeout: 15_000 });
    await page.waitForTimeout(800);

    // —— 角色屏：引导走完后自动落在角色屏，刚建的角色可见 ——
    await page.locator('strat-character-screen [data-role="card"]').first().waitFor({ timeout: 15_000 });
    const cardCount = await page.locator('strat-character-screen [data-role="card"]').count();
    console.log(`[smoke] 角色屏卡片数：${cardCount}`);
    if (cardCount !== identityCount) {
      throw new Error(`角色卡片数与建档数不一致：期望 ${identityCount}，实际 ${cardCount}`);
    }
    await page.waitForTimeout(STEP_WAIT_MS);
    await page.screenshot({ path: shotPath('onboarding-05-character-screen.png') });

    // —— 回主屏：看战场（角色单位已带皮肤色出现在战场上）——
    await page.locator('strat-character-screen [data-role="back"]').click();
    await page.locator('[data-role="unit-count"]').waitFor({ timeout: 15_000 });
    const unitCount = (await page.locator('[data-role="unit-count"]').textContent())?.trim() ?? '';
    console.log(`[smoke] 战场单位计数：${unitCount}`);
    if (unitCount !== String(identityCount)) {
      throw new Error(`单位计数与建档数不一致：期望 ${identityCount}，实际 ${unitCount}`);
    }
    // 记录一下画面尺寸（截图里 HUD 浮层压着战场，单位是否被挡住要看这个）。
    const viewport = page.viewportSize();
    const canvasBox = await page.locator('#battlefield canvas').boundingBox();
    console.log(`[smoke] 视口：${JSON.stringify(viewport)}，战场画布：${JSON.stringify(canvasBox)}`);

    // 把镜头往左挪一挪：HUD 右侧浮层是半透明的，压在单位上会让皮肤色看着发灰 ——
    // 挪开后截图里能看清单位本来的颜色。
    if (canvasBox) {
      const startX = canvasBox.x + canvasBox.width * 0.45;
      const startY = canvasBox.y + canvasBox.height * 0.55;
      await page.mouse.move(startX, startY);
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(startX - 320, startY, { steps: 12 });
      await page.mouse.up({ button: 'right' });
      await page.waitForTimeout(600);
    }
    await page.waitForTimeout(STEP_WAIT_MS);
    await page.screenshot({ path: shotPath('onboarding-06-battlefield.png') });

    console.log('[smoke] 全流程通过：扫描 → 起名 → 人设 → 建档 → 战场出现单位 → 角色屏可见');
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error('[smoke] 失败：', error);
  process.exitCode = 1;
});
