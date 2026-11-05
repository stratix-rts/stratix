/**
 * 文件职责：**service 进程侧的任务执行环接线**（前后端分离 A2 / task_078）——
 *   把「task.queued → 每角色 FIFO 出队 → 并发 1 → 跑一轮 CLI → 相位回报 taskManager」这条
 *   执行环从「渲染进程 → cliChat IPC → Electron main spawn」搬到 **service 进程**：
 *   service 直接 spawn 子进程（cli-transport 的 node-process 工厂），中途不经任何 IPC ——
 *   渲染进程关闭 / 重启不影响任务执行（拓扑见 docs/SERVICE-SPLIT-PLAN.md §2）。
 *
 * 输入：core store（世界态真相源）+ core task manager（相位回报面）+ transport 工厂
 *   （缺省 = 直接 spawn 子进程的那种）+ task-service 的其余可选端口（落库 / 回流 / 通知 / chunk ...）。
 * 输出：TaskService（执行环本体：start / isBusy / queueLength）。
 *
 * 禁止事项：
 *   1. **复制一份执行环** —— 执行环本体复用 app/services/task-service.ts（同一份 FIFO / 并发 1 /
 *      守门 / 相位回报逻辑）；渲染侧与服务侧共用一份实现，两边只是 transport 的来源不同
 *      （渲染侧 = IPC 桥，service 侧 = 直接 spawn）。本模块只做「接线」；
 *   2. 改 cli-transport —— 它已是注入式、零 Electron 耦合（模块零改动是本单的验收项），
 *      本模块只调它的公开出口（createTransportFor）；
 *   3. 在这里做守门 / 状态判断 —— 守门在 task-service（guardTaskCharacter），相位裁决在 core；
 *   4. 引入新依赖 —— 只用既有 core 契约 + 既有 app/services 模块（不装新包）；
 *   5. 直接改 store —— 写操作一律走 core 的 manager（裁决在 core 是铁律）。
 *
 * ============ 忙碌锁语义（与渲染侧同一份实现，故语义必然一致）============
 * 每角色并发 1：busy 集合按 characterId 计（同一角色同一时刻只有一轮任务在跑），
 *   跨角色并行。审批门挂起（plan-first）时 busy **不释放**（门 = 「这个角色先停一停」）——
 *   详见 app/services/task-service.ts 文件头，本模块不另立一套。
 *
 * ============ agent 检出（detectedAgents）============
 * 出队守门读 WorldState.detectedAgents（真相源 = store，渲染侧由主进程探测经 IPC 并入，
 * service 侧由调用方用 store.setDetectedAgents 写入）。**service 进程内的探测接线归 A4**
 * （gateway 接线单）；未接入探测时守门会判「该 CLI 未安装」并把任务直接 failed ——
 *   如实失败，不假装有人能跑（铁律④：绝不假装成功）。
 *
 * @since v3.41（task_078 / service-split A2）。
 */

import { createTransportFor } from '../../app/services/cli-transport';
import type { CliAdapterOptions } from '../../app/services/cli-transport';
import type { SpawnOptions, TransportEvent } from '../../app/services/cli-transport/transport';
import { createTaskService } from '../../app/services/task-service';
import type { TaskService, TaskServiceDeps, TaskTransportFactory, TaskTransportPort } from '../../app/services/task-service';
import type { CoreStore } from '../../core/store';
import type { TaskManager } from '../../core/task';
import { isCustomAgentKind } from '../../core/types';
import type { AgentKind } from '../../core/types';

// ============================================================================
// 端口
// ============================================================================

/**
 * task-service 的**可选端口全集**（去掉两个由 service 自己提供的面）。
 * why 用 Omit 而不是手抄一遍：端口形状以 app/services/task-service.ts 为唯一真相源，
 *   那边加端口，这里自动跟随（抄一份必然漂移）。
 */
export type ServiceTaskExecutionPorts = Omit<
  TaskServiceDeps,
  'getState' | 'taskManager' | 'createTransport'
>;

/** service 侧执行环的依赖。 */
export interface ServiceTaskExecutionDeps extends ServiceTaskExecutionPorts {
  /** 世界态持有者（真相源；守门 / 出队防御都从这里读）。 */
  readonly store: CoreStore;
  /** core 任务域写入面（相位回报：start / complete / fail）。 */
  readonly taskManager: TaskManager;
  /**
   * transport 工厂（缺省 = 直接 spawn 子进程的那种，见 createNodeCliTransportFactory）。
   * 单测注入 fake adapter（echo 型测试替身）；生产走真实子进程。
   */
  readonly createTransport?: TaskTransportFactory;
}

/** node-process 工厂的可选参数。 */
export interface NodeCliTransportFactoryOptions {
  /** 各家 adapter 的可选参数（缺省 = adapter 自身的缺省值）。 */
  readonly adapterOptions?: CliAdapterOptions;
  /** 日志口（cli-transport 的运行日志；缺省静默）。 */
  readonly logger?: (line: string) => void;
}

// ============================================================================
// transport 工厂
// ============================================================================

/**
 * 造一条「明确失败」的 transport（自定义 agent 在 service 侧暂不支持执行时用）。
 * why 不抛异常而是走事件流：传输层的失败语义是 error 事件（runtime 契约），
 *   抛异常会被上层兜底成「CLI 报错」，把「不支持」说成「坏了」—— 原因会失真。
 */
function unsupportedTransport(kind: AgentKind): TaskTransportPort {
  const message = `service 进程暂不支持执行自定义 agent（${kind}）：其执行模板取自注册表，注册表接线尚未归入 service`;
  return {
    spawn: (_prompt: string, _options?: SpawnOptions): AsyncIterable<TransportEvent> => ({
      async *[Symbol.asyncIterator](): AsyncIterator<TransportEvent> {
        yield { type: 'error', message, code: 'cli_error' };
      },
    }),
  };
}

/**
 * **service 进程侧的 transport 工厂** —— agent 种类 → 直接 spawn 子进程的 transport。
 * 与渲染侧的差别只有这一处：渲染侧经 cliChat IPC 让 Electron main spawn（chat-transport-bridge），
 *   service 侧在本进程 spawn（cli-transport 的 node-process 工厂，Node 环境自带 child_process）。
 * cli-transport 模块本身零改动 —— 它本来就是注入式、零 Electron 耦合的。
 *
 * 自定义 agent（`custom:<id>`）：其 adapter 要按**注册行模板**动态构造（注册行在主进程 DB 里，
 *   归 A3 存储归一 / A4 gateway 接线），本单不接 —— 如实返回一条失败 transport（原因不失真）。
 */
export function createNodeCliTransportFactory(
  options: NodeCliTransportFactoryOptions = {}
): TaskTransportFactory {
  return (kind: AgentKind): TaskTransportPort => {
    if (isCustomAgentKind(kind)) return unsupportedTransport(kind);
    return createTransportFor(kind, options.adapterOptions ?? {}, { logger: options.logger });
  };
}

// ============================================================================
// 执行环
// ============================================================================

/**
 * 装一个**跑在 service 进程里**的任务执行环。
 *
 * 与渲染侧的唯一差别：transport 工厂的来源（这里直接 spawn 子进程）；
 *   执行语义（FIFO / 并发 1 / 守门 / 相位回报 / 审批门 / 取消纪律）全部来自同一份
 *   app/services/task-service.ts —— 不复制、不分叉（见文件头禁止事项①）。
 *
 * 注意 start() 的时机：必须在 core runtime 启动**之后**调 —— task.queued 事件由 runtime
 *   处理命令时发出，晚订阅会漏掉启动前那一批（对启动前派发的任务无害：没有人跑它们）。
 */
export function createServiceTaskExecution(deps: ServiceTaskExecutionDeps): TaskService {
  return createTaskService({
    getState: () => deps.store.getState(),
    taskManager: deps.taskManager,
    createTransport: deps.createTransport ?? createNodeCliTransportFactory({ logger: deps.logger }),
    persistTask: deps.persistTask,
    // 会话域写入面（@since v3.43，task_093）：任务收尾时记 task_run / mission_run 会话（LITE 两事件）。
    sessions: deps.sessions,
    onTaskSettled: deps.onTaskSettled,
    onMissionSettled: deps.onMissionSettled,
    // 编组任务存在性读口（@since v3.8 / task_143）：任务收尾时标出"回报落空"，
    //   让 mission_run 会话的收尾原因如实写明（回报去向可追踪）。
    missionExists: deps.missionExists,
    // 标题回写（@since v3.11，task_155）：worker 首轮回报给出标题 → 写回任务单
    //   （占位「生成中…」→ 生成值）。端口在组合根接（stratix-service.ts）。
    missionTitle: deps.missionTitle,
    onMissionTitle: deps.onMissionTitle,
    pushNotice: deps.pushNotice,
    onTaskChunk: deps.onTaskChunk,
    expWeight: deps.expWeight,
    provideContext: deps.provideContext,
    timeoutMs: deps.timeoutMs,
    logger: deps.logger,
    onTransportError: deps.onTransportError,
    notify: deps.notify,
  });
}
