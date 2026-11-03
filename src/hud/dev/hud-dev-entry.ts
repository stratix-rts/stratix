/**
 * 文件职责：dev-only HUD 启动入口 —— 注册所有 hud 组件、构造适配器与主题控制器、
 *   把 main-screen 挂到 #hud-root。不接入任何现有主 UI。
 *   来源：docs/REFACTOR_PLAN_V3.md Phase 1 → hud 骨架联调 hello loop 的最小形态。
 *   task_024：皮肤库扩到 8 套（default/pixel + 六套新 token 变体），本入口一次性全量注入。
 *   task_034（DEMO）：挂角色聊天抽屉 + 定时器假流（见下文 DEMO 块，正式接线走 035 组合根）。
 * 输入：浏览器 DOM（#hud-root）；core/bus 单例。
 * 输出：完整 HUD 渲染，主题可切换，按钮点击经 core/bus 发出 HudCommand。
 * 禁止事项：
 *   1. 引入额外运行时依赖 —— 仅用浏览器原生 API；
 *   2. 在此处写业务态 —— 全部状态由 core 提供；
 *   3. 直接订阅 mitt 总线绕过 bus-adapter —— 一切走 inject 的 onState 路径。
 */

import { onState, emitCommand } from '../../core/bus';
import { type SkinId } from '../../core/theme/skin-registry';
import { createHudBusAdapter } from '../bridge/bus-adapter';
// 信息三层级（@since v3.4，task_096）：层级状态机 + 三档演示开关。
import { createInfoLayerController } from '../layers/info-layer';
import { mountLayerSwitch } from '../layers/layer-switch';
// 遮挡规则（@since v3.5，task_099）：全屏弹窗登记 → 四角常驻件降对比禁点；ESC 统一路由。
import { createOcclusionController } from '../layers/occlusion';
// ⚠️ DEMO（task_034 演示路径，正式接线走 task_035 组合根）：角色聊天抽屉 + 定时器假流。
// 生产链路（main-entry）不得 import demo-fake-stream。
import {
  CHARACTER_CHAT_DRAWER_TAG,
  mountCharacterChatDrawer,
  type StratCharacterChatDrawerElement,
} from '../components/chat-drawer/chat-drawer';
import { createDemoOnSend } from '../components/chat-drawer/demo-fake-stream';
import { createMainScreen } from '../screens/main-screen';
import { createThemeController } from '../theme/theme-controller';
import auroraCss from '../theme/tokens-aurora.css';
import crimsonCss from '../theme/tokens-crimson.css';
import defaultCss from '../theme/tokens-default.css';
import forestCss from '../theme/tokens-forest.css';
import monoCss from '../theme/tokens-mono.css';
import oceanCss from '../theme/tokens-ocean.css';
import pixelCss from '../theme/tokens-pixel.css?inline';
// 像素皮肤专属视觉层（@since v3.7，task_128）：与生产入口同一口径（拼进 pixel 源）。
import pixelLayerCss from '../theme/skin-pixel-layer.css?inline';
import sunsetCss from '../theme/tokens-sunset.css';
import { defineStratButton } from '../widgets/strat-button';

/**
 * 皮肤 id → token 样式表。
 * 类型写成 Record<SkinId, string>：新增皮肤时若忘了引样式表，tsc 立刻报错（而不是运行时掉 token）。
 */
const SKIN_CSS: Record<SkinId, string> = {
  default: defaultCss,
  pixel: pixelCss + pixelLayerCss,
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

  // ===== 信息三层级 + 遮挡规则（@since v3.4 task_096 / @since v3.5 task_099）=====
  // 两个机制层单一实例：层级控制器（CSS 变量通道）+ 遮挡控制器（谁压着谁）。
  // why 建在 createMainScreen 之前：主屏要拿遮挡控制器（子屏登记成全屏弹窗）。
  const layerController = createInfoLayerController();
  // task_099 硬要求：弹窗降对比复用 096 的 L1 通道（l1Dim = 层级控制器），不另造变量。
  const occlusionController = createOcclusionController({ l1Dim: layerController });

  const screen = createMainScreen(adapter, {
    // 遮挡规则（@since v3.5，task_099）：dev 页与生产入口同一套接线 —— 子屏是全屏弹窗，
    //   开着时四角常驻件降对比 + 禁点，ESC / 点遮罩双关闭。
    occlusion: occlusionController,
  });
  const unmount = screen.mount(root);
  adapter.mount();

  // ===== 信息三层级三档开关（@since v3.4，task_096）=====
  // dev 页里没有 world，层级状态照样能切：开关发 HudCommand `hud.layer.set` → core 写
  //   WorldState.infoLayer → state 广播回来 → 控制器改根上的 CSS 变量（L1 降对比 / L2 收起）。
  // 真相在 core，HUD 不存第二份 —— 与生产入口同一套接线。
  const stopLayerState = adapter.subscribe((state) => {
    layerController.apply(state.infoLayer ?? 'L1');
  });
  const { unmount: unmountLayerSwitch } = mountLayerSwitch(
    {
      controller: layerController,
      dispatch: (command) => adapter.dispatch(command),
    },
    root,
  );

  // ⚠️ DEMO（task_034 演示路径）：挂上角色聊天抽屉并接定时器假流，肉眼验证
  //   右侧滑入滑出 / 流式回显 / setSending 禁用态。dev 总线里没有真实角色，
  //   给一个假角色 id 直接开抽屉；点战场单位切真实角色的链路（selection 广播驱动）
  //   在正式组合根接线后生效。发送 → (DEMO 假流) 前缀逐 chunk 回显即本演示。
  const demoHost = document.createElement('div');
  root.appendChild(demoHost);
  let characterDrawer: StratCharacterChatDrawerElement | null = null;
  const unmountCharacterDrawer = mountCharacterChatDrawer({
    subscribe: (handler) => adapter.subscribe(handler),
    // task_099：抽屉是半模态（只压暗对侧、不锁四角）—— 开合状态报给遮挡控制器。
    occlusion: occlusionController,
    onSend: createDemoOnSend((): StratCharacterChatDrawerElement => {
      if (!characterDrawer) throw new Error('hud-dev: 角色聊天抽屉尚未挂载');
      return characterDrawer;
    }),
  }, demoHost);
  characterDrawer = demoHost.querySelector(CHARACTER_CHAT_DRAWER_TAG) as StratCharacterChatDrawerElement;
  characterDrawer.setCharacter('demo-character');
  characterDrawer.open('demo-character');

  // dev-only：暴露在 window 上方便调试 & E2E 测试（不在生产 bundle 内）。
  // 皮肤切换：__srfHud.themeController.apply('crimson')（core 的 theme.set 目前只认 default/pixel）。
  (window as unknown as { __srfHud: unknown }).__srfHud = {
    adapter,
    screen,
    themeController,
    unmount,
    characterDrawer,
    unmountCharacterDrawer,
    // 信息层级（task_096）：控制器可被调试脚本直接驱动（__srfHud.layerController.apply('L3')）。
    layerController,
    unmountLayerSwitch,
    stopLayerState,
    // 遮挡规则（task_099）：遮挡控制器（调试脚本可看当前有没有模态弹窗）。
    occlusionController,
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
