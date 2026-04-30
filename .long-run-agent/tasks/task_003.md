# task_003

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_003.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: Zone Building System v1 完整实现

**这是配置文件**，不是最终产出！

## 描述

Zone Building System v1 骨架实现 - 把 Zone 从抽象矩形变成有叙事感的建筑，Agent 在建筑内部工作

## 子任务

- [x] task_003_01: 数据模型扩展 - buildingType 字段
- [x] task_003_02: Zone 类型选择 UI
- [x] task_003_03: Building 类 + BuildingFactory
- [x] task_003_04: BuildingRenderer - 建筑外壳渲染
- [x] task_003_05: Room 类 - 格子间数据结构
- [x] task_003_06: RoomRenderer - 格子间渲染
- [x] task_003_07: BuildingLabel - 建筑标签
- [x] task_003_08: TaskZone 集成 - createBuilding 方法
- [x] task_003_09: 选中/取消选中 - 屋顶显隐
- [x] task_003_10: Agent 进入格子间 - 基础定位
- [x] task_003_11: 确定性装饰 - Device ID 种子
- [x] task_003_12: 集成测试

## 交付物

- `src/stratix-rts/buildings/` 模块（Building, Room, BuildingRenderer, RoomRenderer, BuildingLabel）
- `src/stratix-rts/buildings/types/` 类型定义
- `src/stratix-rts/ui/ZoneTypeSelector.vue` 组件
- 扩展的 `ProjectZoneConfig` 接口
- `src/stratix-rts/utils/SeededRandom.ts`
- 更新的 `TaskZone.ts`
- 集成测试 `tests/integration/building-system.test.ts`

## 验证证据（完成前必填）

- [ ] **实现证明**: 所有 12 个子任务完成
- [ ] **测试验证**: 集成测试通过，手动验证 UI 交互
- [ ] **影响范围**: 仅新增建筑系统，未破坏现有 Zone/Agent 逻辑

### 测试步骤
1. `npm run dev` 启动开发环境
2. 在地图上画框
3. 选择建筑类型
4. 验证建筑出现
5. 选中建筑验证内部可见
6. 分配 Agent 验证进入格子间
7. 刷新验证装饰布局一致

### 验证结果
<!-- 粘贴测试截图、命令输出或测试结果 -->
