/**
 * 文件职责：core/character 统一出口 —— 对外只认这一个文件。
 * 输入/输出：见 growth.ts（纯数值状态机）、persona.ts（纯字符串改写面）与 manager.ts（store 投影写入面）。
 * 禁止事项：
 *   1. 让上层跨层 import 子文件（hud/world 只认本出口，否则模块边界形同虚设）；
 *   2. 在本文件写逻辑 —— 出口只做再导出。
 *
 * 分层：growth（纯函数，算等级/经验）+ persona（纯函数，改提示词合法性）
 *   + profile（纯函数，建档合法性 / AgentProfile 投影）
 *   → manager（写 store + 上报 Notice）。
 * world/hud 都**不直接**改角色数值：HUD 只发 HudCommand 并读 WorldState.characters 展示，
 *   角色真相由 core 持有并广播。
 *
 * persona.ts 落地史（@since v3.6）：
 *   契约里的对应命令 `character.persona.update`（core/types.ts）与 persona 写入面
 *   是同一批落地的两件事；之前 persona.ts 刻意不落，
 *   是因为 core/runtime.ts 尚未接线（见该文件 handleCommand 'character.persona.update' case），
 *   落一个"调了没反应"的写入面没价值。现在 wiring 已就位，persona 写入面一并开放，
 *   实现细节见 persona.ts 文件头。
 *
 * profile.ts 落地史（@since v3.7）：
 *   随 `character.create` 命令一同落地（首启引导建档）。建档合法性（名字 / agent 种类 /
 *   皮肤 / 人设）全在 profile.ts 的纯函数里，manager 只管冲突、上限与落库。
 *
 * unit-projection.ts 落地史（@since v3.9，task_026）：
 *   角色 → 战场单位的投影（纯函数）。建档时由 manager 在同一次写入里落库，
 *   于是「建了角色」与「战场上多了这个 agent 单位」是一次广播里的同一件事。
 */

export * from './growth';
export * from './persona';
export * from './profile';
export * from './unit-projection';
export * from './manager';