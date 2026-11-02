/**
 * 文件职责：**视觉常量的唯一事实源** —— 调色板（七色语义色）/ 尺寸 / 时长 / easing / 演示模式参数。
 *   来源：docs/DEMO-PLAN.md §1（调色板与 Design Token）+ §8（演示模式）。
 * 输入：无（纯静态常量；零 IO、零 DOM、零 import）。
 * 输出：VISUAL_PALETTE（色值）/ VISUAL_METRICS（尺寸·时长·easing）/ UNIT_ANIMATION_METRICS（单位动画八态度量）
 *      / DEMO_MODE（演示模式参数）
 *      / PALETTE_CSS_VARS（语义色 → CSS 变量名的映射）/ hexToNumber（色值换算）。
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
});

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
 * why 也落在唯一事实源：停留时长 / 聚焦倍率 / 静默阈值 / 巡视速度 / 红色渐晕的呼吸参数
 *   是**两侧共用的规格数字** —— HUD 侧（顶栏「🎬 导演」开关）与战场侧（world/camera 的
 *   导演控制器、objects 的红色渐晕层）必须读同一份，否则「HUD 说开了、战场没动」
 *   或「渐晕呼吸 2 次、实际闪 3 次」这类漂移没人拦得住。
 * 数值逐条对应 DEMO-PLAN §7 的规格原文（未写明的量按同规格最贴近的一档取值并注明）。
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
  /** 报错红色渐晕的呼吸次数（规格钦定 2 次）。 */
  vignettePulses: 2,
  /** 一次呼吸（亮起 + 熄灭）的时长（ms）。 */
  vignettePulseMs: 650,
  /** 红色渐晕的最高透明度（边缘最浓处）。 */
  vignetteAlpha: 0.55,
  /** 红色渐晕自屏幕边缘向内的厚度（屏幕 px）。 */
  vignetteDepthPx: 120,
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
  /** 角标距左上角的留边（px）。 */
  clockInsetPx: 24,
  /** 回放时间轴最多保留多少条事件（超出丢最旧的 —— 数据不许无限增长）。 */
  maxEntries: 600,
  /** 回放化身的世界槽位网格（列 × 行）—— 角色不在战场上时的落位。 */
  slotGrid: Object.freeze({ columns: 8, rows: 6 }),
});

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
