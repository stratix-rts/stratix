/**
 * 文件职责：**切副本的 `ProjectArchivePort` 实现**（app 侧，task_180 / M1-06）——
 *   把该 instance 的**未终结 mission** 归档到 `.stratix/history/missions-YYYYMM.jsonl`
 *   （**append-only**：只追加、不重写 ⇒ 同一会话两次退出 = 两行，不覆盖）。
 * 输入：core 的端口契约（core/types.ts，task_176 / M1-02）、mission 来源口、
 *      实例根目录解析口、落盘口（append-only）。
 * 输出：满足 `ProjectArchivePort` 契约的实现（archive 异步，失败用返回值表达）。
 * 禁止事项：
 *   1. import fs —— 本模块**零 IO**：落盘动作归 node 侧适配（project-archive-node.ts），
 *      这样纯逻辑（造行、算路径、挑未终结 mission）可被无 IO 地单测；
 *   2. 重写归档文件 —— **只追加**是归档的第一条不变量（design §7.1 M1-06 验收①）；
 *   3. 归档**已终结**的 mission —— 终态（done / cancelled）不属于「未终结」；
 *   4. 抛异常表达失败 —— 失败一律返回 `ArchiveResult` 的失败分支（core 据此**拒绝**退出）；
 *   5. import core 的命令通道（emitCommand 之类）—— 端口实现方**不得反向调用 core 的裁决**。
 *
 * 行格式：照 [DESIGN-workspace.md §1.3](../docs/DESIGN-workspace.md) 的 `history/*.jsonl`
 *   （dsh session event 纪律：`v` / `ts` / `kind` / `ignorable` / `payload`）——
 *   归档即冻结；未知事件词汇靠 `ignorable` 标记兜底（默认**必须**显式标注）。
 *
 * why 归档在 app 层而不是 core：core 零 IO 是分层铁律；
 *   「写文件」是有 IO 的一半，必须落在唯一持有 IO 能力的那一层（design §1.2.5 R1-02 裁决）。
 *
 * why 失败用返回值而不是异常：core 的失败语义是**裁决拒绝**（状态不变 + 广播失败事件），
 *   异常一旦跨出端口边界就变成「谁捕获它」的责任漂移（core/types.ts 端口契约的注）；
 *   core 侧另有 `safeArchive` 兜底（实现方万一抛错也不会逃出 core）。
 *
 * @since v3.3（task_180 / M1-06）。
 */

import { join } from 'path';

import { isTerminalPhase } from '../../../core/mission';
import {
  DEFAULT_INSTANCE_ID,
  type ArchiveResult,
  type MissionCheckpoint,
  type MissionView,
  type ProjectArchivePort,
  type ProjectInstanceId,
} from '../../../core/types';

import type { InstanceMissionsProvider } from './instance-loader';

// ============================================================================
// 归档行的形状（照 DESIGN-workspace.md §1.3 的 dsh session event 纪律）
// ============================================================================

/**
 * 归档行格式版本（行内版本，**与 `.stratix` 契约面版本分开**）。
 *
 * why 行内版本**永不 bump**：文件内事件词汇的增长靠每行的 `ignorable` 标记兜底
 *   （DESIGN-workspace.md §1.4.2「文件内事件词汇 —— 永不 bump，靠 ignorable 标记」）。
 */
export const ARCHIVE_LINE_VERSION = 1;

/**
 * 归档事件种类。
 *
 * why 不是契约文档里的 `mission/settled`：settled 隐含「任务已收工（终态）」，
 *   而这里归档的是**未终结**的 mission（离开副本时的强制归档，DESIGN-workspace.md §5.3 Q9）
 *   ⇒ 用独立 kind，读方能区分「收工归档」与「离开副本时的强制归档」。
 */
export const ARCHIVE_EVENT_KIND = 'mission/archived';

/** 归档载荷（一条 mission 的完整快照）。 */
export interface MissionArchivePayload {
  /** ★ mission id —— **与 core 契约（`MissionView.id`）逐字一致**（M1-06 验收③）。 */
  readonly missionId: string;
  /** 所属实例（null = 未归属；默认沙盒有真实 id）。 */
  readonly instanceId: ProjectInstanceId | null;
  readonly title: string;
  /** 归档时刻的相位（未终结 ⇒ 非 done / cancelled）。 */
  readonly phase: MissionView['phase'];
  readonly unitIds: readonly string[];
  readonly createdAt: number;
  readonly brief?: MissionView['brief'];
  readonly checkpoints?: readonly MissionCheckpoint[];
  readonly dependsOn?: readonly string[];
}

/** 一行归档（JSONL 的一行）。 */
export interface ArchiveLine {
  readonly v: number;
  readonly ts: number;
  readonly kind: string;
  readonly ignorable: boolean;
  readonly payload: MissionArchivePayload;
}

// ============================================================================
// 端口两侧的依赖
// ============================================================================

/**
 * 落盘口（**append-only**）。
 *
 * why 是窄接口而不是直接用 fs：① 本模块保持零 IO（node 侧适配持有 fs）；
 *   ② 失败回滚（「不留半份文件」）是**落盘口的责任**——它在同一次调用里掌握写入前后的文件状态，
 *   上层只看得见「成功追加」或「抛错」，看不见中间态。
 */
export interface ArchiveAppender {
  /**
   * 追加一段文本到文件（**只追加，不重写**）。
   *
   * 失败必须**抛错**；且失败时文件必须回到写入前的状态
   *   （要么原样保留，要么把新写的那截回滚掉）—— **不留半份文件**（M1-06 验收②）。
   */
  append(filePath: string, payload: string): void;
}

export interface ProjectArchiveOptions {
  /**
   * mission 来源（**纯内存态** —— mission 是纯内存状态机，不落库，design §1.2.1 的注释）。
   *
   * 口径：给的是**该 instance 的** mission（与 M1-05 的 `InstanceMissionsProvider` 同一形状）。
   */
  readonly missions: InstanceMissionsProvider;
  /**
   * 实例根目录解析（instanceId → 项目根绝对路径；查不到 = undefined ⇒ 归档失败）。
   *
   * why 由调用方注入：根目录来自实例注册表（M1-07 起是 `workspaces.json`），
   *   本模块不该知道注册表长什么样。
   */
  readonly resolveInstanceRoot: (instanceId: ProjectInstanceId) => string | undefined;
  /** 落盘口（append-only；node 侧实现见 project-archive-node.ts）。 */
  readonly appender: ArchiveAppender;
  /** 当前时刻（ms epoch；可注入以便测试）。 */
  readonly now?: () => number;
}

// ============================================================================
// 纯逻辑（行构造 / 文件名 / 挑未终结）
// ============================================================================

/**
 * 该 mission 是否**未终结**（= 该被归档的）。
 *
 * why 用 core 的 `isTerminalPhase` 而不是自己抄一份终态表：
 *   终态词表是 core 契约（MissionPhase）的事实，抄一份必然漂移。
 */
export function isUnfinishedMission(mission: MissionView): boolean {
  return !isTerminalPhase(mission.phase);
}

/**
 * 归档分片文件名（按月分片，避免单文件无限增长 —— DESIGN-workspace.md §1.3）。
 *
 * why 按**本地时区**取月：分片是给人看的（「202611 = 2026 年 11 月」），
 *   与用户所在时区的日历一致；UTC 会让月初/月末的归档落错片。
 */
export function archiveFileName(at: number): string {
  const date = new Date(at);
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `missions-${year}${month}.jsonl`;
}

/** 归档文件的相对路径（`.stratix/history/missions-YYYYMM.jsonl`，契约文档里的口径）。 */
export function archiveRelativePath(fileName: string): string {
  return `.stratix/history/${fileName}`;
}

/** mission 视图 → 归档载荷（**id 逐字取自契约**，不做任何改写）。 */
export function toArchivePayload(mission: MissionView): MissionArchivePayload {
  return {
    missionId: mission.id,
    instanceId: mission.instanceId ?? null,
    title: mission.title,
    phase: mission.phase,
    unitIds: [...mission.unitIds],
    createdAt: mission.createdAt,
    ...(mission.brief ? { brief: mission.brief } : {}),
    ...(mission.checkpoints ? { checkpoints: [...mission.checkpoints] } : {}),
    ...(mission.dependsOn ? { dependsOn: [...mission.dependsOn] } : {}),
  };
}

/** 造一行归档（未序列化的对象形态；序列化交给落盘前的统一 JSON.stringify）。 */
export function buildArchiveLine(mission: MissionView, at: number): ArchiveLine {
  return {
    v: ARCHIVE_LINE_VERSION,
    ts: at,
    kind: ARCHIVE_EVENT_KIND,
    // 默认**必须**显式标注（DESIGN-workspace.md §1.3）：漏标 = 过度拒绝，不便；
    //   默认 ignorable = 静默残缺（安全事故）。这里显式 false = 读方必须认识这个 kind 才敢重建。
    ignorable: false,
    payload: toArchivePayload(mission),
  };
}

/**
 * 把一批 mission 序列化成**一段**待追加的文本（每行一条 JSON，行尾带 `\n`）。
 *
 * why 一次序列化整批：**先全算好再落盘** —— 序列化失败（循环引用等）时磁盘一个字节都没动，
 *   不会留下「写了一半才发现 JSON 不合法」的半份文件。
 */
export function serializeArchiveBatch(missions: readonly MissionView[], at: number): string {
  return missions.map((mission) => `${JSON.stringify(buildArchiveLine(mission, at))}\n`).join('');
}

// ============================================================================
// 端口实现
// ============================================================================

/**
 * 造 `ProjectArchivePort` 实现（task_180 / M1-06）。
 *
 * 语义（design §7.1 M1-06 行）：
 *   把该 instance 的**未终结 mission** 追加进 `.stratix/history/missions-YYYYMM.jsonl`；
 *   **只追加不重写**（两次退出 = 两行）；失败 ⇒ 返回失败分支 ⇒ core 拒绝退出（用户留在副本内）。
 */
export function createProjectArchive(options: ProjectArchiveOptions): ProjectArchivePort {
  const now = options.now ?? ((): number => Date.now());

  const archive = async (instanceId: ProjectInstanceId): Promise<ArchiveResult> => {
    try {
      const root = options.resolveInstanceRoot(instanceId);
      // 根目录查不到 ⇒ 这个实例没法定位归档位置 ⇒ 拒绝（不猜路径、不写到别处）。
      if (!root) return { ok: false, reason: 'instance-missing' };

      // 挑出**该 instance 的未终结 mission**。
      // why 再按 instance 过滤一次（provider 已过滤）：归属口径是 COALESCE
      //   （`mission.instanceId` 缺省 = 未归属 = 默认沙盒），与 design §1.2.1 一致；
      //   provider 若给了别的副本的 mission，这里拦一道 ⇒ 不把别副本的数据写进本副本的归档。
      const unfinished = options
        .missions(instanceId)
        .filter(
          (mission) =>
            isUnfinishedMission(mission) &&
            (mission.instanceId ?? DEFAULT_INSTANCE_ID) === instanceId
        );

      // 没有未终结 mission ⇒ 什么都不写（**不制造空文件**）：归档文件是有内容的账本，
      //   空文件只是噪声，还会让读方误以为「这个月归档过」。
      if (unfinished.length === 0) return { ok: true, archivedCount: 0 };

      const at = now();
      const fileName = archiveFileName(at);
      const filePath = join(root, '.stratix', 'history', fileName);
      const payload = serializeArchiveBatch(unfinished, at);

      // 落盘（append-only；失败抛错 ⇒ 下面的 catch 转成失败分支）。
      options.appender.append(filePath, payload);

      return {
        ok: true,
        archivedCount: unfinished.length,
        archivePath: archiveRelativePath(fileName),
      };
    } catch {
      // 落盘失败 ⇒ 拒绝退出（core 的 adjudicateProjectExit 据此保持 activeInstanceId 不变）。
      // why 归到 'archive-failed' 这一档：HUD 要的就是「归档失败，已留在副本内」这句文案。
      return { ok: false, reason: 'archive-failed' };
    }
  };

  return { archive };
}
