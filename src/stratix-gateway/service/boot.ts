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
 *   ⓪ 默认沙盒物化 + 副本端口（M1-07）：注册表恒含默认沙盒（path = 进程 cwd 快照）
 *      ⇒ 实例清单随第一帧广播就位（大厅有卡）、`project.enter(DEFAULT_INSTANCE_ID)` 能进；
 *      排在组合根之前是因为它俩是**组合根的输入件**（runtime 起来就握在手里）；
 *   ① 组合根（A1）：core runtime 起来 → 命令开始落地（这是「大脑醒了」的那一刻）；
 *   ② 世界态恢复（A4）：角色档案从库里回来 → 写进同一份 store（MCP 立刻见真世界态）；
 *   ③ agent 探测（A4，后台）：detectedAgents 逐条进 store → 执行环的出队守门才认得出
 *      「这个 CLI 装了没」——放最后是因为它最慢（最坏 11×10s），不该挡住 boot。
 *
 * @since v3.43（task_080 / service-split A4）。
 */

import {
  createInstanceRegistryWithDefaultSandbox,
  publishProjectInstances,
} from '../../app/services/persistence/default-sandbox';
import { nodeProcessCwd, nodeProcessGitBranch } from '../../app/services/persistence/default-sandbox-node';
import type { SqliteDatabaseLike } from '../../app/services/persistence/game-save-dao';
import {
  createInstanceLoader,
  createStoreMissionsProvider,
  type InstanceRegistry,
} from '../../app/services/persistence/instance-loader';
import {
  createSqliteInstanceDataSource,
  nodePathExists,
} from '../../app/services/persistence/instance-loader-node';
import { createProjectArchive } from '../../app/services/persistence/project-archive';
import {
  createInstanceRootResolver,
  createNodeArchiveAppender,
} from '../../app/services/persistence/project-archive-node';
import type { TaskTransportFactory } from '../../app/services/task-service';
import { worldStore, type CoreStore } from '../../core/store';

import { startAgentDetection, type ServiceAgentDetection } from './agent-detection';
import type { ServiceStorage } from './storage';
import { createStratixService, type StratixService } from './stratix-service';
import {
  createWorldPersister,
  readWorldSnapshotFile,
  type WorldPersister,
} from './world-persist';
import { restoreWorldFromSnapshot, type WorldSnapshotRestoreResult } from './world-snapshot';
import { restoreWorldFromDatabase, type WorldRestoreResult } from './world-restore';

/** 启动接线的参数（全部可缺席；缺席即降级，不报错）。 */
export interface ServiceBootOptions {
  /** 存储件（A3）—— 给出即：任务全文 / 经验事件由 service 侧独占写。 */
  readonly storage?: ServiceStorage;
  /** 库句柄（恢复世界态用）。缺省 = 不恢复（空世界起步）。 */
  readonly db?: SqliteDatabaseLike;
  /**
   * 世界态快照文件路径（@since v3.7 / task_133：missions + characters 落盘，重启可恢复）。
   *
   * 给出即：启动时读回快照（missions + 角色名册）写进 store，并在运行期把状态变化
   * 防抖落盘。缺省 = 不落盘（内存世界态，重启即失 —— 单测与嵌入式用法走这条）。
   */
  readonly snapshotPath?: string;
  /** 世界态持有者（缺省 = core/store 的 worldStore 单例，与 MCP 数据面同一份）。 */
  readonly store?: CoreStore;
  /** 是否起本地 CLI agent 探测（缺省 = 起；执行环的出队守门依赖它）。 */
  readonly detectAgents?: boolean;
  /**
   * 任务执行的 transport 工厂（可选注入口）。
   *
   * 缺省 = 直接 spawn 真实 CLI（cli-transport 的 node-process 工厂）—— 生产口径。
   * 给出即用它跑任务 —— e2e 剧本据此注入 fake adapter（确定性，不调真 CLI、不花 token）。
   *
   * why 是注入口而不是环境变量开关：service 进程内不该藏「按环境变量换执行器」的行为分支
   *   （生产路径与测试路径必须一眼分得开）；谁造 service 谁决定用哪个执行器。
   */
  readonly createTransport?: TaskTransportFactory;
  /** 日志口（缺省 = console.log）。 */
  readonly logger?: (line: string) => void;
  /**
   * 实例注册表（@since v3.3，task_205 / M2-08）。
   *
   * why 可注入：**同一份**注册表要被两处共用 —— 组合根要它装载副本、
   *   容量守门要它定位副本根（归档到 `.stratix/history`）。
   *   两处各造一份 ⇒ 两份清单可能不一致（副本被挪过位置时，解析出的根会打架）。
   *   缺省 = 自己造一份（默认沙盒 + 进程 cwd 快照）—— 单测与嵌入式用法走这条。
   */
  readonly instanceRegistry?: InstanceRegistry;
}

/** 启动产物：一个可停的 service。 */
export interface BootedStratixService {
  /** 组合根本体（A1）：store / runtime / 三个写入面 / 执行环。 */
  readonly service: StratixService;
  /** 世界态恢复结果（角色数 / 单位数 / 读到的行数）。 */
  readonly restore: WorldRestoreResult;
  /** 快照恢复结果（missions + characters；没给快照路径时全 0）。 */
  readonly snapshot: WorldSnapshotRestoreResult;
  /** 落盘件（未给快照路径时为 null）；stop 时会落最后一次盘。 */
  readonly persister: WorldPersister | null;
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

  // ===== ⓪ 默认沙盒物化（M1-07）+ 副本装载 / 归档端口 =====
  // why 排在组合根之前：注册表与两个端口是**组合根的输入件**（runtime 起来就握在手里），
  //   且实例清单要在第一帧广播里就带着默认沙盒（大厅卡片的数据源）⇒ 必须在 runtime 起来前备好。
  //
  // 默认沙盒 = 注册表里的一条真实记录（instanceId = DEFAULT_INSTANCE_ID，path = 进程 cwd 快照）
  //   ⇒ 大厅有卡、`project.enter(DEFAULT_INSTANCE_ID)` 能进、旧数据（instance_id IS NULL 的行）
  //   按 COALESCE 口径落它名下（design §2.4 R1-04 / §7.1 M1-07 行）。
  const store = options.store ?? worldStore;
  const instanceRegistry =
    options.instanceRegistry ??
    createInstanceRegistryWithDefaultSandbox({
      cwd: nodeProcessCwd(),
      // 分支（@since v3.3，task_187 / M1-13）：副本名牌上的「分支」一行。
      // 取不到 = null（未知不是错误）⇒ 名牌不画「分支」那一段，不猜。
      branch: nodeProcessGitBranch(),
    });
  // 实例根解析口（副本 id → 项目根；注册表为准，副本被挪过位置也能找对）。
  //   两个端口共用**同一份**解析口（物化要它找 `.stratix/roster`，归档要它找 `.stratix/history`）
  //   —— 一份解析口 ⇒ 两处不会各自解释出不同的根。
  const resolveInstanceRoot = createInstanceRootResolver(instanceRegistry);
  // 装载端口要有库才装得动（读库在 app 侧）；无库 = 不接（`project.enter` 走「未落地」，
  //   如实说清没接上，不假装能进）。
  const instanceLoader = options.db
    ? createInstanceLoader({
        store,
        registry: instanceRegistry,
        source: createSqliteInstanceDataSource(options.db, {
          missions: createStoreMissionsProvider(store),
          // 步 N6（@since v3.3，task_202 / M2-05）：物化点要知道「这个副本的项目根在哪」
          //   —— roster 契约在副本根的 `.stratix/roster`。
          resolveInstanceRoot,
        }),
        pathExists: nodePathExists,
      })
    : undefined;
  // 归档端口：退出副本时把未终结 mission 追加进 `.stratix/history/*.jsonl`（append-only）。
  const projectArchive = createProjectArchive({
    missions: createStoreMissionsProvider(store),
    resolveInstanceRoot,
    appender: createNodeArchiveAppender(),
  });

  // ===== ① 组合根（A1）+ 执行环接线（A2）+ 存储接线（A3）=====
  const service = createStratixService({
    store,
    ...(options.storage ? { storage: options.storage } : {}),
    // 执行环：给出即在本进程跑（直接 spawn CLI，不经渲染进程 / IPC）。
    // transport 工厂缺省 = cli-transport 的 node-process 工厂（真实 CLI）；
    // 给了 createTransport 就用它（e2e 剧本注入 fake adapter，见 ServiceBootOptions）。
    taskExecution: options.createTransport ? { createTransport: options.createTransport } : {},
    // 副本装载 / 归档端口（M1-07）：`project.enter` / `project.exit` 的 IO 出口。
    ...(instanceLoader ? { instanceLoader } : {}),
    projectArchive,
    logger,
  });
  // 实例清单进世界态（大厅卡片的数据源）—— 一次写入 = 一次广播（state 通道）。
  publishProjectInstances(store, instanceRegistry);

  // ===== ⓪-ter 开机即大厅态（@since v3.3，task_213 / M2-12）=====
  // why 必须**显式**写 `activeInstanceId = null`（而不是让它缺省）：
  //   HUD 大厅层只认**显式 null**（缺省 = 未知，见 src/app/main/main-entry.ts 的判据注释）
  //   —— 缺省 ⇒ `<strat-lobby-panel>` 永不挂载 ⇒ 大厅里没有默认沙盒卡片
  //   ⇒ 用户进不去任何副本（大厅卡片是唯一的入口）＝ 用户实机报的「大厅空卡」。
  // why 显式 null 还能活过序列化：`undefined` 会被 JSON.stringify 丢掉 ⇒ world-sync 快照里
  //   连字段都没有（前端拿到的永远是 undefined）—— 这正是本缺陷的传输形态。
  // why 由**真相持有者**（service 进程）说这句，而不是让 HUD 去猜：
  //   「开机没有活跃副本」是事实，不是渲染层的推断；真相缺省 = 未知，未知不敢当大厅用。
  // why 落在 service 侧（而不是 core 的 createInitialState）：只有这里**同时**握得住
  //   「实例清单（卡片的数据源）」与「活跃副本（卡片能不能点）」两件 —— 清单在这里发布，
  //   大厅态也必须在这里说；渲染层直连模式（本地 core）压根没有注册表 ⇒ 没有卡可画，
  //   那条路径不该被拖进大厅（否则是「空卡」的另一种形态）。
  // why 排在**清单发布之后**：不变量「谁看见 activeInstanceId === null，谁就看得见卡片清单」
  //   —— 大厅面板第一次挂上就有卡（不会先闪一帧「没有可用副本」再补上）。
  if (store.getState().activeInstanceId !== null) {
    store.setState((prev) => ({ ...prev, activeInstanceId: null }));
  }

  // ===== ② 世界态恢复（A4）：快照（missions + 角色）→ store；再从库里补角色档案 =====
  // 快照是 gateway 自己的世界态真相（missions 与 characters 一起存一起读）；
  // 库里的 characters 表是**渲染侧**那条路径的存档 —— 两条来源都按 id 去重，谁先到谁先占位。
  const snapshotFile = options.snapshotPath ? readWorldSnapshotFile(options.snapshotPath, logger) : null;
  const snapshot: WorldSnapshotRestoreResult = snapshotFile
    ? restoreWorldFromSnapshot(service.store, snapshotFile)
    : { characters: 0, units: 0, missions: 0, skipped: 0 };
  const restore = options.db
    ? restoreWorldFromDatabase(service.store, options.db, logger)
    : { characters: 0, units: 0, records: 0 };

  // ===== ③ 落盘件（task_133）：状态变化防抖落盘；stop 时落最后一次 =====
  const persister: WorldPersister | null = options.snapshotPath
    ? createWorldPersister({ store: service.store, filePath: options.snapshotPath, logger })
    : null;
  persister?.start();

  // ===== ④ agent 探测（A4，后台跑；不挡 boot）=====
  const detection =
    options.detectAgents === false ? null : startAgentDetection(service.store, { logger });

  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    detection?.stop();
    // 先落盘再退 service：退订 runtime 之后 store 不再变化，此刻的快照就是最后的真相。
    persister?.stop();
    service.stop();
  };

  return { service, restore, snapshot, persister, detection, stop };
}
