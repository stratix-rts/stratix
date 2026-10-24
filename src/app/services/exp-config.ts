/**
 * 文件职责：**经验事件的权重配置**（task_039）—— `exp.gained` 事件的 amount 换算表。
 *   core 契约（types.ts 的 ExpSource）只声明「经验从哪来」，**不定义数值**；本文件是发射点的
 *   **缺省实现**：task-service / chat-service 经注入的 `expWeight(source) => amount` 函数取数，
 *   缺省回落到本表的临时常量。
 * 输入：ExpSource（core 词表）。
 * 输出：DEFAULT_EXP_WEIGHTS（常量表）+ defaultExpWeight（发射点缺省权重函数）。
 * 禁止事项：
 *   1. 在这里做等级曲线 / 衰减 / 加成 —— 那是 progression 的领域逻辑，本文件只是拍脑袋的
 *      临时占位数值，不许长出语义；
 *   2. 引入新依赖 —— 一张常量表 + 一个查表函数，仅此而已；
 *   3. 在这里认识发射点 —— 权重是被注入的，谁发、何时发归 task-service / chat-service。
 *
 * ============ 与 task_040（progression 模块）的交接 ============
 * task_040 落地 progression 模块（等级曲线 / 经验数值表）时：
 *   - 本表由模块内的正式数值接管 —— 删除本文件或让组合根改注入 progression 的权重实现，
 *     两个发射点（task-service.ts / chat-service.ts，文件头已注明本交接）**零改动**
 *     （它们只依赖注入的函数形状，不依赖本文件）；
 *   - 事件契约（exp.gained 的 source 词表 / amount > 0）不变，消费者无感切换。
 *
 * @since v3.18（task_039）。
 */

import type { ExpSource } from '../../core/types';

/** 缺省权重表（task_039 拍板的临时数值）：完成 50 / 失败安慰 10 / 对话轮 5。 */
export interface ExpWeightTable {
  /** 任务完成（transport 跑完 done 收尾）。 */
  readonly task_completed: number;
  /** 任务失败（守门拦截 / transport 报错 / 防御性收尾 —— 失败亦有经验）。 */
  readonly task_failed: number;
  /** 一轮成功对话（done 收束；error / 守门拒绝 / 中断轮不计）。 */
  readonly chat_round: number;
}

/** 缺省权重（发射点未注入时的回落值；040 接管后由 progression 模块替换）。 */
export const DEFAULT_EXP_WEIGHTS: ExpWeightTable = {
  task_completed: 50,
  task_failed: 10,
  chat_round: 5,
};

/** 发射点的缺省权重函数：查表；权重 ≤ 0 的来源发射点直接不发事件（见各服务实现）。 */
export function defaultExpWeight(source: ExpSource): number {
  return DEFAULT_EXP_WEIGHTS[source];
}
