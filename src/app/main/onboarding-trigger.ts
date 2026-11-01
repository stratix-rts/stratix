/**
 * 文件职责：**首启判定** —— 「这次启动要不要弹首启向导」的纯裁决（不含任何 DOM / 总线副作用）。
 *   来源：.long-run-agent/tasks/task_026.md「main-entry.ts 首启判定」。
 * 输入：WorldState 快照（characters + detectedAgents）+ 开发期强制开关。
 * 输出：布尔判定（true = 该挂向导）。
 * 禁止事项：
 *   1. 碰 DOM / core/bus —— 判定是纯函数，挂载由 app/main/onboarding-host.ts 负责；
 *   2. 自己发命令 / 改状态 —— 本模块只回答"要不要"，怎么挂由宿主决定；
 *   3. 另写一套"已装"口径 —— 「已装」只看 DetectedAgent.installed
 *      （它表示"**确认**有二进制"；status 只是这次探测的结论，见 core/types.ts）。
 *
 * ★ 三条口径（写在这里免得后来者重新猜一套）：
 *   - **已装**：DetectedAgent.installed === true（确认找到二进制）；
 *   - **可建档**：只有 core 的 AGENT_KINDS（T1 五家）能作为 character.create 的 agentKind ——
 *     本判定**不**用它：T2/T3 的 agent 探到了也值得让用户看一眼（引导屏会如实标注"仅探测"），
 *     能不能建档由引导屏第二步按词表过滤（见 hud/screens/onboarding-catalog.ts）。
 *   - **强制开关**：开发期每次启动都触发（哪怕已经有角色），用于反复走查引导流程。
 */

import type { CharacterView, DetectedAgent } from '../../core/types';

/** 首启判定的输入（只取判定需要的字段，不吃整份 WorldState）。 */
export interface OnboardingTriggerInput {
  /** 已建档角色（core 广播）。空 = 还没建过档。 */
  readonly characters: readonly CharacterView[];
  /** 本地 CLI agent 检测结果（core 广播）。 */
  readonly detectedAgents: readonly DetectedAgent[];
  /** 开发期强制开关（STRATIX_ONBOARDING_FORCE=1）：每次启动都触发。 */
  readonly force?: boolean;
}

/** 已确认安装的 agent 数量。 */
export function countInstalledAgents(detectedAgents: readonly DetectedAgent[]): number {
  return detectedAgents.filter((agent) => agent.installed === true).length;
}

/**
 * 该不该挂首启向导。
 *
 * 判定顺序：
 *   1. 强制开关打开 → 挂（无视已有角色：这是开发期走查用的）；
 *   2. 已有角色 → 不挂（不是首启了）；
 *   3. 还没建过档且**至少探到一个已装 agent** → 挂（探不到就别打扰用户）；
 *   4. 其余 → 不挂。
 */
export function shouldStartOnboarding(input: OnboardingTriggerInput): boolean {
  if (input.force === true) return true;
  if (input.characters.length > 0) return false;
  return countInstalledAgents(input.detectedAgents) > 0;
}
