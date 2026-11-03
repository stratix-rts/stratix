/**
 * 集成测试：皮肤系统（@since v3.6，task_115）—— 「切皮肤 → 视觉真变 + 刷新保持 + 零未处理噪音」。
 *
 * 受测链路（全是真件，不打桩总线）：
 *   HUD 入口 → hud/bridge/bus-adapter.dispatch → hud/theme/theme-controller（切 token + 写记忆）
 *            → core/bus → core/runtime（接地：皮肤是 HUD 本地态，core 不持有）
 *
 * 为什么要有这一层单测：死功能报告里「点皮肤没反应」的三种成因都在这条链路上 ——
 *   ① 命令没人接（core 报未处理）、② token 没换（视觉 0 变化）、③ 记忆没写（刷新后回到默认）。
 *   三件事分别断言，别靠一条端到端断言把它们糊在一起。
 *
 * @jest-environment jsdom
 */

import * as fs from 'fs';
import * as path from 'path';

import { emitCommand, resetBus } from '../../core/bus';
import { createCoreRuntime, type UnhandledChannel } from '../../core/runtime';
import { createStore } from '../../core/store';
import type { HudCommand } from '../../core/types';
import { SKIN_STORAGE_KEY } from '../../core/theme/skin-registry';
import { createHudBusAdapter } from '../bridge/bus-adapter';
import { createThemeController, STYLE_ID_PREFIX } from '../theme/theme-controller';

const readCss = (name: string): string =>
  fs.readFileSync(path.join(__dirname, '..', 'theme', name), 'utf-8');

const SOURCES = { default: readCss('tokens-default.css'), pixel: readCss('tokens-pixel.css') };

/** 当前生效的 token 样式表（= 皮肤真正在起作用的那张）。 */
function activeSheet(): HTMLStyleElement | null {
  const sheets = Array.from(document.querySelectorAll<HTMLStyleElement>(`style[id^="${STYLE_ID_PREFIX}"]`));
  return sheets.find((node) => node.disabled !== true) ?? null;
}

/** 建一套真链路：控制器（带 localStorage 记忆）+ 适配器 + core runtime。 */
function boot(): {
  controller: ReturnType<typeof createThemeController>;
  adapter: ReturnType<typeof createHudBusAdapter>;
  commands: HudCommand[];
  unhandled: { channel: UnhandledChannel; type: string }[];
  stop: () => void;
} {
  resetBus();
  window.localStorage.clear();
  document.head.querySelectorAll(`style[id^="${STYLE_ID_PREFIX}"]`).forEach((node) => node.remove());

  const controller = createThemeController({
    sources: SOURCES,
    initial: 'default',
    storage: window.localStorage,
  });
  const commands: HudCommand[] = [];
  const adapter = createHudBusAdapter({
    themeController: controller,
    emitCommand: (command) => { commands.push(command); emitCommand(command); },
  });
  const unhandled: { channel: UnhandledChannel; type: string }[] = [];
  const runtime = createCoreRuntime({
    store: createStore(),
    onUnhandled: (channel, payload) => { unhandled.push({ channel, type: payload.type }); },
  });
  const stopRuntime = runtime.start();
  const unmountAdapter = adapter.mount();
  return { controller, adapter, commands, unhandled, stop: () => { stopRuntime(); unmountAdapter(); } };
}

describe('皮肤切换：token 真换 + 记忆真写 + core 真接地', () => {
  let harness: ReturnType<typeof boot> | undefined;
  afterEach(() => {
    harness?.stop();
    harness = undefined;
    document.head.querySelectorAll(`style[id^="${STYLE_ID_PREFIX}"]`).forEach((node) => node.remove());
    window.localStorage.clear();
  });

  test('切到像素 → 生效的 token 表换成像素那张（视觉真变，不是只发了个命令）', () => {
    harness = boot();
    expect(activeSheet()?.id).toBe(`${STYLE_ID_PREFIX}default`);

    harness.adapter.dispatch({ type: 'theme.set', themeId: 'pixel' });

    const active = activeSheet();
    expect(active?.id).toBe(`${STYLE_ID_PREFIX}pixel`);
    // 生效表的内容确实是像素皮肤（直角 + 2px 硬边框）—— 组件按 token 画，视觉随之改变。
    expect(active?.textContent).toContain('--srf-border-width: 2px;');
    expect(harness.controller.current).toBe('pixel');
  });

  test('切皮肤写进 localStorage（键名取 core 冻结的那一个）', () => {
    harness = boot();
    expect(window.localStorage.getItem(SKIN_STORAGE_KEY)).toBeNull();

    harness.adapter.dispatch({ type: 'theme.set', themeId: 'pixel' });

    expect(window.localStorage.getItem(SKIN_STORAGE_KEY)).toBe('pixel');
  });

  test('刷新后仍是上次那套皮肤（重建控制器 = 重新读记忆）', () => {
    harness = boot();
    harness.adapter.dispatch({ type: 'theme.set', themeId: 'pixel' });

    // 模拟刷新：同一个 localStorage，重新构造控制器（应用启动时就是这么干的）。
    document.head.querySelectorAll(`style[id^="${STYLE_ID_PREFIX}"]`).forEach((node) => node.remove());
    const reloaded = createThemeController({
      sources: SOURCES,
      initial: 'default',
      storage: window.localStorage,
    });

    expect(reloaded.current).toBe('pixel');
    expect(activeSheet()?.id).toBe(`${STYLE_ID_PREFIX}pixel`);
  });

  test('core 接地：theme.set 不再报「未处理 command」（切换不再刷 console 警告）', () => {
    harness = boot();

    harness.adapter.dispatch({ type: 'theme.set', themeId: 'pixel' });

    expect(harness.commands).toContainEqual({ type: 'theme.set', themeId: 'pixel' });
    expect(harness.unhandled).toEqual([]);
  });

  test('皮肤订阅：真变了才回调（顶栏菜单文案 / 设置屏高亮靠它跟上）', () => {
    harness = boot();
    const seen: string[] = [];
    const off = harness.adapter.subscribeTheme((id) => { seen.push(id); });

    harness.adapter.dispatch({ type: 'theme.set', themeId: 'pixel' });
    harness.adapter.dispatch({ type: 'theme.set', themeId: 'pixel' }); // 同皮肤重复切 = no-op
    off();
    harness.adapter.dispatch({ type: 'theme.set', themeId: 'default' });

    expect(seen).toEqual(['pixel']);
  });

  test('记忆值非法 → 按兜底皮肤走（宁可用默认，也不切到不存在的皮肤）', () => {
    window.localStorage.setItem(SKIN_STORAGE_KEY, 'no-such-skin');
    const controller = createThemeController({
      sources: SOURCES,
      initial: 'default',
      storage: window.localStorage,
    });

    expect(controller.current).toBe('default');
    expect(activeSheet()?.id).toBe(`${STYLE_ID_PREFIX}default`);
  });
});
