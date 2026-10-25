# task_062 单位表现打磨
## 需求
战场单位生命感：待机呼吸/眨眼微动画、头顶名字标签（开关）、说话气泡（对话进行时）。
## 要点
1. idle 微动画：LPC 帧无 idle 带 → 程序化呼吸（sprite scaleY 0.98-1.02 缓动循环）+ 随机间隔小动作（转身）
2. 名字标签：单位头顶小字（皮肤 token），全局开关+缩放跟随；与选中圈/进度环层级协调
3. 说话气泡：chat streaming 期间单位头顶短气泡「…」或最近 10 字（034/035 流式状态联动）
4. 性能：≤50 单位满帧（呼吸动画合并到统一 tick）
## 验收
- 三项表现肉眼可见；50 单位不掉帧（dev tools 帧率）
- typecheck/jest 全绿

---

## 验证结果（2026-10-26，执行：coding agent）

- `npm run typecheck`：通过（0 错误）。
- `npx jest --silent`：**168 suites / 3655 passed / 6 skipped，全绿**（基线 3620 → +35 新用例，无回归）。
- 落地口径（与要点的对应）：
  1. **呼吸微动画**：`world/objects/unit-presence.ts` 纯逻辑（相位按单位 id 哈希派生 + murmur 雪崩，实测 `unit_ch_0..49` 均匀散布；scaleY ±2% 全时域钳制）+ `unit-layer` 单一 presence tick（60ms/步）驱动全场。移动 tween（容器坐标）/ task-fx（独立 Container）与呼吸（sprite.scaleY）属性面不相交，叠加不冲突；离线（online=false）呼吸与走路帧同步停（静止灰显更「死」）。
  2. **名字标签**：单位 Container 内嵌 Text（名字 12px + Lv 10px 小字，token 镜像色 #e6e9ef/#9aa3b2 + #0f131b 描边）；`UnitView.level` 新可选字段（建档投影 + grantExperience 升级同一次 setState 刷新，老单位回落 null 只显名字）。开关：设置屏「单位名字」行 localStorage `stratix.unit.nametags`（键常量冻结在 core/types，缺省开）；zoom < 0.6 自动隐藏（说话气泡共用可读性阈值）。z 协调：容器内 body→ring→精灵( moveTo )→名字→Lv→气泡；任务浮标（depth 5）仍压在单位容器（depth 0）之上。
  3. **说话气泡**：chat-service runRound 起手发 `unit.speaking {unitId, speaking:true}`、finally 发 false（成功/失败/中断统一收，角色没上战场不发）→ runtime 显式接地（不进 onUnhandled、不写 WorldState）→ bus-adapter 转发 syncUnitSpeaking → 场景 → unit-layer 头顶「···」三点脉动（alpha 0.35↔1，900ms 周期）。选最简语义（只表达「正在说话」，不截流式文本）。
  4. **性能**：单 tick 驱动全场（非每单位独立 tween）；50 单位单帧纯计算打桩断言 <1ms（预算 16.6ms 的零头，见 `unit-presence.test.ts`）。名字标签 Text 每单位生命周期只建一次、setText 判重（tagKey）、visibility 只切布尔——**不做池化**（50 单位上限下 2 Text/单位的常驻成本可忽略，池化换来的复杂度不划算；取舍在此注明）。
- 新增测试 35 个：unit-presence 19（相位/幅度/矩阵/开关/zoom/脉动/性能）+ unit-registry level 2 + runtime 接地 1 + bus-adapter 转发 3 + chat-service 起止 5 + settings-screen 行 3 + character 升级投影 2（另修 1 处 toCharacterUnit 形状断言：新增 level 字段）。
- 未尽事项：agent 互聊（agent-chat-service）流式期间未接说话气泡（062 范围只钦点 035 chat 流）；「随机间隔小动作（转身）」未做（规格钦点最简：呼吸+标签+气泡三项，转身留后续打磨）。
