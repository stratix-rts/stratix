# task_076 app+core: mission 回报链最小闭环——task 终态回报 mission 终态

## 描述

MissionManager.completeMission 全仓库零调用（manager.ts:71 设计注释明说等 world 侧上报，但没人接）；task-service settle（completed/failed）与 mission 域零交集；task.assign 载荷（types.ts:1121）无 missionId。**派出去的任务做完了，mission 永远停在中途相位**——回报链断裂。

## Requirements

最小闭环（照 characterId / source / Notice.missionId 的可选增补契约惯例，不破既有构造点）：

1. **core**：task.assign 载荷 + TaskView（types.ts WorldState.tasks 条目）增补可选 `missionId?: string | null`；runtime 的 task.assign 分发透传。
2. **app**：task-service 的 TaskPersistRecord 增补可选 missionId 并随快照落库（tasks 表加列或 JSON 增补，看 DAO 现状选破坏最小路径）；runTask/settle 路径持有它。
3. **回报**：task-service settle 到终态时若有 missionId → 注入的 onMissionSettled 回调（组合根 main-entry 接 runtime/mission：completed→mission.completeMission；failed→mission 状态机的合法转移，**先读 core/mission/machine.ts 相位表再定**，若无 fail 相位用最贴近的既有转移并注明语义，不强加新相位）；回报产生 Notice（source='app/task-service'，missionId 关联，v3.4 惯例现成）。fire-and-forget：回报抛错只记日志不拖累任务收尾。
4. **UI 入口**：mission 面板若已有「派任务」路径则带上 missionId；没有就不强加 UI（数据链通为先），在任务 md 里注明入口留给后续。
   - 落实注记：现有「派任务」仅在角色面板，mission 面板没有该路径；本任务不加 UI，mission 入口及 missionId 表单透传留给后续。
5. **先读**：src/core/mission/manager.ts、machine.ts、src/core/types.ts（mission/task 契约段）、src/app/services/task-service.ts 文件头契约注释再动手。

## Acceptance

- [ ] 单测：载荷增补透传、落库随快照、settle→completeMission/失败转移、Notice 带 source+missionId、无 missionId 任务零影响（回归）
- [ ] `npx tsc --noEmit` 零错误 + jest 全绿
- [ ] 既有 task/mission 单测零回归
- [ ] 不引入新依赖；总线铁律不破（hud/world 互不引用）

## deliverables

- src/core/types.ts（载荷与 TaskView 增补）
- src/core/runtime.ts（透传）
- src/app/services/task-service.ts（记录+settle 回报）
- src/app/services/persistence/（落库增补，视 DAO 现状）
- src/app/main/main-entry.ts（组合根接线）
- 对应单测
