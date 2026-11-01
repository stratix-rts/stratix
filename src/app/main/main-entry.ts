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
 * @since v3.12（task_033）存档接线：boot 改为异步 —— 先读 SQLite 快照（经 IPC 到主进程 DAO）
 *   恢复角色/单位进 store、把站位种子塞给战场，再创建 Phaser。落库由 GameSaveCoordinator
 *   订阅 core 广播完成（档案 diff 落库 + 站位防抖落库），本文件只负责接线和时序：
 *   必须先 restore 注入、再 coordinator.start()，否则注入的那批会被当成新变化回写一遍。
 *
 * @since v3.14（task_035）角色对话回路：挂上角色聊天抽屉并桥到 chat-service ——
 *   onSend / onStop / onRetry 三个回调 + 会话 id 回写 worldStore（存档协调器自动落库）；
 *   transport 经 IPC 桥在主进程跑（chat-transport-bridge），本文件只接线。
 *
 * @since v3.15（task_036）会话历史落库：chat-service 的 persistMessage 注入 IPC 落库回调
 *   （user 即时 / assistant 收束 / error），抽屉的 loadHistory 注入按角色读最近 50 条 ——
 *   打开/切角色回填历史，与重建后的新会话同一段消息流连续展示。本文件仍然只接线。
 *
 * @since v3.16（task_037）任务派发与执行：core/task（task.assign → queued 状态 + 生命周期事件）
 *   + task-service（每角色 FIFO、并发 1，经 chat IPC 通道跑 transport，相位回报 core）+
 *   任务落库（character_tasks 表，schema v4）。UI 入口（派发表单/战场表现）归 038，本任务只接线。
 *
 * @since v3.18（task_039）结果回流 + exp 事件：hud 挂 toast 宿主（右上角轻提示）；task-service
 *   的终态回调接 task-report（报告消息落 character_chat_messages + 抽屉注入 + toast）。经验事件
 *   （exp.gained）的发射与权重缺省都在服务层内部（task-service / chat-service），本文件零业务。
 *
 * @since v3.19（task_040）养成回路：core/progression 成为养成数值的单一真相源 ——
 *   ① chat-service / task-service 的 expWeight 注入件换为 progression.expWeightFor（两服务零改动，
 *     交接面在注入件）；② progression-service 订阅 exp.gained → character manager 累加落库
 *     （等级曲线结算在 core）→ 升级广播 level.up（UI 反馈归 041，本文件只接线）。
 *   character manager 在组合根显式创建，与 runtime / progression-service 共享同一实例
 *     （与 taskManager 同一模式：两处写的是同一份 WorldState）。
 *
 * @since v3.22（task_046）任务实时输出流：抽屉嵌挂的任务输出面板（characterDrawer.taskOutput）
 *   接 task-service 的新端口 onTaskChunk —— 执行期 chunk 原序转发进面板缓冲（实时 tail 视图）。
 *   本文件仍然只接线：面板的开工对账 / 截断 / 跟随全在 hud 组件内，服务只管转发。
 *
 * @since v3.24（task_048）任务成果物：onTaskSettled 终态记录先喂面板的 setTaskArtifacts
 *   （formatTaskArtifactsBlock 在 app 层算好文案再传字符串 —— hud 不 import app/），
 *   再走 039 的结果回流；📋 报告尾部的成果物块在 task-report 内部拼接。本文件仍然只接线。
 *
 * @since v3.33（task_057）小地图：mountMinimap 接进 hud-root（命令口 = adapter.dispatch）；
 *   单位 / 视口数据在本文件累积喸入（位置从恢复站位 + unit.position 事件，视口从 camera.moved
 *   + 容器尺寸换算），组件侧零订阅 —— 仍是只接线，见「小地图」接线段的注释。
 *
 * @since v3.36（task_060）音效反馈：createSfxService 接进总线（task.completed / failed /
 *   level.up / awaiting_approval / agent.offline → WebAudio 合成短音，映射表在 sfx-service）。
 *   仍然只接线：开关与音量走 localStorage（设置屏直写），服务每次播放现读。
 *
 * @since v3.34（task_058）快捷键系统：mountShortcuts（window keydown → 命令口 / 帮助浮层）
 *   接进 hud-root。命令走 adapter.dispatch；居中要的单位坐标复用小地图的同一份位置累积表
 *   （minimapPositions）—— 位置真相在世界层，组合根是唯一能拿到它的地方，仍是只接线。
 *
 * 加载路径：dev 走 vite dev server 的 /src/app/main/index.html；
 *   正式构建走 dist/frontend/src/app/main/index.html（由 vite.config.ts 的 input 产出）。
 *   本页是**唯一**入口：旧 Vue 入口链随 task_017 退役，STRATIX_LEGACY 开关已下线，
 *   回退手段为 git 历史（见 src/app/entry-paths.ts）。
 */

import Phaser from 'phaser';

import { emitCommand, emitState, onState, onWorldEvent } from '../../core/bus';
import { createCharacterManager } from '../../core/character';
import { createMissionManager } from '../../core/mission';
import { createCoreRuntime, type UnhandledChannel } from '../../core/runtime';
import { expWeightFor } from '../../core/progression';
import { worldStore } from '../../core/store';
import type { DetectedAgent, HudCommand, Point, WorldEvent } from '../../core/types';
import { createHudBusAdapter } from '../../hud/bridge/bus-adapter';
import { createMainScreen } from '../../hud/screens/main-screen';
import { levelUpToastText } from '../../hud/screens/appearance-unlock-catalog';
import { createThemeController } from '../../hud/theme/theme-controller';
import defaultCss from '../../hud/theme/tokens-default.css?inline';
import pixelCss from '../../hud/theme/tokens-pixel.css?inline';
import { defineStratButton } from '../../hud/widgets/strat-button';
import { mountCharacterChatDrawer, CHARACTER_CHAT_DRAWER_TAG, type StratCharacterChatDrawerElement } from '../../hud/components/chat-drawer/chat-drawer';
// 音效服务（@since v3.36，task_060）：hud 侧服务（懒建 AudioContext + WebAudio 合成），
// 事件→key 映射在它的纯函数 —— 这里只订阅总线接线（见下方「音效反馈」段）。
import { createSfxService, sfxKeyForEvent } from '../../hud/components/sfx/sfx-service';
import { CharacterComposer } from '../../world/appearance/character-composer';
import { PartRegistry } from '../../world/appearance/part-registry';
import { UNIT_SPRITE_SOURCE_KEY } from '../../world/objects/unit-sprite-source';
import { UNIT_POSITION_SEED_KEY } from '../../world/objects/unit-registry';
import { BattlefieldScene } from '../../world/scenes/BattlefieldScene';
import {
  createGameSaveCoordinator,
  gameSaveApi,
  type RestoreInjection,
} from '../services/persistence/game-save-coordinator';
import {
  CHAT_HISTORY_LOAD_LIMIT,
  chatHistoryApi,
  chatHistoryEntryToDrawerInput,
  makeChatMessagePersister,
} from '../services/persistence/chat-history';
import { createBrowserAppearanceEnvironment } from '../services/appearance-environment';
import { createPhaserPreviewGame } from '../services/appearance-preview-game';
import { createAppearancePreviewService } from '../services/appearance-preview-service';
import { createAgentChatService } from '../services/agent-chat-service';
import { createChatService } from '../services/chat-service';
import {
  createStratixContextProvider,
  createTopicCachePersister,
  isGlobalContextEnabled,
} from '../services/stratix-context';
import { cliChatIpcApi, createIpcChatTransportFactory } from '../services/chat-transport-bridge';
import { createProgressionService } from '../services/progression-service';
import { createTaskService } from '../services/task-service';
import { formatTaskArtifactsBlock, parseTaskArtifactsJson } from '../services/task-artifacts';
import { createTaskReportHandler } from '../services/task-report';
import { taskRecordApi, makeTaskRecordPersister, makeTaskStatsProvider } from '../services/persistence/task-record';
// 经验事件审计流 + 成长看板（@since v3.36，task_061）：exp_events 表的渲染侧端口
//（persister 注入 progression-service；growth 口注入 hud 角色屏的「成长」tab）。
import {
  expEventApi,
  makeExpEventPersister,
  makeGrowthStatsPort,
} from '../services/persistence/exp-record';
// agent 健康监测（@since v3.30，task_054）：周期探测防抖判定 + transport exit 审计的单服务。
import { createHealthMonitor } from '../services/health-monitor';
import { agentHealthApi, makeAgentHealthPersister } from '../services/persistence/agent-health-record';
// 恢复 toast 的 kind 显示名（词表单一真相源在 onboarding-catalog，与 agent-panel 同源）。
import { agentKindLabel } from '../../hud/screens/onboarding-catalog';
// 流水线持久化注入件（@since v3.27，task_051）：pipelines 表专用面 + 站任务 pipeline_id 标记。
import {
  pipelineRecordApi,
  makePipelinePersister,
  makePipelineStampPersister,
} from '../services/persistence/pipeline-record';
import { createPipelineService } from '../services/pipeline-service';
import { mountToastHost } from '../../hud/components/toast/toast-host';
// 小地图宿主（@since v3.33，task_057）：右下角战场缩略图（单位点 / 视口框 / 点击跳转）。
import { mountMinimap } from '../../hud/components/minimap/minimap';
// 快捷键系统（@since v3.34，task_058）：window keydown → 命令 + 帮助浮层（键位表见 hud/shortcuts）。
import { mountShortcuts } from '../../hud/components/shortcuts/shortcut-manager';
import { createTaskManager } from '../../core/task';
import { createUnitSpriteSource } from '../services/unit-sprite-source';

import { isOnboardingForced } from './dev-flags';
import { createOnboardingHost } from './onboarding-host';
// 自定义 agent 注册端口（@since v3.32，task_056）：向导扫描步的「+ 添加自定义 agent」表单 /
// 设置屏的注册管理经它进主进程（IPC 面 = preload 的 customAgents）。非 Electron → null，降级。
import { customAgentsIpcPort } from './custom-agents-bridge';

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
  /** 按需跑一轮 T1 健康探测（@since v3.30，task_054；无 Electron 时没有，监测退化为无周期探测）。 */
  readonly probe?: () => Promise<DetectedAgent[]>;
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

async function boot(): Promise<void> {
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

  // ===== 形象预览（@since v3.10，task_028）=====
  // 组合根是唯一能同时认识 hud 与 world 的地方：向导屏要 canvas 预览（hud），
  // 合成器与素材注册表在 world/appearance —— 两侧都不许直接互认，故在这里接线。
  // 素材元数据在后台加载（失败降级：向导照常能走完，只是没有随机形象可选）。
  // 注册表与合成器**与战场侧共用同一份**：元数据（1.4MB）只加载一次，位图 LRU 缓存也共用。
  // @since v3.20（task_041）：同一实例再递给 main-screen —— 角色屏的形象编辑面板用它做
  // 预览与选择器（向导 / 编辑两屏不会同屏，共享实例零冲突；创建顺序上移只是因为要在建屏前就绪）。
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

  // ===== 任务域写入面前置（@since v3.27，task_051）=====
  // 流水线编排器要在 main-screen 之前建（面板要注入它的实时读数口），而它跑站要
  // taskManager —— createTaskManager 是纯构造（无 IO 无订阅无副作用），前移零风险；
  // runtime / task-service 注入的还是**同一个**实例（见下方「core 侧」注释）。
  const taskManager = createTaskManager({ store: worldStore });

  // ===== 流水线编排器（@since v3.27，task_051）=====
  // 架构：编排态在 app 层（内存 + pipelines 表），不进 WorldState（见 pipeline-service
  // 文件头禁止事项 2）；core 只出端口（PipelineRunnerPort，runtime 转发 pipeline.start）。
  // 跑站 = 逐站 task.assign 指定 targetCharacterId 直达角色 FIFO（与普通任务共用排队）；
  // 收尾信号主路 = task-service 的 onTaskSettled 回流（下方接线，全文输出去下一站
  // {{prev_output}}）；兜底路 = 自订阅总线（详见 pipeline-service 文件头「两路收尾信号」）。
  // 持久化：pipelines 表走专用 IPC 面；站任务 pipeline_id 复用 game:saveTask 多带一列。
  // 非 Electron：两个 IPC 面都是 null → 注入件缺省（编排照跑，只落内存 —— dev 行为可预期）。
  const pipelineApi = pipelineRecordApi();
  const taskApi = pipelineApi ? taskRecordApi() : null;
  const pipelineService = createPipelineService({
    getState: () => worldStore.getState(),
    taskManager,
    persistPipeline: pipelineApi ? makePipelinePersister(pipelineApi) : undefined,
    stampTask: pipelineApi && taskApi ? makePipelineStampPersister(taskApi) : undefined,
  });
  const stopPipelineBus = pipelineService.start();

  // ===== HUD 侧：真实 main-screen + 主题控制器，走注入的 bus-adapter =====
  // task_050：派发推荐的历史统计提供口 —— 从任务记录 IPC 面取聚合（非 Electron = null，
  // hud 侧无历史中性降级，不拆表单）。「缓存」语义在 hud：表单持有上一次快照，打开时刷新一次。
  // task_051：流水线实时读数口 —— 面板发起后显示流水线卡片（站序/相位实时）。
  const screen = createMainScreen(adapter, {
    appearance: appearancePreview,
    taskStats: makeTaskStatsProvider(taskRecordApi()),
    pipelines: pipelineService.feed,
    // task_056：设置屏的注册管理组（查看 / 移除） —— 端口同向导一份（非 Electron = null 降级）。
    customAgents: customAgentsIpcPort(),
    // task_061：成长看板数据口（角色屏「成长」tab + 全场总览排行；非 Electron = 各方法
    // null 降级 —— 看板区块引导语，不拆屏可用性）。
    growth: makeGrowthStatsPort(expEventApi(), taskRecordApi()),
  });
  const unmountScreen = screen.mount(hudRoot);
  const unmountAdapter = adapter.mount();

  // ===== 角色对话回路（@since v3.14，task_035）=====
  // 抽屉（hud 组件）↔ chat-service（app）↔ IPC 桥 → 主进程跑 CLI transport（渲染层无 child_process）。
  // 会话 id 回写 worldStore.characters.externalSessionId —— 存档协调器（task_033）的档案 diff
  // 订阅会自动把它落 SQLite，这里只改状态，不碰 IO。
  // 非 Electron（纯 vite dev）：没有 cliChat IPC 面 → 不接服务，发送无桥接（dev 入口的 DEMO 假流
  // 覆盖那条路径），行为与 034 之前完全一致。
  const chatHost = document.createElement('div');
  hudRoot.appendChild(chatHost);
  const unmountCharacterDrawer = mountCharacterChatDrawer(
    { subscribe: (handler) => adapter.subscribe(handler) },
    chatHost
  );
  const characterDrawer = chatHost.querySelector(CHARACTER_CHAT_DRAWER_TAG) as StratCharacterChatDrawerElement | null;
  const onChatOpen = (event: Event): void => {
    characterDrawer?.open((event as CustomEvent<{ characterId?: string }>).detail?.characterId);
  };
  hudRoot.addEventListener('stratix:chat-open', onChatOpen);
  // 任务输出面板（task_046）：嵌挂在抽屉里，经抽屉的公开引用接流转发端口。
  // 无 Electron（纯 vite dev）时抽屉照挂、面板照嵌 —— 只是没人喏 chunk（行为退回 038 之前）。
  const taskOutputView = characterDrawer?.taskOutput ?? null;
  const cliChat = cliChatIpcApi();
  // 历史通道与 cliChat 同源（都在 preload 的 electronAPI 上）：非 Electron 环境两者皆无，行为退回 034。
  const chatHistory = chatHistoryApi();
  // ============================================================================
  // 上下文注入件组装（task_053）：读 WorldState / 开关裁决都在组合根这一层（服务零 IO，
  // 只消费 provideContextSnapshot 纯输入）。三件套：
  //   ① 话题缓存：包住聊天落库回调，顺手记每角色最近一条用户消息（「最近对话」数据源）——
  //      下方三个消费方（chat / 互聊 / 报告回流）共用同一个包过的 persister，缓存才齐全；
  //   ② 全局开关：localStorage（settings-screen「上下文注入」行写同一键；无存储环境视为开）；
  //   ③ 世界面：worldStore.getState()（角色档案 / 同场单位 / 任务史全在里面，零额外查询）。
  // ============================================================================
  // ============ 落库写侧已迁 service（A3 / task_079）============
  // 渲染进程不再直写 SQLite（铁律 6）：Electron main 的 `game:saveChatMessage` 通道已退役，
  //   写入口收在 service 进程的存储件（src/stratix-gateway/service/storage.ts）。
  // 这里的渲染侧 persister 是**过渡期的旧接线**：写调用会因通道退役而失败（fire-and-forget
  //   吞掉并记一行警告，不打断对话回路），A4 gateway 接线后由 service 侧落库补齐。
  //   读侧（loadChatMessages / loadEarlierChatMessages）**暂时保留** —— 渲染层读历史的兼容
  //   路径，读切 API 是 B 轨（Electron remote store）的收尾项。
  const contextPersister = createTopicCachePersister(
    chatHistory ? makeChatMessagePersister(chatHistory) : undefined
  );
  const stratixContextSource = createStratixContextProvider({
    getState: () => worldStore.getState(),
    lastTopicFor: contextPersister.lastTopicFor,
    isEnabled: () => isGlobalContextEnabled(typeof localStorage === 'undefined' ? null : localStorage),
  });
  // ============================================================================
  // agent 健康监测（@since v3.30，task_054）
  // ============================================================================
  // 单一判定方在这里接线，两路数据源：
  //   ① 周期探测：probe 口 = IPC 到主进程跑 T1 五家真探测（默认 60s 一轮，常量在
  //      health-monitor 顶部），防抖（连续 2 轮失败才判离线，一次成功即恢复）在服务内；
  //   ② transport exit 异常：chat / 互聊 / 任务三路服务的 error 事件回调
  //      onTransportError（非 aborted 各记一条 unhealthy 审计，不改在线位）。
  // 判定翻转 → agent.offline / agent.online 事件 → runtime 接地写 units.online →
  // 战场灰显 + 角色卡徽标 + 入口拦截（守门第四条，见各 service）；恢复 toast 在下方
  // toast 宿主挂载后订阅。非 Electron：无 probe 口（不周期判定，在线位维持缺省在线），
  // 落库通道也没有 —— persistEvent 不注入，行为退化可预期。
  const detectionApi = agentDetectionApi();
  const healthApi = agentHealthApi();
  const healthMonitor = createHealthMonitor({
    probe: detectionApi?.probe ? () => detectionApi.probe!() : undefined,
    persistEvent: healthApi ? makeAgentHealthPersister(healthApi) : undefined,
  });
  const stopHealthMonitor = healthMonitor.start();
  // toast 宿主在下方才挂载（它前面的装配都不需要 toast）：先用空实现占位，挂载后回填 ——
  // 上方 chat 服务的离线拦截提示（notify 口）拿的是这个闭包。
  let showToast: (text: string, tone: 'success' | 'warn' | 'danger') => void = () => undefined;
  const transportHealthReport = (kind: Parameters<typeof healthMonitor.recordTransportFailure>[0], code: Parameters<typeof healthMonitor.recordTransportFailure>[1]): void => {
    healthMonitor.recordTransportFailure(kind, code);
  };
  if (characterDrawer && cliChat) {
    const chatService = createChatService({
      view: characterDrawer,
      getState: () => worldStore.getState(),
      createTransport: createIpcChatTransportFactory(cliChat),
      // task_040：权重数值真相源在 core/progression（旧缺省 exp-config 已降为转发层），
      // 换注入件即接管 —— 本服务零改动（交接注记见 chat-service.ts 文件头）。
      expWeight: expWeightFor,
      persistSessionId: (characterId, sessionId) => {
        worldStore.setState((current) => {
          const index = current.characters.findIndex((c) => c.id === characterId);
          if (index < 0) return current;
          const existing = current.characters[index];
          if (existing.externalSessionId === sessionId) return current;
          const characters = [...current.characters];
          characters[index] = { ...existing, externalSessionId: sessionId };
          return { ...current, characters };
        });
      },
      // task_036：消息落库回调（fire-and-forget，失败只警告不阻断对话）。
      // task_053：换成包过话题缓存的同一个 persister（上方组装说明）。
      persistMessage: contextPersister.persist,
      provideContext: stratixContextSource,
      // task_054：transport exit 异常旁路上报健康监测；离线拦截的轻提示口（warn tone）。
      onTransportError: transportHealthReport,
      notify: (text) => showToast(text, 'warn'),
    });
    const loadEarlierMessages = chatHistory?.loadEarlierMessages?.bind(chatHistory);
    // 二次注入 deps：换上带对话回调与历史加载的完整面（订阅在首次注入时已绑，handleState 是元素方法，不受影响）。
    characterDrawer.deps = {
      subscribe: (handler) => adapter.subscribe(handler),
      onSend: (characterId, text) => {
        void chatService.send(characterId, text);
      },
      onStop: (characterId) => chatService.stop(characterId),
      onRetry: (characterId) => {
        void chatService.retry(characterId);
      },
      // task_036：按角色读最近 50 条（库行 → 抽屉消息输入的翻译也在这里）；
      // 读失败降级为空历史（抽屉 requestHistory 只管回填，不重试）。
      loadHistory: chatHistory
        ? (characterId) =>
            chatHistory
              .loadMessages(characterId, CHAT_HISTORY_LOAD_LIMIT)
              .then((result) => (result.ok && result.messages ? result.messages.map(chatHistoryEntryToDrawerInput) : []))
        : undefined,
      historyPageSize: CHAT_HISTORY_LOAD_LIMIT,
      loadEarlierHistory: loadEarlierMessages
        ? (characterId, beforeId, limit) => {
            const cursor = Number(beforeId);
            if (!Number.isSafeInteger(cursor) || cursor <= 0) {
              return Promise.reject(new Error('bad history cursor'));
            }
            return loadEarlierMessages(characterId, cursor, limit).then((result) => {
              if (!result.ok || !result.messages) throw new Error(result.error ?? 'history load failed');
              return result.messages.map(chatHistoryEntryToDrawerInput);
            });
          }
        : undefined,
    };

    // 互聊编排（task_052）：与 035 同一套对接面（transport 工厂 / 落库回调 / 经验权重），
    // 视图口走组件的互聊扩展面（联合会话 + 流式归属钉死）。会话回执与普通聊天共用
    // externalSessionId 字段（后写覆盖，都是审计回执 —— 两边文件头已注明口径）。
    const agentChatService = createAgentChatService({
      view: characterDrawer,
      getState: () => worldStore.getState(),
      createTransport: createIpcChatTransportFactory(cliChat),
      persistSessionId: (characterId, sessionId) => {
        worldStore.setState((current) => {
          const index = current.characters.findIndex((c) => c.id === characterId);
          if (index < 0) return current;
          const existing = current.characters[index];
          if (existing.externalSessionId === sessionId) return current;
          const characters = [...current.characters];
          characters[index] = { ...existing, externalSessionId: sessionId };
          return { ...current, characters };
        });
      },
      persistMessage: contextPersister.persist,
      provideContext: stratixContextSource,
      expWeight: expWeightFor,
      // task_054：互聊回合的 exit 异常同样上报健康审计（与 chat / task 同一端口）。
      onTransportError: transportHealthReport,
    });
    // 三次注入 deps：互聊入口（表单开始 / 停止钮 / 插话框 → agent-chat-service）。
    characterDrawer.deps = {
      ...characterDrawer.deps,
      onPeerChatStart: (aId, bId, topic, rounds) => {
        void agentChatService.start(aId, bId, topic, rounds);
      },
      onPeerChatStop: () => {
        agentChatService.stop();
      },
      onPeerInterject: (text) => {
        agentChatService.interject(text);
      },
    };
  }

  // ===== 任务轻提示（@since v3.18，task_039）=====
  // toast 宿主是跨面板的顶层反馈面：fixed 定位不占布局，挂上即可；show 由下方 task-report
  // 回调驱动（hud 组件只被驱动、零订阅，与抽屉流式方法同一装配口径）。无 Electron 时挂着也无妨（没人调它）。
  const { element: toastHost, unmount: unmountToastHost } = mountToastHost(hudRoot);
  // task_054：回填上方占位的 toast 闭包（chat 离线拦截提示从此生效）。
  showToast = (text, tone) => {
    toastHost.show(text, tone);
  };

  // ===== 恢复在线轻提示（@since v3.30，task_054）=====
  // agent.online（health-monitor 防抖判定恢复）→ toast「XX 已恢复在线」（成功 tone：
  // 它又能干活了是好消息，与掉线的灰显冷色相反）。kind 级文案：同 kind 可绑多个角色，
  // 事件不携角色名单（不雪球），显示名用 CLI 显示名（与引导屏同一词表）。
  // 掉线不 toast：灰显 + 徽标已是持久可见态（toast 是瞬时面，重复提醒只会脱敏）。
  const stopHealthToast = onWorldEvent((event) => {
    if (event.type !== 'agent.online') return;
    toastHost.show(`「${agentKindLabel(event.kind)}」已恢复在线`, 'success');
  });

  // ===== 升级轻提示（@since v3.20，task_041）=====
  // level.up（progression-service 广播，task_040）→ toast「XX 升到 Lv.X！解锁新外观部件」。
  // 「跨没跨过解锁门槛」的裁决在 appearance-unlock-catalog 的纯函数（门槛数据在 core/progression），
  // 这里只查角色名 + 拼装（组合根只接线，与 task-report 的 toast 同一装配口径）。
  // 角色查不到（极端时序：角色已删但事件在飞）→ 跳过（不猜名字）。
  const stopLevelUpToast = onWorldEvent((event) => {
    if (event.type !== 'level.up') return;
    const character = worldStore.getState().characters.find((c) => c.id === event.characterId);
    if (!character) return;
    toastHost.show(levelUpToastText(character.name, event.fromLevel, event.toLevel), 'success');
  });

  // ===== 审批门轻提示（@since v3.25，task_049）=====
  // task.awaiting_approval → toast「XX 请求批准任务计划」：挂起是不限时的被动等待，
  // 用户可能根本没盯着战场 —— toast 是拉人来的那一声（notice 面板太安静，038 的先例同款取舍）。
  // 审批入口本体在 agent-panel 的审批卡（049 的 UI 面）；角色查不到（极端时序）→ 跳过（不猜名字）。
  // tone 用 warn：黄色问号与战场 ? 浮标（srf-warn）同一族 —— 「有事等你裁决」而不是「出事了」。
  const stopAwaitingToast = onWorldEvent((event) => {
    if (event.type !== 'task.awaiting_approval') return;
    const character = worldStore.getState().characters.find((c) => c.id === event.task.characterId);
    if (!character) return;
    toastHost.show(`「${character.name}」请求批准任务计划`, 'warn');
  });

  // ===== 流水线整线轻提示（@since v3.27，task_051）=====
  // pipeline.completed / pipeline.failed（pipeline-service 广播）→ toast：整线跑完或断链的
  // 那一声（站态细节在 agent-panel 的流水线卡片，这里只报终态 —— 与 level.up 同一装配口径）。
  // tone：completed = success；failed = error（断链是真故障，与任务失败的 toast 同族）。
  const stopPipelineToast = onWorldEvent((event) => {
    if (event.type === 'pipeline.completed') {
      toastHost.show(`流水线「${event.pipelineName}」已完成`, 'success');
      return;
    }
    if (event.type === 'pipeline.failed') {
      toastHost.show(`流水线「${event.pipelineName}」中断：${event.reason}`, 'danger');
    }
  });

  // ===== 音效反馈（@since v3.36，task_060）=====
  // 与 toast 同一装配口径：hud 侧服务只暴露 play(key)（开关 / 节流 / 懒建 AudioContext /
  // 自动播放策略容错全在服务内部），组合根订阅总线接线 —— 事件→key 的映射表是
  // sfx-service 的纯函数 sfxKeyForEvent（≤5 种，exp.gained 刻意不配音：太频繁）。
  // 设置屏的「音效」行（总开关 + 音量）直接写 localStorage，服务每次播放现读 ——
  // 这里无需（也无法）向服务转发设置变更。
  const sfx = createSfxService();
  const stopSfxFeed = onWorldEvent((event) => {
    const key = sfxKeyForEvent(event);
    if (key !== null) sfx.play(key);
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
    customAgents: customAgentsIpcPort(),
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

  // ===== 启动恢复（@since v3.12，task_033）=====
  // 读档必须先于 Phaser 创建：站位种子要在 preBoot 前就绪，恢复的单位也要赶在
  // 首次 state 广播前进 store（否则场景先按网格落位、后到注入，同一单位出现两次落位事件）。
  // 非 Electron（纯 vite dev）或读档失败 → 空注入，行为与从前完全一致。
  const saveApi = gameSaveApi();
  const saveCoordinator = saveApi ? createGameSaveCoordinator({ api: saveApi }) : null;
  const injection: RestoreInjection = (await saveCoordinator?.restore()) ?? {
    characters: [],
    units: [],
    positionsByUnitId: new Map(),
  };
  if (injection.characters.length > 0) {
    worldStore.setState((current) => {
      // 单位去重合并：store 里理论上还没有单位（runtime 未启动、无人写过），
      // 但防御同一 id 重复投影 —— 真变了就是双单位，宁多一次过滤不出血。
      const existingIds = new Set(current.units.map((unit) => unit.id));
      const restoredUnits = injection.units.filter((unit) => !existingIds.has(unit.id));
      return {
        ...current,
        characters: [...injection.characters],
        units: [...current.units, ...restoredUnits],
      };
    });
  }

  // ===== 小地图（@since v3.33，task_057）=====
  // 数据流（组件只认注入口，hud 零 import world）：
  //   单位：位置真相在世界层（core 契约无坐标）—— 从恢复站位起步，吃 unit.position 事件累积；
  //     皮肤/在线位从 WorldState 现读（onState 触发刷新）。新单位落位时场景会补发 unit.position，
  //     那一路的刷新把新人补进快照；
  //   视口：camera.moved（场景相机回调，合并窗口后的上报）+ 战场容器尺寸 → 世界坐标矩形喸入；
  //   交互：组件发的 unit.select / camera.center 经 adapter.dispatch 走既有命令口。
  const { element: minimap, unmount: unmountMinimap } = mountMinimap(hudRoot, {
    dispatch: (command) => adapter.dispatch(command),
  });
  const minimapPositions = new Map<string, Point>(injection.positionsByUnitId);
  const syncMinimapUnits = (): void => {
    minimap.setUnits(
      worldStore
        .getState()
        .units.filter((unit) => minimapPositions.has(unit.id))
        .map((unit) => {
          const at = minimapPositions.get(unit.id);
          // filter 保证命中；非空断言只在同一次调用内成立，不会悬挂。
          return { id: unit.id, x: at!.x, y: at!.y, skinId: unit.skinId, online: unit.online };
        })
    );
  };
  const stopMinimapWorldFeed = onWorldEvent((event) => {
    if (event.type === 'unit.position') {
      minimapPositions.set(event.unitId, { x: event.x, y: event.y });
      syncMinimapUnits();
      return;
    }
    // 视口矩形：center ± 半视口（屏幕尺寸 / zoom = 世界尺寸）。容器尺寸拿不到
    //（隐藏 / 未布局）→ 本次不喸，等下一次上报 —— 不猜默认值。
    if (event.type === 'camera.moved') {
      const width = battlefieldHost.clientWidth;
      const height = battlefieldHost.clientHeight;
      if (!(width > 0) || !(height > 0)) return;
      minimap.setViewport({
        x: event.center.x - width / (2 * event.zoom),
        y: event.center.y - height / (2 * event.zoom),
        width: width / event.zoom,
        height: height / event.zoom,
      });
    }
  });
  // 皮肤 / 在线位 / 单位增删都在 WorldState 里：广播触发一次快照重建（位置仍从累积表取）。
  const stopMinimapStateFeed = onState(() => {
    syncMinimapUnits();
  });

  // ===== 快捷键系统（@since v3.34，task_058）=====
  // 键位表与解析在 hud/components/shortcuts（集中常量，帮助浮层同源渲染）；这里只接三个口：
  //   命令 → adapter.dispatch（unit.select / unit.group.* / camera.center 全是既有命令面，
  //     core 侧 runtime 同任务接线）；状态 → worldStore 现读（全选名单 / 居中目标）；
  //   坐标 → 复用小地图的 minimapPositions 累积表（同一份位置真相，不另建第二份 ——
  //     空格居中的质心算的就是这些点，两处数据源漂移会让小地图点与居中点对不上）。
  // 输入框聚焦时快捷键自动让路（isEditableTarget，在 hud 侧判定）；卸载随 pagehide。
  const { unmount: unmountShortcuts } = mountShortcuts(hudRoot, {
    dispatch: (command) => adapter.dispatch(command),
    getState: () => worldStore.getState(),
    getUnitPosition: (unitId) => minimapPositions.get(unitId) ?? null,
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
        // 恢复站位种子（task_033）：场景 create 时取走；没记录的单位按网格落位。
        booting.registry.set(UNIT_POSITION_SEED_KEY, injection.positionsByUnitId);
      },
    },
  });

  // ===== core 侧：闭环接线（command/world → store → state 广播）=====
  // 未接地的命令 / 事件只落 console：它们是"还没实现"，不是错误，堆错误日志会淹没真故障。
  // 任务域写入面（@since v3.16，task_037）：组合根持一个实例，注入 runtime（task.assign 落点）
  // 与 task-service（相位回报口）—— 两处写的是同一份 WorldState.tasks。
  // ★实例创建已前移到 main-screen 之前（task_051：流水线编排器要先于面板建），这里只引用。
  // 角色域写入面（@since v3.19，task_040）：与 taskManager 同一模式 —— 组合根持一个实例，
  // 注入 runtime（character.create / persona.update 落点）与 progression-service
  // （exp.gained → 累加落库）—— 两处写的是同一份 WorldState.characters。
  const characterManager = createCharacterManager({ store: worldStore });
  // task_076：runtime 的 mission 命令与 task-service 的终态回报共享同一写入面。
  const missionManager = createMissionManager({ store: worldStore });
  const runtime = createCoreRuntime({
    store: worldStore,
    character: characterManager,
    mission: missionManager,
    task: taskManager,
    // task_051：流水线编排器端口 —— runtime 只把 pipeline.start 转发给它（core 不执行编排，
    // 见 core/task/pipeline.ts 架构注）；未注入时命令按未落地处理（与 agent-link 同口径）。
    pipeline: pipelineService,
    onUnhandled: (channel: UnhandledChannel, payload: HudCommand | WorldEvent) => {
      console.warn(`[Stratix] 未处理 ${channel}: ${payload.type}`);
    },
  });
  const stopRuntime = runtime.start();

  // ===== 养成回路（@since v3.19，task_040）=====
  // exp.gained（task-service / chat-service 发射）→ character manager 累加落库（曲线结算在
  // core/progression）→ 升级广播 level.up（UI 反馈归 041）。不依赖 Electron IPC（纯总线订阅），
  // 无条件起：非 Electron 的 dev 环境里事件不会发，订阅空转零成本。
  // task_061：经验事件审计流 —— 每条 exp.gained / 升级结算逐条落 exp_events（非 Electron
  // = 端口缺席，注入件缺省：养成照常，只不落曲线真相源）。
  const expApi = expEventApi();
  // A3 / task_079：写侧已迁 service —— `game:saveExpEvent` 通道退役，这条渲染侧接线在 A4
  //   接线前不再真正落库（失败被 fire-and-forget 吞成一行警告，不打断养成回路）；
  //   读侧（loadExpEvents / growthOverview）保留，读切 API 归 B 轨。
  const stopProgressionService = createProgressionService({
    characterManager,
    persistExpEvent: expApi ? makeExpEventPersister(expApi) : undefined,
  }).start();

  // ===== 角色任务执行回路（@since v3.16，task_037）=====
  // core/task 发的 task.queued 事件 → task-service 出队（每角色 FIFO、并发 1）→ 经
  // chat IPC 通道跑 transport（复用 035 的链路，理由见 task-service.ts 文件头）→
  // 相位回报 taskManager（写状态 + 单位忙闲派生 + 发后续事件）。
  // 非 Electron（纯 vite dev）：没有 cliChat IPC 面 → 不接服务，派发只落 queued（dev 行为可预期）。
  let stopTaskService: (() => void) | null = null;
  if (cliChat) {
    // task_039：终态回调 → 结果回流（报告落库 + 抽屉注入 + toast）。消息落库与聊天共用同一个
    // persister（同表同词表）；toast 借上面挂的宿主。抽屉元素拿不到（非 Electron 边角）时
    // view 传 undefined：只落库 + 轻提示，不注入。
    const reportSettled = createTaskReportHandler({
      view: characterDrawer ?? undefined,
      getState: () => worldStore.getState(),
      persistMessage: contextPersister.persist,
      toast: (text, tone) => {
        toastHost.show(text, tone);
      },
    });
    const taskService = createTaskService({
      getState: () => worldStore.getState(),
      createTransport: createIpcChatTransportFactory(cliChat),
      taskManager,
      // task_054：transport exit 异常旁路上报健康监测；离线拦截的轻提示口（warn tone）。
      onTransportError: transportHealthReport,
      notify: (text) => showToast(text, 'warn'),
      // task_040：权重数值真相源在 core/progression（旧缺省 exp-config 已降为转发层），
      // 换注入件即接管 —— 本服务零改动（交接注记见 task-service.ts 文件头）。
      expWeight: expWeightFor,
      provideContext: stratixContextSource,
      // A3 / task_079：写侧已迁 service —— `game:saveTask` 通道退役，任务全文的落库入口收在
      //   service 进程的存储件；这条渲染侧接线在 A4 接线前不再真正落库（失败被吞成警告，
      //   不打断执行环）。读侧（loadTasks / taskStats）保留，读切 API 归 B 轨。
      persistTask: (() => {
        const taskApi = taskRecordApi();
        return taskApi ? makeTaskRecordPersister(taskApi) : undefined;
      })(),
      // task_076：completed → done；failed 无独立相位，走既有 cancel → cancelled（中止语义）。
      onMissionSettled: (record) => {
        if (!record.missionId) return;
        if (record.status === 'completed') missionManager.completeMission(record.missionId);
        else if (record.status === 'failed') missionManager.cancelMission(record.missionId);
      },
      pushNotice: (notice) => worldStore.pushNotice(notice),
      // task_046：执行期 chunk 原序转发进任务输出面板（实时 tail 视图）。面板拿不到
      // （极端时序：chrome 未建）时端口不接 —— 执行照常，只是没有实时视图。
      onTaskChunk: taskOutputView
        ? (characterId, chunk) => taskOutputView.appendTaskOutput(characterId, chunk)
        : undefined,
      // task_048：终态记录先喂任务输出面板的成果物摘要块（formatTaskArtifactsBlock 与
      // 📋 报告尾部同一渲染模型，规格④；面板不 import app/ —— 这里算好文案再传字符串），
      // 再走 task_039 的结果回流（reportSettled，见上方声明）。failed 喂空串（无成果物）。
      onTaskSettled: (record) => {
        // task_051：先回流流水线编排器（主路收尾信号 —— completed 的全文输出去下一站
        // {{prev_output}}；时序说明见 pipeline-service 文件头「两路收尾信号」）。
        pipelineService.handleTaskSettled(record);
        taskOutputView?.setTaskArtifacts(
          record.characterId,
          record.status === 'completed' ? formatTaskArtifactsBlock(parseTaskArtifactsJson(record.artifacts)) : ''
        );
        reportSettled(record);
      },
    });
    stopTaskService = taskService.start();
  }

  // ===== 存档落库（@since v3.12，task_033）=====
  // 接在 runtime 之后、注入之后：先订阅后注入会把恢复的那批当成新变化回写一遍（见文件头时序说明）。
  saveCoordinator?.start();

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
      // 预览实例（Phaser）由向导屏 / 角色屏在各自卸载时销毁；这里再兜一次底（两个屏都没挂过时也不会有事）。
      appearancePreview.destroy();
      // 升级 toast 订阅（task_041）：与其它总线订阅同一卸载纪律 —— 页面销毁前退干净。
      stopLevelUpToast();
      stopAwaitingToast();
      stopPipelineToast();
      // 小地图（task_057）：退总线订阅再卸宿主（与 toast 同一卸载纪律）。
      stopMinimapStateFeed();
      stopMinimapWorldFeed();
      unmountMinimap();
      // 快捷键（task_058）：退 window keydown 监听 + 关浮层 + 卸宿主（同卸载纪律）。
      unmountShortcuts();
      // 音效（task_060）：退总线订阅再释放服务（丢 AudioContext 引用，页面即将销毁）。
      stopSfxFeed();
      sfx.dispose();
      // 健康监测（task_054）：停周期探测 + 退恢复 toast 订阅。
      stopHealthToast();
      stopHealthMonitor();
      // 流水线编排器总线订阅（task_051）：在跑的线随页面一起终止（库里的 running 行是停机
      // 遗骸，审计可见、不复活 —— 见 pipeline-record-dao 文件头存活语义注）。
      stopPipelineBus();
      // 角色抽屉先卸（退订总线；在跑的对话由主进程超时 / 页面销毁兜底）。
      hudRoot.removeEventListener('stratix:chat-open', onChatOpen);
      unmountCharacterDrawer();
      unmountToastHost();
      stopAgentDetection();
      // 存档协调器先停（内部会冲刷未落盘的站位缓冲），再拆养成服务、任务服务与 runtime。
      saveCoordinator?.stop();
      stopProgressionService();
      stopTaskService?.();
      stopRuntime();
      unmountAdapter();
      unmountScreen();
      game.destroy(true);
    },
    { once: true },
  );
}

/** 装配入口：两条路径（立即执行 / DOMContentLoaded 后）都走同一个 catch，否则监听器里抛错会变成静默白屏。
 *  why 用 promise catch 而不是 try-catch：boot 是 async（task_033 起要先读档），同步 throw 也会变成 rejection。 */
function safeBoot(): void {
  void boot().catch(reportBootFailure);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', safeBoot, { once: true });
} else {
  safeBoot();
}