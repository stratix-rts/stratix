/**
 * 文件职责：core/character 统一出口 —— 对外只认这一个文件。
 * 输入/输出：见 growth.ts（纯数值状态机）与 manager.ts（store 投影写入面）。
 * 禁止事项：
 *   1. 让上层跨层 import 子文件（hud/world 只认本出口，否则模块边界形同虚设）；
 *   2. 在本文件写逻辑 —— 出口只做再导出。
 *
 * 分层：growth（纯函数，算等级/经验）→ manager（写 store + 上报 Notice）。
 * world/hud 都**不直接**改角色数值：HUD 只发 HudCommand 并读 WorldState.characters 展示，
 * 角色真相由 core 持有并广播。
 *
 * persona.ts（角色提示词编辑，见 docs/REFACTOR_PLAN_V3.md §2）本轮**不落**：契约里对应命令是
 *   character.persona.update，而 core/runtime.ts 尚未接线（见该文件 TODO(v3.Phase2)）。
 *   在命令还没通电之前先落一个写入面，只会得到一个"调了没反应"的函数 —— 留到接线那一版同批落地。
 */

export * from './growth';
export * from './manager';