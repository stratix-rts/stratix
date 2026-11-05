/**
 * 文件职责：**默认沙盒物化**（app 侧，task_181 / M1-07）——
 *   把「默认沙盒」从概念变成**注册表里的一条真实记录** + **WorldState.projectInstances 里的一个条目**。
 *
 * ============ 为什么必须有这个模块（design §7.1 M1-07 行 / §2.4 R1-04）============
 * 旧数据全部落在 `instance_id IS NULL` 的行里（characters / character_tasks / sessions /
 *   session_events）。若默认沙盒只是**虚拟的**（不在注册表里、没有 path、大厅无卡片、
 *   `project.enter` 的「路径在？」永远判否）⇒ **用户既有的角色 / 任务 / 会话既不在大厅里、
 *   也进不去**（M1 上线即存量数据全部消失）。
 * ⇒ r1 裁决：把默认沙盒**物化成一个真实 instance**：
 *   | 项 | 值 |
 *   |---|---|
 *   | `instanceId` | `DEFAULT_INSTANCE_ID = 'wsp_sandbox'`（常量，**不是 null**） |
 *   | `path` | **进程 cwd 快照**（首次启动时快照，之后以注册表记录为准） |
 *   | 出现在 `projectInstances` 里？ | ✅ 是 ⇒ 大厅有卡片、`project.enter` 可达 |
 *   | 路径校验 | **特例豁免**：恒 `pathOk = true`（目录被删也不拦 —— 拦了就等于数据又不可达） |
 *   | 旧行命中规则 | `COALESCE(instance_id, 'wsp_sandbox')` ⇒ 落库不改写，查询时归一 |
 *   | `sandbox?: boolean` | `true`（UI 上标「默认沙盒」，且**不可删除 / 不可归档**） |
 *
 * ============ 三件验收的落点（design §7.1 M1-07 行）============
 *   ① 大厅能看到默认沙盒卡 ⇒ `publishProjectInstances` 把清单写进 `WorldState.projectInstances`
 *      （卡片由 HUD 画 —— M1-14；本条只保证**数据在位**，数据在 ⇒ 卡片可画）；
 *   ② 旧数据落在默认沙盒名下 ⇒ 旧行没有 instance 列（**M1 零 DDL**）⇒ 数据源把全部行
 *      按 `COALESCE` 口径归到默认沙盒（instance-loader-node.ts 的 `createSqliteInstanceDataSource`）；
 *   ③ `project.enter(DEFAULT_INSTANCE_ID)` 能进 ⇒ 注册表里有它 + inspect 对沙盒走特例
 *      （`instance-loader.ts` 的 `inspectSandbox`：恒 exists / pathOk）。
 *
 * ============ dsh 双面向（§7.1 M1-07 行）============
 *   - **用 dsh 哪块**：dsh 的 workspace 挂载校验是 `realpath(header.cwd) === workspace.path`
 *     （`packages/workspace/workspace/src/entity.ts:110-141`）⇒ 默认沙盒必须有**确定的 path**
 *     才能挂载 ⇒ 本模块的 `path` 必须是**绝对路径**（进程 cwd 快照，node 侧 realpath 归一）。
 *   - **暴露给 dsh 哪个面**：**事件订阅面 / 控制面** —— 默认沙盒是宿主**唯一能无条件进入**的
 *     instance，是插件的「默认工作区」（大厅卡片 = `ctx.remote.stratix.listInstances` 的可视化）。
 *
 * 输入：core 契约（`ProjectInstanceView` / `DEFAULT_INSTANCE_ID`）+ 实例注册表窄接口 + store。
 * 输出：默认沙盒视图、含沙盒的注册表、含沙盒的实例清单、写进世界态的清单发布口。
 * 禁止事项：
 *   1. import fs / sqlite / process —— 本模块**零 IO**（渲染层也能安全 import）；
 *      进程 cwd 的取法在 node 侧适配（default-sandbox-node.ts）；
 *   2. 改 core 契约 —— 沙盒的**形状**归 core/types.ts，本模块只**组装**；
 *   3. 让沙盒可删除 / 可归档 —— §2.4 明写「不可删除 / 不可归档」（承载全部历史数据）；
 *   4. 在这里做业务判断 —— 本模块只保证「沙盒恒在清单里」。
 *
 * @since v3.3（task_181 / M1-07）。
 */

import type { CoreStore } from '../../../core/store';
import {
  DEFAULT_INSTANCE_ID,
  MAX_PROJECT_INSTANCES,
  type ProjectInstanceView,
  type WorldState,
} from '../../../core/types';

import {
  createInMemoryInstanceRegistry,
  type InstanceRegistry,
  type MutableInstanceRegistry,
} from './instance-loader';

/**
 * 默认沙盒在大厅里的展示标题（固定一张卡 ⇒ 标题固定）。
 *
 * why 不叫「本地副本」之类：这张卡的身份是**承载全部历史数据的那一个**，
 *   用户认的是「默认沙盒」这四个字（M1-14 的卡片直接用它标「默认沙盒」）。
 */
export const DEFAULT_SANDBOX_TITLE = '默认沙盒';

/**
 * 默认沙盒所属的**逻辑项目** id（§2.4：默认沙盒是「一个只有虚拟副本、逻辑项目 = 默认项目」的特例）。
 *
 * why 放 app 层而不是 core 契约：core 契约里只有 `DEFAULT_INSTANCE_ID`（实例维度），
 *   逻辑项目 id 是**注册表条目**的事实（随 `workspaces.json` 走）—— M1 内存态注册表下
 *   给它一个固定值即可，M2 接上真注册表后由注册表提供。
 */
export const DEFAULT_SANDBOX_PROJECT_ID = 'spx_sandbox';

/** 造默认沙盒视图所需的参数。 */
export interface DefaultSandboxParams {
  /**
   * 进程 cwd 快照（**绝对路径**）。
   *
   * why 必须绝对：dsh 的 workspace 挂载按 `realpath(header.cwd) === workspace.path` 比对
   *   （§7.1 M1-07 行「用 dsh 哪块」）⇒ 相对路径挂不上。
   */
  readonly cwd: string;
  /** 最后进入时刻（epoch ms；缺省 0 = 从未进入过）。 */
  readonly now?: number;
}

/**
 * 造默认沙盒的实例视图（注册表里那一条记录）。
 *
 * why `status` 恒 'idle'：§2.4 写死「`status` = idle（除非它正是 `activeInstanceId` ⇒ active）」
 *   —— 「有活儿在办」是**运行态**事实，由读方按活跃实例判定，不写死在注册表条目里。
 * why 不写 `missing`：默认沙盒的路径校验是**特例豁免**（恒 pathOk），
 *   目录没了也**不拦**（拦了就等于数据又不可达）⇒ 不摆一个「路径没了」的信号给读方。
 */
export function createDefaultSandboxInstanceView(params: DefaultSandboxParams): ProjectInstanceView {
  return {
    instanceId: DEFAULT_INSTANCE_ID,
    projectId: DEFAULT_SANDBOX_PROJECT_ID,
    path: params.cwd,
    title: DEFAULT_SANDBOX_TITLE,
    lastOpenedAt: params.now ?? 0,
    pinned: false,
    archived: false,
    status: 'idle',
    sandbox: true,
  };
}

/**
 * 造**恒含默认沙盒**的实例注册表（内存态）。
 *
 * 三条不可破的保证（§2.4）：
 *   ① 沙盒条目**恒在**（初始化即登记；`remove` 拒绝删它）；
 *   ② 沙盒**不可归档**（`upsert` 传 `archived: true` 也会被压回 false）；
 *   ③ 沙盒**恒带 `sandbox: true`**（读方据此在卡上标「默认沙盒」）。
 *
 * why 保护逻辑住在**注册表**而不是读方：读方（大厅卡片）只渲染「拿到的列表」，
 *   若注册表能删掉沙盒，某个写方一次误操作就让存量数据再次不可达 —— 保护必须落在**写侧**。
 */
export function createInstanceRegistryWithDefaultSandbox(
  params: DefaultSandboxParams & {
    /** 其它实例记录（注册表里的其余条目）。 */
    readonly views?: readonly ProjectInstanceView[];
  }
): MutableInstanceRegistry {
  const sandbox = createDefaultSandboxInstanceView(params);
  const inner = createInMemoryInstanceRegistry([sandbox, ...(params.views ?? [])]);
  return {
    get: (instanceId) => inner.get(instanceId),
    list: () => inner.list(),
    upsert: (view) => {
      if (view.instanceId === DEFAULT_INSTANCE_ID) {
        // 沙盒条目：保留登记时的 path（进程 cwd 快照 / 注册表记录为准），
        //   强制 sandbox 标记与「不可归档」—— 别的字段随调用方给（标题可改，路径以登记值为准）。
        inner.upsert({ ...view, path: view.path || sandbox.path, sandbox: true, archived: false });
        return;
      }
      inner.upsert(view);
    },
    remove: (instanceId) => {
      // 沙盒不可删除（承载全部历史数据）—— 静默拒绝，不抛（删副本是 UI 操作，不是编程错误）。
      if (instanceId === DEFAULT_INSTANCE_ID) return;
      inner.remove(instanceId);
    },
  };
}

/**
 * 取实例清单（**恒含默认沙盒**，且沙盒排在最前）。
 *
 * why 沙盒排最前：大厅固定一张「默认沙盒」卡（§2.4），列表顺序由读方排序前也保证它**在场**；
 *   上限截断（`MAX_PROJECT_INSTANCES`）时它也**不会被截掉**（在最前）。
 *
 * @param registry 实例注册表（读口）。
 * @param fallback 沙盒条目缺省时的替身（缺省 = 造一个空路径的沙盒；正常路径下用不到）。
 */
export function listInstancesWithDefaultSandbox(
  registry: InstanceRegistry,
  fallback?: ProjectInstanceView
): readonly ProjectInstanceView[] {
  const views = registry.list();
  const sandbox = views.find((view) => view.instanceId === DEFAULT_INSTANCE_ID);
  const others = views.filter((view) => view.instanceId !== DEFAULT_INSTANCE_ID);
  const head = sandbox ?? fallback ?? createDefaultSandboxInstanceView({ cwd: '' });
  // 上限截断（体积有界：随 WorldState 全量广播）—— 沙盒在最前，恒不被截掉。
  return [head, ...others].slice(0, MAX_PROJECT_INSTANCES);
}

/**
 * 把实例清单**发布**进世界态（`WorldState.projectInstances`）—— 大厅卡片的数据源。
 *
 * why 由 app 层写 store（不是 core 裁决）：`projectInstances` 是**注册表的投影**，
 *   不是业务真相（业务真相的裁决在 core —— 铁律 1）；core 契约里没有「写实例清单」这条命令，
 *   而 M1 的契约增补不许为投影另开命令面（M1-01 冻结的形状）。
 *
 * why 每次发布都重新算「沙盒在不在」：清单可能来自外部注册表（未来 `workspaces.json`），
 *   那一侧漏登记沙盒时，本口兜底补上 ⇒ **大厅恒有默认沙盒卡**（M1-07 验收①）。
 */
export function publishProjectInstances(store: CoreStore, registry: InstanceRegistry): WorldState {
  const current = store.getState().projectInstances ?? [];
  const previousSandbox = current.find((view) => view.instanceId === DEFAULT_INSTANCE_ID);
  const instances = listInstancesWithDefaultSandbox(registry, previousSandbox);
  return store.patch({ projectInstances: instances });
}
