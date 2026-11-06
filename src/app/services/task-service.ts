/**
 * 文件职责：**角色任务执行服务**（task_037）—— 每角色 FIFO 队列、并发 1，把 core/task 派出的
 *   queued 任务经 CLI transport 执行完一个回合，并把相位回报给 core（start / complete / fail）。
 * 输入：core 总线上的 task.* 生命周期事件（task.queued 出队、其余转发落库）；
 *   WorldState 快照（characters + detectedAgents，守门用）；注入的 transport 工厂。
 * 输出：core TaskManager 的相位迁移调用（写 WorldState.tasks + 单位忙闲派生 + 再发事件）；
 *   任务落库回调（tasks 表：状态快照随事件落，**全文输出**随 complete 落 —— 状态里只有摘要）。
 * 禁止事项：
 *   1. import child_process / node-process / cli-transport 的**实现**文件 —— 本模块**不碰子进程**：
 *      两种宿主（渲染进程：子进程在 Electron 主进程经 IPC 桥跑；service 进程：子进程在本进程跑，
 *      见 service-split A2 / task_078）都由调用方注入 transport 工厂，本模块只 import
 *      transport.ts 的纯类型；
 *   2. 在这里认识任何一家 CLI 的字段 —— 事件翻译在 adapters，这里只认公共 TransportEvent 词表；
 *   3. 引入新依赖 —— core 契约 + 注入端口，仅此而已；
 *   4. 自动重试失败任务 —— 规格⑤明确：failed 即终态，手动重派是 038 的 UI 动作（新任务）。
 *
 * ============ 复用 chat IPC 链路（vs 新开 task:* 通道）的选择与理由 ============
 * 任务执行复用 035 的 chat:run / chat:abort IPC 通道 + chat-transport-bridge 的工厂：
 *   - 该通道本来就是通用的「kind + prompt + sessionId + timeout → 事件流」单轮执行管道，
 *     不含任何聊天语义（聊天语义全在 chat-service 里），任务需要的正是同一形状；
 *   - runId 路由保证并发轮次互不串台，任务与聊天共用通道不会互相污染事件流；
 *   - 新开 task:* 三条通道（main + preload + 桥）零增益、双倍维护面 —— 主进程侧 transport
 *     构造逻辑一模一样。选择复用，若将来任务需要 chat 不具备的执行参数（如多轮工具循环），
 *     再分家不迟（那时再在两侧文件头同步改说明）。
 *
 * ============ 任务会话与聊天会话隔离（规格④）============
 * 常规任务**每次都是独立会话**：spawn 恒传 sessionId=null（一次性会话，跑完即弃），
 *   - 不读角色的 externalSessionId（那是聊天会话的落库回执）；
 *   - 不把 CLI 回报的 session id 回写角色档案（回写会污染下一次聊天的续会话判断）；
 *   - session 事件对常规任务直接忽略。
 * 推论：常规任务没有「续发」，每一轮都是首发 → **persona 每次内嵌**（buildTaskPrompt，
 *   与 chat-service 的 buildFirstPrompt 同一拼装式样，措辞换成任务语境）。
 * **审批门例外（@since v3.25，task_049）**：plan-first 任务的计划轮**要记 session id**
 *   （挂单表的sessionId 字段，不回写角色档案）—— 批准后的续发复用 035 的会话延续语义：
 *   同 sessionId 续发只发短指令「计划已批准，按计划执行」（persona / 计划都在会话上下文里）；
 *   session 丢失（CLI 未回 / 服务重启）则退回首发拼装（persona + 原指令 + 计划全文重述）。
 *   —— task_055 复核：这两分支即统一重启恢复策略（有效→透传 resume / 无效→首发重建）的
 *   任务侧口径，已有单测固化（「批准 → 同 session 续发短指令」/「session 丢失 → 重讲」），不动。
 *
 * ============ 派发时的 cwd（@since v3.44，task_166 / §8 M0-02）============
 * 每次派发（首发 runTask / 批准后续段 runContinuation）都往 SpawnOptions 填 **cwd**，
 *   取值 = **活跃实例的项目根**；取值规则只有一份（dispatch-cwd.ts 的 resolveDispatchCwd），
 *   本服务不自己判断目录 ⇒ 派发链上 cwd 不散落。
 * M0 阶段供给口缺省恒 undefined ⇒ cwd 仍为 undefined ⇒ 子进程继承宿主进程 cwd，
 *   **行为与今天逐字节一致**（S6b 接入活跃实例后才给值）。
 *
 * ============ 项目契约块注入（@since v3.3，task_170 / §8 M0-06）============
 * 派单 prompt 里的 `<stratix-project>` 块（`.stratix` 项目契约快照）**与 `<stratix-context>`
 *   战场现状块同一注入点**（都是 runTask 里拼装首发 prompt 时取一次快照），
 *   但**独立标签**（不嵌进战场现状块内部 —— 两块语义不同：一个是项目契约，一个是战场现状）。
 *   位置：**角色设定之后、引用会话之前**（首发一次；引用会话是「接着的那段历史」，
 *   项目契约是「这是哪个项目」—— 契约在前，历史在后）。
 * 续发**不重注**：buildResumedTaskPrompt 不传项目块 ⇒ 续段 prompt 里没有 `<stratix-project>`。
 *   why 与 dsh 同构：dsh 的 session 是 **append-only 事件 log**，resume **重放历史** ⇒
 *   首发那一条里的项目块仍在上下文里，再注一遍就是重复注入（prompt 膨胀 + 契约版本歧义）。
 * 取件口：deps.provideProjectContext（ProjectContextSource 端口，M0-04 的 provider 三段式）——
 *   缺省 = 不注入；provider 抛错 ⇒ resolveProjectContextBlock 吞错降级为无块
 *   （「上下文是增强，不是依赖，坏了不能绑架任务回路」）。
 *
 * ============ 任务审批门（@since v3.25，task_049）============
 * plan-first 人设（personaPlanFirst 判定，两路：手写「先出计划」/ plan-first 预设）的任务：
 *   ① 派发拼装时在 prompt 尾部追加「先输出执行计划并以单独一行 PLAN_WAIT 结束」指令；
 *   ② 计划轮流结束后检测输出含标记行（extractPlanDraft）→ manager.requestApproval 挂起
 *     （六态机 awaiting_approval，plan 字段存已剥离标记行的草稿，状态机截断到上限）；
 *   ③ 挂起期间该角色 busy **不释放**（审批门占位：批准前不泵下一条 —— 门的意义就是
 *     「这个角色先停一停」）；挂起**不限时**：等多久都行，驱动是事件（命令）不是时钟。
 *     重启后挂单表丢失（内存态），awaiting 快照留在库里做审计 —— 没人再驱动它，
 *     与其他运行期内存态（队列 / busy）同一取舍；
 *   ④ 批准（task.approve 命令 → manager.approveTask → task.approved 事件）：本服务听事件
 *     接手 —— 同 session 续发 TASK_APPROVAL_RESUME_PROMPT；续段完成 → completeTask（output
 *     = 续段产出全文；计划全文已在 awaiting 快照与 plan 列存档）；续段出错 → failTask；
 *     找不到挂单（重启后残留的 awaiting 任务被批准）→ failTask(TASK_MSG_RESUME_LOST)
 *     兑底，状态机不留无人驱动的 running；
 *   ⑤ 驳回（task.reject 命令 → manager.rejectTask → task.failed 事件）：与其它失败同面
 *     （落库 + 回流 + exp —— 计划轮也是跑过的产出，「做过就有收获」），同时释放占位的
 *     busy 并继续泵队列（task.failed 事件处理里查挂单表补释放 —— 服务外驱动的收尾也要放门）；
 *   ⑥ 非 plan-first 任务即使输出碰巧含 PLAN_WAIT 也不走门（没有指令就没有协议义务 ——
 *     那只是普通文本，检测只对 plan-first 任务生效）。
 *
 * ============ 取消的队列纪律（task_047）============
 * task.cancelled 事件到达时把该任务从内存队列剔除（emitWorldEvent 是同步广播，取消与出队
 *   不会真的交错 —— 但剔除发生在下一次 pump 之前，队里从此没有它）；pump 出队时再查一次
 *   WorldState.tasks 的相位做**双层防御**：只有仍是 queued 的任务才进 transport，其余跳过继续
 *   泵下一条（防外部直改状态的同帧竞态与未来新路径）。取消的任务：不进 transport、不发 exp、
 *   不触发 onTaskSettled 回流（没跑过，没有可回的结果）；cancelled 快照照常落库（审计可见）。
 *
 * ============ 落库口径（独立 tasks 表，与聊天审计分离）============
 * persistTask 回调随每条 task.* 事件落状态快照（queued / running / failed 的 output 都很短）；
 * completed 单独走：本服务持有执行**全文输出**（transport 流式拼接），complete 时全文落库 ——
 * 状态里只存摘要（MAX_TASK_SUMMARY_LEN，见 core/task/machine.summarizeTaskOutput），
 * 全文只在 SQLite。fire-and-forget：落库失败记日志，不绑架任务执行回路（与 035 同一口径）。
 *
 * ============ 成果物解析与落列（task_048）============
 * complete 时同步多算一步：parseTaskArtifacts(全文) → serializeTaskArtifacts 落进记录的
 * artifacts 字段（JSON 字符串，缺省 = 解析不出）。解析是纯正则、永不抛（解析器内部兜底
 * 返回空），它在 done 收尾主路径上 —— 坏了不能拖累任务收尾，兜底语义写在解析器里。
 * 非终态快照（queued/running/failed/cancelled）不解析不带字段 —— 成果物只在 completed
 * 有意义（失败任务是没产出，不是产出不明）。onTaskSettled 回调携带同一份序列化串，
 * 消费方（task-report / 任务输出面板）各自反序列化，坏形状宽容降级（回落纯文本）。
 *
 * ============ 终态收尾的副作用：结果回流 + mission 回报 + exp 事件 ============
 * 任务到终态（completed / failed）时的副作用都是 fire-and-forget（抛错只记日志，
 * 绝不倒灌任务执行回路）：
 *   ① onTaskSettled 回调：把带**全文输出**的终态记录交给注入方（组合根接 task-report，
 *     组装「任务报告」消息注入角色会话 + 落 character_chat_messages + hud 轻提示）；
 *   ② 发 exp.gained 总线事件（source=task_completed / task_failed）：失败也发 —— 「做过就有
 *     收获」是养成口径。发射点时机与口径：
 *       - completed 在 runTask 的 done 收尾处（全文在手，回调拿全文）；
 *       - failed 挂在 handleEvent 的 task.failed 分支 —— 状态机事件是失败相位的唯一真相源，
 *         服务内四条失败路径（守门拦截 / transport 报错 / 防御性收尾 / 异常兑底）与外部直发的
 *         task.failed 事件都恰好流经这里一次，不会双发也不会漏发。
 *   amount 由注入的 expWeight 换算，缺省 app/services/exp-config.ts 的临时常量；
 *   **数值表归 task_040 的 progression 模块**（交接注记见 exp-config.ts 文件头，两侧已注明）。
 *   ③ task_076：有 missionId 时调 onMissionSettled（组合根 completed→completeMission、
 *     failed→cancelMission，失败按既有「中止」语义落 cancelled），并发 source=app/task-service、
 *     带 missionId 的 Notice；普通任务不进入这条旁路。
 *
 * ============ 会话域接线（@since v3.43，task_093 / v3.2a S3）============
 * 任务侧接入会话域，两种 kind，口径见 docs/SESSION-PLAN.md §2 接线表：
 *   - task_run：**全量事件化**（@since v3.46，task_105 / v3.2b-B6）—— 任务**执行路径**埋点，
 *     事件序列 task_started → step（关键节点）→ output_tail（尾 500 字）→ completed / failed，
 *     同一 task 的事件数上限 env `SX_TASK_EVENT_CAP`（默认 50，超限只记终态）；
 *   - mission_run：任务带单跑完、任务单随之到终态时，记一条（LITE：建 + 收尾两事件）。
 *   任务执行细节（全文 / 计划 / 成果物）仍在 character_tasks 表，**不搬** ——
 *   会话域只回答"这单跑过没有、跑到哪一步了"，不回答"全文写了什么"。
 * 会话记录是**旁路**：会话口缺席或记账失败都不打断任务收尾（可用性优先于历史完整性）。
 * 埋点实现见 services/task-session-recorder.ts（单独成模块：埋点不许改执行行为）。
 *
 * ============ 流式输出转发（task_046）============
 * 执行期每个 message 事件的文本 chunk 经 onTaskChunk 端口原序转发（组合根接 hud 任务输出
 * 面板的 appendTaskOutput —— running 任务的实时 tail 视图）。fire-and-forget（与 persistTask
 * 同一纪律）：回调抛错只记日志，绝不绑架执行回路；tool_use / tool_result / session 事件不转发
 * （任务结果只收 message 文本，与 output 拼接同一口径）。转发在 startTask 之后开始 ——
 * 总线同步广播保证了订阅方先见到 running 再见到 chunk，面板的开工对账（清空重开）不会丢流。
 *
 * @since v3.16（task_037）；v3.18（task_039）追加终态副作用；v3.22（task_046）追加流转发端口；
 *   v3.23（task_047）追加取消的队列纪律（事件剔除 + 出队防御）；v3.24（task_048）追加成果物解析落列；
 *   v3.25（task_049）追加任务审批门（plan-first 挂起 / 批准续发 / 驳回落位）；
 *   v3.30（task_054）追加离线守门（units.online 位拦截 + toast 去重）与 transport 异常上报口；
 *   v3.41（task_078 / service-split A2）本模块成为**两种宿主共用**的执行环实现 ——
 *   渲染进程（transport 经 IPC 桥）与 service 进程（transport 直接 spawn 子进程）共用同一份
 *   FIFO / 并发 1 / 守门 / 相位回报逻辑，两边只是 transport 工厂的来源不同；
 *   v3.43（task_093 / v3.2a S3）追加会话域接线（task_run / mission_run：LITE 建 + 收尾两事件）。
 *   v3.3（task_170 / §8 M0-06）追加项目契约块注入点（`<stratix-project>`，首发注 / 续发不注）。
 */

import { emitWorldEvent, onWorldEvent } from '../../core/bus';
import { personaPlanFirst } from '../../core/character/persona';
import type { SessionManager, SessionTitleService } from '../../core/session';
import type {
  AgentKind,
  CharacterTask,
  CharacterView,
  ExpSource,
  Notice,
  ProjectInstanceId,
  TaskStatus,
  WorldEvent,
  WorldState,
} from '../../core/types';
import { MISSION_TITLE_PENDING, NOTICE_TTL_MS, TASK_PLAN_WAIT_MARKER } from '../../core/types';
import type { TaskManager } from '../../core/task';
import type { SpawnOptions, TransportErrorCode, TransportEvent } from './cli-transport/transport';
import {
  defaultDispatchCwdProvider,
  resolveDispatchCwd,
  type DispatchCwdProvider,
} from './dispatch-cwd';
import { defaultExpWeight } from './exp-config';
import {
  resolveProjectContextBlock,
  type ProjectContextSource,
} from './project-context';
import {
  resolveSessionReferences,
  type SessionReferenceService,
} from './session-reference';
import { parseTaskArtifacts, serializeTaskArtifacts } from './task-artifacts';
import { createTaskSessionRecorder } from './task-session-recorder';
import { resolveStratixContextBlock, type StratixContextSource } from './stratix-context';

// ============================================================================
// 端口与常量
// ============================================================================

/** transport 端口：能跑一轮对话即可（结构上即 cli-transport 的 CliTransport / chat-service 的口）。 */
export interface TaskTransportPort {
  spawn(prompt: string, options?: SpawnOptions): AsyncIterable<TransportEvent>;
}

/** transport 工厂：agent 种类 → transport（生产复用 chat-transport-bridge 的 IPC 工厂；单测打桩）。 */
export type TaskTransportFactory = (kind: AgentKind) => TaskTransportPort;

/**
 * 任务落库记录（与 SQLite tasks 表一行同构）。
 * completed 的 output 是**全文**（调用方传全文覆盖事件里的摘要）。
 * artifacts（task_048）：completed 才携带 —— parseTaskArtifacts(全文) 的序列化成果物
 * （JSON 字符串）；缺省 = 无（非终态快照 / 解析不出）。
 * plan（task_049）：awaiting_approval / 被驳回的 failed 快照携带 —— 计划草稿全文
 * （已剥离标记行）；approved 后 completed 的记录也带（溯源：这单是按哪份计划做完的）。
 * 缺省 = 无（非 plan-first 任务）。
 */
export interface TaskPersistRecord {
  readonly id: string;
  readonly characterId: string;
  readonly prompt: string;
  readonly status: TaskStatus;
  readonly output: string;
  readonly createdAt: number;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  /** @since v3.24（task_048）；'' 不出现在这里 —— 解析不出就是缺省，不占字段。 */
  readonly artifacts?: string;
  /** @since v3.25（task_049）：计划草稿全文（见上）；落库层落进 character_tasks.plan 列。 */
  readonly plan?: string;
  /** @since v3.36（task_076）：关联 mission；缺省 / null = 普通任务，不触发 mission 回报。 */
  readonly missionId?: string | null;
  /**
   * 所属副本（@since v3.3，task_207 / M2-10 验收发现并修掉的写侧欠账）。
   *
   * why 必须带：`character_tasks` 的读口按副本过滤（`COALESCE(instance_id, 'wsp_sandbox')`）
   *   —— 写侧不写这一列 ⇒ 任务行永远落 NULL ⇒ **副本里派的任务在本副本读不回来**
   *   （反倒算进默认沙盒的池子）。core 的 `CharacterTask.instanceId` 是副本归属的真相源
   *   （M2-07 起任务创建时就盖上），这里只做**搬运**，不另立口径。
   * 缺省 / null = 未标注（老行 / 不带归属的来件）。
   */
  readonly instanceId?: ProjectInstanceId | null;
}

/** 任务单轮执行超时（ms）。CLI 跑任务比聊天长得多，取 035 档主进程上限：10 分钟。 */
export const DEFAULT_TASK_TIMEOUT_MS = 600_000;

// ---- 守门与占位文案（导出供单测断言，别在测试里抄一遍字符串）----

/** agent 未检出 / 未安装（出队守门拦截 → 任务直接 failed）。 */
export const TASK_MSG_NOT_INSTALLED = '该 CLI 未安装，任务无法执行';

/** 角色没绑 agent 种类（老档案 / 引导没走完）。 */
export const TASK_MSG_UNBOUND = '该角色未绑定 CLI agent，任务无法执行';

/** 角色档案不在状态里（刚被删 / 快照未到）。 */
export const TASK_MSG_NO_PROFILE = '未找到该角色的档案，任务无法执行';

/**
 * 角色绑定的 CLI 已被健康监测判离线（@since v3.30，task_054：035 守门只看「在档 + 已检出」
 * —— 二进制在盘上但进程级掉线（崩溃 / 探测连续失败）时照样能过田门；这里补上在线位裁决）。
 * 导出构建器供单测断言，别在测试里抄字符串。
 */
export function taskOfflineReason(name: string): string {
  return `「${name}」当前离线，任务无法执行`;
}

/** 传输层错误码 → 任务失败原因前缀。 */
const ERROR_LABELS: Readonly<Record<TransportErrorCode, string>> = {
  spawn_failed: 'CLI 拉起失败',
  aborted: '已中断',
  timeout: '执行超时',
  nonzero_exit: 'CLI 异常退出',
  cli_error: 'CLI 报错',
};

// ============================================================================
// 纯函数（可独立单测）
// ============================================================================

/**
 * 出队守门：任务能不能跑。
 * 与 chat-service 的 guard 同源（在档 / 已绑 / 已检出），外加第四条在线位
 * （task_054：Units.online === false = CLI 掉线，拦截），但拦截落点不同：
 * chat 是错误气泡（对话不入库），task 是任务直接 failed（状态与库里都看得见原因）。
 * @since v3.30（task_054）state 面增 units（在线位裁决用）；组合根与测试注入的都是
 * 完整 getState，零改动兼容。
 */
export function guardTaskCharacter(
  state: Pick<WorldState, 'characters' | 'detectedAgents' | 'units'>,
  characterId: string
): { readonly ok: true; readonly character: CharacterView; readonly kind: AgentKind } | { readonly ok: false; readonly reason: string; readonly offline?: string } {
  const character = state.characters.find((c) => c.id === characterId);
  if (!character) return { ok: false, reason: TASK_MSG_NO_PROFILE };
  const kind = character.agentKind;
  if (!kind) return { ok: false, reason: TASK_MSG_UNBOUND };
  const detected = state.detectedAgents?.some((agent) => agent.kind === kind && agent.installed);
  if (!detected) return { ok: false, reason: TASK_MSG_NOT_INSTALLED };
  // task_054：在线位拦截 —— units.online === false 才拦（缺省 / true = 在线，
  // 老档 / 未探测 / 没接健康监测的单位永远不被误伤，与 UnitView.online 契约注同口径）。
  // offline 字段把角色名带给泵（toast 文案用），与 reason 同文同源。
  if (state.units.some((unit) => unit.characterId === characterId && unit.online === false)) {
    return { ok: false, reason: taskOfflineReason(character.name), offline: character.name };
  }
  return { ok: true, character, kind };
}

/**
 * 任务指令拼装的选项（@since v3.3，task_170 把项目契约块并入 options）。
 */
export interface TaskPromptOptions {
  /**
   * 向 worker 要一个任务标题（@since v3.11，task_155）。
   * 只有「标题待生成」的任务才要（发起时标题是占位「生成中…」，由 Agent 首轮回报生成）。
   * 指令插在【任务指令】之后、plan-first 尾部指令之前（尾部指令恒在最后）。
   */
  readonly askTitle?: boolean;
  /**
   * 项目契约块（@since v3.3，task_170 / §8 M0-06）：`<stratix-project>` 独立标签的块文本。
   * 位置：**角色设定之后、引用会话之前**（首发注入一次；续发路径不传 ⇒ 不重注）。
   * 缺省 = 不注入（行为与 M0 之前一致）。
   */
  readonly projectBlock?: string;
}

/**
 * 任务指令拼装：角色设定引导语 + persona + 任务指令。
 * 任务会话是**一次性**的（每轮独立会话，无续发），所以每次都内嵌 persona ——
 * 与 chat-service.buildFirstPrompt 的差别只有措辞（任务语境 vs 对话语境），拼装式样刻意一致。
 * @since v3.25（task_049）：plan-first 人设（personaPlanFirst）追加尾部指令 —— 要求 agent
 * 先输出执行计划并以单独一行 TASK_PLAN_WAIT_MARKER 结束。标记词从 core 契约取，不另抄一份
 * （prompt 指令、挂起检测、展示剥离三方必须是同一个词，见 types.ts 的 TASK_PLAN_WAIT_MARKER）。
 * @since v3.29（task_053）可选第三参 contextBlock：<stratix-context> 战场现状块。任务会话
 * 一次性 → 每次执行都是首发语义，每条任务的 prompt 都注入（插入位置在 persona 之后、
 * 【任务指令】之前；plan-first 的【工作方式】尾部指令恒在最后）。传 undefined 走原路径。
 * @since v3.49（task_107）可选第四参 referenceBlock：@会话引用的注入块
 * （【引用会话 <title>(<id>) 摘要/时间线】…）。插在 persona 之后、战场现状块之前 ——
 * 引用是"这次任务要接着的那段历史"，属于**上下文**（不是指令），位置与战场现状块同层。
 * @since v3.11（task_155）可选第五参 options.askTitle：**向 worker 要一个任务标题**。
 * @since v3.3（task_170 / §8 M0-06）options.projectBlock：`<stratix-project>` 项目契约块。
 *   插在 **角色设定之后、引用会话之前**（独立标签，**不**嵌进 `<stratix-context>` 内部）。
 *   续发路径（buildResumedTaskPrompt）**不传**这个块 ⇒ 续段 prompt 不重注项目契约。
 */
export function buildTaskPrompt(
  character: CharacterView,
  taskPrompt: string,
  contextBlock?: string,
  referenceBlock?: string,
  options?: TaskPromptOptions
): string {
  const persona = character.persona.trim();
  const hasContext = contextBlock !== undefined && contextBlock.length > 0;
  const hasReference = referenceBlock !== undefined && referenceBlock.length > 0;
  const projectBlock = options?.projectBlock;
  const hasProject = projectBlock !== undefined && projectBlock.length > 0;
  if (
    persona.length === 0 &&
    !hasContext &&
    !hasReference &&
    !hasProject &&
    !options?.askTitle
  ) {
    return taskPrompt;
  }
  const parts: string[] = [
    `你将扮演「${character.name}」这个角色执行任务，请全程保持角色设定一致。`,
  ];
  if (persona.length > 0) parts.push(`【角色设定】\n${persona}`);
  // 项目契约块（task_170）：角色设定之后、引用会话之前（首发注入一次）。
  if (hasProject) parts.push(projectBlock as string);
  if (hasReference) parts.push(referenceBlock as string);
  if (hasContext) parts.push(contextBlock as string);
  parts.push(`【任务指令】\n${taskPrompt}`);
  // @since v3.11（task_155）：标题待生成时向 worker 要一个标题（它在第一轮回报里给）。
  if (options?.askTitle === true) parts.push(TASK_TITLE_INSTRUCTION);
  const base = parts.join('\n\n');
  return personaPlanFirst(persona) ? `${base}\n\n【工作方式】\n${TASK_PLAN_INSTRUCTION}` : base;
}

/**
 * 标题回写指令（@since v3.11，task_155）—— 让 worker 在**第一轮回报**里给出任务标题。
 *
 * why 要显式要：标题不再由用户提供（发起时是占位「生成中…」），
 *   而任务标题是**给人认这条任务**用的（任务列表 / 顶栏 / 跑马灯都显示它）——
 *   worker 是唯一知道这条任务在干什么的一方（它读了指令、知道上下文）。
 * why 说死"第一行"：回报是流式的，首行先到 → 标题能**早**回写（用户不用等任务跑完）。
 */
export const TASK_TITLE_INSTRUCTION =
  '请在回复的第一行写出本次任务标题，格式：「标题：<不超过 20 字的任务标题>」；写完这一行再写正文。';

/** 生成标题的长度上限（@since v3.11，task_155）：一行标题栏放不下更长的 —— 口径先裁，两边一致。 */
export const MAX_GENERATED_TASK_TITLE = 30;

/**
 * 从 worker 的回报里取任务标题（@since v3.11，task_155）—— **首行**口径。
 *
 * 口径：
 *   - 取第一行非空文本；剥掉 markdown 前缀（# / * / -）与「标题：」标记；
 *   - 有标记 → 取标记后的内容；没标记 → 整行就是标题（兜底：worker 没听话时的首行截断）；
 *   - 超长截断到 MAX_GENERATED_TASK_TITLE（末尾补省略号）。
 *
 * why 兜底取首行而不是"取不到就不写"：标题是**必填展示项**（占位「生成中…」不能一直挂着），
 *   worker 的第一句几乎总是"这条任务在干什么" —— 首行截断出来的标题八九不离十。
 * why 不取第二行/第三行：那些多半是寒暄或过程说明，不是标题。
 */
export function extractGeneratedTaskTitle(output: string): string | null {
  const firstLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return null;
  const plain = firstLine.replace(/^[#>*\-\s]+/, '').trim();
  const marked = /^(?:任务)?标题\s*[:：]\s*(.+)$/.exec(plain);
  const raw = (marked ? (marked[1] as string) : plain).trim();
  if (raw.length === 0) return null;
  return raw.length <= MAX_GENERATED_TASK_TITLE
    ? raw
    : `${raw.slice(0, MAX_GENERATED_TASK_TITLE - 1)}…`;
}

/**
 * plan-first 尾部指令（@since v3.25，task_049）：挂起检测靠输出里的标记行，所以指令必须
 * 把「单独一行」说死 —— 否则 agent 把 PLAN_WAIT 写进句子里，检测不到就只能当普通产出收尾。
 */
export const TASK_PLAN_INSTRUCTION =
  '先输出执行计划，并以单独一行 PLAN_WAIT 结束；等待批准后再继续执行，不要自行开工。';

/** 批准后续发的短指令（同 session 续发语义：上下文里已有 persona 与计划全文）。 */
export const TASK_APPROVAL_RESUME_PROMPT = '计划已批准，按计划执行。';

/** 挂单丢失兑底（重启后残留 awaiting 被批准 → 续发无驱动）：failed 收尾，不留无人驾驶的 running。 */
export const TASK_MSG_RESUME_LOST = '批准时任务服务已重启，计划续发丢失，任务未继续';

/**
 * 挂起检测（@since v3.25，task_049）：输出里是否有**独占一行**的挂起标记，并返回剥离标记行
 * 后的计划草稿。纯函数：
 *   - 任一行 trim 后 === TASK_PLAN_WAIT_MARKER 即命中（容忍前后空白与 CRLF）；
 *   - 多个标记行全部剥离；草稿 = 剩余文本 trim（空计划也挂起 —— 空卡自然会被驳回，不越权裁决）；
 *   - 未命中返回 null（调用方走普通收尾）。
 */
export function extractPlanDraft(output: string): string | null {
  const lines = output.split(/\r?\n/);
  let found = false;
  const kept = lines.filter((line) => {
    if (line.trim() === TASK_PLAN_WAIT_MARKER) {
      found = true;
      return false;
    }
    return true;
  });
  return found ? kept.join('\n').trim() : null;
}

/**
 * session 丢失时的续发拼装（首发语义重建：persona + 原指令 + 计划全文重述）。
 * 与 035 会话延续的 fallback 同一口径：没有 sessionId 就没有上下文可复用，只能重讲一遍。
 * @since v3.29（task_053）可选第四参 contextBlock：重建首发语义时同样附战场现状块
 *（调用方只在 sessionId 丢失的重讲路径上传入）。
 * @since v3.49（task_107）可选第五参 referenceBlock：重建首发语义时同样附 @会话引用块
 *（引用是任务指令的一部分 —— 丢了它，重讲出来的任务就不是用户交代的那件事了）。
 * @since v3.3（task_170 / §8 M0-06）：**不传项目契约块** —— 续发不重注
 *（dsh 的 session 是 append-only 事件 log，resume 重放历史 ⇒ 首发那一条里的
 *   `<stratix-project>` 仍在上下文里；再注一遍就是重复注入）。
 */
export function buildResumedTaskPrompt(
  character: CharacterView,
  task: CharacterTask,
  plan: string,
  contextBlock?: string,
  referenceBlock?: string
): string {
  return [
    buildTaskPrompt(character, task.prompt, contextBlock, referenceBlock),
    '【计划审批】\n以下是此前输出的执行计划，已获批准：',
    plan,
    '请按上述计划继续执行并给出结果。',
  ].join('\n\n');
}

/** 传输层错误 → 任务失败原因（带码的人话，落 failed.output 与库）。 */
export function taskErrorText(code: TransportErrorCode, message: string): string {
  return `${ERROR_LABELS[code]}：${message}`;
}

/** 事件快照 → 落库记录（completed 之外的相位直接用快照；output 即失败原因/空串）。 */
export function taskEventToRecord(task: CharacterTask): TaskPersistRecord {
  return {
    id: task.id,
    characterId: task.characterId,
    prompt: task.prompt,
    status: task.status,
    output: task.output,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    endedAt: task.endedAt,
    ...(task.plan && task.plan.length > 0 ? { plan: task.plan } : {}),
    ...(task.missionId !== undefined ? { missionId: task.missionId } : {}),
    // 副本归属随任务快照一起落库（task_207 / M2-10）：core 盖的 instanceId 是唯一真相源。
    ...(task.instanceId !== undefined && task.instanceId !== null
      ? { instanceId: task.instanceId }
      : {}),
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * mission_run 会话的收尾原因（@since v3.8 / task_143）。
 *
 * why 要在这里标「回报未送达」：任务跑完时关联的编组任务可能**已被撤掉 / 删除**（竞态）——
 *   终态回报就无处可落。这条会话的 closed 事件是 MCP 侧唯一查得到的回报去向痕迹，
 *   所以原因里如实写出来（unknown_mission），而不是写一句"任务单完成"了事。
 *
 * @param record 任务终态记录。
 * @param missionExists 编组任务存在性读口（缺省 = 一律认为存在 → 旧文案）。
 */
function missionCloseReason(
  record: TaskPersistRecord,
  missionExists?: (missionId: string) => boolean
): string {
  const base = record.status === 'completed' ? '任务单完成' : '任务单中止';
  const missionId = record.missionId;
  if (!missionId || !missionExists) return base;
  if (missionExists(missionId)) return base;
  return `${base}（unknown_mission：编组任务已不存在，回报未送达）`;
}

// ============================================================================
// 服务
// ============================================================================

export interface TaskServiceDeps {
  /**
   * 世界快照读取口（组合根传 worldStore.getState；单测传夹具）。
   * @since v3.23（task_047）类型面增 tasks：出队防御要查任务当前相位（仅 queued 才执行）。
   * @since v3.30（task_054）类型面增 units：离线守门要查在线位（guardTaskCharacter）。
   * 组合根与测试注入的都是完整 getState，零改动兼容。
   */
  readonly getState: () => Pick<WorldState, 'characters' | 'detectedAgents' | 'tasks' | 'units'>;
  /** transport 工厂（生产：复用 chat-transport-bridge 的 IPC 工厂；单测：打桩）。 */
  readonly createTransport: TaskTransportFactory;
  /**
   * 派发链 cwd 供给口（@since v3.44，task_166 / DESIGN-workspace §8 M0-02）。
   * 取值 = **活跃实例的项目根**；缺省 = `defaultDispatchCwdProvider`（恒 undefined）
   *   ⇒ M0 下派发仍不带 cwd（行为与今天逐字节一致，S6b 接入后才给值）。
   * 取值规则只有一份（见 dispatch-cwd.ts 的「唯一取值点」），本服务不自己判断目录。
   */
  readonly cwdProvider?: DispatchCwdProvider;
  /** core 任务域写入面（相位回报：start / complete / fail）。与 runtime 注入同一个实例。 */
  readonly taskManager: TaskManager;
  /** 任务落库口（缺省不落库）。同步签名、实现方内部异步 —— fire-and-forget，失败只记日志。 */
  readonly persistTask?: (record: TaskPersistRecord) => void;
  /**
   * 任务终态回调（@since v3.18，task_039；缺省不回调）。携带**全文输出**的终态记录
   * （completed = 执行全文；failed = 失败原因）恰好一次/任务。同步签名、fire-and-forget：
   * 抛错只记日志，绝不绑架任务执行回路。组合根接 task-report（报告消息 + 轻提示）。
   */
  readonly onTaskSettled?: (record: TaskPersistRecord) => void;
  /**
   * 关联 mission 的终态回报（@since v3.36，task_076；缺省不回报）。仅 completed / failed
   * 且 record.missionId 非空时调用；组合根分别接 completeMission / cancelMission。
   */
  readonly onMissionSettled?: (record: TaskPersistRecord) => void;
  /**
   * 编组任务存在性读口（@since v3.8 / task_143；缺省 = 一律认为存在）。
   *
   * why 需要它：任务跑完时关联的编组任务可能**已被撤掉 / 删除**（竞态）——
   *   那时终态回报无处可落（mission-report 的兜底会留痕：日志 + Notice）。
   *   本口让这条 mission_run 会话的收尾原因如实写上「回报未送达」，
   *   使回报去向**可追踪**（会话事件流是 MCP 侧唯一查得到的痕迹）。
   * 缺省 = 不问（行为与旧版一致）；接线方给的是"名册里有没有这条"。
   */
  readonly missionExists?: (missionId: string) => boolean;
  /**
   * 关联任务单的**标题读口**（@since v3.11，task_155；缺省 = 读不到 → 不当标题待生成）。
   *
   * why 需要它：只有「标题还是占位『生成中…』」的任务才需要向 worker 要标题 ——
   *   别的任务单（外部 agent 用 MCP 建的、标题是人给的）标题早就有值，
   *   向 worker 要标题会白改一条已有标题的任务单。
   * 缺省 = 读不到（此时一律不写回标题 —— 宁可标题一直占位，也不乱改别人的标题）。
   */
  readonly missionTitle?: (missionId: string) => string | null;
  /**
   * **标题回写口**（@since v3.11，task_155；缺省不回写）。
   *
   * 口径：worker 第一轮回报给出标题后回调一次（missionId + 生成的标题）。
   * 组合根接 core/mission 的写入面（把占位标题换成生成的标题）——
   *   这是**既有 worker 回报通道**上的一环（与终态回报 onMissionSettled 同一族端口），
   *   不新建通道、不新建总线命令。
   * 同步签名、fire-and-forget：抛错只记日志，绝不绑架任务执行回路。
   */
  readonly onMissionTitle?: (missionId: string, title: string) => void;
  /** mission 回报 Notice 写入口（source / missionId 由本服务补齐）；缺省不发 Notice。 */
  readonly pushNotice?: (notice: Notice) => void;
  /**
   * 流式输出转发端口（@since v3.22，task_046；缺省不转发）。执行期每个 message 事件的
   * 文本 chunk 按到达顺序转发（characterId, chunk）。同步签名、fire-and-forget：抛错只记
   * 日志，绝不绑架任务执行回路。组合根接 hud 任务输出面板的 appendTaskOutput（实时 tail 视图）。
   */
  readonly onTaskChunk?: (characterId: string, chunk: string) => void;
  /**
   * 经验权重函数（@since v3.18，task_039；缺省 exp-config 的临时常量表）。
   * **task_040 交接点**：progression 模块接管数值时换掉这个注入件，本服务零改动。
   */
  readonly expWeight?: (source: ExpSource) => number;
  /**
   * context-source 注入件（@since v3.29，task_053；缺省不注入）。零 IO：组合根用
   * createStratixContextProvider 组装。任务会话一次性（每条任务都是首发）→
   * 每次执行取一次快照（resolveStratixContextBlock；异常吞掉不绑架任务回路）。
   */
  readonly provideContext?: StratixContextSource;
  /**
   * 项目契约上下文供给口（@since v3.3，task_170 / DESIGN-workspace §8 M0-06；缺省不注入）。
   *
   * 形状 = `ProjectContextSource`（M0-04 的 provider 三段式）：组合根用
   * `createProjectContextProvider({ load })` 组装（读 `.stratix` 的读数口在 app 侧，M0-05）。
   * 本服务**零 IO**：只调一次 provider 拿纯数据，块文本由 resolveProjectContextBlock 渲染。
   * 注入语义（与战场现状块同一注入点、**独立标签**）：
   *   - **首发**（runTask 拼装 prompt 时）注一次 ⇒ prompt 含 `<stratix-project>`；
   *   - **续发**（buildResumedTaskPrompt）不注 ⇒ 续段 prompt 不含项目块（不重注）；
   *   - provider 抛错 ⇒ 吞错降级为无块（「上下文是增强，不是依赖」，不绑架任务回路）。
   */
  readonly provideProjectContext?: ProjectContextSource;
  /** 单轮执行超时；缺省 DEFAULT_TASK_TIMEOUT_MS（10min，主进程上限同档）。 */
  readonly timeoutMs?: number;
  /** 日志口；缺省静默。 */
  readonly logger?: (line: string) => void;
  /**
   * transport 异常上报口（@since v3.30，task_054；缺省不上报）。执行期 transport error
   * 事件回调（kind + 错误码；含计划续发段）。组合根接 health-monitor.recordTransportFailure
   * —— 非 aborted 的 exit 异常各记一条 unhealthy 审计。同步签名、fire-and-forget。
   */
  readonly onTransportError?: (kind: AgentKind, code: TransportErrorCode) => void;
  /**
   * 入口拦截轻提示口（@since v3.30，task_054；缺省不提示）。离线拦截（guard 的 online
   * 位裁决）时回调一次文案；服务内按角色去重（离线期间只提示一次，恢复后重置）——
   * 队列里排着 N 条任务不该炸出 N 条 toast。组合根接 toast-host（warn tone）。
   */
  readonly notify?: (text: string) => void;
  /**
   * 会话域写入面（可选，@since v3.43，task_093 / v3.2a S3）—— 任务执行（kind=task_run）
   * 与关联任务单（kind=mission_run）的会话记录。**缺省 = 不记会话**。
   *
   * 口径（方案 docs/SESSION-PLAN.md §2 接线表「task_run / mission_run」行）：
   *   - mission_run：**LITE 两事件** —— 任务收尾时建会话并立刻收尾；
   *   - task_run：**全量事件化**（@since v3.46，task_105 / v3.2b-B6）—— 任务**执行路径**埋点
   *     （task_started / step / output_tail / completed / failed），见 task-session-recorder.ts。
   *   任务执行细节（全文 / 计划 / 成果物）仍在 character_tasks 表（不搬）——
   *   会话域只回答"这单跑过没有、跑到哪一步了"。
   */
  readonly sessions?: SessionManager;
  /**
   * 同一 task 的会话事件数上限（@since v3.46，task_105 / v3.2b-B6）。
   * 缺省读 env `SX_TASK_EVENT_CAP`（默认 50，见 task-session-recorder.ts）。
   * 超限后只记 completed / failed —— 中间事件停记（事件频率必须节制）。
   */
  readonly taskEventCap?: number;
  /**
   * 自动起名服务（可选，@since v3.47，task_104 / v3.2b-B5）—— task_run 建会话后**异步**起名。
   * 缺省 = 不起名（标题就是建会话时那条规则版标题）。
   */
  readonly titles?: SessionTitleService;
  /**
   * @会话引用解析服务（可选，@since v3.49，task_107 / v3.2b-B8）—— 解析**任务指令**里的
   * `@session_<id>`，把被引用会话的近期内容拼成上下文块注入任务 prompt 的上下文头部。
   * 缺省 = 指令里的 `@session_…` **无法解析**（此时任务如实失败并给出原因）。
   */
  readonly references?: SessionReferenceService;
}

export interface TaskService {
  /**
   * 接上总线（订阅 task.* 生命周期事件）。必须在 runtime.start 之后调：core/task 的
   * assignTask 在命令处理里同步发 task.queued，晚订阅只会漏掉启动前的派发（无害）。
   * 返回 stop；重复 start 是 no-op。
   */
  start(): () => void;
  /** 某角色是否有一轮任务在跑（观察口：测试 / 调试）。 */
  isBusy(characterId: string): boolean;
  /** 某角色的待执行队列长度（观察口：038 的队列可见性读 WorldState，这里仅供测试）。 */
  queueLength(characterId: string): number;
}

export function createTaskService(deps: TaskServiceDeps): TaskService {
  const logger = deps.logger ?? ((): void => { /* 缺省静默 */ });
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
  /**
   * 派发 cwd 供给口（@since v3.44，task_166）：缺省恒 undefined（M0 行为不变）。
   * 每轮派发现问一次 —— 活跃实例可在两次派发之间换（取值点见 dispatch-cwd.ts）。
   */
  const cwdProvider = deps.cwdProvider ?? defaultDispatchCwdProvider;
  const manager = deps.taskManager;
  const expWeight = deps.expWeight ?? defaultExpWeight;

  /** characterId → 待执行队列（FIFO；队头即下一个执行）。 */
  const queues = new Map<string, CharacterTask[]>();
  /** 正在执行的角色集合（并发 1 的执行纪律；core 侧另有状态机兜底）。 */
  const busy = new Set<string>();
  /** kind → transport 缓存（IPC 桥的 transport 无状态可缓存；省一次工厂往返）。 */
  const transports = new Map<AgentKind, TaskTransportPort>();

  /**
   * 审批门挂单表（task_049）：taskId → 计划轮的驱动上下文（角色 / kind / sessionId / 原指令）。
   * 内存态：挂起**不限时**，但重启即丢（awaiting 快照已在库里，审计可见；丢后批准走
   * TASK_MSG_RESUME_LOST 兑底）。只进一张：批准时立刻移除（同一任务不会二次挂起 ——
   * 批准后的续段里再现 PLAN_WAIT 只当普通文本收尾，见 runContinuation）。
   */
  interface AwaitingEntry {
    readonly task: CharacterTask;
    readonly character: CharacterView;
    readonly kind: AgentKind;
    readonly sessionId: string | null;
    /**
     * @会话引用的注入块（@since v3.49，task_107）—— 续段"重讲"（丢 session）时要重新带上，
     * 否则重讲出来的就不是用户交代的那件事了（同 session 续发时上下文里已经有了）。
     */
    readonly referenceBlock: string;
  }
  const awaitingTasks = new Map<string, AwaitingEntry>();

  /**
   * 离线拦截去重表（task_054）：离线期间每角色只 toast 一次（队列里 N 条任务不炸 N 条）。
   * 恢复语义：守门通过时清除（下一轮掉线重新计）。
   */
  const offlineNotified = new Set<string>();

  /**
   * transport 异常上报（task_054）：回调抛错只记日志 —— 健康审计是旁路，绝不绑架任务回路。
   */
  const reportTransportError = (kind: AgentKind, code: TransportErrorCode): void => {
    if (!deps.onTransportError) return;
    try {
      deps.onTransportError(kind, code);
    } catch (error) {
      logger(`[task-service] transport 异常上报抛错（${kind}/${code}）：${describe(error)}`);
    }
  };

  const transportFor = (kind: AgentKind): TaskTransportPort => {
    const cached = transports.get(kind);
    if (cached) return cached;
    const created = deps.createTransport(kind);
    transports.set(kind, created);
    return created;
  };

  /** 落库（fire-and-forget）：抛错只记日志 —— 历史完整性不绑架任务执行回路。 */
  const persist = (record: TaskPersistRecord): void => {
    if (!deps.persistTask) return;
    try {
      deps.persistTask(record);
    } catch (error) {
      logger(`[task-service] 任务落库回调抛错（${record.id}/${record.status}）：${describe(error)}`);
    }
  };

  /**
   * 发 exp.gained（task_039）：权重 ≤ 0 直接不发（040 接管后可整类关掉某来源）；
   * mitt 不该抛，防御性包一层 —— exp 是旁路观察事件，绝不让它倒灌任务回路。
   */
  const emitExp = (characterId: string, source: ExpSource): void => {
    const amount = expWeight(source);
    if (amount <= 0) return;
    try {
      emitWorldEvent({ type: 'exp.gained', characterId, source, amount });
    } catch (error) {
      logger(`[task-service] exp.gained 发射失败（${characterId}/${source}）：${describe(error)}`);
    }
  };

  /**
   * 流式 chunk 转发（task_046）：fire-and-forget —— 回调抛错只记日志，
   * 观察口（tail 视图）坏了绝不能绑架任务执行本身。
   */
  const emitChunk = (characterId: string, chunk: string): void => {
    if (!deps.onTaskChunk) return;
    try {
      deps.onTaskChunk(characterId, chunk);
    } catch (error) {
      logger(`[task-service] 流式输出转发抛错（${characterId}）：${describe(error)}`);
    }
  };

  /**
   * 标题回写（@since v3.11，task_155）—— worker 的首轮回报给出标题 → 写回任务单。
   *
   * 三道闸（缺一不可）：
   *   ① 任务单标题还是**占位**「生成中…」才写（别人给的标题不改）；
   *   ② **只写一次**（首轮回报说了算 —— 后面的回合不再翻案）；
   *   ③ 流式期要等首行**完整**（出现换行）才取 —— 半行是残句，取出来是错标题；
   *      收尾（final=true）时不再等换行（输出已定稿）。
   * 写回失败/抛错只记日志（旁路纪律：绝不绑架任务执行回路）。
   */
  const writeGeneratedTitle = (missionId: string, title: string): void => {
    if (!deps.onMissionTitle) return;
    try {
      deps.onMissionTitle(missionId, title);
    } catch (error) {
      logger(`[task-service] 标题回写抛错（${missionId}）：${describe(error)}`);
    }
  };

  /**
   * task_run 会话事件埋点器（@since v3.46，task_105 / v3.2b-B6）——
   *   任务**执行路径**的全量事件化（task_started / step / output_tail / completed / failed）。
   * 埋点是旁路：端口缺席（无会话域）或记账失败都只记日志，绝不打断任务执行回路。
   */
  const recorder = createTaskSessionRecorder({
    sessions: deps.sessions,
    ...(deps.titles ? { titles: deps.titles } : {}),
    eventCap: deps.taskEventCap,
    logger,
  });

  /**
   * 任务在状态里的产出摘要（成功收尾时给 completed 事件用）。
   * why 从状态里取而不是从 record.output 取：record.output 在成功路径上是**全文**
   *   （落库口径），事件载荷要的是摘要（core 侧按 MAX_SESSION_TASK_SUMMARY_LEN 收口）。
   */
  const stateTaskSummary = (taskId: string): string | null => {
    const tasks = deps.getState().tasks;
    if (!tasks) return null;
    const found = tasks.find((task) => task.id === taskId);
    return found ? found.output : null;
  };

  /**
   * 会话域记账（@since v3.43，task_093 / v3.2a S3；v3.46 / task_105 改为**全量事件化**）——
   *   任务收尾时给 task_run 会话记上终态事件（completed / failed）并收尾会话。
   * why 终态收在这里而不是执行路径里：服务内**所有**终态路径（守门拦截 / transport 报错 /
   *   防御性收尾 / 外部直发的 task.failed）都恰好流经 settle 一次 —— 在这里收，不会漏也不会重。
   * 成功时的摘要在**状态**里（core/task 的 summarizeTaskOutput 已把全文压成摘要），
   * 失败时的摘要是失败原因（事件里的 task.output）—— 都不搬全文（全文仍在 character_tasks 表）。
   */
  const recordTaskSession = (record: TaskPersistRecord): void => {
    const completed = record.status === 'completed';
    recorder.finish({
      taskId: record.id,
      characterId: record.characterId,
      prompt: record.prompt,
      outcome: completed ? 'completed' : 'failed',
      summary: completed ? (stateTaskSummary(record.id) ?? '') : record.output,
    });
  };

  /**
   * 关联任务单的会话（mission_run，@since v3.43，task_093）—— 与 task_run 同一 LITE 口径：
   *   任务收尾带动任务单收尾，此刻建一条 mission_run 会话并收尾。
   * why 记在任务侧而不是任务单侧：任务单也可能不经任务直接收尾，那是另一条路径（不在本单口径内）；
   *   本单只覆盖"任务带单跑完"这条主路（missionId 非空时）。
   */
  const recordMissionSession = (record: TaskPersistRecord): void => {
    if (!deps.sessions || !record.missionId) return;
    const missionId = record.missionId;
    try {
      const session = deps.sessions.createSession({
        kind: 'mission_run',
        participants: [record.characterId],
        refId: missionId,
        title: `任务单：${missionId}`,
      });
      if (!session) return;
      deps.sessions.closeSession(
        session.id,
        missionCloseReason(record, deps.missionExists)
      );
    } catch (error) {
      logger(`[task-service] 任务单会话记账抛错（${missionId}）：${describe(error)}`);
    }
  };

  /**
   * 终态收尾副作用（task_039）：回流回调 + exp 事件。回调抛错只记日志（fire-and-forget）。
   * 只在状态机相位迁移成功时调（迁移没走动就不算终态，不发生副作用）。
   */
  const settle = (record: TaskPersistRecord, source: ExpSource): void => {
    // 会话域记账（@since v3.43，task_093）：任务到终态 → task_run 会话；有带单则连带 mission_run。
    recordTaskSession(record);
    if (record.missionId) recordMissionSession(record);
    if (deps.onTaskSettled) {
      try {
        deps.onTaskSettled(record);
      } catch (error) {
        logger(`[task-service] 任务收尾回调抛错（${record.id}/${record.status}）：${describe(error)}`);
      }
    }
    if (record.missionId) {
      const missionId = record.missionId;
      if (deps.onMissionSettled) {
        try {
          deps.onMissionSettled(record);
        } catch (error) {
          logger(`[task-service] mission 回报抛错（${record.id}/${missionId}）：${describe(error)}`);
        }
      }
      if (deps.pushNotice) {
        try {
          const at = Date.now();
          deps.pushNotice({
            id: `notice_mission_${record.id}`,
            level: record.status === 'completed' ? 'info' : 'warn',
            text: record.status === 'completed'
              ? '角色任务已完成，已回报关联 mission'
              : '角色任务失败，关联 mission 按中止收尾',
            createdAt: at,
            expiresAt: at + NOTICE_TTL_MS,
            source: 'app/task-service',
            missionId,
          });
        } catch (error) {
          logger(`[task-service] mission 回报 Notice 抛错（${record.id}/${missionId}）：${describe(error)}`);
        }
      }
    }
    emitExp(record.characterId, source);
  };

  /** 总线事件处理：task.queued → 出队执行；其余相位 → 落状态快照 / 审批门驱动。 */
  const handleEvent = (event: WorldEvent): void => {
    switch (event.type) {
      case 'task.queued':
        persist(taskEventToRecord(event.task));
        enqueue(event.task);
        return;
      case 'task.started':
        persist(taskEventToRecord(event.task));
        return;
      case 'task.awaiting_approval':
        // task_049：挂起快照落库 —— output 用**计划全文**（事件里的 task.plan，已剥离标记行；
        // 状态里 output 是空串，全文只在库与流缓冲），plan 列同存。不 settle、不发 exp：
        // 挂起不是终态。busy 不在这里动：挂起时 runTask 的返回值已告知 pump 不释放。
        persist({
          ...taskEventToRecord(event.task),
          output: event.task.plan ?? '',
          plan: event.task.plan ?? '',
        });
        return;
      case 'task.approved':
        // task_049：批准 —— 落回 running 的快照，然后接手续段执行（同 session 续发）。
        persist(taskEventToRecord(event.task));
        resumeApprovedTask(event.task);
        return;
      case 'task.failed':
        // started / failed 的 output 都很短（空串 / 失败原因），快照直接落库。
        // completed 不在这里落：全文在 runTask 手里，那边落（见文件头「落库口径」）。
        // failed 的终态副作用（回流回调 + exp）挂在这里（task_039）：见文件头「终态收尾」 ——
        //   服务内四条失败路径与外部直发的 task.failed 都恰好流经这里一次。
        // task_049：若被收尾的是挂起中的任务（驳回 / 挂起期外部 fail），释放它占住的 busy
        //   并继续泵队列 —— 收尾路径在服务外（命令驱动），不能靠 runTask 的 finally。
        if (awaitingTasks.has(event.task.id)) {
          releaseAwaitingHold(event.task);
        }
        persist(taskEventToRecord(event.task));
        settle(taskEventToRecord(event.task), 'task_failed');
        return;
      case 'task.cancelled':
        // task_047：cancelled 快照照常落库（审计可见），但**不算「跑过」** —— 不发 exp、
        // 不触发 onTaskSettled 回流（见文件头「取消的队列纪律」）。同时把它从待执行队列
        // 剔除：取消事件是同步广播，下次 pump 之前队里就没有它了（取消与出队同帧的竞态面）。
        persist(taskEventToRecord(event.task));
        dequeue(event.task);
        return;
      case 'task.completed':
        return;
      default:
        return;
    }
  };

  /**
   * 释放挂单占住的执行位（task_049，驳回 / 挂起期外部收尾共用）：删挂单 → 释放 busy → 继续泵。
   * 挂起任务占位不占队列（它早已出队），这里不需要动 queues。
   */
  const releaseAwaitingHold = (task: CharacterTask): void => {
    awaitingTasks.delete(task.id);
    busy.delete(task.characterId);
    pump(task.characterId);
  };

  /**
   * 批准接手（task_049，task.approved 事件驱动）：查挂单 → 续段执行。
   * 查不到（重启后残留 awaiting 被批准 / 竞态外部直驱）→ failTask 兑底：状态机不留
   * 无人驱动的 running（挂着比诚实报错更糟 —— 用户以为在跑）。
   */
  const resumeApprovedTask = (task: CharacterTask): void => {
    const entry = awaitingTasks.get(task.id);
    if (!entry) {
      manager.failTask(task.id, TASK_MSG_RESUME_LOST);
      return;
    }
    awaitingTasks.delete(task.id);
    void runContinuation(entry);
  };

  const enqueue = (task: CharacterTask): void => {
    const queue = queues.get(task.characterId) ?? [];
    queue.push(task);
    queues.set(task.characterId, queue);
    pump(task.characterId);
  };

  /**
   * 把一条任务从内存队列剔除（task_047，取消路径专用）。剔除后不 pump：能被取消的只有
   * queued 任务，它不占 busy（busy 是 running 的执行纪律），无位可释放。
   */
  const dequeue = (task: CharacterTask): void => {
    const queue = queues.get(task.characterId);
    if (!queue) return;
    const index = queue.findIndex((item) => item.id === task.id);
    if (index < 0) return;
    queue.splice(index, 1);
  };

  /**
   * 出队防御（task_047）：任务在 WorldState.tasks 里仍是 queued 才执行。
   * tasks 缺省（老快照/裁剪态）时不拦 —— 交给 startTask 的状态机兑底拒绝（同一裁决的
   * 第二道闸，防御性检查不该比真相源更严）。
   */
  const isStillQueued = (taskId: string): boolean => {
    const tasks = deps.getState().tasks;
    if (!tasks) return true;
    return tasks.some((task) => task.id === taskId && task.status === 'queued');
  };

  /**
   * 出队泵：每角色并发 1 —— busy 就不动；队列为空就收工。
   * 守门不通过 → failTask 直达 failed（事件回环会落库），继续泵下一条（队列不被一条死任务堵死）；
   * 已被取消/收尾 → 跳过继续泵（task_047：cancelled 绝不进 transport）。
   */
  const pump = (characterId: string): void => {
    if (busy.has(characterId)) return;
    const queue = queues.get(characterId);
    if (!queue || queue.length === 0) return;
    const task = queue.shift();
    if (!task) return;

    if (!isStillQueued(task.id)) {
      pump(characterId); // 已被取消（或外部收尾）：跳过，接着看下一条
      return;
    }

    const guard = guardTaskCharacter(deps.getState(), characterId);
    if (!guard.ok) {
      // 规格⑤：agent 未检出等 → 任务直接 failed 带原因，不进 transport。
      // task_054：离线拦截补一条轻提示（去重口径见 offlineNotified）。
      if (guard.offline !== undefined) {
        if (!offlineNotified.has(characterId)) {
          offlineNotified.add(characterId);
          if (deps.notify) {
            try {
              deps.notify(`「${guard.offline}」当前离线`);
            } catch (error) {
              logger(`[task-service] 离线拦截提示抛错：${describe(error)}`);
            }
          }
        }
      } else {
        offlineNotified.delete(characterId); // 其它拦截语义不同，重置去重位
      }
      manager.failTask(task.id, guard.reason);
      pump(characterId); // 这条堵死了，接着看下一条
      return;
    }
    offlineNotified.delete(characterId); // 守门通过 = 在线了，去重位重置

    busy.add(characterId);
    // task_049：runTask 返回 'awaiting' = 计划轮挂起 —— busy 不释放、不泵下一条
    //（审批门占位，见文件头）；其余收尾照旧释放并续泵。runTask 内部不抛（自兑底），
    // catch 只是防御性兜底（与 047 同款纪律：任何路径都不许把角色吊死在 busy）。
    void runTask(task, guard.character, guard.kind)
      .then((outcome) => {
        if (outcome === 'awaiting') return;
        busy.delete(characterId);
        pump(characterId); // FIFO 继续：上一条收尾（任何相位）后立刻看下一条
      })
      .catch(() => {
        busy.delete(characterId);
        pump(characterId);
      });
  };

  /** 一轮任务执行的完整生命周期（守门已过）；返回 'awaiting' = 挂起占位（task_049）。 */
  const runTask = async (
    task: CharacterTask,
    character: CharacterView,
    kind: AgentKind
  ): Promise<'awaiting' | 'settled'> => {
    // queued → running：盖 startedAt、单位忙闲派生、发 task.started（事件回环落 running 快照）。
    const started = manager.startTask(task.id);
    if (!started) return 'settled'; // 状态没走动（任务被收尾/不存在）—— 不执行也不重试，防守即可
    // 会话埋点（@since v3.46，task_105）：任务开工 —— 建 task_run 会话 + 记 task_started。
    // 放在 startTask 之后：状态没走动就没有"这单跑过"可言，不建会话。
    recorder.begin({ taskId: task.id, characterId: task.characterId, prompt: task.prompt });
    // @会话引用（@since v3.49，task_107）：任务指令里的 `@session_<id>` → 解析 → 注入块。
    //   引用不存在 / 写法不合法 → **如实报错、任务失败**（不进 transport）：
    //   用户交代的是"接着那场会话做"，拿不到那份上下文还照跑 = 答非所问。
    const references = resolveSessionReferences(task.prompt, deps.references);
    if (!references.ok) {
      // 失败收尾走既有路径（failTask → task.failed 事件 → settle → 会话记 failed 事件），
      // 与守门拦截同一处置：不自己另写一条收尾（那样会与事件路径记两遍）。
      manager.failTask(task.id, references.reason ?? '引用的会话无法解析');
      return 'settled';
    }
    // 引用留痕（@since v3.49，task_107）：本任务的 task_run 会话各记一条 'reference' 事件。
    for (const targetSessionId of references.targetIds) {
      recorder.reference(task.id, targetSessionId);
    }
    const planFirst = personaPlanFirst(character.persona.trim());
    // @since v3.11（task_155）标题待生成？—— 任务单标题还是占位「生成中…」时，
    //   向 worker 要一个标题（它在第一轮回报里给），拿到后写回任务单。
    const missionId = task.missionId ?? null;
    const titlePending = missionId !== null && deps.missionTitle?.(missionId) === MISSION_TITLE_PENDING;
    let titleApplied = false;
    /** 标题回写（@since v3.11，task_155）：首轮回报给出标题 → 写回任务单（只写一次）。 */
    const applyGeneratedTitle = (text: string, final = false): void => {
      if (titleApplied || !titlePending || missionId === null) return;
      // 流式期要等首行完整（出现换行）；收尾时输出已定稿，不再等。
      if (!final && !text.includes('\n')) return;
      const title = extractGeneratedTaskTitle(text);
      if (!title) return;
      titleApplied = true;
      writeGeneratedTitle(missionId, title);
    };
    // persona 每次内嵌（常规任务会话隔离 → 无续发，每条任务都是首发）；plan-first 追加计划指令
    //（见文件头）。task_053：首发语义 → 同样附战场现状块（每任务一次；快照取件异常吞掉不绑架任务）。
    // task_107：@会话引用块插在 persona 之后、战场现状块之前（上下文头部）。
    // task_170（M0-06）：项目契约块与战场现状块**同一注入点**（这里取一次快照）——
    //   独立标签（不嵌进战场现状块内）、位置在角色设定之后、引用会话之前；**只在首发注入**
    //   （续发路径 buildResumedTaskPrompt 不传 ⇒ 续段 prompt 不含项目块）。
    const prompt = buildTaskPrompt(
      character,
      task.prompt,
      resolveStratixContextBlock(deps.provideContext, character.id, logger) || undefined,
      references.block.length > 0 ? references.block : undefined,
      {
        askTitle: titlePending,
        projectBlock: resolveProjectContextBlock(deps.provideProjectContext, logger) || undefined,
      }
    );
    let output = '';
    // task_049：计划轮要记 session id（批准后同 session 续发）；常规任务恒 null。
    let sessionId: string | null = null;

    try {
      const transport = transportFor(kind);
      // 会话埋点（@since v3.46，task_105）：关键节点一 —— 执行启动（transport 已就位）。
      recorder.step(task.id, '执行开始', `agent=${kind}`);
      // sessionId 恒 null：常规任务会话一次性，不复用聊天会话也不跨任务续接（见文件头「会话隔离」）。
      // cwd：派发链的唯一取值点（task_166 / §8 M0-02）—— 取活跃实例的项目根；M0 下为 undefined。
      for await (const event of transport.spawn(prompt, {
        sessionId: null,
        timeoutMs,
        cwd: resolveDispatchCwd(cwdProvider, logger),
      })) {
        if (event.type === 'message') {
          output += event.text;
          emitChunk(task.characterId, event.text); // 实时 tail 视图（task_046）：原序转发，不拦流
          applyGeneratedTitle(output); // 标题回写（task_155）：首行一完整就写回，不必等任务跑完
          continue;
        }
        if (event.type === 'session') {
          // task_049：plan-first 记下会话 id（批准续发复用）；常规任务仍然忽略。
          if (planFirst) sessionId = event.sessionId;
          continue;
        }
        if (event.type === 'done') {
          if (planFirst) sessionId = event.sessionId ?? sessionId;
          // 标题回写（@since v3.11，task_155）：收尾前把生成标题落上去 ——
          //   任务一收尾，任务单就进终态，终态不再改写（core/mission 的铁律）。
          applyGeneratedTitle(output, true);
          // task_049：挂起检测 —— 只对被指示过「先出计划」的任务生效（没指令就没有协议
          // 义务，普通任务碰巧输出标记行也只是文本）。命中 → 挂起占位，return 'awaiting'
          //（不释放 busy、不 settle —— 门等的是用户裁决，不是时钟）。
          if (planFirst) {
            const draft = extractPlanDraft(output);
            if (draft !== null) {
              const awaiting = manager.requestApproval(task.id, draft);
              if (awaiting) {
                awaitingTasks.set(task.id, {
                  task: awaiting,
                  character,
                  kind,
                  sessionId,
                  referenceBlock: references.block,
                });
                // 会话埋点（@since v3.46，task_105）：关键节点二 —— 计划待批准（门在等人裁决）。
                recorder.step(task.id, '计划待批准', draft);
                return 'awaiting';
              }
              // 状态机没走动（外部已收尾）—— 落普通收尾路径：completeTask 同样会被拒，
              // 与既有「终态不改写历史」口径一致。
            }
          }
          // 空输出也给一句占位（与 chat 的空回复占位同一口径），失败/成功都有可读的 output。
          const fullText = output.length > 0 ? output : '（任务完成，无文本输出）';
          // 会话埋点（@since v3.46，task_105）：输出尾部（尾 500 字，core 侧收口）。
          // 记在 completeTask **之前**：收尾事件（completed）之后会话即终态，终态拒收事件。
          recorder.outputTail(task.id, output);
          const finished = manager.completeTask(task.id, fullText); // 状态里存摘要
          // 成果物解析（task_048）：同步算、永不抛（解析器内部兜底空）；解析不出 → 缺省字段。
          // 空输出（占位文案）不解析 —— 占位符不是执行产出，解析它只会造出假 summary。
          const artifactsJson =
            output.length > 0 ? serializeTaskArtifacts(parseTaskArtifacts(fullText)) : '';
          const record: TaskPersistRecord = {
            ...taskEventToRecord(finished ?? started),
            status: 'completed',
            output: fullText, // 库里存全文（状态/事件里只有摘要）
            ...(artifactsJson.length > 0 ? { artifacts: artifactsJson } : {}),
          };
          persist(record);
          // 终态副作用（task_039）：回流回调拿全文 + 发 exp。只在状态机确认收尾时发生
          // （finished 为 null = 状态没走动，不产生副作用；防御性落库照旧，见上面 record 兑底）。
          if (finished) settle(record, 'task_completed');
          return 'settled';
        }
        if (event.type === 'error') {
          // 失败不自动重试（规格⑤）：failed 即终态；事件回环落 failed 快照（output=原因）。
          // task_054：exit 异常（非用户中断）旁路上报健康监测（审计 unhealthy）。
          reportTransportError(kind, event.code);
          // 会话埋点（@since v3.46，task_105）：失败前已产出的部分输出留个尾巴（失败也有产出）。
          recorder.outputTail(task.id, output);
          manager.failTask(task.id, taskErrorText(event.code, event.message));
          return 'settled';
        }
        // tool_use / tool_result：任务结果只收 message 文本，工具回执不进输出。
      }
      // 流自然结束却没有 done / error —— runtime 契约上不该发生，防御性失败收尾。
      recorder.outputTail(task.id, output);
      manager.failTask(task.id, 'transport 事件流异常结束（无 done 事件）');
    } catch (error) {
      // runtime 不该抛（内部全转 error 事件）；真抛了也要给任务一个 failed 收尾，别把它吊死在 running。
      recorder.outputTail(task.id, output);
      manager.failTask(task.id, taskErrorText('cli_error', describe(error)));
    }
    return 'settled';
  };

  /**
   * 批准后的续段执行（task_049，task.approved 事件驱动；busy 仍被挂起占着 —— 无需重占）。
   * 与 runTask 同一收尾式样，但：任务已是 running（不 startTask）；续发优先同 session
   *（上下文里已有 persona 与计划全文），丢 session 退回首发拼装（buildResumedTaskPrompt）；
   * 续段输出里的 PLAN_WAIT 只当普通文本（同一任务的门只用一次 —— 批准后不再二次挂起）。
   * busy 释放放在 finally：任何路径都不许把角色吊死在审批门后。
   */
  const runContinuation = async (entry: AwaitingEntry): Promise<void> => {
    const { task, character, kind, sessionId } = entry;
    const plan = task.plan ?? '';
    const prompt =
      sessionId !== null
        ? TASK_APPROVAL_RESUME_PROMPT
        : buildResumedTaskPrompt(
            character,
            task,
            plan,
            // 丢 session 的重讲 = 首发语义重建（task_053）：同样附战场现状块。
            resolveStratixContextBlock(deps.provideContext, character.id, logger) || undefined,
            // 同样附 @会话引用块（task_107）：重讲也得是用户交代的那件事。
            entry.referenceBlock.length > 0 ? entry.referenceBlock : undefined
            // ⚠️ 不传项目契约块（task_170 / §8 M0-06）：续发**不重注**
            //   （dsh 的 session 是 append-only 事件 log，resume 重放历史 ⇒ 首发那条里的
            //     <stratix-project> 仍在上下文里；再注一遍就是重复注入）。
          );
    let output = '';
    try {
      const transport = transportFor(kind);
      // 会话埋点（@since v3.46，task_105）：关键节点三 —— 计划已批准，续段执行。
      recorder.step(task.id, '计划已批准', '续段执行');
      for await (const event of transport.spawn(prompt, {
        sessionId,
        timeoutMs,
        // cwd：派发链的唯一取值点（task_166 / §8 M0-02）—— 同 runTask 一口径。
        cwd: resolveDispatchCwd(cwdProvider, logger),
      })) {
        if (event.type === 'message') {
          output += event.text;
          emitChunk(task.characterId, event.text);
          continue;
        }
        if (event.type === 'done') {
          const fullText = output.length > 0 ? output : '（任务完成，无文本输出）';
          // 会话埋点（@since v3.46，task_105）：输出尾部（尾 500 字）—— 记在收尾之前。
          recorder.outputTail(task.id, output);
          const finished = manager.completeTask(task.id, fullText);
          const artifactsJson =
            output.length > 0 ? serializeTaskArtifacts(parseTaskArtifacts(fullText)) : '';
          const record: TaskPersistRecord = {
            ...taskEventToRecord(finished ?? task),
            status: 'completed',
            output: fullText,
            ...(artifactsJson.length > 0 ? { artifacts: artifactsJson } : {}),
            ...(plan.length > 0 ? { plan } : {}), // 溯源：这单是按哪份计划做完的
          };
          persist(record);
          if (finished) settle(record, 'task_completed');
          return;
        }
        if (event.type === 'error') {
          // task_054：审批续段的 exit 异常同样上报健康审计（与 runTask 同一口径）。
          reportTransportError(kind, event.code);
          // 会话埋点（@since v3.46，task_105）：失败前的部分输出留个尾巴。
          recorder.outputTail(task.id, output);
          manager.failTask(task.id, taskErrorText(event.code, event.message));
          return;
        }
        // session / tool_*：同 runTask 口径（session 已在手；任务结果只收 message 文本）。
      }
      recorder.outputTail(task.id, output);
      manager.failTask(task.id, 'transport 事件流异常结束（无 done 事件）');
    } catch (error) {
      recorder.outputTail(task.id, output);
      manager.failTask(task.id, taskErrorText('cli_error', describe(error)));
    } finally {
      busy.delete(task.characterId);
      pump(task.characterId);
    }
  };

  let stop: (() => void) | null = null;

  return {
    // 直连 core/bus 单例（与 game-save-coordinator 同一手法：app → core 是合法依赖方向，
    // 单测隔离靠 resetBus，不必为订阅口多开一层注入）。
    start: (): (() => void) => {
      if (stop) return stop;
      const off = onWorldEvent(handleEvent);
      stop = () => {
        off();
        stop = null;
      };
      return stop;
    },

    isBusy: (characterId: string): boolean => busy.has(characterId),

    queueLength: (characterId: string): number => queues.get(characterId)?.length ?? 0,
  };
}
