/**
 * 文件职责：经验权重表的**转发层**（task_040 起降级）—— 数值真相源已迁至
 *   core/progression/weights.ts（养成数值的单一真相源：等级曲线 / 权重 / 解锁门槛都在那）。
 *   本文件不再定义任何数值，只把旧的两个出口（DEFAULT_EXP_WEIGHTS / defaultExpWeight）
 *   转发到 progression 的 EXP_WEIGHTS / expWeightFor。
 *
 * ============ 为什么选「转发」而不是「退役删除」（task_040 的二选一，选了前者）============
 *   task-service / chat-service 的 expWeight 注入端口缺省回落到本文件的 defaultExpWeight
 *   （task_039 落地时定的形状），task_040 的验收口径是**两个发射点零改动**（交接面在组合根的
 *   注入件上，不在服务内部）—— 直接删本文件会让两处缺省实现失去落点、被迫随本任务改服务。
 *   保留转发：组合根注入 expWeightFor 后，本文件在生产路径上已无消费者；单测里仍作为
 *   「迁移等价」的对拍物（progression-service.test.ts 断言两侧数值恒等）。
 *   退役时机：将来发射点把 expWeight 改为强制注入（删缺省回落）时，本文件连同两个出口一并删除。
 *
 * @since v3.18（task_039）初版（临时常量表）；v3.19（task_040）降级为转发层。
 */

import { EXP_WEIGHTS, expWeightFor } from '../../core/progression';
import type { ExpSource } from '../../core/types';

/** 权重表形状（保持 v3.18 的既有形状，消费方零改动）。 */
export interface ExpWeightTable {
  readonly task_completed: number;
  readonly task_failed: number;
  readonly chat_round: number;
}

/**
 * 缺省权重表 —— 现在只是 progression.EXP_WEIGHTS 的同值投影（不复制数值，直接引用）。
 * 调权重只改 core/progression/weights.ts，这里自动跟随。
 */
export const DEFAULT_EXP_WEIGHTS: ExpWeightTable = EXP_WEIGHTS;

/** 缺省权重函数 —— 转发 progression.expWeightFor。 */
export function defaultExpWeight(source: ExpSource): number {
  return expWeightFor(source);
}
