/**
 * 文件职责：**单位表现的生命感纯逻辑**（task_062）—— 呼吸微动画 / 名字标签 / 说话气泡
 *   的全部可计算规则，零 Phaser、零 DOM（渲染在 unit-layer.ts 的统一 tick 里兑现）。
 *   与 task-fx.ts（任务浮标）同一分层纪律：纯逻辑住这里（node 单测直接跑），
 *   画出来是 objects/unit-layer.ts 的事。
 * 输入：单位 id / online 位 / 相机 zoom / localStorage 快照（注入，不在 import 期碰 DOM）。
 * 输出：呼吸相位与缩放、名字标签可见性裁决、说话气泡脉动 alpha、开关读取。
 * 禁止事项：
 *   1. import phaser —— 本文件只算数字与布尔（铁律：unit-object 系零 Phaser，表现逻辑同守）；
 *   2. import hud / app / vue —— 铁律：world 只认识 core/types 与 core/bus；
 *   3. 在 import 期读 localStorage / Date.now —— 环境探测只在调用时做（jsdom / node 可注入桩）；
 *   4. 持有第二份单位真相 —— 输入参数化，相位由单位 id 派生（无状态、可重现）。
 *
 * ============ 呼吸微动画（task_062 规格①）============
 * 全场**一个** tick 驱动（unit-layer 的 presence tick，约 60ms/步），非每单位独立 tween：
 * scaleY = base × (1 ± amplitude × sin(2π·t/period + phase))，幅度 2%（0.98↔1.02 相对值）。
 *   - 相位按单位 id 哈希派生（确定性、无随机种子态）：同 id 永远同相位，相位天然错开，
 *     50 个单位不会整齐划一地「同步呼吸」；
 *   - 与移动 tween / 忙碌 fx 天然叠加不冲突：呼吸只写 sprite.scaleY，moveTo tween 只写
 *     container.x/y，task-fx 是独立 Container —— 属性面不相交（设计即保证，测试固化谓词）；
 *   - 离线（online === false）呼吸停止：shouldBreathe 为 false，渲染层把 scale 复位回基值
 *     （静止 + 灰显 = 更「死」）。
 *
 * ============ 名字标签（task_062 规格②）============
 * 可见性 = 全局开关（localStorage 'stratix.unit.nametags'，键常量冻结在 core/types）AND
 *   zoom ≥ OVERLAY_MIN_ZOOM（拉太远自动隐藏，防小地图级缩放下糊成一片）。
 * 开关缺省开（'0' 才是关）；读取异常（隐私模式 / 无 storage）回落开 —— 表现开关不绑架可用性。
 *
 * ============ 说话气泡（task_062 规格③）============
 * unit.speaking 事件（app 层 chat-service 发，bridge 转发）→ 头顶「···」三点脉动；
 * 只表达「正在说话」语义（规格钦点最简方案，不截流式文本）。脉动 = alpha 在
 * [SPEAKING_ALPHA_MIN, 1] 之间正弦往返，由 presence tick 用场景时钟推进。
 *
 * ============ 层级协调（z 排序，task_062 规格②附注）============
 * 名字 / Lv / 气泡 Text 全部**内嵌**在单位 Container 里（随移动 tween、离线灰显 alpha、
 *   对账生命周期一起走，不另立节点池）；与头顶浮标的层序由全局 depth 决定：
 *   单位 Container depth 0 < 涟漪 4 < 任务浮标 5（task-fx-layer 先例）—— 浮标永远压在
 *   名字之上，本地层内次序 = 添加序（body → ring → 精灵 → 名字 → Lv → 气泡）。
 *
 * @since v3.37（task_062）。
 */

import { STRATIX_NAMETAGS_TOGGLE_KEY } from '../../core/types';
import { VISUAL_PALETTE, hexToRgba } from '../theme';

// ============================================================================
// 呼吸微动画
// ============================================================================

/** 呼吸参数（全部可调项集中一处，同 TASK_FX_STYLE 先例）。 */
export const BREATH_STYLE = {
  /** 幅度：scaleY 相对摆幅 ±2%（规格原文 0.98↔1.02）。 */
  amplitude: 0.02,
  /** 一次呼吸周期（ms）。2.6s 接近静息呼吸节律（12-16 次/分 → 3.75-5s 之间偏快段，战场略催）。 */
  periodMs: 2600,
  /** presence tick 步进间隔（ms）。60ms ≈ 16fps：慢正弦肉眼平滑，50 单位成本仍可忽略。 */
  tickMs: 60,
} as const;

/**
 * 呼吸相位（弧度）：按单位 id 哈希确定性派生，落在 [0, 2π)。
 * why 哈希而不是 Math.random()：无状态可重现（节点重建不换相位、单测可穷举），
 * 且 50 个不同 id 的相位天然散开（同步呼吸才是要防的）。
 */
export function breathPhaseFor(unitId: string): number {
  // FNV-1a 32 位 + murmur 式末置雪崩混合：实现小、无依赖（禁止引入新依赖是任务红线）。
  // why 要末置混合：裸 FNV 对「同前缀短后缀」的 id 族（unit_ch_0..49 这种真实形态）
  // 分布塌缩在窄区间里（实测全部落在 [0.27,0.40] —— 50 个单位近似同步呼吸）；
  // 雪崩后整体均匀，相邻 id 的相位也散开。
  let hash = 0x811c9dc5;
  for (let i = 0; i < unitId.length; i += 1) {
    hash ^= unitId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0x1_0000_0000 * 2 * Math.PI;
}

/**
 * 某一时刻的呼吸 scaleY：base × (1 + amplitude × sin(2π·t/period + phase))，双端钳制。
 * 钳制对 sin 本是冗余，但对浮点误差与外部传参（periodMs ≤ 0 → NaN）是硬保险：
 * 返回值恒落在 [base × (1 - amplitude), base × (1 + amplitude)]，渲染层无需再判。
 */
export function breathScaleY(
  baseScale: number,
  phase: number,
  elapsedMs: number,
  periodMs: number = BREATH_STYLE.periodMs
): number {
  if (!(periodMs > 0)) return baseScale; // 非法周期 → 静止（不产生 NaN 尺度）
  const min = baseScale * (1 - BREATH_STYLE.amplitude);
  const max = baseScale * (1 + BREATH_STYLE.amplitude);
  const wave = Math.sin((2 * Math.PI * elapsedMs) / periodMs + phase);
  return Math.min(max, Math.max(min, baseScale * (1 + BREATH_STYLE.amplitude * wave)));
}

/**
 * 呼吸裁决（tick 矩阵的唯一谓词）：在线 && 有精灵才呼吸。
 * - 离线（online=false，task_054）→ 停止呼吸（静止灰显更「死」，task_062 规格①）；
 * - 占位圆单位（无 LPC 精灵）→ 不呼吸（圆形 scaleY 摆动像果冻，观感劣于静止）；
 * - 移动中 / 忙碌 fx 中 → **照常呼吸**（谓词不收移动态：呼吸写 scaleY、移动写容器
 *   坐标，属性面不相交，叠加不冲突 —— 设计即保证，测试固化签名不含移动参数）。
 */
export function shouldBreathe(online: boolean, hasSprite: boolean): boolean {
  return online && hasSprite;
}

// ============================================================================
// 头顶覆盖物（名字 / Lv / 说话气泡）的可见性与样式
// ============================================================================

/**
 * 头顶覆盖物的 zoom 下限：低于它（拉远到小地图级）名字与气泡都自动隐藏 ——
 * 防止几十个文字标签在低缩放下糊成一片（规格②）。相机 zoom 域 [0.25, 3]
 * （camera-math 的 DEFAULT_ZOOM_LIMITS），0.6 ≈ 拉远一半处开始隐藏。
 */
export const OVERLAY_MIN_ZOOM = 0.6;

/** 覆盖物可读性裁决（名字与气泡共用：太远谁都不该画）。 */
export function overlayVisible(zoom: number): boolean {
  return zoom >= OVERLAY_MIN_ZOOM;
}

/**
 * 名字标签可见性：全局开关（设置屏「单位名字」行，localStorage 直写）AND zoom 达标。
 * 开关语义见 STRATIX_NAMETAGS_TOGGLE_KEY 注释：'0' = 关，缺省 / 其它 = 开。
 */
export function nametagVisible(enabled: boolean, zoom: number): boolean {
  return enabled && overlayVisible(zoom);
}

/** 名字标签可读的最小 storage 面（getItem 足够，不要求完整 Storage 接口 —— 便于打桩）。 */
export interface NametagStorage {
  getItem(key: string): string | null;
}

/**
 * 读名字标签全局开关：值 '0' = 关；无键 / 其它值 / 无 storage / 读取抛错 → 开。
 * why 默认开：表现增强项不绑架可用性（同 sfx-service 的 readSfxEnabled 口径）。
 */
export function readNametagsToggle(storage: NametagStorage | null | undefined): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(STRATIX_NAMETAGS_TOGGLE_KEY) !== '0';
  } catch {
    return true;
  }
}

/**
 * 名字标签样式：name 主色 / Lv 小字沿用 hud 文本 token 口径（#e6e9ef / #9aa3b2 —— 属文字层，
 *   不在场景调色板七色之内，故不并入唯一事实源）；描边 = 调色板背景色（压住任意底色可读，
 *   同浮标底衬色）。@since v3.3（task_110）：描边色改从唯一事实源取。
 */
export const NAMETAG_STYLE = {
  fontFamily: 'monospace',
  nameFontSize: 12,
  lvFontSize: 10,
  nameColor: '#e6e9ef',
  lvColor: '#9aa3b2',
  strokeColor: VISUAL_PALETTE.background,
  strokeWidth: 2,
  /** 名字锚点 y（容器本地坐标，负 = 头顶方向；origin (0.5,1) 文字向上长）。 */
  yAboveUnit: -66,
} as const;

/** 说话气泡样式：「···」三点 + 半透明底衬（底衬色 = 调色板背景色 + 0.8 alpha）。 */
export const SPEAKING_BUBBLE_STYLE = {
  text: '···',
  fontFamily: 'monospace',
  fontSize: 12,
  color: '#e6e9ef',
  backgroundColor: hexToRgba(VISUAL_PALETTE.background, 0.8),
  /** 气泡锚点 y（origin (0.5,1)：悬在名字上方，位置恒定不随开关跳变）。 */
  yAboveUnit: -84,
} as const;

/** 脉动周期（ms）：「正在打字」的节奏感，略快于呼吸。 */
export const SPEAKING_PULSE_MS = 900;

/** 脉动 alpha 下限（上限 1）：最低也要 0.35 —— 再暗就看不出「在说话」。 */
export const SPEAKING_ALPHA_MIN = 0.35;

/**
 * 说话气泡某一时刻的 alpha：[SPEAKING_ALPHA_MIN, 1] 之间正弦往返。
 * 双端由三角函数天然保证，钳制兜浮点（与 breathScaleY 同一保险口径）。
 */
export function speakingDotAlpha(elapsedMs: number): number {
  const wave = 0.5 + 0.5 * Math.sin((2 * Math.PI * elapsedMs) / SPEAKING_PULSE_MS);
  const alpha = SPEAKING_ALPHA_MIN + (1 - SPEAKING_ALPHA_MIN) * wave;
  return Math.min(1, Math.max(SPEAKING_ALPHA_MIN, alpha));
}
