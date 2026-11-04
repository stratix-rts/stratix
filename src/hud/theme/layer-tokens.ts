/**
 * 文件职责：**浮层堆叠登记制度**（@since v3.9，task_146）—— 全局 z-index 刻度表 +
 *   浮层家族登记表 + 「象限归属表」。
 *
 * ============ 为什么需要它（用户亲眼所见的重叠）============
 *   用户报告：「信息层级框和 agent 事件列表出现压在一起的重叠问题」。
 *   病灶不在某个组件的 CSS，而在**制度**：z-index 散落成 20 / 21 / 25 / 28 / 31 / 32 /
 *   40 / 45 / 50 / 55 / 60 / 70 十几个硬编码数字，谁新加一个浮层就随手挑一个数 ——
 *   于是「信息层级开关」(28) 压在「agent 栏」(20) 上、「事件轨」(21) 与
 *   「控制岛」(25) 抢同一条底边、toast(50) 与子屏(50) 同数靠 DOM 顺序决胜负。
 *   **根治 = 一张刻度表 + 一张登记表**：浮层不再自己挑数字，只**登记**自己在刻度表上的位置。
 *
 * ============ 纪律 ============
 *   1. **刻度只有一份** —— 数值只在本文件的 LAYER_TOKENS 里；别处一律用 zVar('name')。
 *      （单测 src/hud/theme/__tests__/layer-tokens.test.ts 会扫 src/hud 全目录，
 *        断言零硬编码 z-index —— 这条纪律是被机器守着的，不是靠自觉。）
 *   2. **登记表要全** —— 新增浮层必须往 OVERLAY_REGISTRY 加一行（id / 档位 / 象限 / 宿主）。
 *   3. **象限唯一归属** —— 同一块屏幕只能有一个主人（见 CORNER_OWNERS）：
 *      角件互相压 = 用户眼里的「压在一起的重叠」。
 *   4. **数值只升不降**：新增档位请挂在语义正确的位置，不要就地改老数值
 *      （改数值 = 全场视觉回归）。
 *
 * 禁止事项：
 *   1. 在本文件里 import world / phaser / app —— hud 只认识 core；
 *   2. 在组件里写 `z-index: 40` 这种裸数字 —— 一律 zVar('sticky')；
 *   3. 把「面板内局部层」（localBase / localMid / localTop）与全局档位混用 ——
 *      局部层只在**自己的 stacking context 内**比较（面板自带 z-index → 自成上下文）。
 */

/**
 * 刻度档位（语义 → 数值）。
 *
 * 全局档位（跨件可比）：
 *   base 10 · underlay 15 · panel 20 · track 21 · island 25 · raised 30 · banner 31 ·
 *   strip 32 · sticky 40 · overlay 45 · modal 50 · toast 55 · spotlight 60 · max 70
 *
 * 局部档位（只在组件自己的 stacking context 内比较 —— 组件根带 z-index 即自成上下文）：
 *   fx 1 · fxRaised 2 · localBase 0 · localMid 2 · localTop 3
 */
export const LAYER_TOKENS = Object.freeze({
  /** 骨架层：HUD 容器（#hud-side）。战场在其下。 */
  base: 10,
  /** 空态覆盖层：战场空态（整屏，但要让出所有 HUD 件）。 */
  underlay: 15,
  /** 常驻面板：左栏（agent）/ 右栏（态势 · 会话 · 日志）。 */
  panel: 20,
  /** 事件轨（左下角最近事件流）—— 角件，与控制岛同一象限但不同列。 */
  track: 21,
  /** 控制岛（贴底居中）。 */
  island: 25,
  /** 顶栏（态势摘要）。 */
  raised: 30,
  /** 网关横幅（顶栏正下方）。 */
  banner: 31,
  /** 模式状态条（顶栏正下方的全局细条）。 */
  strip: 32,
  /** 浮出层（不夺焦点）：顶栏菜单 / 信息层级开关 / 回放角标 / 小地图 —— 「浮在内容之上」。 */
  sticky: 40,
  /** 焦点浮层（半模态 / 瞬时大字）：聊天抽屉 / 里程碑大字 —— 压住角件（sticky 档）。 */
  overlay: 45,
  /** 全屏弹窗：子屏（设置 / 角色）/ 弹窗壳 / 向导屏。 */
  modal: 50,
  /** 瞬时反馈：toast 气泡（弹窗之上，但不挡焦点面）。 */
  toast: 55,
  /** 焦点浮层：onboarding spotlight / 快捷键帮助 / 新任务对话框。 */
  spotlight: 60,
  /** 最高优先级：设置页危险区确认框。 */
  max: 70,
  /** 屏幕空间特效底层：扫描光带（压在面板之下）。 */
  fx: 1,
  /** 屏幕空间特效抬升层：报错红光晕。 */
  fxRaised: 2,
  /** 面板内底层：抽屉的对侧压暗层。 */
  localBase: 0,
  /** 面板内中层：命令面板的内部件。 */
  localMid: 2,
  /** 面板内顶层：事件条目的详情板。 */
  localTop: 3,
} as const);

/** 刻度档位名。 */
export type LayerToken = keyof typeof LAYER_TOKENS;

/** 档位名 → CSS 自定义属性名（--srf-z-<kebab>）。 */
export function layerTokenVar(name: LayerToken): string {
  return `--srf-z-${name.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)}`;
}

/**
 * 取一条 z-index 声明（**组件里唯一的写法**）。
 * @example `z-index: ${zVar('toast')};` → `z-index: var(--srf-z-toast, 55);`
 *
 * why 带兜底值：CSS 变量没注入时（单测 / 裸组件页）整条声明会因 var() 解析失败而作废，
 *   z-index 退回 auto —— 层级当场乱掉。兜底值取自刻度表本身（不是另抄一份数字），
 *   所以「登记表」与「实际渲染」永远一致。
 */
export function zVar(name: LayerToken): string {
  return `var(${layerTokenVar(name)}, ${LAYER_TOKENS[name]})`;
}

/** 刻度表 → CSS 声明块（:root 上的一组自定义属性）。 */
export function buildLayerTokensCss(): string {
  const decls = (Object.keys(LAYER_TOKENS) as LayerToken[])
    .map((name) => `  ${layerTokenVar(name)}: ${LAYER_TOKENS[name]};`)
    .join('\n');
  return `:root {\n${decls}\n}\n`;
}

/** 注入刻度表的 <style> id（幂等覆盖 —— 反复挂载只留一份）。 */
export const LAYER_TOKENS_STYLE_ID = 'srf-layer-tokens';

/**
 * 把刻度表注入文档（幂等）。
 * why 要注入而不是只靠组件里的 var()：刻度表是**全局的**，谁先起来都行，
 *   但必须有一处**主动**把它写进 :root —— 否则第一帧可能有一瞬的 auto 层序。
 */
export function installLayerTokens(doc?: Document): void {
  const target = doc ?? (typeof document === 'undefined' ? null : document);
  if (!target) return;
  const existing = target.getElementById(LAYER_TOKENS_STYLE_ID);
  if (existing) {
    existing.textContent = buildLayerTokensCss();
    return;
  }
  const style = target.createElement('style');
  style.id = LAYER_TOKENS_STYLE_ID;
  style.setAttribute('data-srf-layer-tokens', 'true');
  style.textContent = buildLayerTokensCss();
  (target.head ?? target.documentElement)?.appendChild(style);
}

// ============================================================================
// 浮层家族登记表
// ============================================================================

/** 屏幕象限 / 归属区。 */
export type OverlayZone =
  | 'top-bar'
  | 'top-center'
  | 'top-right'
  | 'left-column'
  | 'left-bottom'
  | 'bottom-center'
  | 'right-column'
  | 'right-bottom'
  | 'full-screen'
  | 'screen-space';

/** 登记项。 */
export interface OverlayRegistration {
  /** 家族 id（单测按它索引）。 */
  readonly id: string;
  /** 所属刻度档位。 */
  readonly layer: LayerToken;
  /** 归属区（象限）。 */
  readonly zone: OverlayZone;
  /** 宿主（挂载位置 —— 浮层挂载位置统一的一条依据）。 */
  readonly host: string;
  /** 一句话说明（这个家族是什么、为什么在这个档位）。 */
  readonly note: string;
}

/**
 * 浮层家族登记表 —— **新增浮层必须在这里加一行**。
 *
 * ★ 这张表就是「登记制度」本身：以前浮层是「随手挑个 z-index」，
 *   现在是「登记一个家族 + 认领一个档位 + 认领一块象限」。
 */
export const OVERLAY_REGISTRY: readonly OverlayRegistration[] = Object.freeze([
  {
    id: 'topbar',
    layer: 'raised',
    zone: 'top-bar',
    host: '#hud-root（主屏布局内）',
    note: '顶栏：品牌 / 当前任务 / 态势胶囊 / 溢出菜单 —— 全场最高频的常驻件。',
  },
  {
    id: 'topbar-menu',
    layer: 'sticky',
    zone: 'top-bar',
    host: '顶栏内（.hud-popover）',
    note: '顶栏弹出层：⋯ 溢出菜单 / 音量层 —— 浮在顶栏之下、战场之上。',
  },
  {
    id: 'gateway-banner',
    layer: 'banner',
    zone: 'top-center',
    host: '#hud-side',
    note: '网关连通性横幅：顶栏正下方 —— 压在顶栏之下，不压顶栏。',
  },
  {
    id: 'mode-strip',
    layer: 'strip',
    zone: 'top-center',
    host: '#hud-side',
    note: '模式状态细条（演示 / 导演）：全宽一条，压在横幅之上。',
  },
  {
    id: 'agent-rail',
    layer: 'panel',
    zone: 'left-column',
    host: '#hud-root（主屏布局内）',
    note: '左栏（agent 侧栏）：**下边界让出左下角带**（见 HUD_OVERLAY_BAND_METRICS）。',
  },
  {
    id: 'right-rail',
    layer: 'panel',
    zone: 'right-column',
    host: '#hud-root（主屏布局内）',
    note: '右栏：态势总览 / 会话 / 日志 —— 下边界让出小地图。',
  },
  {
    id: 'control-island',
    layer: 'island',
    zone: 'bottom-center',
    host: '#hud-root（主屏布局内）',
    note: '控制岛：贴底居中命令条 —— 与左下角事件轨同底但不同列。',
  },
  {
    id: 'event-track',
    layer: 'track',
    zone: 'left-bottom',
    host: '#hud-root',
    note: '事件轨（左下最近事件流）：**左下角的主人**，展开时占高见 MARQUEE_METRICS。',
  },
  {
    id: 'layer-switch',
    layer: 'sticky',
    zone: 'left-bottom',
    host: '#hud-side',
    note: '信息层级开关：认领事件轨**之上**的一条固定带（不与事件轨 / 左栏重叠）。',
  },
  {
    id: 'minimap',
    layer: 'sticky',
    zone: 'right-bottom',
    host: '#hud-root',
    note: '小地图：右下角主人。',
  },
  {
    id: 'milestone',
    layer: 'overlay',
    zone: 'screen-space',
    host: '#hud-root',
    note: '里程碑大字：屏幕中央瞬时提示 —— 与角件同级但居中，不与之争位。',
  },
  {
    id: 'toast',
    layer: 'toast',
    zone: 'bottom-center',
    host: '#hud-root',
    note: 'toast 气泡：**底中 · 控制岛之上**落位（@since v3.9 task_146 从右上角迁走 —— 右上角是顶栏按钮与右栏操作行），浮在弹窗之上。',
  },
  {
    id: 'chat-drawer',
    layer: 'overlay',
    zone: 'right-column',
    host: '#hud-root',
    note: '角色聊天抽屉：右侧滑出（半模态，只压暗对侧）。',
  },
  {
    id: 'replay-clock',
    layer: 'sticky',
    zone: 'bottom-center',
    host: '#hud-side',
    note: '回放时间戳角标：贴控制岛上沿。',
  },
  {
    id: 'modal-shell',
    layer: 'modal',
    zone: 'full-screen',
    host: '.hud-sub-screen',
    note: '全屏弹窗壳（遮罩 + 居中面板）：子屏 / 危险区确认框的宿主。',
  },
  {
    id: 'sub-screen',
    layer: 'modal',
    zone: 'full-screen',
    host: '.hud-sub-screen',
    note: '设置屏 / 角色屏 / 向导屏：全屏弹窗层。',
  },
  {
    id: 'onboarding-spotlight',
    layer: 'spotlight',
    zone: 'full-screen',
    host: '#hud-root',
    note: 'onboarding 聚光向导：压在整个 modal 层之上（它是「教你怎么用」的面）。',
  },
  {
    id: 'shortcut-help',
    layer: 'spotlight',
    zone: 'full-screen',
    host: '#hud-root',
    note: '快捷键帮助：全屏遮罩 + 面板。',
  },
  {
    id: 'new-task-dialog',
    layer: 'spotlight',
    zone: 'full-screen',
    host: '#hud-root',
    note: '新任务对话框：焦点面（打开时它是当前唯一该点的东西）。',
  },
  {
    id: 'confirm-dialog',
    layer: 'max',
    zone: 'full-screen',
    host: '设置屏内（.hud-sub-screen）',
    note: '危险区确认框：全场最高 —— 压在一切之上。',
  },
  {
    id: 'battlefield-empty',
    layer: 'underlay',
    zone: 'screen-space',
    host: '#hud-root',
    note: '战场空态覆盖：整屏但在所有 HUD 件之下（它只是「没人时的一句话」）。',
  },
  {
    id: 'screen-fx',
    layer: 'fx',
    zone: 'screen-space',
    host: '#hud-side',
    note: '屏幕空间特效（扫描光带 / 报错红光晕）：压在面板之下，只做背景感。',
  },
]);

/**
 * 象限归属表 —— **一块屏幕只能有一个主人**。
 *
 * why 需要它：z-index 只管「谁压谁」，管不了「谁占哪块地方」——
 *   两件 z-index 不同的浮层照样可能**位置重叠**（本次用户报告就是这种：
 *   信息层级开关 28 压 agent 栏 20，数字有大小，但位置撞了）。
 *   归属表把「象限 → 主人」写死，位置撞车时改**位置**，而不是改 z-index。
 */
export const CORNER_OWNERS: Readonly<Record<string, string>> = Object.freeze({
  /** 顶栏：顶栏自己。 */
  'top-bar': 'topbar',
  /** 顶中：网关横幅 / 模式条（上下叠放，互不横向重叠）。 */
  'top-center': 'gateway-banner + mode-strip',
  /** 右上：顶栏的操作区（⋯ 菜单 / 通知徽标）—— 不许任何浮层压上来。 */
  'top-right': 'topbar',
  /** 左列：agent 侧栏。 */
  'left-column': 'agent-rail',
  /** 左下：事件轨（主人）+ 信息层级开关（事件轨之上的一条带）。 */
  'left-bottom': 'event-track（主人）→ layer-switch（其上）',
  /** 底中：控制岛（主人）+ toast（控制岛之上的一条带）。 */
  'bottom-center': 'control-island（主人）→ toast（其上）',
  /** 右列：聊天抽屉 / 态势 / 会话 / 日志。 */
  'right-column': 'chat-drawer + right-rail',
  /** 右下：小地图。 */
  'right-bottom': 'minimap',
  /** 全屏：弹窗族（modal → toast → spotlight → max 自下而上）。 */
  'full-screen': 'modal → toast → spotlight → max',
});
