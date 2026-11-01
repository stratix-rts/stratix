/**
 * 文件职责：**service 进程的启动接线**（前后端分离 A4 / task_080）——
 *   把 A1 组合根 / A2 执行环 / A3 存储三件在**进程启动时**装起来，
 *   并补上两件「进程起来才有」的事：世界态恢复（角色 → 单位）与本地 CLI agent 探测。
 * 输入：可选的存储件（A3）/ 库句柄（恢复用）/ 可选开关（是否探测）。
 * 输出：一个可停的 service 句柄（{ service, restore, detection, stop }）。
 * 禁止事项：
 *   1. 在这里做业务判断（等级曲线 / 任务相位 / 角色合法性）—— 那些真相在 core，本模块只接线；
 *   2. 自己开库 —— 开库归存储件工厂（service/storage.ts）与 stratix-database 的进程内单例，
 *      本模块只拿现成的句柄用（不重复开同一个文件）；
 *   3. 吞掉 boot 失败 —— 组合根装不起来就是装不起来，调用方（gateway 启动序列）据此退出进程，
 *      不裸奔一个「路由已挂但大脑没醒」的半启动状态；
 *   4. 在这里塞渲染层 / 宿主层的东西（DOM / ipc / preload）—— 本模块必须能在纯 node 里跑。
 *
 * 装配顺序（why 这个顺序）：
 *   ① 组合根（A1）：core runtime 起来 → 命令开始落地（这是「大脑醒了」的那一刻）；
 *   ② 世界态恢复（A4）：角色档案从库里回来 → 写进同一份 store（MCP 立刻见真世界态）；
 *   ③ agent 探测（A4，后台）：detectedAgents 逐条进 store → 执行环的出队守门才认得出
 *      「这个 CLI 装了没」——放最后是因为它最慢（最坏 11×10s），不该挡住 boot。
 *
 * @since v3.43（task_080 / service-split A4）。
 */

import type { SqliteDatabaseLike } from '../../app/services/persistence/game-save-dao';
import type { CoreStore } from '../../core/store';

import { startAgentDetection, type ServiceAgentDetection } from './agent-detection';
import type { ServiceStorage } from './storage';
import { createStratixService, type StratixService } from './stratix-service';
import { restoreWorldFromDatabase, type WorldRestoreResult } from './world-restore';

/** 启动接线的参数（全部可缺席；缺席即降级，不报错）。 */
export interface ServiceBootOptions {
  /** 存储件（A3）—— 给出即：任务全文 / 经验事件由 service 侧独占写。 */
  readonly storage?: ServiceStorage;
  /** 库句柄（恢复世界态用）。缺省 = 不恢复（空世界起步）。 */
  readonly db?: SqliteDatabaseLike;
  /** 世界态持有者（缺省 = core/store 的 worldStore 单例，与 MCP 数据面同一份）。 */
  readonly store?: CoreStore;
  /** 是否起本地 CLI agent 探测（缺省 = 起；执行环的出队守门依赖它）。 */
  readonly detectAgents?: boolean;
  /** 日志口（缺省 = console.log）。 */
  readonly logger?: (line: string) => void;
}

/** 启动产物：一个可停的 service。 */
export interface BootedStratixService {
  /** 组合根本体（A1）：store / runtime / 三个写入面 / 执行环。 */
  readonly service: StratixService;
  /** 世界态恢复结果（角色数 / 单位数 / 读到的行数）。 */
  readonly restore: WorldRestoreResult;
  /** agent 探测句柄（未起探测时为 null）。 */
  readonly detection: ServiceAgentDetection | null;
  /** 收干净：停探测 → 退 service（执行环 / 养成回路 / runtime 依次退订）。幂等。 */
  stop(): void;
}

/**
 * 装起 service 进程的大脑。
 *
 * boot 失败会**抛**出去：调用方（gateway 启动序列）据此终止启动 —— 半启动的服务
 * 比不启动更糟（路由挂着但没有运行时，MCP 会如实报「命令没落地」而不是假装成功）。
 */
export function bootStratixService(options: ServiceBootOptions = {}): BootedStratixService {
  const logger = options.logger ?? ((line: string): void => console.log(line));

  // ===== ① 组合根（A1）+ 执行环接线（A2）+ 存储接线（A3）=====
  const service = createStratixService({
    ...(options.store ? { store: options.store } : {}),
    ...(options.storage ? { storage: options.storage } : {}),
    // 执行环：给出即在本进程跑（直接 spawn CLI，不经渲染进程 / IPC）。
    // transport 工厂用缺省（cli-transport 的 node-process 工厂）—— 真实 CLI，不是假适配器。
    taskExecution: {},
    logger,
  });

  // ===== ② 世界态恢复（A4）：角色档案 → store（角色 + 战场单位）=====
  const restore = options.db
    ? restoreWorldFromDatabase(service.store, options.db, logger)
    : { characters: 0, units: 0, records: 0 };

  // ===== ③ agent 探测（A4，后台跑；不挡 boot）=====
  const detection =
    options.detectAgents === false ? null : startAgentDetection(service.store, { logger });

  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    detection?.stop();
    service.stop();
  };

  return { service, restore, detection, stop };
}
