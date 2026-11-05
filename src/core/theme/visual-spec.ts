/**
 * 文件职责：**视觉常量的唯一事实源** —— 调色板（七色语义色）/ 尺寸 / 时长 / easing / 演示模式参数。
 *   来源：docs/DEMO-PLAN.md §1（调色板与 Design Token）+ §8（演示模式）。
 * 输入：无（纯静态常量；零 IO、零 DOM、零 import）。
 * 输出：VISUAL_PALETTE（色值）/ VISUAL_METRICS（尺寸·时长·easing）/ UNIT_ANIMATION_METRICS（单位动画八态度量）
 *      / DEMO_MODE（演示模式参数）/ HUD_LAYER_METRICS（信息三层级的对比口径）
 *      / TOPBAR_METRICS（顶栏 Z1 的高度与元素封顶口径）/ CONTROL_ISLAND_METRICS（控制岛 Z4 的宽高与间距口径）
 *      / PALETTE_CSS_VARS（语义色 → CSS 变量名的映射）/ hexToNumber（色值换算）
 *      / blendOver（前景按 alpha 叠背景）/ contrastRatio（WCAG 对比度）。
 * 禁止事项：
 *   1. import world / hud / phaser / 任何 DOM —— 本模块是**叶子常量**，谁都能引，谁都不许它引；
 *   2. 依赖运行时状态（时间、随机、localStorage）—— 常量必须是常量；
 *   3. 在本模块内做「按皮肤改色」的推导 —— 皮肤是 chrome 层，场景调色板是场景层，两层分开；
 *   4. 复制第二份色表 —— 世界侧门面在 src/world/visual-spec.ts，HUD 侧注入在
 *      src/hud/theme/visual-tokens.ts，两者都从这里取色，不各自抄一份。
 *
 * ★ 为什么落在 core/theme/ 而不是 world/（与 skin-registry.ts 同一条纪律）：
 *   这份调色板有**两个消费者** —— 战场侧（world，Phaser 数字色）与 HUD 侧（hud，CSS 变量）。
 *   按 §1 通信铁律「任何 hud ↔ world 直接调用 = 架构违规」，两侧不能互相 import；
 *   而 world 只允许认识 core。故「唯一事实源」必须落在两侧共用的 core —— 与皮肤登记表
 *   （core/theme/skin-registry.ts）同一处境、同一解法。
 *   world 侧的入口仍是 src/world/visual-spec.ts（门面 + Phaser 数字色），hud 侧是
 *   src/hud/theme/visual-tokens.ts（注入 CSS 变量）—— 门面不同，事实只有一份。
 */

/** 语义色键（七色）。键名即语义，值即色值 —— 键名不许带修饰词（换肤在 skin 层做）。 */
export type PaletteKey =
  /** 背景基底（深夜蓝渐变的底色）。 */
  | 'background'
  /** 网格线（低亮度）。 */
  | 'grid'
  /** 我方单位主色（青蓝）。 */
  | 'unit'
  /** 进度 / 施工（琥珀）。 */
  | 'progress'
  /** 完成 / 成功（翠绿）。 */
  | 'success'
  /** 报错 / 卡住（绯红）。 */
  | 'danger'
  /** 事件流 / 装饰（紫）。 */
  | 'accent';

/**
 * 调色板（DEMO-PLAN §1 表，逐字照抄 —— 这是「唯一事实源」的含义：改这里，别处跟着改）。
 * 只冻结语义色；皮肤（chrome）色仍在 skin-registry + tokens-*.css，两层互不覆盖。
 */
export const VISUAL_PALETTE: Readonly<Record<PaletteKey, string>> = Object.freeze({
  background: '#0d1126',
  grid: '#1a2140',
  unit: '#4fc3f7',
  progress: '#f0a020',
  success: '#2ecc71',
  danger: '#ff5470',
  accent: '#8a6bff',
});

/**
 * 语义色 → HUD CSS 变量名。
 * why 单独一张表：注入器（hud/theme/visual-tokens.ts）按这张表生成 CSS，
 *   变量名只有这一处约定，改名不会漏改一处。
 */
export const PALETTE_CSS_VARS: Readonly<Record<PaletteKey, string>> = Object.freeze({
  background: '--srf-visual-background',
  grid: '--srf-visual-grid',
  unit: '--srf-visual-unit',
  progress: '--srf-visual-progress',
  success: '--srf-visual-success',
  danger: '--srf-visual-danger',
  accent: '--srf-visual-accent',
});

/**
 * 十六进制色 → 数字色（Phaser 的 0xRRGGBB）。
 * 只吃 6 位 `#rrggbb`（本模块的色值都是这个形态）；不合法的输入抛错 —— 静默吞掉会让
 * 战场画出一个说不清来源的颜色，比报错难查得多。
 */
export function hexToNumber(hex: string): number {
  const normalized = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`[visual-spec] not a #rrggbb color: ${hex}`);
  }
  return Number.parseInt(normalized, 16);
}

/**
 * 十六进制色 → `rgba(...)` 字符串（带透明度）。
 * 用于「同一语义色 + 不同 alpha」的场合（战场浮标底衬等）—— 免得为了半透明再抄一份 rgba 字面量。
 */
export function hexToRgba(hex: string, alpha: number): string {
  const value = hexToNumber(hex);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * 十六进制色 → `[r, g, b]`（0-255）。色值解析的共同入口。
 * 只吃 6 位 `#rrggbb`（本模块的色值都是这个形态）；不合法输入抛错 —— 静默吞掉会算出一个
 *   说不出来源的颜色，比报错难查得多。
 */
function hexToRgb(hex: string): [number, number, number] {
  const value = hexToNumber(hex);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/**
 * 两色按 sRGB 直接混合（前景以 alpha 叠在背景上）→ `#rrggbb`。
 * 用于「元素整体降不透明度后**实际渲染成什么颜色**」的换算 ——
 *   信息层级把 L1 降到 18% 对比（不透明度 0.18）后，文字与底色要按 0.18 混一次，
 *   才能算出真实对比度（不混就是拿「理论对比」自欺欺人）。
 */
export function blendOver(fg: string, bg: string, alpha: number): string {
  const [fr, fg_, fb] = hexToRgb(fg);
  const [br, bg_, bb] = hexToRgb(bg);
  const a = Math.min(1, Math.max(0, alpha));
  const mix = (f: number, b: number): number => Math.round(f * a + b * (1 - a));
  const hex = (n: number): string => n.toString(16).padStart(2, '0');
  return `#${hex(mix(fr, br))}${hex(mix(fg_, bg_))}${hex(mix(fb, bb))}`;
}

/**
 * WCAG 对比度（1:1 ~ 21:1）—— 给定前景色与背景色，算人眼读起来差多少。
 * why 落在唯一事实源：本仓的「对比度」口径（降对比 / 提对比 / 无障碍校验）都该用同一个公式，
 *   免得各处各算一套（尤其「L1 降到 18% 对比」这条验收要一个可复算的数字）。
 * 相对亮度按 WCAG 2.1 的 sRGB 线性化公式。
 */
export function contrastRatio(fg: string, bg: string): number {
  const luminance = (hex: string): number => {
    const [r, g, b] = hexToRgb(hex).map((c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * HUD 信息层级的度量（@since v3.4，task_096；docs/hud-redesign-proposal.html §2.3）。
 *
 * why 也落在唯一事实源：「L1 降到 18% 对比」是一个**规格数字** —— HUD 侧的视觉层按它写 CSS 变量，
 *   单测按它算实测对比度，两边必须读同一份，否则「降到了 18%」这句话没人能复算。
 * 口径说明：18% 以**元素整体不透明度**实现（opacity 0.18）——
 *   元素与背景按 18% 混合后，实测对比度随之下降（见 blendOver / contrastRatio）。
 */
export const HUD_LAYER_METRICS = Object.freeze({
  /** L1 正常态的不透明度（1 = 完全不透明）。 */
  l1Opacity: 1,
  /** L3 激活时 L1 的不透明度（0.18 = 对比降到 18%）。 */
  l1DimOpacity: 0.18,
  /** L3 激活时 L2 的不透明度（0 = 让位）。 */
  l2DimOpacity: 0,
  /** 层级切换的过渡时长（ms）—— 只动 opacity / visibility，不触发布局重排。 */
  transitionMs: 200,
});

/**
 * 顶栏（Z1）的度量（@since v3.4，task_089；docs/hud-redesign-proposal.html §2.5 分区规格表 Z1 行）。
 *
 * why 落在唯一事实源：Z1 的三个数字（高 40px / 可见元素封顶 7 个 / ⋯ 收纳 5 项）是**验收数字** ——
 *   HUD 侧按它写样式与结构，单测按它断言，评审按它核对；抄成两份必然对不上。
 *   「7 元素」的计数口径见 hud/screens/main-screen.ts 的 TOPBAR_ITEM_ROLES（一个元素位 = 一个可见件）。
 */
export const TOPBAR_METRICS = Object.freeze({
  /** 顶栏高度（px）—— Z1 规格「顶 0，全宽，高 40px」。 */
  heightPx: 40,
  /**
   * 顶栏可见元素上限（个）—— @since v3.8（task_137）由 7 收到 4；
   *   @since v3.10（task_154）由 4 回到 5（加回「+ 角色」一级入口）。
   * why 收紧：评估 r1-r3 反复点「顶栏信息密度偏高」。低频开关（声音 / 导演 / 演示）
   *   收进 ⋯ 菜单后，**功能零删减**，但同屏可见元素位 7 → 4（-43%）。
   * why 加回一个（task_154）：用户反馈「不知道如何添加 agent」—— 新建角色原先只藏在
   *   ⌘K 与战场空态里，等于藏起来。它是产品的主动作，值得一个常驻位；
   *   低频开关仍在 ⋯ 菜单里（密度没失控，只是把主角放对位置）。
   */
  maxVisibleItems: 5,
  /**
   * ⋯ 溢出菜单收纳项数（个）—— @since v3.8（task_137）由 5 增到 8。
   * why 增：多出来的 3 项正是从顶栏收进来的低频开关（声音 / 导演 / 演示）——
   *   收纳 ≠ 删减（这是"功能零丢失"的实现方式）。
   */
  overflowItemCount: 8,
});

/** 尺寸 / 时长 / easing 规范（DEMO-PLAN §1「尺寸/时长规范」）。 */
export const VISUAL_METRICS = Object.freeze({
  /** 单位命中盒（px）。 */
  unitHitboxPx: 48,
  /** hover 放大倍率。 */
  hoverScale: 1.1,
  /** 入场：ease Back.Out，250ms。 */
  enter: Object.freeze({ ease: 'Back.Out', durationMs: 250 }),
  /** 退场：ease Cubic.In，300ms。 */
  exit: Object.freeze({ ease: 'Cubic.In', durationMs: 300 }),
  /** 摄像机移动：ease Cubic.easeInOut，600ms。 */
  camera: Object.freeze({ ease: 'Cubic.easeInOut', durationMs: 600 }),
});

/**
 * 事件跑马灯 + 里程碑大字的度量（DEMO-PLAN §6）。
 *
 * why 也落在唯一事实源：条数上限 / 滑入时长 / 淡出时长 / 里程碑间隔 / 大字停留 / 震动参数
 *   是**两侧共用的规格数字** —— HUD 侧（跑马灯组件、里程碑 overlay）与战场侧（Phaser 相机震动）
 *   必须读同一份，否则「大字出现时震 100ms」与 HUD 里写的 100ms 会各说各话。
 * 滑入 / 淡出时长不另抄：直接引用 VISUAL_METRICS 的入场 / 退场口径（250ms / 300ms）。
 */
export const MARQUEE_METRICS = Object.freeze({
  /** 跑马灯同时最多显示几条（超出时最旧一条淡出）。 */
  maxEntries: 5,
  /**
   * @since v3.4（task_091）事件轨最大宽度（px）—— proposal §2.5 Z2：「左下 fixed，宽 ≤260px」。
   *   why 落唯一事实源：宽度是「与控制岛（Z4，56% 屏宽贴底居中）零重叠」这条验收的输入 ——
   *   轨道右缘 = 左边距 + 本宽度，控制岛左缘 = 22% 屏宽，两者要在 1280 宽下不相撞。
   */
  maxWidthPx: 260,
  /**
   * @since v3.4（task_091）折叠态默认显示几条 —— proposal §2.5 Z2：「默认显示 2 条 + 展开 N 条」。
   *   why 折叠：底边是「高密度变动区」，常驻 5 条会把观众的注意力钉在左下角；
   *   折叠成 2 条 + 一个「展开 N 条」入口，底边静默度才回来（proposal §1.3 痛点 c）。
   */
  collapsedVisible: 2,
  /** 新消息左侧滑入时长（ms）= 通用入场时长。 */
  enterDurationMs: VISUAL_METRICS.enter.durationMs,
  /** 最旧一条淡出时长（ms）= 通用退场时长。 */
  exitDurationMs: VISUAL_METRICS.exit.durationMs,
  /** 每完成多少个任务触发一次里程碑大字。 */
  milestoneEvery: 10,
  /** 里程碑大字停留时长（ms）。 */
  milestoneDurationMs: 1500,
  /** 里程碑伴随的镜头震动时长（ms）。 */
  shakeDurationMs: 100,
  /** 镜头震动强度（Phaser 口径：视口宽高的比例；小幅取 0.005）。 */
  shakeIntensity: 0.005,
});

/**
 * **左下角浮层带**的度量（@since v3.9，task_146）—— 浮层堆叠登记制度的「象限归属」侧。
 *
 * ============ 病灶 ============
 *   用户报告「信息层级框和 agent 事件列表压在一起」。根因不是 z-index 的大小，
 *   而是**位置**：左下角这一小块屏幕同时被三件东西惦记着 ——
 *     ① 左栏（agent 侧栏，下边界原先在「控制岛高度 + 缝」= 视口底往上 112px）；
 *     ② 事件轨（左下最近事件流，展开到 5 条时占高 175px）；
 *     ③ 信息层级开关（固定浮层，原先贴在「控制岛高度 + 8px」= 往上 108px）。
 *   三者的纵向区间互相咬合 → 压在一起。
 *
 * ============ 口径 ============
 *   本表把左下角**切成两条互不重叠的带**（从视口底边往上数）：
 *     · 事件轨带：事件轨主人位，含它的底边留边；
 *     · 信息层级开关带：开关的固定位，压在事件轨带之上；
 *     · 两者之和 = 左栏（agent 侧栏）的下边界（cornerBandPx）——
 *       左栏的内容到此为止，**不再伸进角件带**。
 *   why 落在 core：这份数字是 HUD 的**布局契约**（屏幕哪一块归谁），
 *     与 CONTROL_ISLAND_METRICS / TOPBAR_METRICS 同族。
 */
export const HUD_OVERLAY_BAND_METRICS = Object.freeze({
  /** 事件轨单行高（px）—— 与 marquee 组件的 --marquee-row-h 同源（26）。 */
  marqueeRowHeightPx: 26,
  /** 事件轨行间距（px）—— 与 --marquee-gap 同源（4）。 */
  marqueeRowGapPx: 4,
  /** 事件轨「展开 N 条」按钮高（px）—— 事件轨最底下那一行。 */
  marqueeToggleHeightPx: 25,
  /** 事件轨最大占高（px）—— 展开到 MARQUEE_METRICS.maxEntries 条时的总高。 */
  marqueeMaxHeightPx: MARQUEE_METRICS.maxEntries * (26 + 4) + 25,
  /** 角件贴边留边（px）—— 事件轨的底边留边（与 MARQUEE_METRICS.cornerMargin 同值）。 */
  cornerMarginPx: 16,
  /** 信息层级开关带高（px）—— 开关实际高 78 + 与事件轨的 8px 缝 + 余量。 */
  layerSwitchBandPx: 92,
  /**
   * 信息层级开关的下边界（px，从视口底边起算）——
   * 压在事件轨最大占高之上，两者之间留 8px 缝。
   */
  layerSwitchBottomPx: 16 + MARQUEE_METRICS.maxEntries * (26 + 4) + 25 + 8,
  /**
   * 左栏（agent 侧栏）的下边界（px，从视口底边起算）——
   * 事件轨带 + 信息层级开关带之和。这是「左栏不再压角件」的硬边界。
   */
  cornerBandPx: 16 + MARQUEE_METRICS.maxEntries * (26 + 4) + 25 + 92,
});

/**
 * 单位联动（@since v3.4，task_092；docs/hud-redesign-proposal.html §2.2「视线动线」/ §2.5 Z2）的度量。
 *
 * why 也落在唯一事实源：描边高亮的粗细 / 呼吸周期与引导弧线的淡入时长 / 贝塞尔形状
 *   是**两侧共用的规格数字** —— 战场侧（world/objects 的焦点层）按它渲染，单测按它断言；
 *   弧线起点锚在 HUD 事件轨（Z2）上，两侧对「事件轨在哪」的认知必须来自同一份数字。
 * 形状约定（规格原文）：
 *   - 描边高亮：**霓虹描边 + 呼吸**，持续到失焦 / 再次点击（不是一次性闪光）；
 *   - 引导弧线：**屏幕坐标绘制**的贝塞尔曲线，800ms 淡入，镜头移动实时跟随。
 */
export const FOCUS_LINK_METRICS = Object.freeze({
  /** 描边高亮：霓虹**外发光**圈的粗细（世界 px）—— 亮线的外圈，负责「霓虹」的辉光感。 */
  outlineGlowPx: 6,
  /** 描边高亮：霓虹**亮线**的粗细（世界 px）。 */
  outlineStrokePx: 2,
  /** 描边高亮：亮线相对单位本体的外扩（世界 px）—— 圈在身体外，不压住角色。 */
  outlinePaddingPx: 4,
  /** 描边高亮：呼吸周期（ms）—— 一轮「亮起 → 暗下」的时间。 */
  breathPeriodMs: 1600,
  /** 描边高亮：呼吸谷值透明度（不是全灭 —— 全灭看着像「取消选中」）。 */
  outlineMinAlpha: 0.45,
  /** 描边高亮：呼吸峰值透明度。 */
  outlineMaxAlpha: 1,
  /** 描边高亮：外发光相对亮线的透明度系数（辉光是亮的余晖，不是主体）。 */
  outlineGlowAlphaRatio: 0.35,
  /** 引导弧线：淡入时长（ms；规格钦定 800ms 淡入）。 */
  arcFadeInMs: 800,
  /** 引导弧线：贝塞尔采样段数（24 段足够顺滑，且每帧重画的代价可忽略）。 */
  arcSegments: 24,
  /** 引导弧线：线宽（屏幕 px）—— 屏幕空间绘制，不随镜头缩放变粗变细。 */
  arcStrokePx: 2,
  /** 引导弧线：控制点的外扩比例（相对起终点竖直距离；0 = 直线）。 */
  arcBendRatio: 0.35,
  /** 引导弧线：外扩的最小高度（屏幕 px）—— 起终点几乎水平时也保得住弧度。 */
  arcMinBendPx: 60,
  /**
   * 引导弧线：**起点锚点**（屏幕空间）—— HUD 事件轨（Z2）的右缘。
   * why 锚在事件轨而不是屏幕角：弧线要回答的是「这条事件说的是哪个单位」，
   *   从条目所在的那条轨出发，指向才是「从左下到中屏」（proposal §2.2 的动线）。
   * 数值与 HUD 事件轨的 fixed 定位同口径（left: 16px / bottom: 16px / 行高 26px）。
   */
  origin: Object.freeze({
    /** 事件轨左边距（px）。 */
    trackLeftPx: 16,
    /** 事件轨宽度（px）—— 取 MARQUEE_METRICS.maxWidthPx（唯一事实源，勿另抄）。 */
    trackWidthPx: MARQUEE_METRICS.maxWidthPx,
    /** 事件轨下边距（px）。 */
    trackBottomPx: 16,
    /** 事件轨单行高（px）—— 起点落在首行中部。 */
    trackRowPx: 26,
  }),
});

/**
 * 导演取景框的度量（@since v3.4，task_092；docs/hud-redesign-proposal.html §2.5 A6 / G1）。
 *
 * why 落在唯一事实源：取景框的括号尺寸 / 线宽 / 呼吸周期是**验收数字** ——
 *   「🎬 导演开启后中屏出现琥珀色取景框并标注『🎬 导演』」（proposal §2.5），
 *   战场侧按它渲染、单测按它断言，两边读同一份才不会各画各的。
 */
export const DIRECTOR_FRAME_METRICS = Object.freeze({
  /** 取景框：单角括号的两条边长（屏幕 px）。 */
  cornerSizePx: 26,
  /** 取景框：括号线宽（屏幕 px）。 */
  strokeWidthPx: 2,
  /** 取景框：括号峰值透明度。 */
  maxAlpha: 0.9,
  /** 取景框：括号谷值透明度（呼吸谷底 —— 提示「它一直亮着」，不是闪一下）。 */
  minAlpha: 0.4,
  /** 取景框：一次呼吸（亮 → 暗）的时长（ms）—— 半个周期。 */
  breathHalfPeriodMs: 900,
  /** 取景框：标注文案（proposal 钦定「🎬 导演」）。 */
  label: '🎬 导演',
  /** 取景框：标注字号（屏幕 px）。 */
  labelFontPx: 13,
  /** 取景框：标注距取景框上缘的留边（屏幕 px）。 */
  labelInsetPx: 10,
});

/**
 * 中屏可视区（战场画面区）的布局留白（@since v3.4，task_092）。
 *
 * why 需要它：导演取景框要框在**中屏**（HUD 分区之间的战场画面区），
 *   而 HUD 的分区尺寸写在 HUD 侧的 CSS 里（顶栏 / 左右栏 / 底栏）——
 *   world 侧不能 import hud（铁律），只能按同一组口径在 core 里复算一次。
 * ★ 耦合声明：下面六个数字与 HUD 侧 main-screen 的布局表达式**同源**
 *   （.hud-rail-left = min(320px, 28vw)、.hud-rail-right = min(360px, 30vw)、
 *   --hud-bottom-h = min(34cqh, 300px)）。改 HUD 分区尺寸时这里要同步改 ——
 *   两处各写一份是已知的漂移点，故在此显式记下，别让后来人以为它能自动跟随。
 */
export const STAGE_METRICS = Object.freeze({
  /** 分区之间的留白（px）—— 与 HUD 的 --hud-gap 同量级。 */
  gapPx: 16,
  /** 底栏高度占屏高的比例（对应 --hud-bottom-h 的 34cqh）。 */
  bottomBarRatio: 0.34,
  /** 底栏高度上限（px）（对应 --hud-bottom-h 的 300px 上限）。 */
  bottomBarMaxPx: 300,
  /** 左栏宽度上限（px）（对应 .hud-rail-left 的 320px）。 */
  leftRailMaxPx: 320,
  /** 左栏宽度占屏宽的比例（对应 .hud-rail-left 的 28vw）。 */
  leftRailRatio: 0.28,
  /** 右栏宽度上限（px）（对应 .hud-rail-right 的 360px）。 */
  rightRailMaxPx: 360,
  /** 右栏宽度占屏宽的比例（对应 .hud-rail-right 的 30vw）。 */
  rightRailRatio: 0.3,
});

/**
 * 单位动画八态的度量（DEMO-PLAN §2「单位动画八态」）。
 *
 * why 也落在唯一事实源：动画的尺寸/时长与调色板同属「视觉规范」——
 *   战场动画层（world/appearance/unit-animation.ts）与 dev 逐态验收页都从这里取，
 *   免得各处抄一份「±4px / 2000ms / 8°」再各改各的。
 * 数值逐条对应 DEMO-PLAN §2 的规格原文（未写明的量按同规格最贴近的一档取值并注明）。
 */
export const UNIT_ANIMATION_METRICS = Object.freeze({
  /** 待机三件套 · 悬浮 bob：正弦 ±4px，周期 2s（相位按单位 id 派生，天然错开）。 */
  bob: Object.freeze({ amplitudePx: 4, periodMs: 2000 }),
  /** 待机三件套 · 眨眼：每 3-6s 随机触发一次，闭眼 120ms（眼睛压成横线）。 */
  blink: Object.freeze({ minIntervalMs: 3000, maxIntervalMs: 6000, closedMs: 120 }),
  /** 待机三件套 · 天线摆动：±5°（周期规格未给，取与 bob 同量级的 1.8s）。 */
  antenna: Object.freeze({ amplitudeDeg: 5, periodMs: 1800 }),
  /** 工作态：前倾 8° + 高频微颤 ±1px + 头顶琥珀进度弧 0→360° + 每 1.5s 一次 squash-stretch。 */
  working: Object.freeze({
    leanDeg: 8,
    tremorAmplitudePx: 1,
    tremorHz: 12,
    arcPeriodMs: 3000,
    squashPeriodMs: 1500,
    squashMinScaleY: 0.9,
    squashMaxScaleY: 1.05,
  }),
  /** 卡住态：整体灰度 50% + 头顶红 ❗ 每 2s 弹跳一次 + 身体同步抖动。 */
  stuck: Object.freeze({
    grayscale: 0.5,
    alertBouncePeriodMs: 2000,
    /** 一次弹跳的时长（占 2s 周期的前段，其余时间静止）。 */
    alertBounceMs: 400,
    alertBounceHeightPx: 12,
    shakeAmplitudePx: 2,
    shakeHz: 20,
  }),
  /** 完成态：squash → 原地跳 20px → 落地爆 8-12 个星尘小三角四散淡出。 */
  completed: Object.freeze({
    squashMs: 150,
    jumpMs: 450,
    jumpHeightPx: 20,
    dustMs: 600,
    dustMin: 8,
    dustMax: 12,
  }),
  /** 摸鱼态：头顶 z→Z→Z 依次上升淡出，循环。 */
  slacking: Object.freeze({ periodMs: 2400, stepMs: 600, lifeMs: 900, risePx: 24 }),
  /** 选中态：脚下旋转虚线环，青色，直径 64px，2s/圈。 */
  selection: Object.freeze({ ringDiameterPx: 64, ringPeriodMs: 2000, dashCount: 12, dashFillRatio: 0.55 }),
  /** 点击态：白圈涟漪 200ms 扩散淡出 + squash 一下。 */
  click: Object.freeze({ rippleMs: 200, squashScaleY: 0.9, rippleFromPx: 6, rippleToPx: 34 }),
});

/**
 * 点击与指令特效的度量（DEMO-PLAN §4「点击与指令特效」）。
 *
 * why 也落在唯一事实源：框选 / 指令 / 翻卡 / 插旗 / 集火的**时长与尺寸**是规格数字
 *   （「800ms 后淡出」「每 40ms 一个」「旗杆升起 0.5s」），战场侧
 *   （world/objects/selection-box.ts、objects/task-fx*.ts）与 dev 逐项验收页都从这里取，
 *   免得两处各抄一份再各改各的。色值不在这里 —— 色值只有 VISUAL_PALETTE 一处。
 */
export const INTERACTION_FX_METRICS = Object.freeze({
  /** 框选：青色半透明填充 + 2px 霓虹边框 + 四角亮块；松手边框收缩闪烁一次后消失。 */
  selectionBox: Object.freeze({
    /** 填充透明度（青色半透明）。 */
    fillAlpha: 0.16,
    /** 霓虹边框粗细（px）。 */
    strokeWidthPx: 2,
    /** 四角亮块边长（px）。 */
    cornerSizePx: 9,
    /** 四角亮块透明度。 */
    cornerAlpha: 0.95,
    /** 松手收缩到的比例（1 = 不收缩）。 */
    releaseShrinkRatio: 0.86,
    /** 收缩（期间边框霓虹闪一下）时长（ms）。 */
    releaseFlashMs: 90,
    /** 收缩后淡出时长（ms）。 */
    releaseFadeMs: 160,
  }),
  /** 命中单位波浪式弹选择环：每 40ms 一个（DEMO-PLAN §4）。 */
  selectionWave: Object.freeze({
    /** 相邻两个单位弹环的间隔（ms）。 */
    intervalMs: 40,
    /** 单次弹环动画时长（ms）。 */
    ringDurationMs: 280,
    /** 环的起始半径倍率（相对选中环半径）。 */
    ringFromScale: 0.45,
    /** 环的终止半径倍率。 */
    ringToScale: 1.35,
  }),
  /** 下达指令：流动虚线（青→目标色渐变）+ 目标双重涟漪。 */
  command: Object.freeze({
    /** 流线总时长（ms；规格钦定 800ms 后淡出）。 */
    flowDurationMs: 800,
    /** 淡出段时长（ms；总时长尾部才开始淡）。 */
    flowFadeMs: 200,
    /** 虚线段长（世界坐标 px）。 */
    dashLengthPx: 10,
    /** 虚线段间隔（世界坐标 px）。 */
    dashGapPx: 8,
    /** 虚线流动速度（px/s）。 */
    flowSpeedPxPerSec: 130,
    /** 双重涟漪：两圈先后展开的间隔（ms；规格钦定 300ms）。 */
    rippleGapMs: 300,
    /** 单圈涟漪时长（ms）。 */
    rippleDurationMs: 600,
  }),
  /** 任务认领 3D 翻卡：背面灰 → 正面亮色 + 图标。 */
  cardFlip: Object.freeze({
    /** 翻转时长（ms）。 */
    durationMs: 420,
    /** 翻完停留时长（ms；停留结束淡出）。 */
    holdMs: 900,
  }),
  /** 任务完成插旗：旗杆升起 0.5s + 旗面 Back.Out 弹性展开。 */
  flag: Object.freeze({
    /** 旗杆升起时长（ms；规格钦定 0.5s）。 */
    poleDurationMs: 500,
    /** 旗面弹性展开时长（ms）。 */
    clothDurationMs: 420,
    /** 旗杆高度（世界坐标 px）。 */
    poleHeightPx: 46,
    /** 旗面宽（世界坐标 px）。 */
    clothWidthPx: 26,
    /** 旗面高（世界坐标 px）。 */
    clothHeightPx: 16,
  }),
  /** 集火支援：选中群脚下位移脉冲一次。 */
  focusFire: Object.freeze({
    /** 脉冲时长（ms）。 */
    pulseDurationMs: 320,
    /** 脉冲环起始半径（px）。 */
    pulseFromPx: 8,
    /** 脉冲环终止半径（px）。 */
    pulseToPx: 30,
  }),
});

/**
 * 精灵特效（sprite sheet 动画）的度量（@since v3.3，task_161）。
 *
 * why 也落在唯一事实源：「同时最多 4 个特效实例」是**CPU 硬约束**（一期特效走
 *   Phaser 纹理帧动画，每实例一条动画 + 一个显示对象），战场侧（objects/sprite-fx-layer.ts）
 *   与单测按它断言 —— 抄成两份必然对不上，而"上限是多少"这件事只有一个事实源才靠得住。
 *
 * 数值口径：
 *   - maxConcurrent：并发实例上限（个）—— 超出的最老实例被挤掉（先来的先让位）；
 *   - offscreenMarginPx：离屏判定的留边（世界 px）—— 特效中心超出视口这么多即停并回收；
 *   - depth：渲染深度 —— 压在单位（0）之上、指令流线（2）之上、任务浮标（5）之下。
 */
export const SPRITE_FX_METRICS = Object.freeze({
  /** 同时最多播放的特效实例数（个）—— 一期上限 4（task_161 requirement 5）。 */
  maxConcurrent: 4,
  /** 离屏判定留边（世界 px）—— 特效中心超出视口这么多即停（不再逐帧播放）。 */
  offscreenMarginPx: 96,
  /** 渲染深度（压在单位之上、任务浮标之下）。 */
  depth: 3,
});

/**
 * 摄像机 + 小地图 + 氛围彩蛋的度量（DEMO-PLAN §5 后半：任务 v3.3-06）。
 *
 * why 也落在唯一事实源：缩放区间 / 橡皮筋阻力 / 回弹时长 / 小地图尺寸 / 云的间隔与速度
 *   是**规格数字** —— 战场侧（world/camera、world/objects 的云层与地面层）与 HUD 侧
 *   （小地图组件）必须读同一份，否则「小地图 200×120」与战场里画的框对不上、
 *   「滚轮 0.6-1.6」与实际钳制区间会各说各话。
 * 数值逐条对应 DEMO-PLAN §5 的规格原文（未写明的量按同规格最贴近的一档取值并注明）。
 */
export const CAMERA_METRICS = Object.freeze({
  /** 用户滚轮可达的缩放下限（规格钦定 0.6x）。 */
  zoomMin: 0.6,
  /** 用户滚轮可达的缩放上限（规格钦定 1.6x）。 */
  zoomMax: 1.6,
  /** 滚轮一格的倍率（1.12 ≈ 每格 +12%）。 */
  zoomStep: 1.12,
  /**
   * 橡皮筋阻力：越界位移按此比例外显（0.28 = 拉出 100px，相机只多走 28px）。
   * why 不是 1：全量外显等于「能拖出世界外」，边界感就没了。
   */
  rubberBandResistance: 0.28,
  /** 橡皮筋外显位移的上限（世界 px）—— 拉得再远，相机最多也只越界这么多。 */
  rubberBandMaxPx: 120,
  /** 松手回弹时长（ms）—— 越界位移归零的弹性回收时间。 */
  rubberBandReturnMs: 260,
  /** 双击判定窗口（ms）：两次点击间隔在此之内算双击（双击单位 = 跟随镜头）。 */
  doubleClickWindowMs: 320,
  /** 双击判定允许的两次点击位移（屏幕 px）—— 手抖不算双击。 */
  doubleClickSlopPx: 8,
  /** 全景 / 跟随镜头的移动时长（ms）= 通用摄像机移动口径（ease Cubic.easeInOut）。 */
  moveDurationMs: VISUAL_METRICS.camera.durationMs,
});

/**
 * 小地图的度量（DEMO-PLAN §5「小地图（06）」）。
 *
 * why 尺寸也进唯一事实源：小地图画在 HUD 侧（DOM canvas），战场侧的「当前视野白框」
 *   若按另一份尺寸算，框与图就对不上 —— 两侧读同一份数字。
 */
export const MINIMAP_METRICS = Object.freeze({
  /** 小地图画布宽（px；规格钦定 200）。 */
  widthPx: 200,
  /** 小地图画布高（px；规格钦定 120）。 */
  heightPx: 120,
  /** 单位光点半径（画布 px）。 */
  dotRadiusPx: 3,
  /** 点命中半径（画布 px）—— 比点本身大一圈，缩略图上按像素级命中的体验不可用。 */
  hitRadiusPx: 8,
  /** 视野白框的描边粗细（画布 px）。 */
  viewportStrokeWidthPx: 1.5,
  /** 视野白框的填充透明度。 */
  viewportFillAlpha: 0.12,
  /** 小地图外框描边粗细（画布 px）。 */
  frameStrokeWidthPx: 2,
  /** 外框与视野框的留边（画布 px）。 */
  frameInsetPx: 1,
  /** 岛屿轮廓的填充透明度。 */
  islandFillAlpha: 0.07,
  /** 岛屿轮廓的描边透明度。 */
  islandStrokeAlpha: 0.9,
  /** 「MAP」角标的字号（画布 px）。 */
  badgeFontPx: 11,
  /** 「MAP」角标的文案（规格钦定的英文角标）。 */
  badgeText: 'MAP',
  /**
   * 小地图贴视口右 / 下边的留边（px）—— 与事件轨（left:16px）同一口径（@since v3.4，task_093）。
   * why 提为常量：Z3 与 Z4 的「≥40px 间距」是**两条边同时成立**的规则，留边一旦各写各的
   *   （事件轨 16 / 小地图 12），间距推导就对不上唯一事实源 —— 版面计算要能算出来。
   */
  cornerMarginPx: 16,
  /** 小地图标题栏（「小地图」标签）的高度（px）—— @since v3.5（task_098）折叠按钮已摘，只剩标签。 */
  headHeightPx: 20,
  /** 外框描边宽度（px）—— 外框总宽 = 画布宽 + 2 × 此值。 */
  frameBorderPx: 1,
  /** hover 提升亮度的倍数（>1 = 变亮）—— Z3 规格「hover 提升亮度」（@since v3.4，task_093）。 */
  hoverBrightness: 1.12,
  // 注（@since v3.9，task_147）：hover 提亮的**过渡时长**已收编进动效 token
  //   （--srf-motion-hover = fast 档）—— 时长只有一个事实源（core/theme/motion-spec.ts），
  //   本块不再自带第二份时长常量。
});

/**
 * 控制岛（Z4）的度量（@since v3.4，task_090；docs/hud-redesign-proposal.html §2.5 分区规格表 Z4 行）。
 *
 * why 落在唯一事实源：Z4 的四个数字（宽 56% 屏宽 / 高上限 100px / 与左右下角件 ≥40px 间距 /
 *   一行 6 条）是**验收数字** —— HUD 侧按它写样式，碰撞脚本与单测按它断言；
 *   抄成两份必然对不上（与顶栏 TOPBAR_METRICS 同一纪律）。
 *
 * why 单侧留边由「角件」算出来而不是写死：控制岛贴底居中，左右下角各有一个常驻件
 *   （左：事件轨 MARQUEE_METRICS.maxWidthPx；右：小地图 MINIMAP_METRICS.widthPx）。
 *   岛宽一旦超过「屏宽 − 两侧留边」，岛就会压到角件上 —— 这正是 §1.9 实测的两处碰撞。
 */
export const CONTROL_ISLAND_METRICS = Object.freeze({
  /** 控制岛宽度占屏宽的比例（0.56 = 56% 屏宽）—— Z4 规格「宽 56% 屏宽」。 */
  widthRatio: 0.56,
  /** 控制岛高度上限（px）—— 硬验收「高度 ≤100px」。实际高度按内容自适应。 */
  maxHeightPx: 100,
  /** 设计目标高度（px）—— proposal §2.5 的「≈92px」；只作参照，实际高度由内容决定。 */
  targetHeightPx: 92,
  /** 与左右下角件（事件轨 / 小地图）的最小水平间距（px）—— 硬验收「≥40px」。 */
  cornerClearancePx: 40,
  /** 一行里同时可见的命令条数（个）—— Z4 规格「1 行 6 条」；其余命令横向滚动收纳。 */
  visibleCommandCount: 6,
  /** 角件贴边留边（px）—— 事件轨 left:16px / 小地图 right:16px（两个组件 shadow CSS 的同一口径）。 */
  cornerMarginPx: 16,
  /**
   * 右下角件（小地图）从视口底边起占的总高（px）—— 右竖栏的下边界要按它让开。
   * 拆解：画布 120（MINIMAP_METRICS.heightPx）+ 标题栏 20 + 外框描边 2 + 贴边留边 16 = 158。
   * why 跟着 MINIMAP_METRICS 走：小地图的留边 / 标题栏高度变了，右竖栏的下边界必须跟着变 ——
   *   写死 154 就会在小地图变高时让右竖栏压上去。
   */
  cornerStackHeightPx:
    MINIMAP_METRICS.heightPx +
    MINIMAP_METRICS.headHeightPx +
    MINIMAP_METRICS.frameBorderPx * 2 +
    MINIMAP_METRICS.cornerMarginPx,
});

/**
 * 控制岛单侧的最小留边（px）= 角件留边 + 角件宽 + 最小间距。
 *
 * why 取两个角件里更宽的那个（事件轨 260 > 小地图 200）：控制岛是**居中**的，
 *   两侧留边必须同时成立才不撞 —— 约束方永远是更宽的那一侧。
 */
export const CONTROL_ISLAND_SIDE_INSET_PX =
  CONTROL_ISLAND_METRICS.cornerMarginPx +
  MARQUEE_METRICS.maxWidthPx +
  CONTROL_ISLAND_METRICS.cornerClearancePx;

/**
 * 氛围彩蛋的度量（DEMO-PLAN §5「氛围彩蛋（06）」）。
 *
 * why 落在唯一事实源：云的间隔 / 速度 / 尺寸与「几点算入夜」都是规格数字，
 *   战场侧（云层 + 地面层）读同一份，单测也能按同一份数字断言。
 */
export const AMBIENCE_METRICS = Object.freeze({
  /** 小云：两次出现之间的间隔区间（ms；规格钦定每 30-60s 一朵）。 */
  cloudIntervalMs: Object.freeze({ min: 30_000, max: 60_000 }),
  /** 小云的宽 / 高（世界 px）—— 一朵「小」云。 */
  cloudSizePx: Object.freeze({ width: 140, height: 42 }),
  /** 小云的漂移速度（世界 px/s）—— 慢速（跨过全场约一分钟）。 */
  cloudSpeedPxPerSec: 55,
  /** 小云的透明度（微乎即可，别抢戏）。 */
  cloudAlpha: 0.16,
  /** 小云出现的纵向位置区间（占战场高度的比例）—— 贴着地图上/下边缘漂。 */
  cloudBandRatio: Object.freeze({ top: 0.18, bottom: 0.78 }),
  /** 入夜时段（真实本地时间，小时）—— 19 点到 24 点背景网格微微变暖。 */
  warmHours: Object.freeze({ start: 19, end: 24 }),
  /** 变暖程度：格网色向暖色混合的比例（「微微」= 小比例）。 */
  warmMix: 0.28,
});

/**
 * 导演模式的度量（DEMO-PLAN §7「导演模式」）。
 *
 * why 也落在唯一事实源：停留时长 / 聚焦倍率 / 静默阈值 / 巡视速度 是**两侧共用的规格数字** ——
 *   HUD 侧（顶栏「🎬 导演」开关）与战场侧（world/camera 的导演控制器）必须读同一份，
 *   否则「HUD 说开了、战场没动」这类漂移没人拦得住。
 * 数值逐条对应 DEMO-PLAN §7 的规格原文（未写明的量按同规格最贴近的一档取值并注明）。
 *
 * @since v3.3（task_086）报错红光晕的呼吸参数**迁出**本块 → SCREEN_FX_METRICS：
 *   红光晕已从战场可缩放层迁到 HUD 屏幕空间（task_086），它不再是「战场侧导演控制器」
 *   的参数，而是「屏幕空间特效」参数 —— 留在本块会让两侧各读一半、漂移无人拦。
 */
export const DIRECTOR_METRICS = Object.freeze({
  /** 缓动到事件点的时长（ms；规格钦定 600ms，与通用摄像机口径同值）。 */
  moveDurationMs: VISUAL_METRICS.camera.durationMs,
  /** 到达事件点后的停留时长（ms；规格钦定 3s）。 */
  holdMs: 3000,
  /** 聚焦事件点时的缩放倍率（规格钦定 1.2x）。 */
  focusZoom: 1.2,
  /** 事件静默超过该时长（ms；规格钦定 8s）开始缓慢巡视。 */
  silenceMs: 8000,
  /** 巡视漂移速度（世界 px/s）—— 慢到「像没动」，但画面确实在走。 */
  patrolSpeedPxPerSec: 26,
  /** 巡视漂移的纵向摆幅（世界 px）—— 缓慢正弦摆动，避免纯横移太机械。 */
  patrolAmplitudePx: 90,
  /** 巡视时的缩放倍率（比聚焦小：巡视是「看全图」，聚焦是「看细节」）。 */
  patrolZoom: 0.9,
});

/**
 * 屏幕空间特效的度量（@since v3.3，task_086）。
 *
 * why 单独成块：这两个特效（横向扫描光带 / 报错红光晕）**不再画在战场可缩放层**，
 *   而是画在 HUD 的屏幕空间 —— 缩放 / 平移镜头时它们必须**纹丝不动**（观众盯的是画面，
 *   不是地图上某个坐标）。留在 world 侧当「导演/地面参数」会让人以为它们跟着镜头跑。
 * 数值逐条对应 DEMO-PLAN §5（扫描光带）与 §7（报错红光）的规格原文，
 *   偏离处均在注释里写明原因（迁层时按用户验收意见降级）。
 */
export const SCREEN_FX_METRICS = Object.freeze({
  /** 扫描光带：周期（ms）= 每 12s 扫过一次（规格钦定 12s）。 */
  scanBandPeriodMs: 12_000,
  /** 扫描光带：宽度（屏幕 px；规格钦定 120px）。 */
  scanBandWidthPx: 120,
  /**
   * 扫描光带：峰值透明度（白）—— 规格原值是 8% 透明白（world 侧同款），
   * 迁到屏幕空间后按验收意见**再弱一半**：它此刻是「压在画面上的背景感」，
   * 8% 在全屏尺度上会盖住单位与区域点亮。
   */
  scanBandAlpha: 0.04,
  /** 报错红光晕：呼吸次数（规格钦定 2 次）。 */
  errorGlowPulses: 2,
  /** 报错红光晕：一次呼吸（亮起 + 熄灭）的时长（ms）。 */
  errorGlowPulseMs: 650,
  /**
   * 报错红光晕：屏幕边缘的峰值透明度 —— 原硬边框渐晕（0.55）的一半。
   * why 降级：红框的语义是「导演注意到 agent 卡住」，不该抢过画面主体。
   */
  errorGlowAlpha: 0.28,
  /** 报错红光晕：中心透明区的半径（占屏幕短边的比例）—— 越靠边越浓。 */
  errorGlowInnerRatio: 0.45,
});

/**
 * 当日回放的度量（DEMO-PLAN §9「当日回放」）。
 *
 * why 也落在唯一事实源：时间轴的桶数 / 60 秒模式的压缩区间 / 气泡减半的节流比 /
 *   角标字号是**两侧共用的规格数字** —— HUD 侧（底部 scrubber 组件、角标）与战场侧
 *   （回放化身层）必须读同一份，否则「HUD 说 60 秒、战场演了 90 秒」这类漂移没人拦得住。
 * 数值逐条对应 DEMO-PLAN §9 的规格原文（未写明的量按同规格最贴近的一档取值并注明）。
 */
export const REPLAY_METRICS = Object.freeze({
  /** 时间轴热力条把「有事件的时段」切成几桶（单位密度按桶统计）。 */
  heatBuckets: 96,
  /** 底部 scrubber 条的高度（px）。 */
  stripHeightPx: 56,
  /** 「▶ 60 秒看完今天」的目标时长（ms）。 */
  sixtySecondTargetMs: 60_000,
  /** 60 秒模式里相邻事件的间隔下限 / 上限（ms）—— 规格钦定 0.5-2s/事件。 */
  minEventGapMs: 500,
  maxEventGapMs: 2000,
  /** 回放气泡的节流：每 N 个可冒泡事件冒一次（N=2 = 频率减半）。 */
  bubbleEveryN: 2,
  /** 左上角大号时间戳角标的字号（px）。 */
  clockFontPx: 44,
  /** 角标距左边界的留边（px）。 */
  clockInsetPx: 24,
  /**
   * 角标顶部与顶栏下缘的垂直间距（px）—— @since v3.4，task_093。
   * why 需要它：角标原为 inset top 24px，而顶栏是 40px 高的固定条 —— 角标直接压在顶栏上。
   *   Z5 规格「左上 inset top 56px」= 顶栏 40 + 间距 16。
   */
  clockTopbarClearancePx: 16,
  /** 回放时间轴最多保留多少条事件（超出丢最旧的 —— 数据不许无限增长）。 */
  maxEntries: 600,
  /** 回放化身的世界槽位网格（列 × 行）—— 角色不在战场上时的落位。 */
  slotGrid: Object.freeze({ columns: 8, rows: 6 }),
});

/**
 * 时间戳角标（Z5）的顶部 inset（px）= 顶栏高度 + 与顶栏的间距（40 + 16 = 56）。
 *
 * why 派生而不是写死 56：顶栏高度是变量（TOPBAR_METRICS.heightPx），顶栏一改，
 *   角标的落点必须跟着挪 —— 否则「角标与顶栏不相交」这条规则会悄悄失效。
 *   Z5 规格：左上 fixed，inset top 56px（docs/hud-redesign-proposal.html §2.5）。
 */
export const REPLAY_CLOCK_TOP_INSET_PX =
  TOPBAR_METRICS.heightPx + REPLAY_METRICS.clockTopbarClearancePx;

/**
 * 演示模式参数（DEMO-PLAN §8）。
 * 字号放大倍率 1.3 = 「字号 +30%」；storageKey 是开关记忆的 localStorage 键。
 */
export const DEMO_MODE = Object.freeze({
  /** localStorage 键名（值 'on' / 'off'）。 */
  storageKey: 'stratix.demo-mode',
  /** 字号放大倍率（1.3 = +30%）。 */
  fontScale: 1.3,
});

/**
 * 演示声音包的键（DEMO-PLAN §10「四音 + 里程碑」）。
 *   select —— 选中 ack（短哔）；command —— 派活（哒）；complete —— 完成（上行双音）；
 *   error —— 报错（低鸣）；milestone —— 里程碑（完成音 + 上行琶音）。
 * why 与 SoundCue（战场的 cue 词表）分开：SoundCue 是**战场动作**的闭集，
 *   这里是**声音**的闭集 —— 一个 cue 可以映射到同一声音（如 command / claim / focus 都是「哒」）。
 */
export type SoundId = 'select' | 'command' | 'complete' | 'error' | 'milestone';

/**
 * 单音符的合成参数（WebAudio 振荡器 + 包络 —— 零音频文件）。
 * 频率 / 时长 / 波形逐条对应 DEMO-PLAN §10 的规格原文。
 */
export interface SoundNoteSpec {
  /** 基频（Hz）。 */
  readonly frequency: number;
  /** 音长（ms）：从起播到收零。 */
  readonly durationMs: number;
  /** 相对响度（0-1）：播放时再乘全局音量（0-1）。 */
  readonly gain: number;
  /** 组内延迟（ms）：音组内串行排布靠它，不靠相邻音长凑。 */
  readonly delayMs?: number;
  /** 波形：正弦（柔和）/ 方波（硬、短促）/ 三角（介于两者）。 */
  readonly waveform?: 'sine' | 'square' | 'triangle';
  /** 起音时长（ms）：0 → peak 的线性爬升；缺省取 SOUND_METRICS.attackMs。 */
  readonly attackMs?: number;
  /**
   * 峰值保持比例（0-1）：0 = 起音后立刻线性衰减（短促的「叮」）；
   * >0 = 保持峰值到该比例处再收（低鸣的「嗡」）。
   */
  readonly holdRatio?: number;
  /** 失谐（音分 cents）：>0 时叠一个偏移后的振荡器，制造「低鸣」的拍频。 */
  readonly detuneCents?: number;
}

/**
 * 声音包的度量（DEMO-PLAN §10）。
 *
 * why 也落在唯一事实源：频率 / 时长 / 波形是**规格数字** —— HUD 侧的声音引擎
 *   （src/hud/sound-engine.ts）按本表合成，单测也按本表断言 —— 免得引擎里再抄一份
 *   「880Hz / 80ms」然后两处各改各的。音量刻度（0-100）与节流窗口同理。
 */
export const SOUND_METRICS: Readonly<{
  readonly volumeMax: number;
  readonly defaultVolume: number;
  readonly throttleMs: number;
  readonly attackMs: number;
  readonly milestoneEvery: number;
  readonly duplicateSuppressMs: number;
  readonly sounds: Readonly<Record<SoundId, readonly SoundNoteSpec[]>>;
}> = Object.freeze({
  /** 音量刻度上限（HUD 滑条 0-100；播放时换算成 0-1 乘到峰值上）。 */
  volumeMax: 100,
  /** 缺省音量（0-100）：无记忆值 / 值非法时回落。 */
  defaultVolume: 70,
  /** 同一声音的最小间隔（ms）：成串事件不机关枪（不同声音互不影响）。 */
  throttleMs: 800,
  /** 包络起音（ms）：太短有咔哒声，太长音头发闷。 */
  attackMs: 6,
  /** 里程碑间隔（每完成 N 个触发一次）—— 与 HUD 里程碑大字同一口径（MARQUEE_METRICS）。 */
  milestoneEvery: MARQUEE_METRICS.milestoneEvery,
  /** 同一动作两条通道的重复抑制窗口（ms）：完成音只响一声。 */
  duplicateSuppressMs: 600,
  /** 五音的合成参数表（键 = SoundId）。 */
  sounds: Object.freeze({
    /**
     * 选中 ack：880Hz 短哔 80ms（规格原文「880Hz 哔 80ms」）。
     */
    select: Object.freeze([
      Object.freeze({ frequency: 880, durationMs: 80, gain: 0.4, waveform: 'sine' as const }),
    ]),
    /**
     * 派活：240Hz 方波 60ms（规格原文「哒，240Hz 60ms 方波」）——
     *   方波偏硬，响度压低一档，免得抢过后续的完成音。
     */
    command: Object.freeze([
      Object.freeze({ frequency: 240, durationMs: 60, gain: 0.26, waveform: 'square' as const }),
    ]),
    /**
     * 完成：C5 → E5 上行双音各 120ms（规格原文）。
     */
    complete: Object.freeze([
      Object.freeze({ frequency: 523.25, durationMs: 120, gain: 0.38, waveform: 'sine' as const }),
      Object.freeze({
        frequency: 659.25,
        durationMs: 120,
        gain: 0.38,
        waveform: 'sine' as const,
        delayMs: 120,
      }),
    ]),
    /**
     * 报错：180Hz 低鸣 300ms + 轻微失谐（规格原文「180Hz 低鸣 300ms + 轻微失谐」）——
     *   失谐 25 音分 ≈ 182.6Hz，与 180Hz 拍出约 0.4s 一次的「呜」，就是「低鸣」的手感。
     */
    error: Object.freeze([
      Object.freeze({
        frequency: 180,
        durationMs: 300,
        gain: 0.42,
        waveform: 'sine' as const,
        attackMs: 30,
        holdRatio: 0.6,
        detuneCents: 25,
      }),
    ]),
    /**
     * 里程碑：完成音 + 上行琶音（三音）（规格原文「里程碑：完成音 + 上行琶音（三音）」）——
     *   前两音是完成音本体，后三音是 C5 → E5 → G5 的上行琶音（尾音长半拍收稳）。
     */
    milestone: Object.freeze([
      Object.freeze({ frequency: 523.25, durationMs: 120, gain: 0.38, waveform: 'sine' as const }),
      Object.freeze({
        frequency: 659.25,
        durationMs: 120,
        gain: 0.38,
        waveform: 'sine' as const,
        delayMs: 120,
      }),
      Object.freeze({
        frequency: 523.25,
        durationMs: 90,
        gain: 0.3,
        waveform: 'sine' as const,
        delayMs: 320,
      }),
      Object.freeze({
        frequency: 659.25,
        durationMs: 90,
        gain: 0.3,
        waveform: 'sine' as const,
        delayMs: 410,
      }),
      Object.freeze({
        frequency: 783.99,
        durationMs: 170,
        gain: 0.32,
        waveform: 'sine' as const,
        delayMs: 500,
      }),
    ]),
  }),
});
