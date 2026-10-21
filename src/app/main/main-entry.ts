/**
 * 文件职责：v3 **正式渲染入口**（Electron 主窗口默认加载页）的组合根 —— 把三段接成一个可运行应用：
 *   core runtime（命令/事件 → 状态机 → store → state 广播）+ world（Phaser BattlefieldScene 战场）
 *   + hud（main-screen 全套屏/面板）同屏装配。装配骨架参照 dev/hello-loop.html（Phase 1 联调页），
 *   差别是：去掉 dev-only 观测面板与演示种子，页面上的每个状态都来自 core 广播的真实 WorldState。
 *   方案来源：docs/REFACTOR_PLAN_V3.md §1 通信铁律 + §2「app/ 两个渲染入口（new / legacy）」+ §6 Phase 3 入口切换。
 * 输入：DOM 容器 #hud-side / #battlefield / #boot-error；core 的 store / bus / runtime；hud 与 world 的公开工厂。
 * 输出：一个跑起来的新 UI：左侧 HUD 屏，右侧战场，两侧只经 core/bus 通信。
 * 禁止事项：
 *   1. 绕过 hud / world 的公开桥接 —— 本文件是**唯一**允许同时认识两侧的组合根，
 *      但 hud ↔ world 之间依然零直接调用（组合根不豁免架构铁律）；
 *   2. 在这里写业务态 —— 选中与否一律由 core 状态机裁决，本文件只发命令、只读状态；
 *   3. 造演示数据（种子单位 / 假任务）—— 页面上的每个单位都必须来自 core 广播的 UnitView；
 *   4. 挂 dev-only 调试句柄（window.__srf*）到生产 bundle —— 需要排查时看 renderer console；
 *   5. 引入新的运行时依赖 —— 仅用已有依赖（phaser + 浏览器原生 API）。
 *
 * 加载路径：dev 走 vite dev server 的 /src/app/main/index.html；
 *   正式构建走 dist/frontend/src/app/main/index.html（由 vite.config.ts 的多入口 input 产出）。
 *   切回旧入口：STRATIX_LEGACY=1（判定逻辑见 src/app/entry-paths.ts，主进程侧消费）。
 */

import Phaser from 'phaser';

import { emitCommand, emitState, onState } from '../../core/bus';
import { createCoreRuntime, type UnhandledChannel } from '../../core/runtime';
import { worldStore } from '../../core/store';
import type { HudCommand, WorldEvent } from '../../core/types';
import { createHudBusAdapter } from '../../hud/bridge/bus-adapter';
import { createMainScreen } from '../../hud/screens/main-screen';
import { createThemeController } from '../../hud/theme/theme-controller';
import defaultCss from '../../hud/theme/tokens-default.css?inline';
import pixelCss from '../../hud/theme/tokens-pixel.css?inline';
import { defineStratButton } from '../../hud/widgets/strat-button';
import { BattlefieldScene } from '../../world/scenes/BattlefieldScene';

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`main-entry: #${id} not found`);
  return el as T;
}

/** 装配失败时的兜底提示（空白页无法诊断）。正式入口没有 dev 观测面板，只能就地报错。 */
function reportBootFailure(error: unknown): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error('[Stratix] 装配失败', error);
  const host = document.getElementById('boot-error');
  if (host) {
    host.hidden = false;
    host.textContent = `Stratix 启动失败\n${message}`;
  }
}

function boot(): void {
  const hudRoot = must<HTMLElement>('hud-root');
  const battlefieldHost = must<HTMLElement>('battlefield');

  // ===== HUD 侧：真实 main-screen + 主题控制器，走注入的 bus-adapter =====
  defineStratButton();
  const themeController = createThemeController({
    sources: { default: defaultCss, pixel: pixelCss },
    initial: 'default',
  });
  const adapter = createHudBusAdapter({ onState, emitCommand, themeController });

  const screen = createMainScreen(adapter);
  const unmountScreen = screen.mount(hudRoot);
  const unmountAdapter = adapter.mount();

  // ===== world 侧：Phaser 战场（BattlefieldScene 内部自带 world ↔ core 桥接层）=====
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: battlefieldHost,
    backgroundColor: '#0f131b',
    scale: { mode: Phaser.Scale.RESIZE },
    scene: [BattlefieldScene],
  });

  // ===== core 侧：闭环接线（command/world → store → state 广播）=====
  // 未接地的命令 / 事件只落 console：它们是"还没实现"，不是错误，堆错误日志会淹没真故障。
  const runtime = createCoreRuntime({
    store: worldStore,
    onUnhandled: (channel: UnhandledChannel, payload: HudCommand | WorldEvent) => {
      console.warn(`[Stratix] 未处理 ${channel}: ${payload.type}`);
    },
  });
  const stopRuntime = runtime.start();

  /**
   * 首帧后补发一次当前 WorldState。
   * why 必须等 POST_RENDER：Phaser 第一个 step 里先 boot 场景（跑完 create，桥接层此时才订阅好），
   * 再渲染，最后才发 POST_RENDER；而 store.subscribe 不回放历史（core/store.ts），
   * runtime 早于场景 start 也不会把初始快照补送给后来订阅的桥接层 ——
   * 不补这一次，HUD 与战场都要等下一次真实变更才拿到初始状态（与 world/dev/main.ts 同一推理）。
   */
  game.events.once(Phaser.Core.Events.POST_RENDER, () => {
    emitState(worldStore.getState());
  });

  // 窗口销毁时逆序收干净：runtime 退订 → HUD 退订 → Phaser 销毁（场景 shutdown 会自行 destroy 桥接层）。
  window.addEventListener(
    'pagehide',
    () => {
      stopRuntime();
      unmountAdapter();
      unmountScreen();
      game.destroy(true);
    },
    { once: true },
  );
}

/** 装配入口：两条路径（立即执行 / DOMContentLoaded 后）都走同一个 try-catch，否则监听器里抛错会变成静默白屏。 */
function safeBoot(): void {
  try {
    boot();
  } catch (error) {
    reportBootFailure(error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', safeBoot, { once: true });
} else {
  safeBoot();
}