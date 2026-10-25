# task_045 RTS 操作补全——选中视觉反馈 + 右击移动

## 需求来源
用户验收反馈（2026-10-25 15:46）：「rts界面里没有操作agent的操作了，之前都有类似rts的操作（框选，右击移动等）」。排查：框选/点选逻辑在但无视觉反馈（选中圈缺失，用户看不出框选生效）；右击移动完全缺失（右键被平移占用，无 unit.move 命令）。

## 需求
1. 选中视觉：单位选中态脚下画圈（单选/多选统一圈样式，走 TASK_FX_STYLE 同款可调常量）；selection 变化时刷新
2. 右击移动：HudCommand 增 unit.move {unitIds, x, y}；core 纯函数算编队落位（多选时目标点+网格偏移，间距常量），写 WorldState 位置并广播 unit.position 终值；world 侧单位 tween 平滑移动到新位置（动画只是渲染过渡，状态立即生效）
3. 右键语义区分：右键 down→up 位移 < 拖拽阈值 = 移动命令（对选中单位）；≥ 阈值 = 平移（现状保留）；无选中单位时右击短按无操作（或轻微镜头聚焦，从简：无操作）
4. 移动点击反馈：目标点绿色涟漪标记（短动画淡出，与 038 ✓ 浮标同层风格）
5. 到位后 033 站位防抖落库链路自动跟随（验证即可，不新做）

## 验收标准
- [ ] 点选/框选后单位有选中圈，取消选择圈消失
- [ ] 框选多个 → 右击地面 → 整队移动（编队落位）+ 涟漪标记 + 平滑动画
- [ ] 右键拖拽平移不受影响
- [ ] 移动后重启应用站位恢复（033 链路）
- [ ] typecheck 零错误；jest 全绿（2888 基线不回归）
- [ ] 不引入新依赖；core 零 IO；world 不 import app/hud

---

## 验证结果（2026-10-25 执行）

**分支**：`refactor/game-v3`（基线 HEAD `a24de4b`）

**实现要点**
- ①core：`HudCommand`/`WorldEvent` 各增 `unit.move`（同名同载荷，方向不同，runtime 两个入口共用 `applyUnitMove`）；编队纯函数 `core/unit/formation.ts`（`FORMATION_SPACING=50`，血缘 v2 `FormationSystem` box 编队：cols=ceil(√n)、网格中心对齐目标点；v2 ≤3 人平移保形分支因 core 无坐标**不移植**，已在文件头注明）；runtime 过滤未知单位后逐单位广播 `unit.position` 终值；「位置立即生效于状态，动画只是渲染过渡」已注明（契约里 UnitView 无坐标，「WorldState 位置更新」落位在世界层 UnitObject + unit.position 广播，task_033 落库链路自动跟随——集成测试断言的就是这条链）
- ②world：tween 落在 unit-layer（unit-object 禁 Phaser，头注铁律；位置真相仍走 UnitObject.setPosition 立即生效）；常速 300px/s（v2 `DEFAULT_SPEED` 血缘，240px≈800ms 即规格口径）+ Sine.easeOut；阈值 2px 内贴齐；新目标打断旧 tween；朝向随移动方向转面（v2 getDirection 4 行简化版）
- ③选中圈：unit-layer 圆环改**脚下椭圆**（v2 `AgentSprite.drawSelectionRing` 血缘：2.5px 主圈、绿=colors.status.success 镜像 srf-success #6fcf97，弱色预览圈）；可调常量 `SELECTION_RING_STYLE`
- ④右键：pan 候选起手记录按钮与累计位移，`pointerup` 时右键短按（<DRAG_THRESHOLD_PX）且选中非空 → 涟漪 + `unit.move`；`disableContextMenu()` 补上（浏览器右键菜单会吃掉 pointerup）。**框选闭环（用户反馈根因）**：`selection.box` 原是死事件（无人算命中）——现在世界侧 `queryBounds` 算命中，拖拽中本地预览弱色圈（不经总线），松手把命中 id 补在事件上（`unitIds`/`additive` 可选字段，老事件形状不变），core 落选择集；拖空框/点空地=清空选择，Shift=加选
- ⑤涟漪：`MOVE_RIPPLE_STYLE`（v2 `agentArrivalRipple` 血缘：半径 10→50、alpha 0.7→0、600ms Power2.easeOut、2px 描边+10% 充填，色改 srf-success）+ `TaskFxLayer.ripple()`
- ⑥测试：formation 纯函数 8 例；runtime 集成链路（命令→过滤→编队→逐单位 unit.position 广播、WorldState 不变、选择集不变）+ selection.box 闭环 6 例；bus-adapter 出口/转发 7 例

**验证输出**
- `npm run typecheck`：通过（0 错误）
- `npx jest --silent`：**129 suites / 2914 passed / 6 skipped / 0 failed**（基线 2888 → 2888+26 新增=2914，无回归）
- `eslint`（改动文件）：0 error / 0 warning

**未尽事项**
- HUD 侧暂无 `unit.move` 派发入口（面板「移动」按钮/小地图指令留给后续任务；core/runtime 已就绪）
- v2 到站切 idle 帧动画未移植（v3 精灵表只合成了走路带，无 idle 带；现状为持续走路节奏，与 029 一致）
- 编队落位未做世界边界钳制（v2 同样不钳；目标点靠边时边缘单位可越界渲染，如需钳制应加在世界层并回报，避免与广播终值分叉）
- `task_045` 验收人反馈的「无选中视觉反馈」实际根因是框选死事件（上见④），非单纯渲染缺失
