/**
 * 文件职责：v3 Phase 1 的 **HelloLoop 联调入口**（dev-only）—— 同屏挂「HUD 主屏 + 战场」，
 *   把完整闭环真跑一遍：HUD 按钮 → HudCommand → core 选择状态机 → WorldState 变更 →
 *   world 桥接层 → BattlefieldScene 单位高亮（反向：点战场单位 → world 事件 → core → HUD 显示）。
 *   方案来源：docs/REFACTOR_PLAN_V3.md §6 Phase 1「联调验收（hello loop）」。
 * 输入：DOM 容器 #hud-root / #loop-panel / #battlefield / #loop-log；core 的 store / bus / runtime。
 * 输出：一个可交互页面 + window.__srfHelloLoop 调试句柄（供 E2E / 手工排查）。
 * 禁止事项：
 *   1. 被生产入口 import —— 本文件只配 hello-loop.html，vite build 不会把它打进正式产物；
 *   2. 绕过 hud / world 的公开桥接 —— 本文件是**唯一**允许同时认识 hud/ 与 world/ 的地方（组合根），
 *      但 hud ↔ world 之间依然零直接调用：两层只经 core/bus 通信（架构铁律不因组合根破例）；
 *   3. 在这里写业务态 —— 选中与否一律由 core 状态机裁决，本文件只发命令、只读状态；
 *   4. 造假状态让页面好看 —— 页面上每个单位都必须来自 core 广播的 UnitView，战场上的圆点只是它的渲染。
 *
 * 启动方式：npm run dev（vite dev server）后访问 /src/app/dev/hello-loop.html
 */

import Phaser from 'phaser';

import { emitCommand, onCommand, onState } from '../../core/bus';
import { createCoreRuntime, type UnhandledChannel } from '../../core/runtime';
import { worldStore } from '../../core/store';
import type { HudCommand, UnitView, WorldState } from '../../core/types';
import { createHudBusAdapter } from '../../hud/bridge/bus-adapter';
import { createMainScreen } from '../../hud/screens/main-screen';
import { createThemeController } from '../../hud/theme/theme-controller';
import defaultCss from '../../hud/theme/tokens-default.css?inline';
import pixelCss from '../../hud/theme/tokens-pixel.css?inline';
// 像素皮肤的真像素字体（@since v3.8，task_134）：与生产入口同一口径。
import { pixelFontFaceCss, pixelFontUrl } from '../../hud/theme/pixel-font';
import { defineStratButton } from '../../hud/widgets/strat-button';
import { BattlefieldScene, BATTLEFIELD_SCENE_KEY } from '../../world/scenes/BattlefieldScene';

import { createHelloLoopPanel } from './hello-loop-panel';

/**
 * dev 种子单位：世界层按落位顺序自动排布，core 只持有业务态（无坐标，见 core/types.ts UnitView）。
 * why 允许有种子：闭环演示需要一个非空战场；种子写进**真实 store** 再广播，
 * 页面与场景都只读这份广播，没有任何绕过 core 的旁路数据。
 */
const SEED_UNITS: UnitView[] = [
  { id: 'u-neo', name: 'Neo', status: 'idle', missionId: null, power: 3 },
  { id: 'u-trinity', name: 'Trinity', status: 'busy', missionId: null, power: 5 },
  { id: 'u-morpheus', name: 'Morpheus', status: 'idle', missionId: null, power: 4 },
  { id: 'u-cipher', name: 'Cipher', status: 'error', missionId: null, power: 1 },
];

/** 观测面板最多保留的行数（perf：日志不许无限增长）。 */
const LOG_MAX_LINES = 12;

/**
 * dev-only 摆位：把镜头对准单位的落位区（世界坐标，战场左上角一带）。
 * why 需要它：单位位置由 world 自治并从战场左上角落位（world/objects/unit-registry.ts），
 * 而场景的开局机位是战场正中（world/camera），两者相差一千多世界像素 ——
 * 不摆位的话闭环虽然在跑，但点亮的单位在画面外，演示等于没跑。
 * 已知缺口（TODO(v3.Phase2)）："首批单位自动入镜 / 落位起点与开局机位对齐"应由 world 侧收口，
 * 届时删掉本函数即可，dev 页不用动。
 */
const DEMO_VIEW_AREA = { width: 1000, height: 760 };

function frameDemoView(game: Phaser.Game): void {
  const scene = game.scene.getScene(BATTLEFIELD_SCENE_KEY);
  if (!scene) return;
  const zoom = Math.min(game.scale.width / DEMO_VIEW_AREA.width, game.scale.height / DEMO_VIEW_AREA.height);
  const camera = scene.cameras.main;
  // 顺序要紧：先对中再缩放 —— Phaser 的 setZoom 会保持相机中点，先缩放会把中点算错
  camera.centerOn(DEMO_VIEW_AREA.width / 2, DEMO_VIEW_AREA.height / 2);
  camera.setZoom(zoom);
}

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`hello-loop: #${id} not found`);
  return el as T;
}

function boot(): void {
  const hudRoot = must('hud-root');
  const panelHost = must('loop-panel');
  const logHost = must('loop-log');

  // ===== 观测面板：只读真实发生的消息，让闭环的每一步都肉眼可见 =====
  const lines: string[] = [];
  const renderLog = (): void => {
    logHost.textContent = lines.length > 0
      ? `闭环日志（最近 ${lines.length} 条）\n${lines.join('\n')}`
      : '闭环日志\n（点击左侧按钮或在战场上点单位）';
  };
  const push = (line: string): void => {
    lines.unshift(line);
    if (lines.length > LOG_MAX_LINES) lines.length = LOG_MAX_LINES;
    renderLog();
  };

  onCommand((command: HudCommand) => {
    push(`hud → core   ${describeCommand(command)}`);
  });
  onState((state: WorldState) => {
    push(`core → 两层  选择 [${state.selection.unitIds.join(', ') || '空'}] rev ${state.selection.revision}`);
  });

  // ===== HUD 侧：真实 main-screen + 真实操作面板，共用一个 bus-adapter =====
  defineStratButton();
  const themeController = createThemeController({
    sources: {
      default: defaultCss,
      // 像素皮肤的真像素字体（@since v3.8，task_134）：@font-face 随像素源一起启停。
      // why 深度 3：本页在 src/app/dev/hello-loop.html（相对站点根 3 层：src/app/dev/），字体在站点根下 fonts/。
      pixel: pixelCss + pixelFontFaceCss(pixelFontUrl(document.baseURI, 3)),
    },
    initial: 'default',
  });
  const adapter = createHudBusAdapter({ onState, emitCommand, themeController });

  const screen = createMainScreen(adapter);
  const unmountScreen = screen.mount(hudRoot);

  const panel = createHelloLoopPanel(adapter, { units: SEED_UNITS });
  const unmountPanel = panel.mount(panelHost);

  adapter.mount();

  // ===== world 侧：Phaser 战场（BattlefieldScene 内部自带 world ↔ core 桥接层）=====
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'battlefield',
    backgroundColor: '#0f131b',
    scale: { mode: Phaser.Scale.RESIZE },
    scene: [BattlefieldScene],
  });

  // ===== core 侧：接上闭环的唯一接线（command/world → store → state）=====
  const runtime = createCoreRuntime({
    store: worldStore,
    onUnhandled: (channel: UnhandledChannel, payload) => {
      push(`未处理 ${channel} ${payload.type}（Phase 2 落地）`);
    },
  });
  const stopRuntime = runtime.start();

  /**
   * 种子单位在首帧之后写入。
   * why 必须等 POST_RENDER：Phaser 第一个 step 里先 boot 场景（跑完 create，桥接层此时才订阅好），
   * 再渲染，最后才发 POST_RENDER；早于它广播会把初始 state 丢在没人听的频道上（与 world/dev/main.ts 同一推理）。
   */
  game.events.once(Phaser.Core.Events.POST_RENDER, () => {
    worldStore.patch({ units: SEED_UNITS });
    frameDemoView(game);
    push(`core 播种 ${SEED_UNITS.length} 个单位并广播 state`);
  });

  // 窗口尺寸变化时场景会按自己的位姿重新钳制镜头，这里再摆一次位，保证单位仍在画面里
  game.scale.on(Phaser.Scale.Events.RESIZE, () => frameDemoView(game));

  renderLog();

  // dev-only 调试句柄：E2E / 手工排查用，不在生产 bundle 内
  (window as unknown as { __srfHelloLoop: unknown }).__srfHelloLoop = {
    adapter,
    screen,
    panel,
    themeController,
    game,
    runtime,
    stopRuntime,
    unmount: () => {
      stopRuntime();
      unmountPanel();
      unmountScreen();
      game.destroy(true);
    },
  };
}

function describeCommand(command: HudCommand): string {
  if (command.type === 'unit.select') {
    return `unit.select [${command.unitIds.join(', ') || '空'}] mode=${command.mode}`;
  }
  if (command.type === 'theme.set') return `theme.set ${command.themeId}`;
  if (command.type === 'ui.navigate') return `ui.navigate ${command.screen}`;
  return command.type;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}