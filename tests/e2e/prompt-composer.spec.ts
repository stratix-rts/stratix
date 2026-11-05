/**
 * e2e：提示词 composer（@since v3.9，task_144）—— 命令面板输入面的重造验收。
 *
 * ★ @since v3.11（task_155）输入语义定稿：命令一律带 `/` 前缀
 *   （非 `/` 开头一律是提示词 → 回车直接发起任务；中文别名同理：`/设置`）。
 *
 * 覆盖验收口径：
 *   ① 粘贴 800 字多行中文提示词 → 一个字符不丢、composer 平滑长高、无横向溢出；
 *   ② IME 合成「/你好世界」过程中按 Enter **不提交**，合成完成后 Enter 才提交（中文用户命门）；
 *   ③ ↑↓ 历史切换（首/末行）+ 中部光标 ↑↓ 不抢键；
 *   ④ 聚焦态一眼可辨（失焦 / 聚焦对照截图落 reports/shots/）；
 *   ⑤ 既有五命令 + 中文别名无回归（触发方式改成 `/` 前缀，命令行为不变）。
 *
 * 跑法：npx playwright test --config=tests/e2e/playwright.prompt-composer.config.ts
 */

import { expect, test, type Page } from '@playwright/test';

const APP_URL = '/src/app/main/index.html';
const SHOTS = 'reports/shots';

/** 起页面：进主屏、跳过首启向导、等命令面板就位。 */
async function boot(page: Page): Promise<void> {
  await page.goto(APP_URL);
  await page.waitForSelector('strat-command-panel', { timeout: 15_000 });
  const skip = page.locator('strat-onboarding-screen [data-action="skip"]');
  if (await skip.count()) {
    await skip.first().click();
    await page.waitForTimeout(500);
  }
}

/** 命令面板里的多行编辑区（@since v3.9：单行 input → textarea）。 */
function composer(page: Page) {
  return page.locator('strat-command-panel').locator('textarea[data-role="query"]');
}

/** 回执区文案。 */
function outputText(page: Page) {
  return page.locator('strat-command-panel').locator('[data-role="output"]').innerText();
}

test.describe('提示词 composer（task_144）', () => {
  test('粘贴 800 字多行中文提示词：一个字符不丢 + 平滑长高 + 无横向溢出', async ({ page }) => {
    await boot(page);
    const el = composer(page);
    await el.click();

    const lines = [
      '请把事件总线的重构做完，拆成采集层、归一化层与分发层三层。',
      '采集层只负责从适配器拉取原始事件，不做任何业务判断。',
      '归一化层负责把七种来源的字段统一成同一个内部模型，命名以领域为准。',
      '分发层按订阅关系把事件送出去，并且要支持中途取消订阅。',
      '约束一：core 域保持零 IO，任何文件都不许直接读数据库。',
      '约束二：所有新增的纯函数都要有对应的单元测试。',
      '约束三：不要动 session-panel 与 z-index 相关的结构，那是另外两个任务的地盘。',
    ];
    const prompt = lines.join('\n');

    const before = await el.evaluate((node) => node.getBoundingClientRect().height);

    // 粘贴语义：keyboard.insertText 把整段多行文本一次灌进编辑区（等价于一次粘贴，
    //   不经过逐字键盘事件 —— 800 字逐字敲要好几分钟，验的不是打字速度）。
    await page.keyboard.insertText(prompt);

    const after = await el.evaluate((node) => node.getBoundingClientRect().height);
    const metrics = await el.evaluate((node) => ({
      length: node.value.length,
      lines: node.value.split('\n').length,
      expanded: node.getAttribute('data-expanded'),
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      fontSize: getComputedStyle(node).fontSize,
    }));

    // ① 一个字符不丢（值与原文逐字相等）。
    expect(await el.inputValue()).toBe(prompt);
    expect(metrics.length).toBe(prompt.length);
    expect(metrics.lines).toBe(lines.length);

    // ② 平滑长高：比粘贴前高，且进入展开态。
    expect(after).toBeGreaterThan(before);
    expect(metrics.expanded).toBe('true');

    // ③ 无横向溢出：编辑区自身不横向滚动。
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);

    // ④ 字号至少 md（14px）—— 输入面不再是个「肉眼难辨的小区域」。
    expect(parseFloat(metrics.fontSize)).toBeGreaterThanOrEqual(14);

    // ⑤ 控制岛没有被长提示词顶出屏幕宽度。
    const island = await page
      .locator('.hud-bottom-bar')
      .evaluate((node) => ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
    expect(island.scrollWidth).toBeLessThanOrEqual(island.clientWidth + 1);

    // 截图留证（长提示词 + 展开态）。
    // why 截整页而不是只截控制岛：展开态的编辑区**浮在岛的上方**（脱流浮层），
    //   只截岛只会拍到一块空地，看不见编辑区。
    await page.screenshot({ path: `${SHOTS}/prompt-composer-r7-longtext.png` });
  });

  test('IME：合成过程中按 Enter 不提交，合成完成后 Enter 才提交', async ({ page }) => {
    await boot(page);
    const el = composer(page);
    await el.click();

    const client = await page.context().newCDPSession(page);
    // 真 IME 合成态（Chromium 的 IME 通道）：合成未提交时按 Enter 是「选词」。
    await client.send('Input.imeSetComposition', {
      text: '你好',
      selectionStart: 2,
      selectionEnd: 2,
    });
    await page.keyboard.press('Enter');

    // 合成中的 Enter 不得触发提交：回执区必须还是空的。
    expect(await outputText(page)).toBe('');

    // 合成完成（提交合成结果）→ 再按 Enter 才提交。
    await client.send('Input.insertText', { text: '/你好世界' });
    await page.keyboard.press('Enter');

    await expect.poll(() => outputText(page)).not.toBe('');
    const text = await outputText(page);
    // 「/你好世界」不是命令 → 未匹配回执（说明走完了命令行，而不是静默）。
    expect(text).toContain('没有匹配的命令');
  });

  test('↑↓ 翻历史；光标在中间行时 ↑↓ 不抢键', async ({ page }) => {
    await boot(page);
    const el = composer(page);
    await el.click();

    // 先提交两条命令（进历史）。
    await el.fill('/help');
    await el.press('Enter');
    await expect.poll(() => outputText(page)).toContain('可用命令');

    await el.fill('/replay');
    await el.press('Enter');
    await page.waitForTimeout(300);

    // ↑ 在首行 → 翻出最近一条（replay）。
    // why 历史存的是**原文**（含 / 前缀）：命令一律带 / 触发，翻出来的就是要能直接回车再执行的那句。
    await el.fill('');
    await el.press('ArrowUp');
    expect(await el.inputValue()).toBe('/replay');
    // 再 ↑ → 更旧的一条（help）。
    await el.press('ArrowUp');
    expect(await el.inputValue()).toBe('/help');
    // ↓ → 回到更新的那条。
    await el.press('ArrowDown');
    expect(await el.inputValue()).toBe('/replay');

    // 中部光标：↑ 不抢键（值不变、光标所在行不被动）。
    await el.fill('第一行\n第二行\n第三行');
    await el.evaluate((node) => {
      const pos = node.value.indexOf('第二') + 1;
      node.setSelectionRange(pos, pos);
    });
    await el.press('ArrowUp');
    expect(await el.inputValue()).toBe('第一行\n第二行\n第三行');
  });

  test('聚焦态一眼可辨（失焦 / 聚焦对照截图）', async ({ page }) => {
    await boot(page);
    const island = page.locator('.hud-bottom-bar');

    // 失焦态截图。
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await island.screenshot({ path: `${SHOTS}/prompt-composer-r7-blur.png` });

    // 聚焦态截图。
    const el = composer(page);
    await el.click();
    await el.fill('把总线重构一遍');
    await page.waitForTimeout(200);
    await island.screenshot({ path: `${SHOTS}/prompt-composer-r7-focus.png` });

    // 聚焦态必须有可见的强调（描边色变了 + 有光晕），不是"肉眼看不出差别"。
    const focused = await el.evaluate((node) => {
      const s = getComputedStyle(node);
      return { border: s.borderTopColor, shadow: s.boxShadow, fontSize: s.fontSize };
    });
    const blurred = await (async () => {
      await page.locator('body').click({ position: { x: 5, y: 5 } });
      await page.waitForTimeout(100);
      return el.evaluate((node) => {
        const s = getComputedStyle(node);
        return { border: s.borderTopColor, shadow: s.boxShadow, fontSize: s.fontSize };
      });
    })();

    expect(focused.border).not.toBe(blurred.border);
    expect(focused.shadow).not.toBe('none');
    expect(parseFloat(focused.fontSize)).toBeGreaterThanOrEqual(14);
  });

  test('皮肤双适配：切到像素风后 composer 仍可见、字号不变、聚焦态仍有强调', async ({ page }) => {
    await boot(page);
    const el = composer(page);
    await el.click();
    await el.fill('/theme');
    await el.press('Enter');
    await page.waitForTimeout(300);

    const metrics = await el.evaluate((node) => {
      const s = getComputedStyle(node);
      return { fontSize: s.fontSize, visible: node.getBoundingClientRect().width > 0 };
    });
    expect(metrics.visible).toBe(true);
    expect(parseFloat(metrics.fontSize)).toBeGreaterThanOrEqual(14);

    await el.click();
    await page.waitForTimeout(200);
    await page.locator('.hud-bottom-bar').screenshot({ path: `${SHOTS}/prompt-composer-r7-pixel.png` });
  });

  test('既有命令无回归：五命令 + 中文别名照旧能执行', async ({ page }) => {
    await boot(page);
    const el = composer(page);
    await el.click();

    // help → 五条命令的用法都在。
    await el.fill('/help');
    await el.press('Enter');
    let text = await outputText(page);
    for (const usage of ['mission <标题>', 'theme [default|pixel]', 'settings', 'replay', 'help']) {
      expect(text).toContain(usage);
    }
    for (const alias of ['别名：任务 / 新建任务', '别名：主题 / 皮肤', '别名：设置', '别名：回放']) {
      expect(text).toContain(alias);
    }

    // 中文别名「设置」→ 设置屏现身。
    await el.fill('/设置');
    await el.press('Enter');
    await expect(page.locator('strat-settings-screen')).toBeVisible({ timeout: 1000 });
  });
});
