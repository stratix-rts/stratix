/**
 * 文件职责：**角色任务执行服务**（task_037）—— 每角色 FIFO 队列、并发 1，把 core/task 派出的
 *   queued 任务经 CLI transport 执行完一个回合，并把相位回报给 core（start / complete / fail）。
 * 输入：core 总线上的 task.* 生命周期事件（task.queued 出队、其余转发落库）；
 *   WorldState 快照（characters + detectedAgents，守门用）；注入的 transport 工厂。
 * 输出：core TaskManager 的相位迁移调用（写 WorldState.tasks + 单位忙闲派生 + 再发事件）；
 *   任务落库回调（tasks 表：状态快照随事件落，**全文输出**随 complete 落 —— 状态里只有摘要）。
 * 禁止事项：
 *   1. import child_process / node-process / cli-transport 的**实现**文件 —— 本服务跑在渲染层
 *      bundle 里，子进程一律在 Electron 主进程（经 IPC 桥），这里只 import transport.ts 的纯类型；
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
 * ============ 终态收尾的副作用：结果回流 + exp 事件（task_039）============
 * 任务到终态（completed / failed）时额外做两件事，两者都是 fire-and-forget（抛错只记日志，
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
 *   v3.30（task_054）追加离线守门（units.online 位拦截 + toast 去重）与 transport 异常上报口。
 */

import { emitWorldEvent, onWorldEvent } from '../../core/bus';
import { personaPlanFirst } from '../../core/character/persona';
import type {
  AgentKind,
  CharacterTask,
  CharacterView,
  ExpSource,
  TaskStatus,
  WorldEvent,
  WorldState,
} from '../../core/types';
import { TASK_PLAN_WAIT_MARKER } from '../../core/types';
import type { TaskManager } from '../../core/task';
import type { SpawnOptions, TransportErrorCode, TransportEvent } from './cli-transport/transport';
import { parseTaskArtifacts, serializeTaskArtifacts } from './task-artifacts';
import { defaultExpWeight } from './exp-config';
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
 * 任务指令拼装：角色设定引导语 + persona + 任务指令。
 * 任务会话是**一次性**的（每轮独立会话，无续发），所以每次都内嵌 persona ——
 * 与 chat-service.buildFirstPrompt 的差别只有措辞（任务语境 vs 对话语境），拼装式样刻意一致。
 * @since v3.25（task_049）：plan-first 人设（personaPlanFirst）追加尾部指令 —— 要求 agent
 * 先输出执行计划并以单独一行 TASK_PLAN_WAIT_MARKER 结束。标记词从 core 契约取，不另抄一份
 * （prompt 指令、挂起检测、展示剥离三方必须是同一个词，见 types.ts 的 TASK_PLAN_WAIT_MARKER）。
 * @since v3.29（task_053）可选第三参 contextBlock：<stratix-context> 战场现状块。任务会话
 * 一次性 → 每次执行都是首发语义，每条任务的 prompt 都注入（插入位置在 persona 之后、
 * 【任务指令】之前；plan-first 的【工作方式】尾部指令恒在最后）。传 undefined 走原路径。
 */
export function buildTaskPrompt(character: CharacterView, taskPrompt: string, contextBlock?: string): string {
  const persona = character.persona.trim();
  const hasContext = contextBlock !== undefined && contextBlock.length > 0;
  if (persona.length === 0 && !hasContext) return taskPrompt;
  const parts: string[] = [
    `你将扮演「${character.name}」这个角色执行任务，请全程保持角色设定一致。`,
  ];
  if (persona.length > 0) parts.push(`【角色设定】\n${persona}`);
  if (hasContext) parts.push(contextBlock as string);
  parts.push(`【任务指令】\n${taskPrompt}`);
  const base = parts.join('\n\n');
  return personaPlanFirst(persona) ? `${base}\n\n【工作方式】\n${TASK_PLAN_INSTRUCTION}` : base;
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
 */
export function buildResumedTaskPrompt(
  character: CharacterView,
  task: CharacterTask,
  plan: string,
  contextBlock?: string
): string {
  return [
    buildTaskPrompt(character, task.prompt, contextBlock),
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
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
   * 终态收尾副作用（task_039）：回流回调 + exp 事件。回调抛错只记日志（fire-and-forget）。
   * 只在状态机相位迁移成功时调（迁移没走动就不算终态，不发生副作用）。
   */
  const settle = (record: TaskPersistRecord, source: ExpSource): void => {
    if (deps.onTaskSettled) {
      try {
        deps.onTaskSettled(record);
      } catch (error) {
        logger(`[task-service] 任务收尾回调抛错（${record.id}/${record.status}）：${describe(error)}`);
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
    const planFirst = personaPlanFirst(character.persona.trim());
    // persona 每次内嵌（常规任务会话隔离 → 无续发，每条任务都是首发）；plan-first 追加计划指令
    //（见文件头）。task_053：首发语义 → 同样附战场现状块（每任务一次；快照取件异常吞掉不绑架任务）。
    const prompt = buildTaskPrompt(
      character,
      task.prompt,
      resolveStratixContextBlock(deps.provideContext, character.id, logger) || undefined
    );
    let output = '';
    // task_049：计划轮要记 session id（批准后同 session 续发）；常规任务恒 null。
    let sessionId: string | null = null;

    try {
      const transport = transportFor(kind);
      // sessionId 恒 null：常规任务会话一次性，不复用聊天会话也不跨任务续接（见文件头「会话隔离」）。
      for await (const event of transport.spawn(prompt, { sessionId: null, timeoutMs })) {
        if (event.type === 'message') {
          output += event.text;
          emitChunk(task.characterId, event.text); // 实时 tail 视图（task_046）：原序转发，不拦流
          continue;
        }
        if (event.type === 'session') {
          // task_049：plan-first 记下会话 id（批准续发复用）；常规任务仍然忽略。
          if (planFirst) sessionId = event.sessionId;
          continue;
        }
        if (event.type === 'done') {
          if (planFirst) sessionId = event.sessionId ?? sessionId;
          // task_049：挂起检测 —— 只对被指示过「先出计划」的任务生效（没指令就没有协议
          // 义务，普通任务碰巧输出标记行也只是文本）。命中 → 挂起占位，return 'awaiting'
          //（不释放 busy、不 settle —— 门等的是用户裁决，不是时钟）。
          if (planFirst) {
            const draft = extractPlanDraft(output);
            if (draft !== null) {
              const awaiting = manager.requestApproval(task.id, draft);
              if (awaiting) {
                awaitingTasks.set(task.id, { task: awaiting, character, kind, sessionId });
                return 'awaiting';
              }
              // 状态机没走动（外部已收尾）—— 落普通收尾路径：completeTask 同样会被拒，
              // 与既有「终态不改写历史」口径一致。
            }
          }
          // 空输出也给一句占位（与 chat 的空回复占位同一口径），失败/成功都有可读的 output。
          const fullText = output.length > 0 ? output : '（任务完成，无文本输出）';
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
          manager.failTask(task.id, taskErrorText(event.code, event.message));
          return 'settled';
        }
        // tool_use / tool_result：任务结果只收 message 文本，工具回执不进输出。
      }
      // 流自然结束却没有 done / error —— runtime 契约上不该发生，防御性失败收尾。
      manager.failTask(task.id, 'transport 事件流异常结束（无 done 事件）');
    } catch (error) {
      // runtime 不该抛（内部全转 error 事件）；真抛了也要给任务一个 failed 收尾，别把它吊死在 running。
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
            resolveStratixContextBlock(deps.provideContext, character.id, logger) || undefined
          );
    let output = '';
    try {
      const transport = transportFor(kind);
      for await (const event of transport.spawn(prompt, { sessionId, timeoutMs })) {
        if (event.type === 'message') {
          output += event.text;
          emitChunk(task.characterId, event.text);
          continue;
        }
        if (event.type === 'done') {
          const fullText = output.length > 0 ? output : '（任务完成，无文本输出）';
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
          manager.failTask(task.id, taskErrorText(event.code, event.message));
          return;
        }
        // session / tool_*：同 runTask 口径（session 已在手；任务结果只收 message 文本）。
      }
      manager.failTask(task.id, 'transport 事件流异常结束（无 done 事件）');
    } catch (error) {
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
