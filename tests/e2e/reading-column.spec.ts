/**
 * e2e：**阅读列**（@since v3.9，task_149）—— 消息分野 / 连续分组 / 时间线 /
 *   滚动记忆 / 长会话窗口化。
 *
 * 覆盖验收口径：
 *   ① 三种消息身份（用户 / agent / 系统事件）在**双皮肤**下都可辨（截图 + 计算样式断言）；
 *   ② 连续同 agent 消息合组 + 跨分钟时间分隔条（截图 + 断言）；
 *   ③ 用户上翻时新消息**不打扰** + 「回到最新」浮标可用（断言 + 截图）；
 *   ④ 切换往返（组件重建 / 刷新页面）后滚动位置恢复（断言）；
 *   ⑤ 200+ 消息滚动无卡顿（证据：滚动帧时间 + DOM 节点数上限）。
 *
 * why 直接 import 应用模块（/src/hud/components/reading-column/reading-column.ts）：
 *   e2e 要验的是**真组件**；复制一份逻辑等于测了个影子。
 *
 * 跑法：npx playwright test --config=tests/e2e/playwright.reading-column.config.ts
 */

import { expect, test, type Page } from '@playwright/test';

const APP_URL = '/src/app/main/index.html';
const SHOTS = 'reports/shots';
const SKIN_KEY = 'stratix.skin';

async function boot(page: Page): Promise<void> {
  await page.goto(APP_URL);
  await page.waitForSelector('strat-command-panel', { timeout: 20_000 });
  const skip = page.locator('strat-onboarding-screen [data-action="skip"]');
  if (await skip.count()) {
    await skip.first().click();
    await page.waitForTimeout(400);
  }
}

/** 把阅读列模块装进 window.__rc（vite 首次见到新依赖会整页 reload —— 失败就重试）。 */
async function loadReadingColumn(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const ok = await page.evaluate(async () => {
        try {
          const mod = await import('/src/hud/components/reading-column/reading-column.ts');
          const demo = await import('/src/hud/panels/demo-session.ts');
          (window as unknown as { __rc: typeof mod }).__rc = mod;
          (window as unknown as { __demo: typeof demo }).__demo = demo;
          return true;
        } catch {
          return false;
        }
      });
      if (ok) return;
    } catch {
      // 页面被 reload（执行上下文销毁）—— 重新加载后再试。
    }
    await page.waitForTimeout(800);
    await page.reload();
    await page.waitForSelector('strat-command-panel', { timeout: 20_000 });
  }
  throw new Error('阅读列模块加载失败（vite 依赖预打包未收敛）');
}

/** 把示例会话的阅读列滚回顶部（截图要看身份 / 分组 / 分隔条 —— 别截在半截正文上）。 */
async function scrollDemoToTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const panel = document.querySelector('strat-session-panel') as HTMLElement & { shadowRoot: ShadowRoot };
    const list = panel.shadowRoot.querySelector('[data-role="rc-list"]') as HTMLElement;
    list.scrollTop = 0;
    list.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(150);
}

/** 展开会话面板并打开示例会话。 */
async function openDemoSession(page: Page): Promise<void> {
  // 顶栏的「会话面板」入口藏在溢出菜单里（点不开）—— 直接调面板的公开方法。
  await page.evaluate(() => {
    const panel = document.querySelector('strat-session-panel') as
      | (HTMLElement & { collapsed?: boolean; toggleCollapsed?: () => void })
      | null;
    if (panel?.collapsed) panel.toggleCollapsed?.();
  });
  await page.waitForTimeout(200);
  await page.locator('strat-session-panel button[data-action="demo-session"]').click();
  await page.waitForSelector('strat-session-panel [data-role="demo-message"]');
}


/** 在页面上挂一个独立阅读列（截图用）—— 尺寸自己定，不受右栏窄槽限制。 */
async function mountStandalone(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const rc = (window as unknown as {
      __rc: {
        ReadingColumn: new (host: HTMLElement, options: Record<string, unknown>) => {
          setMessages(messages: unknown[]): void;
        };
      };
    }).__rc;
    const demo = (window as unknown as {
      __demo: { buildDemoReadingMessages(baseAt?: number): unknown[] };
    }).__demo;
    document.getElementById('rc-shot')?.remove();
    const host = document.createElement('div');
    host.id = 'rc-shot';
    host.style.cssText =
      'position:fixed;left:60px;top:48px;width:560px;height:660px;z-index:99999;' +
      'background:var(--srf-panel);border:var(--srf-border-width) solid var(--srf-border);' +
      'border-radius:var(--srf-radius);padding:var(--srf-spacing-sm);';
    document.body.appendChild(host);
    const column = new rc.ReadingColumn(host, {
      contextKey: 'shot',
      memoryScope: 'shot',
      markdown: true,
      messageRole: 'demo-message',
      badgeRole: 'demo-badge',
    });
    column.setMessages(demo.buildDemoReadingMessages());
  });
  await page.waitForTimeout(250);
}

test.describe('阅读列', () => {
  test('① 三种消息身份可辨（默认皮 + 像素皮截图）', async ({ page }) => {
    await boot(page);
    await openDemoSession(page);

    const identity = await page.evaluate(() => {
      const panel = document.querySelector('strat-session-panel') as HTMLElement & { shadowRoot: ShadowRoot };
      const rows = Array.from(
        panel.shadowRoot.querySelectorAll('[data-role="demo-message"]'),
      ) as HTMLElement[];
      const pick = (role: string): HTMLElement | undefined =>
        rows.find((el) => el.getAttribute('data-rc-role') === role);
      const user = pick('user');
      const agent = pick('agent');
      const system = pick('system');
      const bubbleOf = (row: HTMLElement | undefined): HTMLElement | null =>
        row?.querySelector('.rc-bubble') as HTMLElement | null;
      const ub = bubbleOf(user);
      const ab = bubbleOf(agent);
      const sb = bubbleOf(system);
      const list = panel.shadowRoot.querySelector('[data-role="rc-list"]') as HTMLElement;
      const listBox = list.getBoundingClientRect();
      const userBox = (user?.querySelector('.rc-main') as HTMLElement | null)?.getBoundingClientRect();
      const agentBox = (agent?.querySelector('.rc-main') as HTMLElement | null)?.getBoundingClientRect();
      return {
        roles: rows.map((el) => el.getAttribute('data-rc-role')),
        userBg: ub ? getComputedStyle(ub).backgroundColor : '',
        agentBg: ab ? getComputedStyle(ab).backgroundColor : '',
        agentBorderLeft: ab ? getComputedStyle(ab).borderLeftColor : '',
        systemBorderStyle: sb ? getComputedStyle(sb).borderTopStyle : '',
        systemAlign: sb ? getComputedStyle(sb).textAlign : '',
        userRightGap: userBox ? Math.round(listBox.right - userBox.right) : -1,
        agentLeftGap: agentBox ? Math.round(agentBox.left - listBox.left) : -1,
        // 头像位 = 「对齐方向」的锚：用户头像在右缘、agent 头像在左缘。
        userAvatarRight: user
          ? Math.round((user.querySelector('[data-role="rc-avatar"]') as HTMLElement | null)?.getBoundingClientRect().right ?? -1)
          : -1,
        agentAvatarLeft: agent
          ? Math.round((agent.querySelector('[data-role="rc-avatar"]') as HTMLElement | null)?.getBoundingClientRect().left ?? -1)
          : -1,
        listRight: Math.round(listBox.right),
        listLeft: Math.round(listBox.left),
      };
    });

    // 三种身份都在场。
    expect(identity.roles).toContain('user');
    expect(identity.roles).toContain('agent');
    expect(identity.roles).toContain('system');
    // 视觉上真的不同：用户底色 ≠ agent 底色；系统事件是虚线居中。
    expect(identity.userBg).not.toBe(identity.agentBg);
    expect(identity.systemBorderStyle).toBe('dashed');
    expect(identity.systemAlign).toBe('center');
    // 对齐：用户靠右（头像在右缘）、agent 靠左（头像在左缘）。
    expect(identity.userRightGap).toBeLessThan(40);
    expect(identity.agentLeftGap).toBeLessThan(40);
    expect(Math.abs(identity.userAvatarRight - identity.listRight)).toBeLessThan(14);
    expect(Math.abs(identity.agentAvatarLeft - identity.listLeft)).toBeLessThan(14);

    await scrollDemoToTop(page);
    await page.locator('strat-session-panel .demo-session').screenshot({
      path: `${SHOTS}/reading-r9-panel-integration-read.png`,
    });

    // —— 独立阅读列截图（尺寸可控 —— 面板槽位太窄截不全三种身份）——
    await loadReadingColumn(page);
    await mountStandalone(page);
    await page.locator('#rc-shot').screenshot({
      path: `${SHOTS}/reading-r9-identity-default-read.png`,
    });

    // —— 像素皮再来一遍（双皮肤可辨）——
    await page.evaluate((key) => localStorage.setItem(key, 'pixel'), SKIN_KEY);
    await page.reload();
    await page.waitForSelector('strat-command-panel', { timeout: 20_000 });
    await loadReadingColumn(page);
    await mountStandalone(page);
    await page.locator('#rc-shot').screenshot({
      path: `${SHOTS}/reading-r9-identity-pixel-read.png`,
    });
  });

  test('② 连续同 agent 合组 + 跨分钟时间分隔条', async ({ page }) => {
    await boot(page);
    await openDemoSession(page);

    const shape = await page.evaluate(() => {
      const panel = document.querySelector('strat-session-panel') as HTMLElement & { shadowRoot: ShadowRoot };
      const rows = Array.from(
        panel.shadowRoot.querySelectorAll('[data-role="demo-message"]'),
      ) as HTMLElement[];
      const agents = rows.filter((el) => el.getAttribute('data-rc-role') === 'agent');
      const separators = Array.from(
        panel.shadowRoot.querySelectorAll('[data-role="rc-separator"]'),
      ) as HTMLElement[];
      return {
        agentOpens: agents.map((el) => el.getAttribute('data-opens-group')),
        agentAvatars: agents.map((el) => el.querySelectorAll('[data-role="rc-avatar"]').length),
        separatorLabels: separators.map((el) => (el.textContent ?? '').trim()),
        timestamps: rows.map((el) => {
          const time = el.querySelector('[data-role="rc-time"]') as HTMLElement | null;
          return time ? (time.textContent ?? '').trim() : '';
        }),
      };
    });

    // 连续两条 agent：第二条不开组（不重复头像/名字）。
    const lastTwo = shape.agentOpens.slice(-2);
    expect(lastTwo).toEqual(['true', 'false']);
    expect(shape.agentAvatars.slice(-2)).toEqual([1, 0]);
    // 跨分钟分隔条：至少两条，文案是「HH:MM」。
    expect(shape.separatorLabels.length).toBeGreaterThanOrEqual(2);
    for (const label of shape.separatorLabels) {
      expect(label).toMatch(/^\d{2}:\d{2}$/);
    }
    // 时间戳默认轻呈现（元素在，但默认透明 —— hover 才显形）。
    const opacity = await page.evaluate(() => {
      const panel = document.querySelector('strat-session-panel') as HTMLElement & { shadowRoot: ShadowRoot };
      const time = panel.shadowRoot.querySelector('[data-role="rc-time"]') as HTMLElement;
      return time ? getComputedStyle(time).opacity : '';
    });
    expect(Number(opacity)).toBeLessThan(1);

    await scrollDemoToTop(page);
    await page.locator('strat-session-panel .demo-session').screenshot({
      path: `${SHOTS}/reading-r9-panel-integration-read.png`,
    });

    await loadReadingColumn(page);
    await mountStandalone(page);
    await page.locator('#rc-shot').screenshot({
      path: `${SHOTS}/reading-r9-group-timeline-read.png`,
    });
  });

  test('③ 上翻时新消息不打扰 + 「回到最新」浮标可用', async ({ page }) => {
    await boot(page);
    await loadReadingColumn(page);

    const result = await page.evaluate(async () => {
      const rc = (window as unknown as {
        __rc: {
          ReadingColumn: new (
            host: HTMLElement,
            options: Record<string, unknown>,
          ) => {
            setMessages(messages: unknown[]): void;
            readonly atBottom: boolean;
            readonly pendingCount: number;
            readonly jumpVisible: boolean;
            destroy(): void;
          };
        };
      }).__rc;
      const host = document.createElement('div');
      host.id = 'rc-host';
      host.style.cssText = 'position:fixed;left:40px;top:80px;width:420px;height:360px;z-index:99999;';
      document.body.appendChild(host);
      const column = new rc.ReadingColumn(host, { contextKey: 'e2e-disturb', memoryScope: 'e2e' });
      const now = Date.now();
      const many = Array.from({ length: 60 }, (_, i) => ({
        id: `m-${i}`,
        role: i % 3 === 0 ? 'user' : 'agent',
        author: i % 3 === 0 ? '你' : '审阅 agent',
        text: `第 ${i} 条消息 —— 用于验证上翻时不打扰。`,
        at: now + i * 1000,
      }));
      column.setMessages(many);
      const list = host.querySelector('[data-role="rc-list"]') as HTMLElement;
      // 滚到顶 = 用户在上翻阅读。
      list.scrollTop = 0;
      list.dispatchEvent(new Event('scroll'));
      const before = list.scrollTop;
      // 新消息到达 —— 不该把人顶走。
      column.setMessages([...many, { ...many[0], id: 'new-1', text: '新到的消息' }]);
      const after = list.scrollTop;
      const jump = host.querySelector('[data-role="rc-jump"]') as HTMLButtonElement;
      const jumpHidden = jump.hidden;
      const jumpText = (jump.textContent ?? '').trim();
      // 点浮标 → 回到最新。
      jump.click();
      const afterJump = list.scrollTop;
      const atBottom = column.atBottom;
      const pending = column.pendingCount;
      return {
        before,
        after,
        jumpHidden,
        jumpText,
        afterJump,
        atBottom,
        pending,
        maxScroll: list.scrollHeight - list.clientHeight,
      };
    });

    expect(result.before).toBe(0);
    expect(result.after).toBe(0); // 位置没被顶走
    expect(result.jumpHidden).toBe(false); // 浮标出现了
    expect(result.jumpText).toContain('回到最新');
    expect(result.afterJump).toBe(result.maxScroll); // 一点就回到底
    expect(result.atBottom).toBe(true);
    expect(result.pending).toBe(0);

    // 浮标可见时的截图（上翻状态）。
    await page.evaluate(async () => {
      const rc = (window as unknown as {
        __rc: {
          ReadingColumn: new (
            host: HTMLElement,
            options: Record<string, unknown>,
          ) => { setMessages(m: unknown[]): void; readonly jumpVisible: boolean };
        };
      }).__rc;
      const host = document.getElementById('rc-host')!;
      const column = new rc.ReadingColumn(host, { contextKey: 'e2e-shot', memoryScope: 'e2e-shot' });
      const now = Date.now();
      const many = Array.from({ length: 40 }, (_, i) => ({
        id: `s-${i}`,
        role: i % 4 === 0 ? 'user' : 'agent',
        author: i % 4 === 0 ? '你' : '审阅 agent',
        text: `第 ${i} 条 —— 上翻阅读中。`,
        at: now + i * 1000,
      }));
      column.setMessages(many);
      const list = host.querySelector('[data-role="rc-list"]') as HTMLElement;
      list.scrollTop = 40;
      list.dispatchEvent(new Event('scroll'));
      column.setMessages([...many, { ...many[0], id: 'shot-new' }]);
      (window as unknown as { __rcCol: unknown }).__rcCol = column;
    });
    await page.waitForTimeout(200);
    await page.locator('#rc-host').screenshot({
      path: `${SHOTS}/reading-r9-jump-latest-read.png`,
    });
  });

  test('④ 切换往返 / 刷新页面后滚动位置恢复', async ({ page }) => {
    await boot(page);
    await loadReadingColumn(page);

    // —— 组件重建（= 面板重画）——
    const roundTrip = await page.evaluate(async () => {
      const rc = (window as unknown as {
        __rc: {
          ReadingColumn: new (
            host: HTMLElement,
            options: Record<string, unknown>,
          ) => { setMessages(m: unknown[]): void; destroy(): void };
        };
      }).__rc;
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:40px;top:80px;width:420px;height:360px;';
      document.body.appendChild(host);
      const messages = Array.from({ length: 60 }, (_, i) => ({
        id: `r-${i}`,
        role: 'agent',
        author: '审阅 agent',
        text: `第 ${i} 条。`,
        at: Date.now() + i * 1000,
      }));
      const first = new rc.ReadingColumn(host, { contextKey: 'e2e-memory', memoryScope: 'e2e-memory' });
      first.setMessages(messages);
      const list = host.querySelector('[data-role="rc-list"]') as HTMLElement;
      list.scrollTop = 700;
      list.dispatchEvent(new Event('scroll'));
      const before = list.scrollTop;
      const stored = localStorage.getItem('stratix:reading-scroll:e2e-memory');
      first.destroy();
      // 重建（面板重画 / 抽屉开合 —— 组件被重新 new 一次）。
      const second = new rc.ReadingColumn(host, { contextKey: 'e2e-memory', memoryScope: 'e2e-memory' });
      second.setMessages(messages);
      const list2 = host.querySelector('[data-role="rc-list"]') as HTMLElement;
      const after = list2.scrollTop;
      second.destroy();
      return { before, after, stored };
    });

    expect(roundTrip.before).toBeGreaterThan(0);
    expect(roundTrip.stored).toBeTruthy(); // 记忆写进了 localStorage（刷新也在）
    expect(roundTrip.after).toBeGreaterThan(0);
    // 位置恢复（比例一致 —— 允许几像素误差）。
    expect(Math.abs(roundTrip.after - roundTrip.before)).toBeLessThanOrEqual(80);

    // —— 刷新页面后仍在（记忆持久化）——
    await page.reload();
    await page.waitForSelector('strat-command-panel', { timeout: 20_000 });
    await loadReadingColumn(page);
    const afterReload = await page.evaluate(async () => {
      const rc = (window as unknown as {
        __rc: {
          ReadingColumn: new (
            host: HTMLElement,
            options: Record<string, unknown>,
          ) => { setMessages(m: unknown[]): void };
        };
      }).__rc;
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:40px;top:80px;width:420px;height:360px;';
      document.body.appendChild(host);
      const messages = Array.from({ length: 60 }, (_, i) => ({
        id: `r-${i}`,
        role: 'agent',
        author: '审阅 agent',
        text: `第 ${i} 条。`,
        at: Date.now() + i * 1000,
      }));
      const column = new rc.ReadingColumn(host, { contextKey: 'e2e-memory', memoryScope: 'e2e-memory' });
      column.setMessages(messages);
      const list = host.querySelector('[data-role="rc-list"]') as HTMLElement;
      return list.scrollTop;
    });
    expect(afterReload).toBeGreaterThan(0);
  });

  test('⑤ 200+ 消息：滚动无卡顿（帧时间 + DOM 节点数上限）', async ({ page }) => {
    await boot(page);
    await loadReadingColumn(page);

    const perf = await page.evaluate(async () => {
      const rc = (window as unknown as {
        __rc: {
          ReadingColumn: new (
            host: HTMLElement,
            options: Record<string, unknown>,
          ) => { setMessages(m: unknown[]): void };
        };
      }).__rc;
      const host = document.createElement('div');
      host.id = 'rc-perf';
      host.style.cssText = 'position:fixed;left:40px;top:80px;width:520px;height:420px;z-index:99999;';
      document.body.appendChild(host);
      const column = new rc.ReadingColumn(host, { contextKey: 'e2e-perf', memoryScope: 'e2e-perf' });
      const now = Date.now();
      const messages = Array.from({ length: 260 }, (_, i) => ({
        id: `p-${i}`,
        role: i % 3 === 0 ? 'user' : 'agent',
        author: i % 3 === 0 ? '你' : '审阅 agent',
        text: `第 ${i} 条消息 —— 长会话性能样本。`.repeat(2),
        at: now + i * 1000,
      }));
      const t0 = performance.now();
      column.setMessages(messages);
      const firstPaint = performance.now() - t0;
      const list = host.querySelector('[data-role="rc-list"]') as HTMLElement;

      // 连续滚动 60 帧 —— 量「帧间隔」：主线程被渲染卡住时帧间隔会突变。
      const deltas: number[] = [];
      let maxNodes = 0;
      let last = performance.now();
      await new Promise<void>((resolve) => {
        let i = 0;
        const step = (): void => {
          const now = performance.now();
          deltas.push(now - last);
          last = now;
          list.scrollTop = i * 30;
          list.dispatchEvent(new Event('scroll'));
          maxNodes = Math.max(
            maxNodes,
            host.querySelectorAll('[data-role="rc-message"]').length,
          );
          i += 1;
          if (i < 60) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
      return {
        total: messages.length,
        firstPaint,
        maxNodes,
        avgFrame: deltas.reduce((a, b) => a + b, 0) / deltas.length,
        maxFrame: Math.max(...deltas),
        longFrames: deltas.filter((d) => d > 50).length,
      };
    });

    // 节点数有上限（窗口化 —— 不是 260 条全铺在 DOM 里）。
    expect(perf.maxNodes).toBeLessThanOrEqual(60);
    expect(perf.maxNodes).toBeGreaterThan(0);
    // 滚动帧间隔：平均在一帧（≈16ms）附近，且没有一帧被拖过 50ms（= 不卡）。
    expect(perf.avgFrame).toBeLessThan(25);
    expect(perf.maxFrame).toBeLessThan(100);
    expect(perf.longFrames).toBe(0);

    // eslint-disable-next-line no-console
    console.log('[reading-column perf]', JSON.stringify(perf));

    await page.locator('#rc-perf').screenshot({
      path: `${SHOTS}/reading-r9-long-session-read.png`,
    });
  });
});
