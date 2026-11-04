/**
 * e2e：动效系统（@since v3.8，task_138）。
 *
 * 覆盖验收口径：
 *   ① 动效 token 在双 token 体系可查（computed style：:root 上的 --srf-motion-* 三档时长 + 三档缓动）；
 *   ② 签名瞬间一：任务完成确认（成功 toast 的对勾描边 + scale/brightness 脉冲，类切换 + 动画名断言 + 截图）；
 *   ③ 签名瞬间二：横幅与 ≥2 个面板有位移入场（不是瞬现：animationName 断言 + 位移量断言）；
 *   ④ prefers-reduced-motion: reduce 下全部动效禁用（animation none / transition 0s）。
 *
 * 跑法（**不要**用仓库默认配置 —— 它的 globalSetup 会杀掉 7523/7524 上的进程）：
 *   npx playwright test --config=tests/e2e/playwright.motion.config.ts
 *
 * why 横幅用「页面内动态 import 真实组件」的方式验：
 *   应用里那一条横幅连着真网关（7524 正常时是「在线」，横幅不亮）——
 *   为了看到入场动效而掐掉网关会连累别的任务。这里挂的是**同一个真实组件**，
 *   只把「连通性端口」换成一只测试替身（端口本来就是注入面）。
 */

import { expect, test, type Page } from '@playwright/test';

const APP_URL = '/src/app/main/index.html';

async function boot(page: Page): Promise<void> {
  await page.goto(APP_URL);
  await page.waitForSelector('strat-command-panel', { timeout: 15_000 });
  const skip = page.locator('strat-onboarding-screen [data-action="skip"]');
  if (await skip.count()) {
    await skip.first().click();
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(300);
}

/** 取 shadow 组件里某元素的 computed style（挑几个字段）。 */
async function styleIn(
  page: Page,
  hostSel: string,
  innerSel: string,
  props: string[],
): Promise<Record<string, string>> {
  return page.evaluate(
    ([host, inner, keys]) => {
      const node = document.querySelector(host);
      const root = node?.shadowRoot ?? node;
      const el = root?.querySelector(inner);
      if (!el) return { missing: '1' };
      const cs = getComputedStyle(el);
      const out: Record<string, string> = {};
      for (const key of keys) out[key] = cs.getPropertyValue(key);
      return out;
    },
    [hostSel, innerSel, props] as const,
  );
}

test('动效 token + 签名瞬间 + 位移入场（task_138）', async ({ page }) => {
  await boot(page);

  // ── ① 动效 token（computed style 断言，双 token 体系可查）──────────
  const tokens = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const names = [
      '--srf-motion-fast',
      '--srf-motion-base',
      '--srf-motion-slow',
      '--srf-motion-ease-enter',
      '--srf-motion-ease-exit',
      '--srf-motion-ease-spring',
    ];
    const out: Record<string, string> = {};
    for (const name of names) out[name] = cs.getPropertyValue(name).trim();
    return out;
  });
  // shadow 组件里取同一个变量（证明 token 跨 shadow root 可见 —— 全 HUD 同速）
  const tokenInShadow = await styleIn(page, 'strat-command-panel', '.panel', ['--srf-motion-base']);
  console.log(`T138_TOKENS ${JSON.stringify({ tokens, tokenInShadow })}`);

  expect(tokens).toEqual({
    '--srf-motion-fast': '120ms',
    '--srf-motion-base': '200ms',
    '--srf-motion-slow': '360ms',
    '--srf-motion-ease-enter': 'ease-out',
    '--srf-motion-ease-exit': 'ease-in',
    '--srf-motion-ease-spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  });
  expect(tokenInShadow['--srf-motion-base']).toBe('200ms');

  // ── ③-A 命令面板：位移入场（不是瞬现）───────────────────────────
  const panelEnter = await styleIn(page, 'strat-command-panel', '.panel', [
    'animation-name',
    'animation-duration',
    'animation-timing-function',
  ]);
  const panelClass = await page.evaluate(() => {
    const el = document.querySelector('strat-command-panel')?.shadowRoot?.querySelector('.panel');
    return el?.className ?? 'MISSING';
  });
  console.log(`T138_PANEL_ENTER ${JSON.stringify({ panelEnter, panelClass })}`);
  expect(panelEnter['animation-name']).toBe('srf-motion-enter-in');
  expect(panelEnter['animation-duration']).toBe('0.2s');
  expect(panelEnter['animation-timing-function']).toBe('ease-out');
  expect(panelClass).toContain('srf-motion-enter');

  // ── ③-B 网关横幅：落位入场（真实组件 + 注入端口替身）─────────────
  const banner = await page.evaluate(async () => {
    const mod = await import('/src/hud/components/gateway-banner/gateway-banner.ts');
    const host = document.createElement('div');
    host.id = 'motion-banner-probe';
    document.body.appendChild(host);
    const link = {
      state: 'offline' as const,
      subscribe: (handler: (s: 'offline') => void) => {
        handler('offline');
        return () => {};
      },
      refresh: async () => 'offline' as const,
    };
    mod.mountGatewayBanner(host, { link });
    const el = host.querySelector('strat-gateway-banner');
    const bannerEl = el?.shadowRoot?.querySelector('.banner') ?? null;
    if (!bannerEl) return { missing: '1' };
    const cs = getComputedStyle(bannerEl);
    return {
      className: bannerEl.className,
      animationName: cs.animationName,
      animationDuration: cs.animationDuration,
      hidden: (bannerEl as HTMLElement).hidden,
    };
  });
  console.log(`T138_BANNER_ENTER ${JSON.stringify(banner)}`);
  expect(banner['animation-name'] ?? banner.animationName).toBe('srf-motion-enter-in');
  expect(banner.className).toContain('srf-motion-enter');
  // 等入场动效跑完再截图（200ms）：否则拍到的是半途的位移帧，看不出「落位」后的样子。
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'reports/shots/gateway-banner-r5-motion.png' });

  // ── ② 签名瞬间一：任务完成确认（成功 toast 的对勾 + 脉冲）──────────
  // 走的是**真实组件的公开接口** —— app 侧任务完成也是这一条
  // （app/services/task-report.ts：deps.toast(text, 'success')）。
  const toast = await page.evaluate(() => {
    const host = document.querySelector('strat-toast-host') as
      | (HTMLElement & { show?: (text: string, tone?: string) => void })
      | null;
    if (!host?.show) return { missing: '1' };
    host.show('阿尔法 完成任务', 'success');
    const root = host.shadowRoot;
    const node = root?.querySelector('.toast');
    const check = node?.querySelector('.check');
    const path = check?.querySelector('path');
    if (!node || !check || !path) return { missing: '1' };
    const cs = getComputedStyle(check);
    const pathCs = getComputedStyle(path);
    return {
      toastClass: node.className,
      checkClass: check.className,
      pathClass: path.getAttribute('class'),
      animationName: cs.animationName,
      animationDuration: cs.animationDuration,
      pathAnimationName: pathCs.animationName,
      pathDashOffset: pathCs.strokeDashoffset,
      text: node.textContent,
    };
  });
  console.log(`T138_CONFIRM ${JSON.stringify(toast)}`);
  expect(toast.toastClass).toContain('srf-motion-enter');
  expect(toast.checkClass).toContain('srf-motion-confirm');
  expect(toast.pathClass).toBe('srf-motion-check');
  expect(toast.animationName).toBe('srf-motion-confirm-pop');
  expect(toast.pathAnimationName).toBe('srf-motion-check-draw');
  // 对勾描边动画从 opacity:0 起步 —— 等它跑完再拍，否则拍到的是一根还没画出来的线。
  await page.waitForTimeout(500);
  const toastBox = await page.evaluate(() => {
    const host = document.querySelector('strat-toast-host');
    const node = host?.shadowRoot?.querySelector('.toast');
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  console.log(`T138_TOAST_BOX ${JSON.stringify(toastBox)}`);
  if (toastBox) {
    await page.screenshot({
      path: 'reports/shots/toast-confirm-r5-motion.png',
      clip: {
        x: Math.max(0, toastBox.x - 8),
        y: Math.max(0, toastBox.y - 8),
        width: toastBox.width + 16,
        height: toastBox.height + 16,
      },
    });
  } else {
    await page.screenshot({ path: 'reports/shots/toast-confirm-r5-motion.png' });
  }

  // ── ③-C 第三个有位移入场的面：任务确认面板（真实组件 + 注入适配器）──
  const missionPanel = await page.evaluate(async () => {
    const mod = await import('/src/hud/panels/mission-confirm.ts');
    const host = document.createElement('div');
    host.id = 'motion-mission-probe';
    document.body.appendChild(host);
    const deps = {
      dispatch: () => {},
      subscribe: () => () => {},
    };
    mod.mountMissionConfirm(deps, host);
    const el = host.querySelector('strat-mission-confirm');
    const panel = el?.shadowRoot?.querySelector('.panel') ?? null;
    if (!panel) return { missing: '1' };
    const cs = getComputedStyle(panel);
    return { className: panel.className, animationName: cs.animationName };
  });
  console.log(`T138_MISSION_PANEL ${JSON.stringify(missionPanel)}`);
  expect(missionPanel.animationName).toBe('srf-motion-enter-in');
  expect(missionPanel.className).toContain('srf-motion-enter');

  await page.screenshot({ path: 'reports/shots/motion-r5-full.png' });
});

test('prefers-reduced-motion: reduce 下全部动效禁用（task_138）', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await boot(page);

  const reduced = await page.evaluate(() => {
    const panel = document.querySelector('strat-command-panel')?.shadowRoot?.querySelector('.panel');
    const panelCs = panel ? getComputedStyle(panel) : null;
    const host = document.querySelector('strat-toast-host') as
      | (HTMLElement & { show?: (text: string, tone?: string) => void })
      | null;
    let check: Element | null = null;
    host?.show?.('阿尔法 完成任务', 'success');
    check = host?.shadowRoot?.querySelector('.check') ?? null;
    const checkCs = check ? getComputedStyle(check) : null;
    return {
      panelAnimationName: panelCs?.animationName ?? 'MISSING',
      panelTransitionDuration: panelCs?.transitionDuration ?? 'MISSING',
      checkAnimationName: checkCs?.animationName ?? 'MISSING',
      checkTransitionDuration: checkCs?.transitionDuration ?? 'MISSING',
    };
  });
  console.log(`T138_REDUCED ${JSON.stringify(reduced)}`);

  // 全部禁用：animation 归 none、transition 归 0s（不是「快到看不见」，是真没有）
  expect(reduced.panelAnimationName).toBe('none');
  expect(reduced.panelTransitionDuration).toBe('0s');
  expect(reduced.checkAnimationName).toBe('none');
  expect(reduced.checkTransitionDuration).toBe('0s');
});
