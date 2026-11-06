/**
 * 文件职责：**实体层的副本归属（scope）口径**（@since v3.3，task_204 / M2-07）——
 *   「这个实体属于哪个副本」+「按副本过滤数组」+「裁剪后拼回原数组」的**唯一**出处。
 * 权威依据：docs/DESIGN-project-map.md §1.4（内存池裁剪按 instance 口径 / B4a）
 *   + §1.2.1 R1-03 / §2.4 R1-04（**COALESCE 命中口径**：缺省 / null ⇒ 默认沙盒）。
 * 输入：core 契约里的纯数据（带 instanceId 的实体）+ 目标副本 id。
 * 输出：纯函数结果（归属 id / 布尔判定 / 过滤后的数组）。
 * 禁止事项：
 *   1. 任何 IO（fs / sqlite）—— core 零 IO 铁律；
 *   2. import hud / world —— core 是被依赖方（core/README.md 铁律）；
 *   3. 认识具体实体类型 —— 这里只认「带 instanceId 的东西」与副本 id。
 *
 * ★ 为什么单独成文件（而不是各层各写一份）：
 *   「缺省 / null ⇒ 默认沙盒」这条口径已经被**三层**消费 ——
 *   ① 落库层（app/services/persistence/instance-scope.ts 的 COALESCE 谓词，task_198）；
 *   ② 表现层（world/bridge 的转发过滤，task_184 / M1-10）；
 *   ③ 数据 / 编排层（本单：managers 的裁剪口径 + machine 的依赖判定隔离）。
 *   三层各写一份必然漂移 —— 同一批旧行在不同的层里落进不同的副本，
 *   老数据就会「部分消失」（落库层 instance-scope.ts 文件头同款纪律）。
 *
 * ⚠️ 与 app/services/persistence/instance-scope.ts **同名不同层**：那边管**表行**的 SQL 谓词，
 *   这边管**内存实体**的归属；两边的 COALESCE 口径必须一致（都是「缺省 ⇒ 默认沙盒」）。
 *
 * @since v3.3（task_204 / M2-07）。
 */

import { DEFAULT_INSTANCE_ID, type ProjectInstanceId } from '../types';

/** 带副本归属的实体（core 契约里 instanceId 是可选增补字段 —— 缺省 = 未标注）。 */
export interface InstanceScopedEntity {
  readonly instanceId?: ProjectInstanceId | null;
}

/**
 * 实体的**有效归属**（副本 scope）—— COALESCE 口径（design §1.2.1 R1-03 / §2.4 R1-04）。
 *
 * why 缺省 / null 归**默认沙盒**而不是「无归属」：旧数据没有副本维度
 *   （落库时 `instance_id IS NULL`）在**查询期**按 `COALESCE(instance_id, 'wsp_sandbox')`
 *   命中默认沙盒（落库不改写）—— 本文件与落库层 / 桥接层用**同一条**口径，
 *   两边不一致 = 「HUD 看得到、战场看不到」的老毛病。
 *
 * @param instanceId 实体上的归属声明（缺省 / null = 未标注）。
 * @returns 该实体实际所属的物理副本 id。
 */
export function scopeOf(instanceId?: ProjectInstanceId | null): ProjectInstanceId {
  return instanceId ?? DEFAULT_INSTANCE_ID;
}

/**
 * 实体是否属于目标副本（= scopeOf(实体) === scopeOf(目标)）。
 *
 * why 两边都归一再比：目标副本本身也可能是「未标注」（大厅态：activeInstanceId 为 null）
 *   ⇒ 归默认沙盒；归一后比较的才是**同一套口径**
 *   （不拿「未标注」和「默认沙盒」当两回事 —— 它们在 COALESCE 口径下是同一个副本）。
 */
export function inInstanceScope(
  entity: InstanceScopedEntity,
  instanceId?: ProjectInstanceId | null
): boolean {
  return scopeOf(entity.instanceId) === scopeOf(instanceId);
}

/**
 * 按副本过滤数组（保持原有顺序）。
 *
 * 用法：裁剪 / 依赖判定**只吃当前副本的数据**（design §1.4 B4a）：
 *   上限是**每副本**的（副本配额不互相挤），依赖判定**不跨副本**建索引。
 */
export function filterInstanceScope<T extends InstanceScopedEntity>(
  items: readonly T[],
  instanceId?: ProjectInstanceId | null
): T[] {
  return items.filter((item) => inInstanceScope(item, instanceId));
}

/**
 * 裁剪后**拼回**原数组（@since v3.3，task_204 / M2-07）。
 *
 * why 要拼回而不是直接用裁剪结果：裁剪只该动**当前副本**的数据 ——
 *   别的副本的任务 / 会话既不占本副本的位子（配额互不挤，design §1.4 B4a），
 *   也不该被本副本的裁剪顺手丢掉（missions 是**纯内存态**，丢了不可恢复）。
 * 存活条目保持原有相对顺序（裁剪只决定「丢不丢」，不决定「谁在前」）。
 *
 * @param original 裁剪前的原数组。
 * @param scoped 原数组里属于目标副本的那一段（filterInstanceScope 的结果）。
 * @param kept scoped 经裁剪后留下的那部分。
 */
export function mergeScopedTrim<T extends InstanceScopedEntity>(
  original: readonly T[],
  scoped: readonly T[],
  kept: readonly T[]
): T[] {
  const scopedSet = new Set(scoped);
  const keptSet = new Set(kept);
  return original.filter((item) => !scopedSet.has(item) || keptSet.has(item));
}
