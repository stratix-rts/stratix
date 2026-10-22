/**
 * 文件职责：dev-only HUD 启动入口 —— 注册所有 hud 组件、构造适配器与主题控制器、
 *   把 main-screen 挂到 #hud-root。不接入任何现有主 UI。
 *   来源：docs/REFACTOR_PLAN_V3.md Phase 1 → hud 骨架联调 hello loop 的最小形态。
 *   task_024：皮肤库扩到 8 套（default/pixel + 六套新 token 变体），本入口一次性全量注入。
 * 输入：浏览器 DOM（#hud-root）；core/bus 单例。
 * 输出：完整 HUD 渲染，主题可切换，按钮点击经 core/bus 发出 HudCommand。
 * 禁止事项：
 *   1. 引入额外运行时依赖 —— 仅用浏览器原生 API；
 *   2. 在此处写业务态 —— 全部状态由 core 提供；
 *   3. 直接订阅 mitt 总线绕过 bus-adapter —— 一切走 inject 的 onState 路径。
 */

import { onState, emitCommand } from '../../core/bus';
import { createHudBusAdapter } from '../bridge/bus-adapter';
import { createMainScreen } from '../screens/main-screen';
import { type SkinId } from '../theme/skin-registry';
import { createThemeController } from '../theme/theme-controller';
import auroraCss from '../theme/tokens-aurora.css';
import crimsonCss from '../theme/tokens-crimson.css';
import defaultCss from '../theme/tokens-default.css';
import forestCss from '../theme/tokens-forest.css';
import monoCss from '../theme/tokens-mono.css';
import oceanCss from '../theme/tokens-ocean.css';
import pixelCss from '../theme/tokens-pixel.css';
import sunsetCss from '../theme/tokens-sunset.css';
import { defineStratButton } from '../widgets/strat-button';

/**
 * 皮肤 id → token 样式表。
 * 类型写成 Record<SkinId, string>：新增皮肤时若忘了引样式表，tsc 立刻报错（而不是运行时掉 token）。
 */
const SKIN_CSS: Record<SkinId, string> = {
  default: defaultCss,
  pixel: pixelCss,
  crimson: crimsonCss,
  forest: forestCss,
  ocean: oceanCss,
  sunset: sunsetCss,
  mono: monoCss,
  aurora: auroraCss,
};

function boot(): void {
  const root = document.getElementById('hud-root');
  if (!root) throw new Error('hud-dev: #hud-root not found');

  defineStratButton();
  const themeController = createThemeController<SkinId>({
    sources: SKIN_CSS,
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
  // 皮肤切换：__srfHud.themeController.apply('crimson')（core 的 theme.set 目前只认 default/pixel）。
  (window as unknown as { __srfHud: unknown }).__srfHud = { adapter, screen, themeController, unmount };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
