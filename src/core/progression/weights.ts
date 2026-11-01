/**
 * 文件职责：**经验来源权重表**（task_040）—— 「一次任务/对话值多少经验」的数值真相源。
 *   从 app/services/exp-config.ts 迁来（task_039 的临时占位数值，040 起由本模块接管；
 *   exp-config 降级为转发层，见其文件头）。发射点（task-service / chat-service）经注入的
 *   `expWeight(source) => amount` 函数取数 —— 组合根注入本模块的 expWeightFor，
 *   两个发射点**零改动**（交接面在注入件上，不在服务内部 —— 见两侧服务文件头的交接注记）。
 * 输入：ExpSource（core/types 的来源词表 —— 类型引用，运行时零依赖）。
 * 输出：EXP_WEIGHTS（常量表）+ expWeightFor（查表函数）。
 * 禁止事项：
 *   1. 运行时 import —— ExpSource 是 type-only import（编译期擦除），本文件运行时零依赖；
 *   2. 在这里做等级曲线 —— 那是 curve.ts；解锁门槛 —— 那是 unlocks.ts；
 *   3. 让某个来源的权重为 0 —— 权重 ≤ 0 的语义是「发射点整类不发事件」（见 task-service），
 *      要关某来源改表即可，但缺省三来源都必须 > 0（做过就有收获，是养成口径）。
 *
 * 数值口径（task_039 拍板、040 沿用 —— 迁移等价由单测对拍）：
 *   完成任务 50 / 失败安慰 10 / 一轮成功对话 5。
 *   参照 curve.ts 的曲线量级：L1→2 需 100 = 2 个任务或 20 轮对话；L19→20 需 147790 ≈ 2956 个任务
 *   —— 长线养成，靠任务为主、对话为辅逐步喂满。
 *
 * @since v3.19（task_040；数值表前身是 task_039 的 app/services/exp-config.ts）。
 */

import type { ExpSource } from '../types';

/** 来源 → 经验权重（一次该来源事件发出的 exp.gained 的 amount）。 */
export const EXP_WEIGHTS: Readonly<Record<ExpSource, number>> = {
  /** 任务完成（transport 跑完 done 收尾）。 */
  task_completed: 50,
  /** 任务失败（守门拦截 / transport 报错 / 防御性收尾 —— 失败亦有经验）。 */
  task_failed: 10,
  /** 一轮成功对话（done 收束；error / 守门拒绝 / 中断轮不计）。 */
  chat_round: 5,
};

/** 查表函数（组合根把它注入 task-service / chat-service 的 expWeight 端口）。 */
export function expWeightFor(source: ExpSource): number {
  return EXP_WEIGHTS[source];
}
