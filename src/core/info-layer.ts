/**
 * 文件职责：**信息三层级的纯逻辑**（@since v3.4，task_096）—— 层级词表 / 合法性判定 /
 *   「某层级下各层的视觉口径」三件事的**唯一事实源**（零 IO、零 DOM、零 import 副作用）。
 *   依据：docs/hud-redesign-proposal.html §2.3（信息三层级：L1 常驻 / L2 事件 / L3 沉浸）。
 * 输入：InfoLayer（core/types.ts 的契约类型）或任意未知值（判合法性用）。
 * 输出：INFO_LAYERS（有序词表）/ isInfoLayer / normalizeInfoLayer /
 *      layerL1Opacity / layerL2Opacity / layerL2Collapsed。
 * 禁止事项：
 *   1. import world / hud / phaser / DOM —— 纯逻辑模块，两侧都能引（core 是依赖图底层）；
 *   2. 在本文件里写死 0.18 / 200ms 这类数字 —— 数字的唯一事实源在
 *      core/theme/visual-spec.ts（HUD_LAYER_METRICS），本文件只做「层级 → 口径」的映射；
 *   3. 在本文件里做 DOM 副作用（写样式 / 加 class）—— 那是 HUD 侧 info-layer.ts 的活；
 *   4. 改 WorldState —— 状态写入在 core/store.ts（applyInfoLayer），本文件只读不写。
 *
 * why 单独成文件而不塞进 store.ts：store.ts 只管「写状态」，本模块管「层级语义」，
 *   两件事的消费者不同（store 的消费者是 runtime / hud，语义表的消费者是 hud 的视觉层
 *   与将来的 world 侧 L3 元素）。混在一起会让 store 变成杂物袋。
 */

import { HUD_LAYER_METRICS } from './theme/visual-spec';
import type { InfoLayer } from './types';

/**
 * 层级词表（有序：L1 → L2 → L3）。
 * why 显式列出而不是靠类型推导：HUD 的三档开关要按这个次序渲染按钮，
 *   单测也要按这个次序断言 —— 顺序是契约的一部分。
 */
export const INFO_LAYERS: readonly InfoLayer[] = Object.freeze(['L1', 'L2', 'L3']);

/** 缺省层级（读取方拿不到 infoLayer 时的回落）：L1 常驻 = 无任何特殊状态。 */
export const DEFAULT_INFO_LAYER: InfoLayer = 'L1';

/** 层级合法性判定（运行时用：命令载荷可能来自 JS 调用方，类型系统拦不住）。 */
export function isInfoLayer(value: unknown): value is InfoLayer {
  return value === 'L1' || value === 'L2' || value === 'L3';
}

/**
 * 归一化：非法值一律回落 L1（常驻档）。
 * why 不抛错：层级是**显示密度**，不是业务不变量 —— 收到一个看不懂的值时，
 *   退回「什么都不特殊」的档位比让整条命令失败更稳（命令失败会打断 UI 交互链）。
 */
export function normalizeInfoLayer(value: unknown): InfoLayer {
  return isInfoLayer(value) ? value : DEFAULT_INFO_LAYER;
}

/**
 * 某层级下 L1（常驻件）的对比因子 = 元素不透明度。
 * L1 / L2 档：1（不透明，正常对比）；L3 档：HUD_LAYER_METRICS.l1DimOpacity（0.18）——
 *   L3 激活时 L1 让位（降对比），退出即恢复 1。
 */
export function layerL1Opacity(layer: InfoLayer): number {
  return layer === 'L3' ? HUD_LAYER_METRICS.l1DimOpacity : HUD_LAYER_METRICS.l1Opacity;
}

/** 某层级下 L2（事件件）的对比因子：L3 档为 0（让位），其余档为 1。 */
export function layerL2Opacity(layer: InfoLayer): number {
  return layer === 'L3' ? HUD_LAYER_METRICS.l2DimOpacity : HUD_LAYER_METRICS.l1Opacity;
}

/**
 * 某层级下 L2 是否收起（visibility: hidden —— 视觉上消失、不吃指针事件）。
 * 只有 L3 档收起；L1 / L2 档 L2 正常在屏（事件轨 / toast 是它们的主场）。
 */
export function layerL2Collapsed(layer: InfoLayer): boolean {
  return layer === 'L3';
}
