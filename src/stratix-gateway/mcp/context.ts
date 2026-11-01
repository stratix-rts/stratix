/**
 * 文件职责：数据面端口的生产实现 —— 把 MCP 接到 **core 总线 + core store + SQLite 投影**上。
 * 输入：McpHost 的四个方法调用（读世界态 / 投递 HudCommand / 读任务全文输出 / 跑一轮角色对话）。
 * 输出：core 的 WorldState 快照；core 总线上的命令；SQLite tasks 表里的输出全文；一轮对话的结果。
 * 禁止事项：
 *   1. 在这里自己记状态（自己记一张表做分页 / 缓存）—— 一旦如此，MCP 的视图会和战场漂移，
 *      而 MCP 是没有人看的那一侧，漂移不会有人发现（docs/MCP-SPEC.md §3.1）；
 *   2. 绕过 core 总线直接改 store —— 写操作必须走 HudCommand，由 core 状态机裁决；
 *   3. 把任务全文回灌进 WorldState —— 全文只从 SQLite 读，状态里只有摘要；
 *   4. 依赖具体传输 —— 本文件与 stdio / HTTP 无关（两种模式共享同一份 handler）。
 */

import type { SqliteDatabaseLike } from '../../app/services/persistence/game-save-dao';
import { emitCommand } from '../../core/bus';
import { worldStore, type CoreStore } from '../../core/store';
import type { HudCommand } from '../../core/types';
import { getDatabase } from '../../stratix-database';
import { readTaskOutputFromDb } from '../service/storage';

import type { ChatRoundOutcome, McpHost } from './types';

export interface CoreMcpHostOptions {
  /** 状态持有者；缺省 = core/store 的 worldStore 单例（与 hud / world 两侧同一份世界态）。 */
  readonly store?: CoreStore;
  /** 命令投递口；缺省 = core/bus 的 emitCommand（core runtime 消费后落状态机）。 */
  readonly dispatch?: (command: HudCommand) => void;
  /** 任务全文输出读取口；缺省 = SQLite 的 character_tasks 表。 */
  readonly readTaskOutput?: (taskId: string) => Promise<string | null>;
  /**
   * 角色对话口（跑一轮、等回复）；缺省 = 不提供。
   *
   * why 缺省不接：对话服务（app 层 chat-service）住在**渲染进程**（抽屉 DOM + per-character
   * 忙碌锁在那儿），而 gateway 是另一个进程 —— 在这里替它造一套会毁掉"同一角色同时只跑一轮"
   * 这条约束，也会造出第二份会话真相。要接就把渲染侧那一轮的入口注入进来。
   */
  readonly sendChatRound?: (characterId: string, text: string) => Promise<ChatRoundOutcome>;
}

/**
 * 读任务输出全文（SQLite 投影）。
 *
 * why 从库里读而不是从状态里读：core 的 CharacterTask.output **只存摘要**
 * （上限 MAX_TASK_SUMMARY_LEN = 2000），全文由 task-service 在收尾时落库
 * （docs/MCP-SPEC.md §2.3）。库里没有这一条（任务刚建、尚未落库、或库未初始化）时返回 null，
 * 由工具回退到摘要 —— 绝不编造。
 *
 * ============ 拓扑（A3 / task_079 之后）：这里的直读为什么合法 ============
 * 铁律 6：SQLite 只由 **service 进程**打开写；其余进程经 API 读。
 *   MCP host 挂在 gateway 进程里，而 gateway 进程**就是** service 进程（同一份存储件、
 *   同一个连接）—— 这里的直读是**同进程读**（读自己进程开的库），不是「第二个进程开同一个库」，
 *   因此合法。跨进程读（例如浏览器 / 外部 client）走 service 侧的只读 API
 *   （GET /api/storage/tasks/:id/output，见 api/routes/storage.ts）。
 *   库句柄与读口由 service/storage.ts 统一持有（同一句 SQL 两处共用，不各写一份）。
 */
export function readTaskOutputFromDatabase(taskId: string): string | null {
  try {
    const db = getDatabase().getDatabase();
    return readTaskOutputFromDb(db as unknown as SqliteDatabaseLike, taskId);
  } catch {
    // 库未初始化 / 表不存在 / 查询失败 —— 一律按「没有全文」处理，不让读失败打断工具调用。
    return null;
  }
}

/**
 * 构造生产用的 McpHost。
 *
 * ★ 拓扑前提（接线时必须知道的一件事）：core 的运行时（core/runtime.ts）跑在**持有世界态的进程**里，
 * 本 host 只提供「读状态 + 投命令」两个入口 —— 该进程是否挂着 core runtime，决定了 MCP 工具
 * 能不能看见战场、派单能不能落地。派单后本 host 会回读状态核对结果：命令没人接管时
 * 工具返回 internal_error（明说"没落地"），绝不假装成功。
 */
export function createCoreMcpHost(options: CoreMcpHostOptions = {}): McpHost {
  const store = options.store ?? worldStore;
  const dispatch = options.dispatch ?? emitCommand;
  const readOutput = options.readTaskOutput ?? readTaskOutputFromDatabase;
  const sendChatRound = options.sendChatRound;

  const host: McpHost = {
    getWorldState: () => store.getState(),
    dispatchCommand: (command: HudCommand) => {
      dispatch(command);
    },
    readTaskOutput: async (taskId: string) => readOutput(taskId),
  };

  // 对话端口是可选的：没接就不挂这个键（工具据此如实报"本进程没有可用的角色对话通路"）。
  if (sendChatRound) {
    return {
      ...host,
      sendChatRound: (characterId: string, text: string) => sendChatRound(characterId, text),
    };
  }
  return host;
}
