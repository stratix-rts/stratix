/**
 * 文件职责：core/progression 统一出口 —— **养成数值的单一真相源**（task_040）。
 *   三块数据 + 一组纯查询：curve（等级曲线 / 升级结算）、weights（经验来源权重）、
 *   unlocks（外观解锁门槛）。全部零依赖纯函数（weights 的 ExpSource 是 type-only 引用）。
 * 输入/输出：见三个子文件。
 * 禁止事项：
 *   1. 让上层跨层 import 子文件（hud/world/app 只认本出口，否则模块边界形同虚设 ——
 *      与 character/index.ts 同一口径）；
 *   2. 在本文件写逻辑 —— 出口只做再导出；
 *   3. 在这里认识 CharacterView / store / bus —— progression 只认数值，
 *      「一个角色此刻几级」的裁决在 core/character/growth（它委托 curve），
 *      「事件怎么编排」在 app 层 progression-service。
 *
 * 落地史（@since v3.19，task_040）：
 *   - 等级曲线从 character/growth 的线性模型（每级 100 / 封顶 5）换代为 ×1.5 递增曲线（L1→20），
 *     数值收拢到本模块 —— growth 保留 CharacterView 状态机，不再拥有数值；
 *   - 权重表从 app/services/exp-config.ts 迁入（exp-config 降级为转发层）；
 *   - 解锁门槛首次落地（数据 + 查询；UI 接线归 041）。
 */

export * from './curve';
export * from './weights';
export * from './unlocks';
