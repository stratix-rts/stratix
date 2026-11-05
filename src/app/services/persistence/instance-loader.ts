/**
 * 文件职责：**切副本的 `InstanceLoaderPort` 实现**（app 侧，task_179 / M1-05）——
 *   ① `inspect`：读实例注册表（内存态）给出**三件独立的事实**（存在？已归档？路径在？）；
 *   ② `load`：把该 instance 的 missions / tasks / sessions / characters / units
 *      **整份载入 store**（**全量替换，不增量合并**）；
 *   ③ `unload`：把 store 里的实体**清空**（离开副本时丢弃内存态）。
 * 输入：core 的端口契约（core/types.ts，task_176 / M1-02）、core store、实例注册表、实例数据源。
 * 输出：满足 `InstanceLoaderPort` 契约的实现（inspect 同步；load / unload 异步，失败用返回值表达）。
 * 禁止事项：
 *   1. import core 的命令通道（emitCommand 之类）—— 端口实现方**不得反向调用 core 的裁决**
 *      （避免裁决重入：core 正在 adjudicateProjectEnter，端口又发命令回去）；
 *   2. 在这里做**增量合并** —— 「整份载入 + 全量替换」是本任务的第一验收点，
 *      合并即串副本（design §2.2「切副本 = 全量重载，不是增量合并」）；
 *   3. 抛异常表达失败 —— 失败一律返回 `PortResult` 的失败分支（core 据此**拒绝**裁决）；
 *   4. import fs / sqlite —— 本模块**零 IO**：路径判定与读库都归 node 侧适配
 *      （instance-loader-node.ts），这样渲染层也能安全 import 本模块。
 *
 * why 端口实现在 app 层而不是 core：core 零 IO 是分层铁律；
 *   读库 / 判路径是有 IO 的一半，必须落在唯一持有 IO 能力的那一层（design §1.2.5 R1-02 裁决）。
 *
 * why 失败用返回值而不是异常：core 的失败语义是**裁决拒绝**（状态不变 + 广播失败事件），
 *   异常一旦跨出端口边界就变成「谁捕获它」的责任漂移（core/types.ts 端口契约的注）。
 *
 * @since v3.3（task_179 / M1-05）。
 */

import type { CoreStore, EntitySnapshot } from '../../../core/store';
import {
  DEFAULT_INSTANCE_ID,
  type InstanceInspection,
  type InstanceLoaderPort,
  type MissionView,
  type PortResult,
  type ProjectInstanceId,
  type ProjectInstanceView,
} from '../../../core/types';

// ============================================================================
// 端口两侧的依赖（都是**窄接口** —— 实现方可以换，端口形状不变）
// ============================================================================

/**
 * 实例注册表（一个物理副本 = 一个目录 = 注册表一条记录）。
 *
 * why 直接用 core 契约的 `ProjectInstanceView` 当注册表条目：大厅卡片、勘察事实、
 *   归档标记要的都是这一份形状，注册表再抄一份字段映射就会漂移。
 * M1 的注册表是**内存态**（本模块的 `createInMemoryInstanceRegistry`）；
 * M1-07 起由 `workspaces.json` 注册表端口供给同一形状。
 */
export interface InstanceRegistry {
  /** 取一条实例记录；查不到 = 该实例不存在。 */
  get(instanceId: ProjectInstanceId): ProjectInstanceView | undefined;
  /** 列出全部实例记录（大厅卡片网格的数据源）。 */
  list(): readonly ProjectInstanceView[];
}

/**
 * 实例数据源 —— **整份快照**的读口。
 *
 * why 是「一次读出整份」而不是「五类各读一次」：五类实体要**同属一个副本**才构成一份真相，
 *   分五次读就可能读到跨时刻的混合态（角色换了、单位还是旧的），而 store 一次写入就把它当真的。
 * why 形状是 core store 的 `EntitySnapshot`：写入口与读口共用一份形状 —— 少一次翻译、少一处漂移。
 */
export interface InstanceDataSource {
  /** 读该 instance 的全部实体（missions / tasks / sessions / characters / units）。 */
  read(instanceId: ProjectInstanceId): Promise<EntitySnapshot>;
}

/**
 * mission 的来源（**纯内存态**，不落库 —— design §1.2.1 的注释：mission 是纯内存状态机）。
 *
 * why 单独一个口：库里没有 missions 表（missions 不可恢复），
 *   读口必须显式承认这件事，而不是悄悄返回空数组假装「这个副本没有编组任务」。
 */
export type InstanceMissionsProvider = (instanceId: ProjectInstanceId) => readonly MissionView[];

export interface InstanceLoaderOptions {
  /** 状态持有者（切副本的目标 store）。 */
  readonly store: CoreStore;
  /** 实例注册表（inspect 的事实来源）。 */
  readonly registry: InstanceRegistry;
  /** 实例数据源（load 的行来源）。 */
  readonly source: InstanceDataSource;
  /**
   * 路径可达性判定（**同步**）—— 组合根注入。
   * why 由调用方注入：渲染层没有 fs 能力（与 game-save-coordinator 的 IPC 纪律同源），
   *   本模块因此保持零 IO，node 侧的现成实现见 instance-loader-node.ts 的 `nodePathExists`。
   */
  readonly pathExists: (path: string) => boolean;
}

// ============================================================================
// 内存态注册表（M1 的实现；M1-07 起换成 workspaces.json 注册表端口）
// ============================================================================

/** 可写的内存态注册表（供注册表端口注入与测试构造）。 */
export interface MutableInstanceRegistry extends InstanceRegistry {
  /** 登记 / 覆盖一条实例记录（路径移动后 id 不变，只改 path）。 */
  upsert(view: ProjectInstanceView): void;
  /** 移除一条记录（用户删副本）。 */
  remove(instanceId: ProjectInstanceId): void;
}

/**
 * 内存态实例注册表（Map 承载，**一条记录 = 一个实例**）。
 *
 * why 有上限：注册表随用户添加副本增长，但大厅卡片有契约上限（MAX_PROJECT_INSTANCES）——
 *   读方按上限截断，写方不需要重复限制（同一份上限只落一处：core 契约）。
 */
export function createInMemoryInstanceRegistry(
  views: readonly ProjectInstanceView[] = []
): MutableInstanceRegistry {
  const entries = new Map<ProjectInstanceId, ProjectInstanceView>();
  for (const view of views) entries.set(view.instanceId, view);
  return {
    get: (instanceId) => entries.get(instanceId),
    list: () => Array.from(entries.values()),
    upsert: (view) => {
      entries.set(view.instanceId, view);
    },
    remove: (instanceId) => {
      entries.delete(instanceId);
    },
  };
}

/**
 * 从 store 的内存态取某 instance 的 mission（mission 不落库，只能这么取）。
 *
 * why 按 instance 过滤：mission 的 `instanceId` 缺省 = 未归属 = 默认沙盒
 *   （COALESCE 命中口径，design §1.2.1 / §2.4）；缺省不填会把别的副本的编组任务串进来。
 */
export function createStoreMissionsProvider(store: CoreStore): InstanceMissionsProvider {
  return (instanceId) =>
    store
      .getState()
      .missions.filter((mission) => (mission.instanceId ?? DEFAULT_INSTANCE_ID) === instanceId);
}

// ============================================================================
// 端口实现
// ============================================================================

/**
 * 默认沙盒的**特例**（design §2.4）：
 *   - `exists` 恒 true —— 它承载全部历史数据，判「不存在」等于把存量数据判为不可达；
 *   - `pathOk` 恒 true —— **目录被删也不拦**（拦了就等于数据又不可达，R1-04 的原话）；
 *   - `archived` 恒 false —— 默认沙盒不可归档（不可删除/不可归档，design §2.4）。
 *
 * why 不读注册表判存在：M1-07 才把默认沙盒物化成注册表里的一条真实记录；
 *   在那之前若以注册表为准，`project.enter(DEFAULT_INSTANCE_ID)` 会被判否 ⇒ 存量数据不可达。
 */
function inspectSandbox(registry: InstanceRegistry): InstanceInspection {
  const view = registry.get(DEFAULT_INSTANCE_ID);
  return {
    exists: true,
    archived: false,
    pathOk: true,
    ...(view ? { view } : {}),
  };
}

/** 普通实例的勘察：注册表查得到 + 归档标记 + 路径可达性。 */
function inspectRegistered(registry: InstanceRegistry, pathExists: (path: string) => boolean, instanceId: ProjectInstanceId): InstanceInspection {
  const view = registry.get(instanceId);
  if (!view) return { exists: false, archived: false, pathOk: false };
  return {
    exists: true,
    archived: view.archived === true,
    pathOk: pathExists(view.path),
    view,
  };
}

/**
 * 造 `InstanceLoaderPort` 实现（task_179 / M1-05）。
 *
 * 三拍语义与 core 裁决一一对应（design §7.1 M1-03 / M1-05 行）：
 *   inspect（纯查询，不写状态）→ load（读库 + **整份替换** store）→ core 写 activeInstanceId。
 * 失败一律**返回值**（`ok: false` + 分类 reason），不抛异常 —— core 兜底捕获后按拒绝处理。
 */
export function createInstanceLoader(options: InstanceLoaderOptions): InstanceLoaderPort {
  const { store, registry, source, pathExists } = options;

  const inspect = (instanceId: ProjectInstanceId): InstanceInspection =>
    instanceId === DEFAULT_INSTANCE_ID
      ? inspectSandbox(registry)
      : inspectRegistered(registry, pathExists, instanceId);

  const load = async (instanceId: ProjectInstanceId): Promise<PortResult> => {
    // 装载前先复核勘察事实：core 的裁决已经查过一次，但端口是**可被直接调用**的入口
    //   （将来 `ctx.remote.stratix.enterInstance` 直接调它），自己再守一道才不漏。
    const inspection = inspect(instanceId);
    if (!inspection.exists) return { ok: false, reason: 'instance-missing' };
    if (inspection.archived) return { ok: false, reason: 'instance-archived' };
    if (!inspection.pathOk) return { ok: false, reason: 'path-unreachable' };

    let snapshot: EntitySnapshot;
    try {
      snapshot = await source.read(instanceId);
    } catch {
      // 读库失败 ⇒ 拒绝进入：状态不变，用户仍站在原处（半进入比不进更糟）。
      return { ok: false, reason: 'load-failed' };
    }

    try {
      // ★ 全量替换（不增量合并）：旧实例的实体一个不剩。
      store.replaceEntities(snapshot);
    } catch {
      return { ok: false, reason: 'load-failed' };
    }
    return { ok: true };
  };

  const unload = async (_instanceId: ProjectInstanceId): Promise<PortResult> => {
    // why 不按 instanceId 过滤：卸载 = **丢弃当前内存态**；此刻 store 里只可能装着
    //   一个 instance 的实体（§2.3 状态层纪律），按 id 过滤反而可能留下旧实体的残留。
    try {
      store.replaceEntities({ missions: [], tasks: [], sessions: [], characters: [], units: [] });
    } catch {
      return { ok: false, reason: 'unload-failed' };
    }
    return { ok: true };
  };

  return { inspect, load, unload };
}
