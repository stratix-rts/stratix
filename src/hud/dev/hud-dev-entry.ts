/**
 * 文件职责：dev-only HUD 启动入口 —— 注册所有 hud 组件、构造适配器与主题控制器、
 *   把 main-screen 挂到 #hud-root。不接入任何现有主 UI。
 *   来源：docs/REFACTOR_PLAN_V3.md Phase 1 → hud 骨架联调 hello loop 的最小形态。
 * 输入：浏览器 DOM（#hud-root）；core/bus 单例。
 * 输出：完整 HUD 渲染，主题可切换，按钮点击经 core/bus 发出 HudCommand。
 * 禁止事项：
 *   1. 引入额外运行时依赖 —— 仅用浏览器原生 API；
 *   2. 在此处写业务态 —— 全部状态由 core 提供；
 *   3. 直接订阅 mitt 总线绕过 bus-adapter —— 一切走 inject 的 onState 路径。
 */

import { onState, emitCommand } from '../../core/bus';
import { createHudBusAdapter } from '../bridge/bus-adapter';
import { createThemeController } from '../theme/theme-controller';
import defaultCss from '../theme/tokens-default.css';
import pixelCss from '../theme/tokens-pixel.css';
import { createMainScreen } from '../screens/main-screen';
import { defineStratButton } from '../widgets/strat-button';

function boot(): void {
  const root = document.getElementById('hud-root');
  if (!root) throw new Error('hud-dev: #hud-root not found');

  defineStratButton();
  const themeController = createThemeController({
    sources: { default: defaultCss, pixel: pixelCss },
    initial: 'default',
  });
  const adapter = createHudBusAdapter({
    onState,
    emitCommand,
    themeController,
  });

  const screen = createMainScreen(adapter);
  const unmount = screen.mount(root);
  adapter.mount();

  // dev-only：暴露在 window 上方便调试 & E2E 测试（不在生产 bundle 内）。
  (window as unknown as { __srfHud: unknown }).__srfHud = { adapter, screen, themeController, unmount };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
