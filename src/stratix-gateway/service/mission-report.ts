/**
 * 文件职责：任务终态 → 编组任务（mission）的**回报落点** —— 含「编组任务已消失」的兜底。
 * 输入：一条任务终态记录（任务 id / 终态 / missionId）+ core store + mission 写入面 + 日志口。
 * 输出：回报结果（已收尾 / 编组任务不存在 / 被相位机拒 / 本单不带编组）。
 * 禁止事项：
 *   1. 静默丢弃回报 —— 回报落空（编组已被撤掉 / 删除）必须**留痕**：warn 日志 + Notice，
 *      绝不"任务跑完了、编组那边一声不响"（评估报告 r4 P1：终态回报静默蒸发，日志零异常）；
 *   2. 自己判相位 —— 收不收尾由 core 的 mission 写入面裁决，这里只判**存在性**
 *      （查出来的，不是算出来的 —— 与 mission_cancel 的 unknown 拒绝同口径）；
 *   3. 编造编组任务 —— 编组不存在时**不重建**（重建会把"断链"伪装成"新任务"）；
 *   4. 直接改 store —— 状态写入一律走 core 写入面（铁律：裁决在 core）。
 *
 * ============ 为什么兜底放在 service 层（而不是 MCP 工具层）============
 * 终态回报**不是一次 MCP 调用** —— 它是执行环内部的事件（任务跑完 → 回报给编组）。
 * MCP 工具层看不到这个时刻；能看见的是 service 进程（它持有 core runtime 与执行环）。
 * 所以兜底落在这里：日志进网关日志，Notice 进世界态（HUD / world-sync 可见）。
 *
 * @since v3.8（task_143）。
 */

import type { MissionManager } from '../../core/mission';
import type { CoreStore } from '../../core/store';
import { NOTICE_TTL_MS, type MissionPhase } from '../../core/types';

/** 任务终态记录的最小形状（只取回报需要的三项）。 */
export interface MissionReportInput {
  /** 任务 id（留痕时用得上：调用方据此回查是哪一单的回报落空了）。 */
  readonly taskId: string;
  /** 任务终态（completed / failed / …）。 */
  readonly status: string;
  /** 关联的编组任务 id；null / undefined = 本单不带编组（无需回报）。 */
  readonly missionId?: string | null;
}

/** 回报结果（四态，穷举 —— 调用方能据此区分"收好了"与"没送出去"）。 */
export type MissionReportOutcome =
  /** 本单不带编组任务：无事可做（不是异常）。 */
  | { readonly kind: 'no_mission' }
  /** 编组任务已收尾（done / cancelled）。 */
  | { readonly kind: 'settled'; readonly missionId: string; readonly phase: MissionPhase }
  /** 编组任务已不存在（被撤掉 / 删除）—— 回报**无处可落**，已留痕。 */
  | {
      readonly kind: 'unknown_mission';
      readonly missionId: string;
      readonly taskId: string;
      readonly status: string;
    }
  /** 编组任务在，但这次回报不合法（相位不对，例如已经收尾）—— 也留痕，绝不静默。 */
  | {
      readonly kind: 'rejected';
      readonly missionId: string;
      readonly taskId: string;
      readonly status: string;
    };

/** 兜底所需的端口。 */
export interface MissionReportDeps {
  /** 世界态持有者（真相源：查名册 + 落 Notice）。 */
  readonly store: CoreStore;
  /** core 编组任务写入面（收尾裁决在这里）。 */
  readonly mission: MissionManager;
  /** 日志口（缺省静默）。 */
  readonly logger?: (line: string) => void;
  /** 时钟（缺省 Date.now）。 */
  readonly now?: () => number;
}

/** 兜底留痕用的来源标记（与 HUD 日志抽屉的"来源"列同一口径）。 */
export const MISSION_REPORT_SOURCE = 'service/mission-report';

/**
 * 把一条任务终态回报给它的编组任务。
 *
 * @returns 回报结果（见 MissionReportOutcome）。
 */
export function settleMissionFromTaskReport(
  deps: MissionReportDeps,
  report: MissionReportInput
): MissionReportOutcome {
  const missionId = report.missionId ?? null;
  if (!missionId) return { kind: 'no_mission' };

  const logger = deps.logger ?? ((): void => {});
  const now = deps.now ?? Date.now;

  // 存在性是**查**出来的（不是判出来的）：不在名册里就是不存在。
  const known = (deps.store.getState().missions ?? []).some((mission) => mission.id === missionId);
  if (!known) {
    // 回报落空：编组任务已被撤掉 / 删除 —— 这条回报送不到任何地方。
    // 留两道痕：① 日志（网关日志里能 grep 到）；② Notice（世界态里可见，HUD / world-sync 都吃）。
    const text =
      `终态回报落空：编组任务「${missionId}」已不存在（任务 ${report.taskId} / ${report.status}）` +
      '—— 回报未送达（unknown_mission）';
    logger(`[Stratix][service] ${text}`);
    const at = now();
    deps.store.pushNotice({
      id: `notice_mission_report_${report.taskId}`,
      level: 'warn',
      text,
      createdAt: at,
      expiresAt: at + NOTICE_TTL_MS,
      source: MISSION_REPORT_SOURCE,
      missionId,
    });
    return {
      kind: 'unknown_mission',
      missionId,
      taskId: report.taskId,
      status: report.status,
    };
  }

  // 收尾裁决交给 core（completed → done；failed → cancelled 中止语义）。
  const settled =
    report.status === 'completed'
      ? deps.mission.completeMission(missionId)
      : report.status === 'failed'
        ? deps.mission.cancelMission(missionId)
        : null;

  if (!settled) {
    // 编组任务在，但这次回报不合法（相位不对）—— 同样留痕（core 那边已发过相位 Notice，
    // 这里补一条日志，让"回报没落地"在日志里也可追溯）。
    logger(
      `[Stratix][service] 终态回报未落地：编组任务「${missionId}」当前相位不接受 ${report.status} 回报` +
        `（任务 ${report.taskId}）`
    );
    return { kind: 'rejected', missionId, taskId: report.taskId, status: report.status };
  }

  return { kind: 'settled', missionId, phase: settled.phase };
}
