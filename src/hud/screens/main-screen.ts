/**
 * 文件职责：HUD 主屏壳 —— 一个挂载容器，把核心 HUD 区块组织起来（顶栏态势摘要 / agent 侧栏 /
 *   命令面板 / 态势总览 / 日志抽屉），通过事件桥把组件交互翻译成 HudCommand。
 *   组件本层不直连 core/bus。
 *   屏位路由（@since v3.6）：依据 WorldState.currentScreen 切换 main / settings / character
 *   三屏之一的渲染；status-screen 不占独立屏位，仍以"主屏浮动区块"形态挂载，
 *   跳转出去走 ui.navigate，落到 store.currentScreen 后由本屏切换渲染。
 *   顶栏形态（@since v3.4，task_089；docs/hud-redesign-proposal.html §2.5 Z1 规格）：
 *     19 个元素 → **7 个元素封顶** = 品牌 + 态势胶囊（单位/任务/会话三值合一）+ 通知徽标
 *     + 声音（音量滑条收进它的弹出层）+ 导演 + 演示 + 溢出菜单（收纳 5 项低频操作：
 *     聊天 / 会话 / 角色 / 设置 / 像素风）。三个 on/off 文本标签（theme/demo/director-tag）删除 ——
 *     **开关点亮即状态**，不再有第二份文本（§4 A13）。
 *   顶栏图标（@since v3.6，task_121）：四件按钮与溢出菜单五项**全部换成 SVG 图标**
 *     （widgets/icon-set.ts 的线条图标组）—— 原来的 🔊 / 🎬 / ▶ / ⋯ 是 **emoji（字形）**，
 *     跟"战术线条风"对不上（审美评估：西装配拖鞋）。图标走 currentColor → 随皮肤换色。
 *   布局形态（@since v3.7，task_020）：**RTS 悬浮布局** —— 战场占满视口，HUD 环绕四周悬浮
 *   （顶栏态势摘要 / 左单位竖栏 / 右态势总览+日志抽屉 / 底命令横条），子屏与抽屉覆盖在最上层。
 *   交互铁律：除 HUD 实体面板外，空白区域的 pointer-events 必须穿透到 Phaser 画布
 *   （拖拽平移 / 框选 / 滚轮缩放不被遮挡）—— 容器 pointer-events:none，只有面板开 auto。
 *   来源：docs/REFACTOR_PLAN_V3.md §2 screens/ 层级；用户反馈「hud 并没有环绕整个 rts 屏幕」。
 * 输入：父容器（mount 时传入 DOM 节点）；总线适配器（dispatch 入口）。
 * 输出：渲染到父容器的 DOM；交互通过 strat-button-click / 等事件触发 adapter.dispatch。
 * 禁止事项：
 *   1. import 任何 src/world/、src/stratix-rts/、vue/react/pinia —— 铁律；
 *   2. 直接 emitCommand —— 全部走注入的 adapter（事件 → adapter.dispatch）；
 *   3. 写死颜色 / 边框 —— 全部引用 --srf-* 变量；
 *   4. 跨屏业务态 —— 本屏不持有业务态，只持有"当前选中皮肤 / 当前屏位"等纯展示态；
 *      当前屏位以 core 广播的 WorldState.currentScreen 为单一口径（status-screen 同源）。
 *
 * 屏位路由约定（@since v3.6，本任务接线）：
 *   - currentScreen 为 undefined / 'main' 时：渲染主屏布局（命令面板 + agent 侧栏 + 态势总览 + 日志抽屉）；
 *   - 'settings' 时：替换内容区为 settings-screen（settings 自带返回按钮 → ui.navigate(main)）；
 *   - 'character' 时：替换内容区为 character-screen（character 自带返回按钮 → ui.navigate(main)）；
 *   - 'chat' 由 core 解释为"打开聊天抽屉"，不入 currentScreen（见 core/types.ts 注释），
 *     故本屏不为此分支 —— 顶栏按钮另发 stratix:chat-open，由组合根打开角色抽屉。
 *   why 用 replace 而非 overlay：sub-screen 自身带 topbar + body + 返回按钮，
 *   若仍渲染主屏 topbar/抽屉会出现双 topbar 与抽屉占视野；直接换内容区更稳。
 *
 * ★ 宿主归属铁律（@since v3.4，task_097）：本屏**只写自己的子树**（style + .hud-root），
 *   绝不重写宿主（host.innerHTML）。组合根把覆盖层（小地图 / 事件轨 / toast / 聊天抽屉 /
 *   里程碑 / 快捷键帮助）挂在同一个宿主下 —— 宿主被重写 = 那些覆盖层当场消失且永不重挂，
 *   真机表现是「点一下演示开关，之后小地图、事件轨、聊天入口全部没反应」。
 *
 * ★ 子屏 = 全屏弹窗（@since v3.5，task_099）：settings / character 两个子屏走
 *   **全屏弹窗壳**（遮罩 + 居中面板，hud/layers/occlusion.ts）——
 *   ① 弹窗开着时，四角常驻件（顶栏 / 控制岛 / 事件轨 / 小地图）统一降对比 + 禁点（遮挡规则 R1）；
 *   ② ESC 可关 + 点遮罩可关（双关闭途径必齐 —— 方案 §二 R4），两条都收口到「回主屏」这条命令。
 */

// 顶栏度量（@since v3.4，task_089）：Z1 的高度与「7 元素封顶」口径 —— 数字取自唯一事实源。
// 控制岛度量（@since v3.4，task_090）：Z4 的宽 / 高上限 / 与角件的间距口径 —— 同样只此一份。
import {
  CONTROL_ISLAND_METRICS,
  CONTROL_ISLAND_SIDE_INSET_PX,
  TOPBAR_METRICS,
} from '../../core/theme/visual-spec';
import type { MissionView, WorldState } from '../../core/types';
import type { HudBusAdapter } from '../bridge/bus-adapter';
import type { GatewayLinkPort } from '../bridge/gateway-link-port';
// 当日回放（@since v3.3，task_082）：底栏时间轴 scrubber（组件 + 控制器口径）。
import { mountDayReplay } from '../components/replay/day-replay';
import type { ReplayController } from '../components/replay/replay-controller';
import { mountAgentPanel, type AgentPanelDeps } from '../panels/agent-panel';
import { mountCommandPanel } from '../panels/command-panel';
import { mountLogDrawer } from '../panels/log-drawer';
// 遮挡规则（@since v3.5，task_099）：全屏弹窗壳（遮罩 + 居中面板 + ESC/遮罩双关闭）
//   + 遮挡控制器（弹窗开着 → 四角常驻件降对比禁点）。
import { mountModalShell, type OcclusionController } from '../layers/occlusion';
import type { PipelineFeedInput } from '../panels/pipeline-catalog';
import type { SessionHistoryPort } from '../panels/session-catalog';
import {
  mountSessionPanel,
  SESSION_PANEL_TAG,
  type StratSessionPanelElement,
} from '../panels/session-panel';
import type { TaskStatsProvider } from '../panels/task-assign-catalog';
// 声音包（@since v3.3，task_083）：顶栏的总开关 + 音量滑条 —— 读写 localStorage
//   （真源在 hud/sound-engine.ts，引擎每次播放现读，这里只做读写与回显）。
import {
  readSoundEnabled,
  readSoundVolume,
  writeSoundEnabled,
  writeSoundVolume,
} from '../sound-engine';
import { demoMode } from '../theme/demo-mode';
// 排版字阶与截断规则（@since v3.8，task_137）：字阶 token 走皮肤层（theme-controller 注入），
//   截断规则是文档级工具类（各表面共用同一份文案，见 theme/type-scale.ts）。
import { TRUNCATE_CSS } from '../theme/type-scale';
import { defineStratButton, escapeHtml, STRAT_BUTTON_TAG } from '../widgets/strat-button';

import type { AppearancePreviewPort } from './appearance-preview-port';
import { mountCharacterScreen } from './character-screen';
import type { CustomAgentsPort } from './custom-agents-port';
import type { GrowthStatsPort } from './growth-catalog';
import { mountSettingsScreen } from './settings-screen';
import { mountStatusScreen } from './status-screen';

/** currentScreen 缺省回落（与读取 WorldState.currentScreen 的各处共用）。 */
const DEFAULT_SCREEN: WorldState['currentScreen'] = 'main';

/** 渲染判定用的窄类型：屏位路由只关心这四个值的差异。 */
type CurrentScreen = 'main' | 'settings' | 'character';

function resolveCurrentScreen(state: WorldState | null): CurrentScreen {
  const screen = state?.currentScreen ?? DEFAULT_SCREEN;
  // 'chat' 由 core/types 注释说明不由 currentScreen 承载；runtime 也不会写它进来 —— 落到 'main'。
  return screen === 'settings' || screen === 'character' ? screen : 'main';
}

/**
 * 音量档位（@since v3.6，task_116）：点顶栏音量计 = 循环切到下一档。
 * why 有档位而不是连续调：20×6px 的小条上连续调无从下手，循环档位是能被「点出来」的交互。
 */
export const VOLUME_PRESETS: readonly number[] = [0, 30, 70, 100];

/**
 * 下一档音量：找**严格大于**当前值的档位；没有（已到顶或超出）则回到静音档。
 * @since v3.6，task_116
 */
export function nextVolumePreset(current: number): number {
  for (const preset of VOLUME_PRESETS) {
    if (preset > current) return preset;
  }
  return VOLUME_PRESETS[0] ?? 0;
}

/**
 * 音量的文字标签：0 → 「静音」，其余 → 「N%」。
 * why 单独抽：标题、aria-label、数值文本三处用同一口径，避免出现「静音 0%」这类自相矛盾。
 * @since v3.6，task_116
 */
export function volumeLabel(volume: number): string {
  return volume <= 0 ? '静音' : `${Math.round(volume)}%`;
}

/**
 * 主屏 / 子屏共用的样式表（模块级常量）。
 * why 独立成常量：屏位切换会重写主屏布局的 DOM，样式必须能一直跟着，否则子屏会裸奔。
 * why 类名带 hud- 前缀：本表是文档级样式表（style 元素不进 shadow DOM），类名不加前缀会与
 * 页面里其它同名词撞车（settings / character 屏在 shadow DOM 内，不受影响，但主屏布局在文档流里）。
 */
const MAIN_SCREEN_STYLE = `
  .hud-root {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: auto;
    pointer-events: none;
    container-type: size;
    --hud-topbar-h: ${TOPBAR_METRICS.heightPx}px;
    --hud-gap: var(--srf-spacing-md);
    /* 控制岛（Z4）度量 —— 唯一事实源在 core/theme/visual-spec.ts（CONTROL_ISLAND_METRICS）。
       why 不再是 --hud-bottom-h: min(34cqh, 300px)：那是写死视口比例的底栏，
       720p 下吃掉 34% 视口高，中轴只剩 66%（proposal §1.9 P1）。
       岛改成贴底居中、内容自适应、高度封顶 --hud-island-max-h。 */
    --hud-island-w: ${Math.round(CONTROL_ISLAND_METRICS.widthRatio * 100)}%;
    --hud-island-max-h: ${CONTROL_ISLAND_METRICS.maxHeightPx}px;
    /* 单侧留边 = 角件留边 + 角件宽 + 最小间距（事件轨侧更宽，取它为约束方）。
       岛宽超过「屏宽 − 两侧留边」就会压到左下事件轨上 —— 这一条是宽度公式的上限。 */
    --hud-island-inset: ${CONTROL_ISLAND_SIDE_INSET_PX}px;
    /* 右下角件（小地图）占高 —— 右竖栏的下边界按它让开。 */
    --hud-corner-stack-h: ${CONTROL_ISLAND_METRICS.cornerStackHeightPx}px;
    color: var(--srf-text);
    font-family: var(--srf-font-ui);
    font-size: var(--srf-font-size-md);
    scrollbar-width: thin;
    scrollbar-color: var(--srf-border-strong) transparent;
  }
  .hud-root::-webkit-scrollbar { width: var(--srf-spacing-sm); height: var(--srf-spacing-sm); }
  .hud-root::-webkit-scrollbar-thumb { background: var(--srf-border-strong); border-radius: var(--srf-radius-pill); }
  .hud-surface {
    --srf-panel: var(--srf-panel-overlay);
    --srf-panel-elevated: var(--srf-panel-elevated-overlay);
    pointer-events: auto;
  }
  .hud-topbar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    min-height: var(--hud-topbar-h);
    z-index: 30;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--srf-space-room);
    padding: var(--srf-space-tight) var(--srf-space-room);
    background: var(--srf-panel-overlay);
    border-bottom: var(--srf-border-width) solid var(--srf-border);
    box-shadow: var(--srf-shadow);
    pointer-events: auto;
  }
  /* 品牌（@since v3.8，task_137）：降为**辅助级** —— 顶栏的视觉主角是「当前任务一句话」，
     品牌退到第二梯队（辅助字号 + 弱化色），信息层级才立得住。 */
  .hud-brand {
    font-size: var(--srf-font-size-caption);
    font-weight: var(--srf-font-weight-semibold);
    letter-spacing: 0.08em;
    color: var(--srf-text-muted);
    white-space: nowrap;
  }
  /* 当前任务一句话（@since v3.8，task_137）：顶栏的**视觉主角** —— 标题级字号 + 单行截断。
     why 放在品牌之后、态势之前：一眼看到的是「现在在干什么」，而不是「这是哪个产品 /
     有几个单位」—— 那是评估 r1-r3 反复点的「顶栏信息密度偏高」的正解。 */
  .hud-task {
    display: flex;
    align-items: baseline;
    gap: var(--srf-space-tight);
    flex: 1 1 auto;
    /* 上限：任务标题不许吃掉态势胶囊与右侧操作区的位置（长标题靠截断收敛，不靠挤压别人）。 */
    max-width: 48%;
    min-width: 0;
  }
  .hud-task-kicker {
    color: var(--srf-text-disabled);
    font-size: var(--srf-font-size-caption);
    letter-spacing: 0.06em;
    white-space: nowrap;
  }
  .hud-task-title {
    color: var(--srf-text);
    font-size: var(--srf-font-size-title);
    line-height: var(--srf-line-height-title);
    font-weight: var(--srf-font-weight-semibold);
    min-width: 0;
  }
  /* 态势胶囊（@since v3.4）：单位 / 任务 / 会话三值合一 —— Z1 只占一个元素位。 */
  .hud-capsule {
    display: flex;
    align-items: center;
    gap: var(--srf-spacing-xs);
    padding: var(--srf-spacing-xxs) var(--srf-spacing-sm);
    border-radius: var(--srf-radius-pill);
    border: var(--srf-border-width) solid var(--srf-border);
    background: var(--srf-panel);
    color: var(--srf-text-muted);
    font-size: var(--srf-font-size-caption);
    white-space: nowrap;
  }
  .hud-capsule-item { display: inline-flex; align-items: baseline; gap: var(--srf-spacing-xxs); }
  .hud-capsule-value {
    color: var(--srf-text);
    font-size: var(--srf-font-size-body);
    font-weight: var(--srf-font-weight-semibold);
    font-variant-numeric: tabular-nums;
  }
  .hud-actions {
    position: relative;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--srf-spacing-sm);
    margin-left: auto;
  }
  .hud-notice-badge {
    min-width: 18px;
    height: 18px;
    padding: 0 var(--srf-spacing-xs);
    box-sizing: border-box;
    border-radius: var(--srf-radius-pill);
    background: var(--srf-danger);
    color: var(--srf-bg);
    font-size: var(--srf-font-size-caption);
    font-weight: var(--srf-font-weight-semibold);
    line-height: 18px;
    text-align: center;
  }
  .hud-notice-badge[hidden] { display: none; }
  /* 弹出层（@since v3.4）：音量层 + ⋯ 溢出菜单共用一套外观；默认 hidden（不占顶栏宽度）。 */
  .hud-popover {
    position: absolute;
    top: calc(100% + var(--srf-spacing-xs));
    z-index: 40;
    display: flex;
    align-items: center;
    gap: var(--srf-spacing-xs);
    padding: var(--srf-spacing-xs) var(--srf-spacing-sm);
    border-radius: var(--srf-radius);
    border: var(--srf-border-width) solid var(--srf-border-strong);
    background: var(--srf-panel-elevated);
    box-shadow: var(--srf-shadow);
    pointer-events: auto;
    /* 出入场过渡（@since v3.6）：140ms 淡入淡出 + 轻微上浮。
       why 用 allow-discrete + @starting-style：hidden 属性的 display:none 会**掐断**过渡，
       改成"display 离散过渡"后收起时能播完淡出、展开时能播淡入（纯 CSS，无 JS 计时器）。 */
    opacity: 1;
    transform: translateY(0);
    transition: opacity 140ms ease-out, transform 140ms ease-out, display 140ms allow-discrete;
  }
  .hud-popover[hidden] { display: none; opacity: 0; transform: translateY(-6px); }
  @starting-style {
    .hud-popover { opacity: 0; transform: translateY(-6px); }
  }
  .hud-menu { right: 0; flex-direction: column; align-items: stretch; min-width: 200px; }
  /* 菜单分组隔断（@since v3.8，task_137）：收纳项按「开关 / 导航」两段分组。 */
  .hud-menu-divider { height: 1px; background: var(--srf-border); margin: var(--srf-space-xxs) 0; }
  /* 声音段（@since v3.8，task_137）：音量滑条从「顶栏浮层」改成「菜单内行内展开」——
     声音件已经收进 ⋯ 菜单，浮层再浮一层就是两层套娃。 */
  .hud-menu .hud-sound-slot { width: 100%; }
  .hud-menu .hud-sound-popover {
    position: static;
    padding: 0;
    border: none;
    background: transparent;
    box-shadow: none;
  }
  .hud-popover-value { color: var(--srf-text-muted); font-size: var(--srf-font-size-xs); font-variant-numeric: tabular-nums; }
  /* 声音件（@since v3.4）：🔊 开关 + 音量计（音量层的入口，见 §4 A7/A8）。 */
  .hud-sound-slot { position: relative; display: flex; align-items: center; gap: var(--srf-spacing-xxs); }
  .hud-sound-popover { left: 0; }
  .hud-sound-level {
    /* @since v3.6：20×6px 的小条看不出是音量、也不知道能点 ——
       放大到 28×8px（顶栏高度不变，仍在一行内），并把 fill 做成可读的档位指示。 */
    width: 28px;
    height: 8px;
    padding: 0;
    border-radius: var(--srf-radius-pill);
    border: var(--srf-border-width) solid var(--srf-border);
    background: var(--srf-panel);
    cursor: pointer;
    overflow: hidden;
  }
  .hud-sound-level-fill { display: block; height: 100%; width: 0%; background: var(--srf-accent); }
  /* 音量滑条（@since v3.3，@since v3.4 收进 🔊 弹出层）：0-100。 */
  .hud-volume {
    width: 84px;
    accent-color: var(--srf-accent);
    cursor: pointer;
  }
  .hud-volume:disabled { opacity: 0.4; cursor: not-allowed; }
  .hud-rail-left {
    position: absolute;
    left: var(--hud-gap);
    /* 模式状态条（@since v3.6）：细条亮出时下方版面整体下移一条 ——
       让位量由 mode-strip 组件写在 <html> 上的 --srf-mode-strip-h 给（没亮 = 0）。 */
    top: calc(var(--hud-topbar-h) + var(--srf-mode-strip-h, 0px) + var(--hud-gap));
    /* 下边界避开两件：控制岛（居中，与左栏只有一条窄带重叠）与左下事件轨。
       why 用「岛的高度上限」而不是实测高度：岛高随内容变，栏的下边界得按上限留 —— 宁可空一截，
       也不能让栏压到岛或事件轨上。 */
    bottom: calc(var(--hud-island-max-h) + var(--hud-gap));
    width: min(320px, 28vw);
    z-index: 20;
    overflow: auto;
  }
  .hud-rail-right {
    position: absolute;
    right: var(--hud-gap);
    /* 同 .hud-rail-left：模式状态条亮出时让位一条（--srf-mode-strip-h）。 */
    top: calc(var(--hud-topbar-h) + var(--srf-mode-strip-h, 0px) + var(--hud-gap));
    /* 右下角是小地图（200×120 + 标题栏）—— 右栏的下边界按它的高度让开。 */
    bottom: calc(var(--hud-corner-stack-h) + var(--hud-gap));
    width: min(360px, 30vw);
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: var(--hud-gap);
    pointer-events: none;
  }
  .hud-status-slot { flex: 1 1 auto; min-height: 0; overflow: auto; }
  .hud-drawer-slot { flex: 0 0 auto; max-height: 45%; overflow: auto; }
  .hud-session-slot { flex: 0 0 auto; max-height: 45%; overflow: auto; }
  /* 控制岛（Z4；@since v3.4）：贴底居中一块，内容自适应、高度封顶。
     why 不再是「通栏底栏」：通栏底栏在 720p 下高 245px（34% 视口高），中轴只剩 66%；
     岛收成 56% 屏宽、约 60-90px 高之后，中轴在 720p 下回到 85% 以上。 */
  .hud-bottom-bar {
    position: absolute;
    left: 50%;
    bottom: 0;
    /* 贴底居中：用 translate 而不是 left/right 各半 —— 宽度是 min() 的结果，两侧留白自动均分。 */
    transform: translateX(-50%);
    /* 宽度 = 56% 屏宽，但不得越过「屏宽 − 两侧角件留边」——
       留边 = 角件留边 + 角件宽 + ≥40px 间距（CONTROL_ISLAND_SIDE_INSET_PX）。 */
    width: min(var(--hud-island-w), calc(100% - 2 * var(--hud-island-inset)));
    max-height: var(--hud-island-max-h);
    z-index: 25;
    box-sizing: border-box;
    display: flex;
    /* 回放条在上、命令面板在下：岛内竖排（列方向 flex）—— 同岛上下分层。 */
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-end;
    gap: 3px;
    padding: 4px 6px;
    background: var(--srf-panel-overlay);
    border: var(--srf-border-width) solid var(--srf-border);
    border-radius: var(--srf-radius);
    box-shadow: var(--srf-shadow);
    pointer-events: auto;
  }
  /* 命令面板槽位：整行铺满岛的宽度（面板本体在 strip 形态里自己排成 1 行）。 */
  .hud-bottom-bar > .hud-surface { width: 100%; flex: 0 0 auto; min-height: 0; }
  /* 回放条槽位：自己接指针事件（岛内其余部分让位给画布）。
     底色 / 边框由岛统一提供 —— 槽位只管排版。
     why 热力条变矮：岛的高度预算是 100px（硬验收），且 720p 下中轴可用高度要 ≥85% ——
       留 14px 给热力条（96 根柱子仍是缩略图口径），剩下的留给命令行。 */
  .hud-replay-slot {
    width: 100%;
    flex: 0 0 auto;
    pointer-events: auto;
    background: transparent;
    border: none;
    border-radius: 0;
    --replay-strip-h: 14px;
    --replay-pad-y: 1px;
    --replay-pad-x: 0px;
  }
  .hud-sub-screen {
    position: absolute;
    inset: 0;
    z-index: 50;
    pointer-events: auto;
    /* 透明：这层只是**弹窗宿主** —— 底色由弹窗壳的遮罩（--srf-backdrop）给。
       why 不是不透明：全屏弹窗开着时，四角常驻件要在遮罩**之下**可见并降对比
       （v3.5 遮挡规则 R1）—— 铺一层不透明底色会把它们整个盖掉，降对比就白做了。 */
    background: transparent;
  }
  @container (max-width: 700px) {
    .hud-topbar { position: static; }
    .hud-rail-left,
    .hud-rail-right,
    .hud-bottom-bar {
      position: static;
      width: auto;
      height: auto;
      max-height: none;
    }
    /* 窄屏（容器宽 ≤700px）：岛退化成文档流里的一块（不再居中浮起，也不再 translate）。 */
    .hud-bottom-bar { display: block; padding: var(--hud-gap); transform: none; }
    .hud-bottom-bar > .hud-surface { width: auto; height: auto; overflow: visible; }
  }
  /* 统一截断规则（@since v3.8，task_137）：单行 ellipsis，完整文本由 title 属性兜底。 */
${TRUNCATE_CSS}
`;

export const MAIN_SCREEN_TAG = 'strat-main-screen';

/**
 * 顶栏可见元素位（@since v3.4，task_089；docs/hud-redesign-proposal.html §2.5 Z1 规格；
 *   @since v3.8，task_137：**7 位 → 4 位**的减密度改版）。
 *
 * why 是一张显式清单而不是「数 DOM 节点」：验收口径是「顶栏可见元素 ≤N」，
 *   而顶栏内部本来就有子节点（胶囊里 3 个计数、弹出层里的 8 个菜单项）—— 不先定义
 *   「一个元素位 = 一个可见件」，这个数字就没法数、也没法回归。
 *   渲染时每个元素位都打 `data-topbar-item="<位名>"`，单测按这张清单逐位核对。
 *
 * 4 位（@since v3.8，task_137 —— 视觉权重：当前任务一句话 > 战场态势 > 其余收纳）：
 *   brand    品牌标识（§4 A1）—— 降为辅助级字号（不再是顶栏主角）
 *   task     **当前任务一句话**（新增）—— 标题级字号，顶栏的视觉主角
 *   capsule  态势胶囊：单位 / 任务 / 会话三值合一（§4 A2）+ 通知徽标（§4 A3，收进胶囊内）
 *   overflow 溢出菜单（收纳 8 项：声音 / 导演 / 演示 + 聊天 / 会话 / 角色 / 设置 / 像素风）
 *   why 从 7 位降到 4 位：声音 / 导演 / 演示是**低频开关**，常驻顶栏只是占位 ——
 *     收进 ⋯ 菜单后功能一条不少（点亮即状态的语义不变），同屏可见元素数 7 → 4（-43%）。
 */
export const TOPBAR_ITEM_ROLES = Object.freeze([
  'brand',
  'task',
  'capsule',
  'overflow',
] as const);

/** 顶栏元素位名（TOPBAR_ITEM_ROLES 的元素类型）。 */
export type TopbarItemRole = (typeof TOPBAR_ITEM_ROLES)[number];

/**
 * ⋯ 溢出菜单收纳的项（@since v3.4，task_089；§4 功能对照表 A4 / A9 / A10 / A11 / A12；
 *   @since v3.8，task_137：5 项 → 8 项 —— 声音 / 导演 / 演示三个低频开关也收进来）。
 *   why 是一张清单：功能零删减是硬验收，清单让"哪几项"可核对、可回归。
 */
export const TOPBAR_OVERFLOW_ROLES = Object.freeze([
  'sound',
  'director',
  'demo',
  'chat',
  'sessions',
  'character',
  'settings',
  'theme',
] as const);

/**
 * 顶栏「当前任务一句话」的取词口径（@since v3.8，task_137）。
 *
 * why 要一个明确口径而不是「随便取一条」：顶栏的主角位只能有一条真相 ——
 *   取「最近创建且**未终结**」的那条（running / pending / confirmed / draft 都算在跑）；
 *   一条都没在跑时明说「暂无进行中的任务」（不拿已完成的旧任务冒充当前任务）。
 *
 * @param missions 世界态里的任务列表（core 保留最近 MAX_MISSIONS 条）。
 * @returns 顶栏显示的一句话（空列表 → 明确的空态文案，不留空白）。
 */
export function currentTaskLine(missions: readonly MissionView[]): string {
  const TERMINAL: readonly MissionView['phase'][] = ['done', 'cancelled'];
  let active: MissionView | null = null;
  for (const mission of missions) {
    if (TERMINAL.includes(mission.phase)) continue;
    if (!active || mission.createdAt >= active.createdAt) active = mission;
  }
  return active ? active.title : '暂无进行中的任务';
}

/**
 * 回放条槽位（@since v3.3，task_082）—— 本屏只认「一个控制器」，不认数据源。
 * controller = null → 挂空条（显示「今天还没有任务记录」，不显示假时间轴）。
 */
export interface ReplaySlotOptions {
  readonly controller: ReplayController | null;
}

export interface MainScreenHandle {
  /** 把渲染出口挂到指定 DOM 节点；返回 unmount 闭包。 */
  mount(host: HTMLElement): () => void;
  /** 当前激活主题（只读，方便测试断言）。 */
  readonly currentThemeId: 'default' | 'pixel';
}

/**
 * 主屏可选依赖（@since v3.20，task_041）：形象预览端口 —— 由组合根（main-entry）注入，
 *   供角色屏的形象编辑面板用（与向导屏共享同一实例；缺省不注入，面板降级成提示语）。
 * @since v3.26（task_050）taskStats：派发推荐的历史统计提供口 —— 透传给 agent-panel 的
 *   「交给谁」选择器（表单打开时取一次；缺省不注入 = 无历史中性降级）。
 * @since v3.27（task_051）pipelines：流水线站态实时读数口 —— 透传给 agent-panel 的
 *   流水线卡片（app 层 pipeline-service.feed 同构注入；缺省不注入 = 面板不显示卡片，
 *   表单仍可发起 —— 只是发起后看不到站序读数）。
 */
export interface MainScreenOptions {
  readonly appearance?: AppearancePreviewPort;
  readonly taskStats?: TaskStatsProvider;
  readonly pipelines?: PipelineFeedInput;
  /**
   * 成长看板数据口（@since v3.36，task_061）：角色屏「成长」tab 与全场总览排行的数据源。
   * 缺省 = 引导语降级（非 Electron 场景），不拆屏可用性。
   */
  readonly growth?: GrowthStatsPort | null;
  /**
   * 自定义 agent 注册端口（@since v3.32，task_056）：设置屏的注册管理组（查看 / 移除，
   * 新增入口在向导）。缺省 = 不显示该组（非 Electron 降级）。
   */
  readonly customAgents?: CustomAgentsPort | null;
  /**
   * 会话历史的读取口（@since v3.43，task_095）—— 会话面板「历史抽屉」的两路真 IO
   *   （角色对话历史 / 会话事件流）。缺省 = 历史读取器未附着（面板如实说明，不显示假数据）。
   */
  readonly sessionHistory?: SessionHistoryPort;
  /**
   * 当日回放（@since v3.3，task_082）—— 底栏时间轴 scrubber 的控制器。
   * 控制器在组合根建（它要 app 层的读取口）；缺省 / controller=null → 回放条显示**空态**
   * （「今天还没有任务记录」—— 观众看得见这条时间轴在哪儿，而不是组件凭空消失）。
   */
  readonly replay?: ReplaySlotOptions | null;
  /**
   * 遮挡控制器（@since v3.5，task_099）—— 全屏弹窗（设置屏 / 角色屏）登记进去，
   * 于是弹窗开着时**四角常驻件统一降对比 + 禁点**（R1），ESC 也由它统一路由到栈顶（R4）。
   * 缺省 = 只接双关闭途径（ESC + 遮罩），不做四角降对比（单屏单测用的最小形态）。
   */
  readonly occlusion?: OcclusionController | null;
  /**
   * 网关连通性端口（@since v3.7，task_127）—— 态势屏「网关连接」那一行的真相源，
   *   与顶栏下方的全局横幅读**同一份**三级态（在线 / 降级 / 离线）。
   *   缺省 = 未接入探测（那一行如实说「未探测」，不谎报在线）。
   */
  readonly gateway?: GatewayLinkPort | null;
}

/** 工厂：构造 main-screen 句柄；接受一个已建好的 bus-adapter（依赖注入）。 */
export function createMainScreen(adapter: HudBusAdapter, options: MainScreenOptions = {}): MainScreenHandle {
  defineStratButton();

  const renderTo = (host: HTMLElement): () => void => {
    let currentScreen: CurrentScreen = 'main';
    /** 子屏挂载闭包（卸 sub-screen 时调用；null = 当前没挂任何子屏）。 */
    let unmountSubScreen: (() => void) | null = null;
    /** 主屏布局内各组件的挂载闭包（拆解 / 重建主布局时同步生命周期）。 */
    let unmountMain: (() => void) | null = null;
    /** 演示模式订阅的退订闭包（演示开关变化 → 主屏布局重渲）。 */
    let unsubscribeDemo: (() => void) | null = null;
    /** 皮肤订阅的退订闭包（皮肤变化 → ⋯ 菜单项回显）。 */
    let unsubscribeTheme: (() => void) | null = null;
    /** core 订阅闭包（订阅 WorldState.currentScreen 变化）；只在 mount 期间存在。 */
    let unsubscribeState: (() => void) | null = null;

    /**
     * 本屏**自有子树**（样式表 + .hud-root 根节点）—— 挂在宿主下，但**不接管宿主本身**。
     *
     * ★ @since v3.4（task_097）：本屏曾用 `host.innerHTML = ...` 重写整个宿主。
     *   组合根把**覆盖层**（小地图 / 事件轨 / toast / 聊天抽屉 / 里程碑 / 快捷键帮助）
     *   也挂在同一个宿主下 —— 宿主一旦被重写，这些覆盖层当场从 DOM 里消失且**永不重挂**：
     *   真机表现是「点一下顶栏的演示开关，小地图和事件轨就没了；之后点小地图、点事件轨条目、
     *   点『打开聊天』全部没反应」。task_097 的点击体检把这个坑逮了出来。
     *   改法：本屏只写自己的 rootEl —— 别人的节点一根手指都不碰。
     */
    const styleEl = document.createElement('style');
    styleEl.textContent = MAIN_SCREEN_STYLE;
    const rootEl = document.createElement('div');
    rootEl.className = 'hud-root';
    rootEl.setAttribute('part', 'root');
    host.append(styleEl, rootEl);

    /** 子屏宿主（settings / character）—— 与主屏布局同级，挂在宿主下（absolute 定位口径不变）。 */
    let subHostEl: HTMLElement | null = null;

    /** 卸掉子屏宿主（进主屏 / 卸载时调用）。 */
    const dropSubHost = (): void => {
      subHostEl?.remove();
      subHostEl = null;
    };

    const renderMain = (): void => {
      // 已挂的 sub-screen 必须先卸（进 main 时也要走这一步 —— 同屏重复也算 changed 边界）。
      if (unmountSubScreen) {
        unmountSubScreen();
        unmountSubScreen = null;
      }
      dropSubHost();
      if (unmountMain) {
        // 已经是 main 时仍走这里（renderMain 自身幂等）：先拆再装，节点身份会变（屏内容全换）。
        // 主屏布局是壳 + 子组件的集合，拆掉才能清干净。
        unmountMain();
        unmountMain = null;
      }
      // 声音包开关与音量（@since v3.3，task_083）：状态真源是 localStorage
      //   （hud/sound-engine.ts 每次播放现读）—— 顶栏只做读写与回显，不存第二份真相。
      const soundVolume = readSoundVolume();
      const soundVolumeLabel = volumeLabel(soundVolume);
      // 皮肤开关的显示名（@since v3.4，task_089）：像素风收进 ⋯ 菜单后，菜单项自带当前皮肤名 ——
      //   不再另挂一个 theme-tag 文本（§4 A13：状态不写第二遍）。
      const themeLabel = adapter.themeId === 'pixel' ? '像素' : '默认';
      // 顶栏主角位的一句话（@since v3.8，task_137）：初始取世界态最新快照，订阅后再刷新。
      const initialTask = currentTaskLine(adapter.latest?.missions ?? []);
      rootEl.innerHTML = `
        <header class="hud-topbar" data-role="topbar">
          <span class="hud-brand" data-topbar-item="brand">Stratix</span>
          <div class="hud-task" data-topbar-item="task" data-role="current-task">
            <span class="hud-task-kicker">当前任务</span>
            <span class="hud-task-title truncate" data-role="current-task-title" title="${escapeHtml(initialTask)}">${escapeHtml(initialTask)}</span>
          </div>
          <div class="hud-capsule" data-topbar-item="capsule" data-role="status-capsule" title="单位 / 任务 / 会话">
            <span class="hud-capsule-item"><b class="hud-capsule-value" data-role="mission-count">0</b> 任务</span>
            <span class="hud-capsule-item"><b class="hud-capsule-value" data-role="unit-count">0</b> 单位</span>
            <span class="hud-capsule-item"><b class="hud-capsule-value" data-role="link-count">0</b> 会话</span>
            <span class="hud-notice-badge" data-role="notice-badge" hidden title="待处理通知">0</span>
          </div>
          <div class="hud-actions">
            <${STRAT_BUTTON_TAG} icon="more" variant="default" title="更多" aria-label="更多" data-topbar-item="overflow" data-role="overflow"></${STRAT_BUTTON_TAG}>
            <div class="hud-popover hud-menu" data-role="overflow-menu" hidden>
              <div class="hud-sound-slot" data-role="sound-slot">
                <${STRAT_BUTTON_TAG} icon="sound" label="声音" variant="default" stretch title="声音开关" aria-label="声音开关" data-role="sound" data-menu-item="sound"></${STRAT_BUTTON_TAG}>
                <button class="hud-sound-level" type="button" data-role="sound-volume-open"
                        title="音量 ${soundVolumeLabel}（点击切换档位）" aria-label="音量 ${soundVolumeLabel}">
                  <span class="hud-sound-level-fill" data-role="sound-level-fill"></span>
                </button>
                <div class="hud-popover hud-sound-popover" data-role="sound-popover" hidden>
                  <input class="hud-volume" type="range" min="0" max="100" step="5"
                         value="${soundVolume}" data-role="sound-volume"
                         aria-label="音效音量" title="音量 ${soundVolumeLabel}">
                  <span class="hud-popover-value" data-role="sound-volume-value">${soundVolumeLabel}</span>
                </div>
              </div>
              <${STRAT_BUTTON_TAG} icon="director" label="导演镜头" variant="default" stretch title="导演镜头" aria-label="导演镜头" data-role="director" data-menu-item="director"></${STRAT_BUTTON_TAG}>
              <${STRAT_BUTTON_TAG} icon="demo" label="演示模式" variant="default" stretch title="演示模式" aria-label="演示模式" data-role="demo" data-menu-item="demo"></${STRAT_BUTTON_TAG}>
              <div class="hud-menu-divider"></div>
              <${STRAT_BUTTON_TAG} icon="chat" label="打开聊天" variant="default" stretch data-role="chat" data-menu-item="chat"></${STRAT_BUTTON_TAG}>
              <${STRAT_BUTTON_TAG} icon="sessions" label="会话面板" variant="default" stretch data-role="sessions" data-menu-item="sessions"></${STRAT_BUTTON_TAG}>
              <${STRAT_BUTTON_TAG} icon="character" label="看角色" variant="default" stretch data-role="character" data-menu-item="character"></${STRAT_BUTTON_TAG}>
              <${STRAT_BUTTON_TAG} icon="settings" label="去设置" variant="default" stretch data-role="settings" data-menu-item="settings"></${STRAT_BUTTON_TAG}>
              <${STRAT_BUTTON_TAG} icon="palette" label="像素风 · ${themeLabel}" variant="default" stretch title="切换像素风" aria-label="切换像素风" aria-pressed="${adapter.themeId === 'pixel' ? 'true' : 'false'}" data-role="theme" data-menu-item="theme"></${STRAT_BUTTON_TAG}>
            </div>
          </div>
        </header>
        <div class="hud-rail-left hud-surface" data-role="agent-panel"></div>
        <div class="hud-rail-right">
          <div class="hud-status-slot hud-surface" data-role="status-screen"></div>
          <div class="hud-session-slot hud-surface" data-role="session-panel"></div>
          <div class="hud-drawer-slot hud-surface" data-role="log-drawer" data-engineering="true"></div>
        </div>
        <div class="hud-bottom-bar">
          <div class="hud-replay-slot" data-role="replay"></div>
          <div class="hud-surface" data-role="command-panel"></div>
        </div>
    `;

      // 计数元素缓存一次：core 每次状态变更都全量广播，逐帧 querySelector 是纯浪费。
      const unitCounter = rootEl.querySelector('[data-role="unit-count"]');
      const missionCounter = rootEl.querySelector('[data-role="mission-count"]');
      const linkCounter = rootEl.querySelector('[data-role="link-count"]');
      const noticeBadge = rootEl.querySelector<HTMLElement>('[data-role="notice-badge"]');
      // 顶栏主角位：当前任务一句话（@since v3.8，task_137）—— 文本 + title 双写，
      // 省略号截断后仍可悬停读到完整标题（截断规则的一半是"被截掉的内容还在"）。
      const taskTitle = rootEl.querySelector<HTMLElement>('[data-role="current-task-title"]');

      /**
       * 开关态回显（@since v3.4，task_089）：**点亮即状态** —— 顶栏不再挂 on/off 文本标签
       *   （§4 A13：那是"把开关状态用文字再写一遍"）。视觉用 variant（primary = 亮），
       *   可访问用 aria-pressed（读屏能听出"开/关"）。
       */
      const applySwitchState = (el: HTMLElement | null, on: boolean): void => {
        if (!el) return;
        el.setAttribute('variant', on ? 'primary' : 'default');
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
      };

      // 导演开关（@since v3.3，task_081）：按钮读 core 广播的同一份真相
      //   （WorldState.directorEnabled）—— HUD 不自己存一份「导演开着吗」。
      const directorButton = rootEl.querySelector<HTMLElement>('[data-role="director"]');
      applySwitchState(directorButton, adapter.latest?.directorEnabled === true);

      // 演示开关（@since v3.3，task_110）：本地展示态（demo-mode 是唯一真相源）。
      const demoButton = rootEl.querySelector<HTMLElement>('[data-role="demo"]');
      applySwitchState(demoButton, demoMode.enabled);

      // 声音包开关与音量（@since v3.3，task_083）：纯本地展示态 —— 不发 HudCommand、
      //   不进总线（与演示模式同一口径：音效不进 WorldState）。真源是 localStorage，
      //   声音引擎每次播放现读 → 这里改完立即生效，不留第二份真相。
      const soundButton = rootEl.querySelector<HTMLElement>('[data-role="sound"]');
      const volumeInput = rootEl.querySelector<HTMLInputElement>('[data-role="sound-volume"]');
      const volumeValue = rootEl.querySelector<HTMLElement>('[data-role="sound-volume-value"]');
      const levelFill = rootEl.querySelector<HTMLElement>('[data-role="sound-level-fill"]');
      const soundPopover = rootEl.querySelector<HTMLElement>('[data-role="sound-popover"]');
      const volumeOpenButton = rootEl.querySelector<HTMLElement>('[data-role="sound-volume-open"]');
      /** 把当前开关 / 音量状态回显到顶栏（按钮点亮 + 滑条可用性 + 音量计 + 数值 + 标题）。 */
      const applySoundState = (): void => {
        const enabled = readSoundEnabled();
        applySwitchState(soundButton, enabled);
        // 图标随开关换形（@since v3.6，task_121）：静音 = 喇叭上打斜杠。
        //   why 要换形而不只是变亮：亮/暗在小图标上分不清"开着"还是"关了"，
        //   形状差（斜杠）才是一眼可辨的状态差。
        soundButton?.setAttribute('icon', enabled ? 'sound' : 'sound-muted');
        if (volumeInput) volumeInput.disabled = !enabled;
        const volume = readSoundVolume();
        const label = volumeLabel(volume);
        if (levelFill) levelFill.style.width = `${volume}%`;
        if (volumeValue) volumeValue.textContent = label;
        // 标题同步（@since v3.6，task_116）：音量变了，title 必须跟着变 ——
        //   否则点完还是「音量 70%」，正是死功能报告里「点了没反应」的观感来源。
        if (volumeOpenButton) {
          volumeOpenButton.title = `音量 ${label}（点击切换档位）`;
          volumeOpenButton.setAttribute('aria-label', `音量 ${label}`);
        }
        if (volumeInput) volumeInput.title = `音量 ${label}`;
      };
      applySoundState();

      // ── 弹出层开合（@since v3.4，task_089）────────────────────────────────
      //   两个弹层：🔊 音量层（§4 A8）与 ⋯ 溢出菜单（§4 A4/A9/A10/A11/A12）。
      //   why 不用 <details>：弹层要能被「点外面关掉 / Esc 关掉」，且开合态要在 DOM 上可断言。
      const overflowMenu = rootEl.querySelector<HTMLElement>('[data-role="overflow-menu"]');
      const setPopover = (el: HTMLElement | null, open: boolean): void => {
        if (!el) return;
        el.hidden = !open;
      };
      const closePopovers = (): void => {
        setPopover(overflowMenu, false);
        setPopover(soundPopover, false);
      };
      // 点顶栏以外 → 弹层收起（顶栏内部的开合由顶栏自己管）。
      // why 挂 document 而不是 host：顶栏是浮层，点空白（战场画布）也得能收起它。
      const onDocumentClick = (e: Event): void => {
        const target = e.target as HTMLElement | null;
        // closest?.：target 未必是 Element（点 document 本身时就是）—— 别在这儿抛。
        if (!target?.closest?.('.hud-topbar')) closePopovers();
      };
      // Esc → 收起（键盘可达：图标开关也得能用键盘操作）。
      const onDocumentKeydown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') closePopovers();
      };
      document.addEventListener('click', onDocumentClick);
      document.addEventListener('keydown', onDocumentKeydown);

      // 音量层的入口 = 声音件里的音量计（§4 A7：「点击旁边的音量区 = 弹出音量层」）。
      // why 顺带循环档位（@since v3.6，task_116）：原实现点了只弹层、不改音量，
      //   20×6px 的小条既看不出是音量也不知道能点 —— 现在点击 = 切到下一档
      //   （静音/30/70/100）并同步标题，同时展开滑条供细调（老行为保留）。
      const onVolumeOpenClick = (): void => {
        const next = nextVolumePreset(readSoundVolume());
        writeSoundVolume(next);
        setPopover(soundPopover, true);
        applySoundState();
      };
      volumeOpenButton?.addEventListener('click', onVolumeOpenClick);

      /**
       * 皮肤菜单项的回显（@since v3.6，task_115）：菜单项自带当前皮肤名（@since v3.4，task_089）。
       * why 从 adapter 读而不是本屏存一份：皮肤真源是主题控制器（token + localStorage 记忆）——
       *   本屏另存一份必然和「刷新后恢复的皮肤」对不上（那正是死功能报告里点不动的症状之一）。
       */
      const syncThemeButton = (): void => {
        const themeButton = rootEl.querySelector<HTMLElement>('[data-role="theme"]');
        if (!themeButton) return;
        const themeId = adapter.themeId;
        themeButton.setAttribute('label', `像素风 · ${themeId === 'pixel' ? '像素' : '默认'}`);
        themeButton.setAttribute('aria-pressed', themeId === 'pixel' ? 'true' : 'false');
      };

      const onThemeClick = (): void => {
        // 下一套皮肤 = 当前皮肤的对面（真源在 adapter，不在本屏）。
        const next = adapter.themeId === 'default' ? 'pixel' : 'default';
        adapter.dispatch({ type: 'theme.set', themeId: next });
        // 回显由皮肤订阅统一驱动（dispatch → 落 token → 订阅回调 → 菜单项改名）；
        // 这里再补一次是为了「派发即回显」，不等订阅那一拍。
        syncThemeButton();
      };
      const onDemoClick = (): void => {
        // 演示模式是纯本地展示态：不发 HudCommand、不进总线（见 demo-mode.ts 文件头）。
        // 状态变化由 demo-mode 的订阅回调统一触发重渲（工程件显隐 + 顶栏标签）。
        demoMode.toggle();
      };
      const onDirectorClick = (): void => {
        // 导演模式（@since v3.3，task_081）：HUD 只发**开关命令**，绝不直接操控 world（铁律）。
        // 当前态取自 core 广播的 WorldState.directorEnabled（core 是唯一真相）：
        //   用户开 → core 写 true → 广播 → 按钮点亮；
        //   用户在战场上手动碰了镜头 → world 发 camera.director=false → core 写回 false
        //   → 广播 → 按钮熄灭（手动优先，导演让位）。
        const enabled = adapter.latest?.directorEnabled === true;
        adapter.dispatch({ type: 'camera.director', enabled: !enabled });
      };
      const onSoundClick = (): void => {
        // 声音包总开关（@since v3.3，task_083）：直写 localStorage（引擎每次播放现读）——
        //   纯本地展示态，不发 HudCommand、不进总线。缺省开（演示模式默认有声）。
        writeSoundEnabled(!readSoundEnabled());
        applySoundState();
      };
      const onVolumeInput = (): void => {
        // 音量滑条（0-100）：即拖即写 —— 引擎下次播放现读，立即生效。
        if (!volumeInput) return;
        const value = Number.parseInt(volumeInput.value, 10);
        if (!Number.isFinite(value)) return;
        writeSoundVolume(value);
        // 音量计、数值与标题同步（@since v3.4 task_089 / v3.6 task_116）：
        //   拖条时顶栏立刻看出音量到哪了，标题也跟着变。
        applySoundState();
      };
      volumeInput?.addEventListener('input', onVolumeInput);
      const onSettingsClick = (): void => {
        adapter.dispatch({ type: 'ui.navigate', screen: 'settings' });
      };
      const onCharacterClick = (): void => {
        adapter.dispatch({ type: 'ui.navigate', screen: 'character' });
      };
      const onChatClick = (): void => {
        // 'chat' 由 core 解释为打开聊天抽屉（见 types.ts ScreenId 注释）；不进 currentScreen。
        adapter.dispatch({ type: 'ui.navigate', screen: 'chat' });
        const state = adapter.latest;
        const selectedUnitId = state?.selection.unitIds.length === 1 ? state.selection.unitIds[0] : null;
        const characterId = state?.units.find((unit) => unit.id === selectedUnitId)?.characterId ?? undefined;
        host.dispatchEvent(new CustomEvent('stratix:chat-open', {
          bubbles: true,
          detail: { characterId },
        }));
      };

      // 会话面板的元素引用（顶栏「会话面板」钮要能展开/收起它 —— 入口常驻可见）。
      let sessionPanelEl: StratSessionPanelElement | null = null;

      const onSessionsClick = (): void => {
        sessionPanelEl?.toggleCollapsed();
      };

      /**
       * ⋯ 溢出菜单开合（@since v3.4，task_089）：收纳 5 项低频操作
       *   （聊天 / 会话 / 角色 / 设置 / 像素风 —— §4 A4 / A9 / A10 / A11 / A12，功能零删减）。
       *   开菜单时顺手收起音量层：两个弹层不叠着（省一层视觉噪音）。
       */
      const onOverflowClick = (): void => {
        const nextOpen = overflowMenu?.hidden ?? true;
        setPopover(overflowMenu, nextOpen);
        setPopover(soundPopover, false);
      };

      const themeHandler = (e: Event): void => {
        const target = e.target as HTMLElement | null;
        if (target?.closest('[data-role="overflow"]')) onOverflowClick();
        else if (target?.closest('[data-role="theme"]')) { onThemeClick(); closePopovers(); }
        else if (target?.closest('[data-role="demo"]')) onDemoClick();
        else if (target?.closest('[data-role="director"]')) onDirectorClick();
        else if (target?.closest('[data-role="sound"]')) onSoundClick();
        else if (target?.closest('[data-role="chat"]')) { onChatClick(); closePopovers(); }
        else if (target?.closest('[data-role="sessions"]')) { onSessionsClick(); closePopovers(); }
        else if (target?.closest('[data-role="character"]')) { onCharacterClick(); closePopovers(); }
        else if (target?.closest('[data-role="settings"]')) { onSettingsClick(); closePopovers(); }
      };
      host.addEventListener('strat-button-click', themeHandler);

      // 命令面板：唯一命令入口。注入同一个 adapter —— 与顶栏按钮共用一条派发通道，
      // 不给面板另开总线口子。必须在 rootEl.innerHTML 之后挂（容器节点得先存在）。
      // variant='strip'（@since v3.4，task_090）：控制岛形态 —— 1 行命令条，
      //   两个 scope 分组的按钮摊平成一条横向滚动行（其余命令滚动可达，一条不减）。
      // replay（@since v3.6，task_113）：当日回放控制器 —— 命令行 `replay` 的落地面；
      //   与回放条（mountDayReplay）共用**同一个**控制器实例（两处读数必须是同一份）。
      const panelHost = rootEl.querySelector<HTMLElement>('[data-role="command-panel"]');
      const unmountPanel = panelHost
        ? mountCommandPanel(adapter, panelHost, {
            variant: 'strip',
            replay: options.replay?.controller ?? null,
          })
        : null;

      // 当日回放条（@since v3.3，task_082）：底栏上沿的时间轴 scrubber。
      // 组件只被控制器驱动（它自己不读数据）；控制器由组合根注入（它才有读取口）。
      const replayHost = rootEl.querySelector<HTMLElement>('[data-role="replay"]');
      const unmountReplay = replayHost
        ? mountDayReplay(replayHost, { controller: options.replay?.controller ?? null })
        : null;

      // Agent 侧栏：选中单位的业务态。与命令面板共用同一个 adapter —— 两条派发通道合成一条；
      // task_050：可选的历史统计提供口一并注入（派发推荐「交给谁」选择器用）；
      // task_051：可选的流水线实时读数口一并注入（发起后的流水线卡片用）。
      const agentHost = rootEl.querySelector<HTMLElement>('[data-role="agent-panel"]');
      const agentDeps: AgentPanelDeps =
        options.taskStats || options.pipelines
          ? {
              dispatch: (command) => adapter.dispatch(command),
              subscribe: (handler) => adapter.subscribe(handler),
              taskStats: options.taskStats,
              pipelines: options.pipelines,
            }
          : adapter;
      const unmountAgentPanel = agentHost ? mountAgentPanel(agentDeps, agentHost) : null;

      // 日志抽屉：纯展示，不发命令 —— 只把同一个 adapter 的 subscribe 能力给它。
      // 演示模式（@since v3.3，task_110）：日志抽屉是工程件（时间戳 / 来源 / 级别四列），
      //   演示时不挂载 —— 既不占画面也不订阅总线（省一份无谓的订阅）。
      const drawerHost = rootEl.querySelector<HTMLElement>('[data-role="log-drawer"]');
      const unmountDrawer = drawerHost && !demoMode.enabled ? mountLogDrawer(adapter, drawerHost) : null;

      // 会话面板（@since v3.43，task_095）：多会话管理的入口 —— 列表 / kind 筛选 / 状态徽标 /
      //   中断钮（发 session.interrupt）+ 历史抽屉。历史读取口可选（缺省 = 面板说"未附着"）。
      const sessionHost = rootEl.querySelector<HTMLElement>('[data-role="session-panel"]');
      const unmountSession = sessionHost
        ? mountSessionPanel(
            {
              adapter,
              ...(options.sessionHistory ? { history: options.sessionHistory } : {}),
            },
            sessionHost
          )
        : null;
      sessionPanelEl = sessionHost?.querySelector(SESSION_PANEL_TAG) as StratSessionPanelElement | null;

      // 态势屏：同为纯展示区块（指标卡 / 系统状态 / 最近事件全由 WorldState 派生），
      // 复用同一个 adapter —— 它唯一的出口是导航 ui.navigate，不发任何业务命令。
      const statusHost = rootEl.querySelector<HTMLElement>('[data-role="status-screen"]');
      const unmountStatus = statusHost
        ? mountStatusScreen(adapter, statusHost, options.gateway ?? null)
        : null;

      // 演示模式开关 → 主屏布局重渲（工程件显隐 + 顶栏标签同步）。
      // why 重渲而不是局部改：工程件可能出现在任何面板里，重渲一次最不容易漏。
      unsubscribeDemo?.();
      unsubscribeDemo = demoMode.subscribe(() => renderMain());

      // 皮肤变化 → ⋯ 菜单项改名 / aria-pressed（@since v3.6，task_115）。
      // why 订阅而不是各入口自己改：皮肤可能从设置页 / 底栏命令 / 本菜单三处任一处切，
      //   菜单项只有一个真相来源（主题控制器）。
      unsubscribeTheme?.();
      unsubscribeTheme = adapter.subscribeTheme(() => syncThemeButton());

      const unsubscribe = adapter.subscribe((state) => {
        if (unitCounter) unitCounter.textContent = String(state.units.length);
        if (missionCounter) missionCounter.textContent = String(state.missions.length);
        if (linkCounter) linkCounter.textContent = String(state.links.length);
        if (noticeBadge) {
          const pending = state.notices.length;
          noticeBadge.textContent = String(pending);
          noticeBadge.hidden = pending === 0;
        }
        // 顶栏主角位刷新（@since v3.8，task_137）：当前任务一句话随世界态走。
        if (taskTitle) {
          const line = currentTaskLine(state.missions);
          taskTitle.textContent = line;
          taskTitle.setAttribute('title', line);
        }
        // 导演开关回显（task_081 / task_089）：点亮即状态 —— 读 core 广播的同一份真相，
        //   不再另写一份 on/off 文本。
        applySwitchState(directorButton, state.directorEnabled === true);
      });

      // 工程件过滤（骨架机制）：标了 data-engineering 的节点在演示模式下隐藏。
      // 各面板后续只需给自己的工程件标这个属性即可接入（无需改本屏）。
      // 作用域是 rootEl（**本屏自有子树**）—— 不扫宿主：宿主里还有组合根挂的覆盖层，
      //   那些节点不归本屏管（宿主归属铁律，task_097）。
      demoMode.filterEngineering(rootEl);

      // 主屏布局内所有挂载闭包打包到一个闭包里：renderScreen 拆主屏布局时一次性释放。
      unmountMain = () => {
        unsubscribe();
        unsubscribeDemo?.();
        unsubscribeDemo = null;
        unsubscribeTheme?.();
        unsubscribeTheme = null;
        unmountSession?.();
        unmountDrawer?.();
        unmountStatus?.();
        unmountAgentPanel?.();
        unmountPanel?.();
        unmountReplay?.unmount();
        // 音量滑条的 input 监听（task_083）：随本屏布局一起拆（滑条节点本也会被丢弃，
        //   但显式摘掉更符合本文件的卸载纪律）。
        volumeInput?.removeEventListener('input', onVolumeInput);
        // 音量层入口的 click 监听（task_089）+ document 上的「点外面关 / Esc 关」监听：
        //   同样随本屏布局一起摘 —— 监听器留在 document 上就是泄漏（perf 铁律）。
        volumeOpenButton?.removeEventListener('click', onVolumeOpenClick);
        document.removeEventListener('click', onDocumentClick);
        document.removeEventListener('keydown', onDocumentKeydown);
        host.removeEventListener('strat-button-click', themeHandler);
        // 这里不置空 rootEl —— renderMain 自身会立刻重写（rootEl 是本屏自有的那块）。
      };
    };

    const renderSettings = (): void => {
      if (unmountMain) {
        unmountMain();
        unmountMain = null;
      }
      // 只清**本屏自有**的主屏布局 —— 宿主里组合根挂的覆盖层（小地图 / 事件轨 / toast…）一根都不碰。
      rootEl.innerHTML = '';
      dropSubHost();
      const subHost = document.createElement('div');
      subHost.className = 'hud-sub-screen';
      host.appendChild(subHost);
      subHostEl = subHost;
      // 全屏弹窗壳（@since v3.5，task_099）：遮罩 + 居中面板；ESC 与点遮罩都收口到
      //   「回主屏」这一条命令（双关闭途径必齐 —— 方案 §二 R4）。
      const shell = mountModalShell(
        {
          id: 'settings',
          onClose: () => adapter.dispatch({ type: 'ui.navigate', screen: 'main' }),
          occlusion: options.occlusion ?? null,
        },
        subHost
      );
      // settings-screen 自带 topbar + 返回按钮 → ui.navigate(main)。
      const unmountSettings = mountSettingsScreen(adapter, shell.panel, {
        customAgents: options.customAgents ?? null,
        // 遮挡控制器（@since v3.6，task_116）：设置页的危险区确认框复用 task_112 的
        //   全屏弹窗模式（遮罩 + 居中面板 + ESC/点遮罩双关闭），需登记进遮挡栈 ——
        //   否则 ESC 会把设置页一起关掉（栈顶即当前模态）。
        occlusion: options.occlusion ?? null,
      });
      unmountSubScreen = () => {
        unmountSettings();
        shell.unmount();
      };
      currentScreen = 'settings';
    };

    const renderCharacter = (): void => {
      if (unmountMain) {
        unmountMain();
        unmountMain = null;
      }
      rootEl.innerHTML = '';
      dropSubHost();
      const subHost = document.createElement('div');
      subHost.className = 'hud-sub-screen';
      host.appendChild(subHost);
      subHostEl = subHost;
      // 同设置屏：全屏弹窗壳（遮罩 + 面板 + ESC/遮罩双关闭，task_099）。
      const shell = mountModalShell(
        {
          id: 'character',
          onClose: () => adapter.dispatch({ type: 'ui.navigate', screen: 'main' }),
          occlusion: options.occlusion ?? null,
        },
        subHost
      );
      // character-screen 自带 topbar + 返回按钮 → ui.navigate(main) 或 ui.navigate(chat) 打开聊天抽屉。
      // @since v3.20（task_041）：形象编辑面板的预览端口随屏位注入（没给 = 面板降级，屏照常可用）。
      const unmountCharacter = mountCharacterScreen(adapter, shell.panel, {
        appearance: options.appearance,
        growth: options.growth,
      });
      unmountSubScreen = () => {
        unmountCharacter();
        shell.unmount();
      };
      currentScreen = 'character';
    };

    const renderScreen = (state: WorldState | null): void => {
      const next = resolveCurrentScreen(state);
      if (next === currentScreen && (next === 'main' ? unmountMain !== null : unmountSubScreen !== null)) {
        // 同屏重复广播，跳过重渲；perf：屏位无变更不刷 DOM。
        return;
      }
      currentScreen = next;
      if (next === 'main') renderMain();
      else if (next === 'settings') renderSettings();
      else renderCharacter();
    };

    // 初次渲染：若 adapter 已挂载（dev 入口顺序），用其最新快照；否则按 main 兜底显示。
    renderScreen(adapter.latest);
    // 之后跟着 core 广播的 currentScreen 走：每次 main / settings / character 切换都重渲对应屏。
    unsubscribeState = adapter.subscribe((state) => renderScreen(state));

    return () => {
      unsubscribeState?.();
      unsubscribeState = null;
      unmountMain?.();
      unmountMain = null;
      unmountSubScreen?.();
      unmountSubScreen = null;
      dropSubHost();
      // ★ 只卸本屏自己的两个节点 —— **不清 host.innerHTML**：
      //   宿主里还有组合根挂的覆盖层（小地图 / 事件轨 / toast / 聊天抽屉 / 快捷键帮助），
      //   一刀切会把它们连同本屏一起抹掉（task_097 逮到的真机缺陷的另一半）。
      rootEl.remove();
      styleEl.remove();
    };
  };

  return {
    mount: renderTo,
    get currentThemeId() { return adapter.themeId; },
  };
}
