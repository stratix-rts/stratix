/**
 * 文件职责：**形象预览的端口契约**（hud 侧）—— 向导屏第②步与"会合成 LPC 角色"的那一侧之间的唯一接口。
 *   任务：.long-run-agent/tasks/task_028.md「hud 向导第②步重做 —— canvas 动画预览 + 随机形象 + 部件选择器」。
 * 依赖：无运行时依赖（只 import core 的**类型**）。
 * 输出：AppearanceCategoryInfo / AppearancePreviewPort 两个类型。
 * 禁止事项：
 *   1. import world/、phaser —— **铁律**：hud 不认识 world。
 *      合成器与 Phaser 迷你实例住在 app 层（app/services/appearance-preview-service.ts），
 *      由组合根（app/main/main-entry.ts）注入；屏只管发意图（换部件 / 随机 / 刷新预览）；
 *   2. 在这里写合成逻辑 —— 端口只是"能做什么"的声明，实现全在 app 层；
 *   3. 把素材元数据（LPC 的 item-metadata.json 形状）搬进来 —— 端口只给**渲染用的最小清单**
 *      （类别名 + 可选变体名），屏不认识图层 / z 序 / 动画偏移这些渲染细节。
 *
 * ★ 为什么是"端口"而不是直接调用：
 *   向导屏要能单测（不碰真 canvas），也要能在"没接合成器"的环境里照常跑完向导。
 *   于是屏只依赖这个接口 —— 测试注入桩，正式环境注入真实现。
 */

import type { AppearanceBodyType, CharacterAppearance } from '../../core/types';

/** 一个部位类别的可选变体清单（UI 侧渲染下拉框用）。 */
export interface AppearanceCategoryInfo {
  /** 部位类别 id（body / hair / eyes / ears / facial…）。 */
  readonly category: string;
  /** 类别显示名（中文）。 */
  readonly name: string;
  /** 该类别下可选的变体（变体名 = 素材文件名的一部分，如 'blonde' / 'light'）。 */
  readonly variants: readonly string[];
}

/**
 * 形象预览端口（由 app 层实现，由组合根注入）。
 *
 * 屏对它的全部依赖就这七个动作（@since v3.12，task_032 扩到 7 个）：
 *   1. 问有哪些部位类别与变体（渲染选择器）；
 *   2. 等素材元数据就绪（不阻塞向导 —— 失败也 resolve，降级成空清单）；
 *   3. 取某 agent 种类的**默认形象**（品牌预设；实现方对无预设的种类给规则随机兜底）；
 *   4. 按规则随机抽一套形象（normal 档，itemId 精确格式）——「重随机」按钮；
 *   5. 把预览画布挂到自己的容器；
 *   6. 刷新预览内容（部件变更后调用；实现内部异步合成，屏不等待）；
 *   7. 释放（向导关闭时销毁 Phaser 实例）。
 *
 * ★ @since v3.12（task_032）「每 agent 独立形象」的接口口径：
 *   向导屏给**每个** agent 各存一份形象草稿 —— 初始值来自 preset(kind)（品牌预设，
 *   静态数据、不依赖素材加载），「重随机」来自 randomizeNormal()（task_030 的规则化
 *   随机器 normal 档，产物带 itemId）。「重置为品牌默认」再调一次 preset(kind)。
 *   两个方法都住在端口上而不是屏里直接 import —— 预设与随机器都在 world/appearance，
 *   hud 只认这份注入的接口（总线铁律）。
 */
export interface AppearancePreviewPort {
  /** 可选的体型（任务口径：male / female）。 */
  readonly bodyTypes: readonly AppearanceBodyType[];
  /**
   * 某体型下的部位变体清单。
   * why 按体型问：LPC 素材按体型分目录，某些部位只支持其中一种体型 ——
   * 混着给会让用户选到画不出来的组合。
   */
  listCategories(bodyType: AppearanceBodyType): readonly AppearanceCategoryInfo[];
  /**
   * @since v3.20（task_041，**可选能力**）：全量部位类别清单（含选择器数据源）——
   *   形象**编辑**面板用：解锁门槛按全类别（22 个）展示「Lv.X 解锁」角标，
   *   而向导的 listCategories 只开放五个基础类别（032 口径，保持不变）。
   *   未实现（undefined）时编辑面板退回 listCategories —— 向导屏 / 既有桩不受影响。
   */
  readonly listAllCategories?: (bodyType: AppearanceBodyType) => readonly AppearanceCategoryInfo[];
  /** 素材元数据就绪后 resolve（**失败也 resolve**：降级成空清单，不卡住向导）。 */
  whenReady(): Promise<void>;
  /**
   * 取某 agent 种类的默认形象（@since v3.12，task_032）。
   * 已知 kind → 品牌预设（确定性、静态数据，不依赖素材元数据加载）；
   * 无预设的 kind → 实现方给规则随机兜底（minimal 档一次生成，素材未就绪 → null）。
   * 屏拿到后必须**深拷贝**再存（见 onboarding-catalog.cloneAppearance）——
   * 同一份预设对象会被多个调用点共享引用，屏内草稿必须各自独立。
   */
  preset(kind: string): CharacterAppearance | null;
  /**
   * 规则化随机一套形象（@since v3.12，task_032）：normal 档（task_030 的随机器），
   * parts 每项 = { variant, itemId }（itemId 精确格式）。
   * 素材未就绪（抽不到任何部位）→ null（屏据此提示"素材没加载出来"，不编造长相）。
   */
  randomizeNormal(): CharacterAppearance | null;
  /** 把预览画布挂到宿主容器（同一个容器重复挂 = 无副作用）。 */
  attach(host: HTMLElement): void;
  /** 刷新预览内容（部件变更后调用；实现内部异步合成，屏不等待）。 */
  preview(appearance: CharacterAppearance): void;
  /** 释放资源（销毁 Phaser 实例）。 */
  destroy(): void;
}
