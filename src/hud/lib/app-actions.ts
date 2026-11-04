/**
 * 文件职责：**宿主动作登记口**（@since v3.9，task_150）—— ⌘K 命令面板里那些
 *   「不落总线契约、只落某个组件的公开能力」的动作的统一登记处。
 *
 * ============ 为什么需要它（为什么不塞进 HudCommand）============
 *   命令面板 ⌘K 收编的是**全应用动作**，其中有一类不是总线命令：
 *     · 展开示例会话（会话面板的公开方法）
 *     · 展开日志抽屉（抽屉的公开方法）
 *     · 聚焦态势屏（纯展示区块，core 契约里没有这个概念）
 *     · 打开建档向导（首启向导的公开能力）
 *     · 回放今天（回放控制器在组合根手里）
 *     · 清空任务草稿（底栏命令面板的瞬时态）
 *   它们**没有、也不该有** HudCommand 变体 —— core 契约里加一条命令只为「让 HUD 展开一个
 *   自己家的抽屉」是污染契约（core 不该知道 HUD 的抽屉）。
 *   但面板仍要知道两件事：**这条动作此刻有人接吗**（没人接 → 灰态 + 原因）、
 *   **接了之后怎么跑**。
 *   本文件就是这两件事的答案：一个极小的登记口（Map），有登记 = 可用且可执行。
 *
 * 输入：动作 id + 执行闭包（组件挂载时登记，卸载时注销）。
 * 输出：可用性判定 + 执行。
 * 禁止事项：
 *   1. 触碰 DOM —— 本文件是纯 Map（node 环境可直测）；
 *   2. import core/bus / world / app —— 铁律；
 *   3. 在这里写业务逻辑 —— 登记口只负责「谁接了」与「叫谁」；
 *   4. 长期持有不注销 —— 组件卸载必须注销（否则动作永远「可用」但点了没反应）。
 */

/** 宿主动作 id（面板 / 底栏 composer / 组合根之间共用的稳定标识）。 */
export type AppActionId =
  | 'open-character-wizard'
  | 'toggle-demo-session'
  | 'toggle-log-drawer'
  | 'focus-status-screen'
  | 'clear-draft'
  | 'replay-today'
  | 'toggle-shortcut-help';

/** 登记项：执行闭包 + 可用性说明（说明用于灰态文案 —— 为什么不灰着也能点）。 */
export interface AppActionRegistration {
  /** 执行动作（可能抛错 —— 调用方负责兜底并给回执）。 */
  readonly run: () => void;
  /** 不可用原因（null = 可用）。例：回放控制器没接线 → 「回放没接线」。 */
  readonly unavailableReason?: string | null;
}

/** 登记表（模块级单例 —— 宿主动作是**跨件**的事实，与遮挡控制器同一口径）。 */
const registrations = new Map<AppActionId, AppActionRegistration>();

/**
 * 登记一个宿主动作；返回注销闭包（组件卸载时必须调用 —— 否则动作永远「可用」）。
 * 重复登记同 id = 覆盖（后挂的赢 —— 与遮挡栈「后来者顶掉前者」同一口径）。
 */
export function registerAppAction(
  id: AppActionId,
  run: () => void,
  unavailableReason: string | null = null
): () => void {
  registrations.set(id, { run, unavailableReason });
  return () => {
    // 只注销**自己**那次登记：若期间被别人覆盖，注销不能把新主人的登记撤掉。
    if (registrations.get(id)?.run === run) registrations.delete(id);
  };
}

/** 动作此刻有没有人接。 */
export function isAppActionAvailable(id: AppActionId): boolean {
  return registrations.has(id);
}

/** 动作不可用的原因（没人接 = 一句人话；有登记但自带原因 = 登记的原因）。 */
export function appActionUnavailableReason(id: AppActionId): string | null {
  const reg = registrations.get(id);
  if (!reg) return '当前环境未接入该动作';
  return reg.unavailableReason ?? null;
}

/** 执行一个宿主动作；返回 false = 没人接（调用方据此给回执，不假装成功）。 */
export function runAppAction(id: AppActionId): boolean {
  const reg = registrations.get(id);
  if (!reg) return false;
  reg.run();
  return true;
}

/** 当前已登记的动作 id 集合（面板渲染灰态时用）。 */
export function availableAppActions(): ReadonlySet<AppActionId> {
  return new Set(registrations.keys());
}

/** 测试与卸载用：清空登记表（单测之间隔离）。 */
export function resetAppActions(): void {
  registrations.clear();
}
