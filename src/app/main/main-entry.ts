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
 *   5. 引入新的运行时依赖 —— 仅用已有依赖（phaser + 浏览器原生 API）；
 *   6. 在这里写首启判定 —— 判定与挂载分别住在 onboarding-trigger.ts / onboarding-host.ts，
 *      本文件只负责把两者接进总线（组合根的职责就是接线）。
 *
 * 加载路径：dev 走 vite dev server 的 /src/app/main/index.html；
 *   正式构建走 dist/frontend/src/app/main/index.html（由 vite.config.ts 的 input 产出）。
 *   本页是**唯一**入口：旧 Vue 入口链随 task_017 退役，STRATIX_LEGACY 开关已下线，
 *   回退手段为 git 历史（见 src/app/entry-paths.ts）。
 */

import Phaser from 'phaser';

import { emitCommand, emitState, onState } from '../../core/bus';
import { createCoreRuntime, type UnhandledChannel } from '../../core/runtime';
import { worldStore } from '../../core/store';
import type { DetectedAgent, HudCommand, WorldEvent } from '../../core/types';
import { createHudBusAdapter } from '../../hud/bridge/bus-adapter';
import { createMainScreen } from '../../hud/screens/main-screen';
import { createThemeController } from '../../hud/theme/theme-controller';
import defaultCss from '../../hud/theme/tokens-default.css?inline';
import pixelCss from '../../hud/theme/tokens-pixel.css?inline';
import { defineStratButton } from '../../hud/widgets/strat-button';
import { CharacterComposer } from '../../world/appearance/character-composer';
import { PartRegistry } from '../../world/appearance/part-registry';
import { UNIT_SPRITE_SOURCE_KEY } from '../../world/objects/unit-sprite-source';
import { BattlefieldScene } from '../../world/scenes/BattlefieldScene';
import { createBrowserAppearanceEnvironment } from '../services/appearance-environment';
import { createPhaserPreviewGame } from '../services/appearance-preview-game';
import { createAppearancePreviewService } from '../services/appearance-preview-service';
import { createUnitSpriteSource } from '../services/unit-sprite-source';

import { isOnboardingForced } from './dev-flags';
import { createOnboardingHost } from './onboarding-host';

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`main-entry: #${id} not found`);
  return el as T;
}

/**
 * preload 暴露的检测接口（形状取自 src/electron/preload.ts 的 agentDetection）。
 * why 这里自己声明一份而不是 import preload 的类型：preload 依赖 electron 模块，
 * 渲染层 bundle 里不能有它（import type 虽会被擦除，但形状重复一份反而更清楚 —— 两边本就该解耦）。
 */
interface AgentDetectionApi {
  readonly snapshot?: () => Promise<DetectedAgent[]>;
  readonly onUpdate?: (callback: (agents: DetectedAgent[]) => void) => () => void;
}

/** 取 preload 上的检测接口；非 Electron 环境（纯 vite dev）没有它，返回 null。 */
function agentDetectionApi(): AgentDetectionApi | null {
  const api = (window as unknown as { electronAPI?: { agentDetection?: AgentDetectionApi } }).electronAPI;
  return api?.agentDetection ?? null;
}

/**
 * 订阅本地 CLI agent 检测结果并入 core 状态（@since v3.8，task_022）。
 *
 * 数据流：Electron 主进程探测（Node 侧才有 child_process）→ IPC 推送 → 这里写 store
 *   → core/runtime.ts 的 store 订阅广播 WorldState.detectedAgents → hud 读取。
 * 本文件只做「搬运 + 落库」，不碰探测逻辑（那是 app/services/agent-detector 的职责）。
 *
 * why **先订阅、后拉快照**：反过来（先拉后订阅）的话，"拉快照那一刻到订阅生效那一刻"之间
 *   到达的推送会永久丢失 —— 那一项就再也不会出现在状态里。
 * 返回退订函数（资源必须可清理）：页面卸载时调用。
 */
function subscribeDetectedAgents(): () => void {
  const api = agentDetectionApi();
  if (!api) return () => {};

  const unsubscribe = api.onUpdate?.((agents) => {
    worldStore.setDetectedAgents(agents);
  });

  // 快照是补充，不是替代：订阅已经覆盖后续推送，快照只补上"订阅之前就检测完"的那部分。
  void api
    .snapshot?.()
    .then((agents) => {
      worldStore.setDetectedAgents(agents);
    })
    .catch((error) => {
      // 拉不到快照不是故障：订阅还在，等下一次推送即可（不打断启动）。
      console.warn('[Stratix] 检测快照拉取失败，等待后续推送', error);
    });

  return () => unsubscribe?.();
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
  const onboardingHost = must<HTMLElement>('onboarding-host');

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

  // ===== 形象预览（@since v3.10，task_028）=====
  // 组合根是唯一能同时认识 hud 与 world 的地方：向导屏要 canvas 预览（hud），
  // 合成器与素材注册表在 world/appearance —— 两侧都不许直接互认，故在这里接线。
  // 素材元数据在后台加载（失败降级：向导照常能走完，只是没有随机形象可选）。
  // 注册表与合成器**与战场侧共用同一份**：元数据（1.4MB）只加载一次，位图 LRU 缓存也共用。
  const appearanceEnv = createBrowserAppearanceEnvironment();
  const appearanceRegistry = new PartRegistry({ basePath: appearanceEnv.spritesheetBaseUrl });
  const appearanceComposer = new CharacterComposer({
    registry: appearanceRegistry,
    createCanvas: appearanceEnv.createCanvas,
    createImage: appearanceEnv.createImage,
  });
  const appearancePreview = createAppearancePreviewService({
    registry: appearanceRegistry,
    composer: appearanceComposer,
    createCanvas: appearanceEnv.createCanvas,
    createImage: appearanceEnv.createImage,
    createGame: createPhaserPreviewGame,
  });

  // ===== 战场单位的形象（@since v3.10，task_029）=====
  // 单位带 appearance 时，战场用合成好的 LPC 精灵表当身体（走路动画）。
  // 合成要 DOM（canvas / Image），world 层零 DOM —— 故实现在 app 层，world 只认端口。
  const unitSpriteSource = createUnitSpriteSource({
    registry: appearanceRegistry,
    composer: appearanceComposer,
    createCanvas: appearanceEnv.createCanvas,
  });

  // ===== 首启向导覆盖层（@since v3.9，task_026）=====
  // 判定：还没有角色 且 探到 ≥1 个已装 agent（开发期 STRATIX_ONBOARDING_FORCE=1 每次都触发）。
  // 走完向导 → 角色落库 → 同一次广播里多出该角色的战场单位（core/character/unit-projection.ts）。
  const onboarding = createOnboardingHost({
    deps: adapter,
    host: onboardingHost,
    appearance: appearancePreview,
    force: isOnboardingForced(),
    onComplete: () => {
      // 引导走完落在角色屏：用户第一眼看到自己刚建的角色（而不是空荡荡的主屏）。
      // why 排到微任务里：向导屏在完成事件之后还会派发 ui.navigate('main')，
      //   同步跳转会被它盖掉 —— 微任务保证最终停在角色屏。
      queueMicrotask(() => {
        adapter.dispatch({ type: 'ui.navigate', screen: 'character' });
      });
    },
  });

  // ===== world 侧：Phaser 战场（BattlefieldScene 内部自带 world ↔ core 桥接层）=====
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: battlefieldHost,
    backgroundColor: '#0f131b',
    scale: { mode: Phaser.Scale.RESIZE },
    scene: [BattlefieldScene],
    // 形象精灵源在 boot 前就位（场景自己实例化，构造器拿不到注入 —— 走 game.registry）。
    callbacks: {
      preBoot: (booting) => {
        booting.registry.set(UNIT_SPRITE_SOURCE_KEY, unitSpriteSource);
      },
    },
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

  // ===== 本地 CLI agent 检测（@since v3.8）=====
  // 主进程探测 → IPC → 这里并入 core 状态 → runtime 的 store 订阅广播给 hud。
  const stopAgentDetection = subscribeDetectedAgents();

  // ===== 首启判定：跟着 core 广播走（角色为空 + 探到已装 agent → 挂向导）=====
  // 订阅放在 runtime 启动之后：广播是 runtime 的 store 订阅发出的，晚订阅会漏掉首次快照。
  const stopOnboardingWatch = onState((state) => {
    onboarding.evaluate(state);
  });

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
      stopOnboardingWatch();
      onboarding.dispose();
      // 预览实例（Phaser）由向导屏在卸载时销毁；这里再兜一次底（向导没挂过时也不会有事）。
      appearancePreview.destroy();
      stopAgentDetection();
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