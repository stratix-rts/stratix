# RTS 第一优先级优化实施计划

## 📋 项目概述

**目标：** 实施性能监控、空间分区碰撞检测、调试可视化工具  
**原则：** 详细、全面、易用  
**工期：** 2-3天（14-20小时）

---

## 🎯 功能需求确认

### 1. 性能监控面板
✅ **位置：** TopBar右侧  
✅ **默认状态：** 收起，只显示FPS  
✅ **交互：** 点击展开完整面板  
✅ **内容：** 场景、UI、精灵等**所有**性能相关数据  
✅ **详细程度：** 尽可能详细

### 2. 调试工具
✅ **默认状态：** 关闭  
✅ **控制方式：** 在性能面板中开关  
✅ **功能：** 碰撞调试、移动调试、网格调试

### 3. 空间分区碰撞检测
✅ **默认状态：** 开启  
✅ **控制方式：** 在性能面板中开关  
✅ **触发条件：** 用户可手动切换

---

## 📐 UI设计

### TopBar 右侧性能组件

#### 收起状态（默认）
```
┌─────────────────────────────────────────┐
│ Agent  Busy  Zone  [Progress]    [60] ✓│
└─────────────────────────────────────────┘
                                      ↑ FPS
```

**尺寸：** 40x40px 圆形按钮  
**颜色编码：**
- 绿色：FPS ≥ 55
- 黄色：30 ≤ FPS < 55
- 红色：FPS < 30

#### 展开状态（点击后）

面板尺寸：400x600px，可滚动，固定在TopBar下方

包含内容：
1. 🎮 帧率统计（含FPS图表）
2. 👥 Agent统计（类型/状态分布）
3. 💥 碰撞系统（检测次数/耗时/性能提升）
4. 🎨 渲染系统（模式/密度/Draw Calls）
5. 🖼️ UI系统（组件数量/事件统计）
6. 💾 内存使用（可选）
7. 🔧 调试工具控制（复选框）
8. 💡 性能建议（自动提示）

---

## 📊 数据收集结构

### DetailedPerformanceData

包含以下详细信息：

1. **帧率统计**
   - 当前/最小/最大/平均 FPS
   - 帧时间分布
   - FPS历史（最近60帧）

2. **Agent统计**
   - 总数/移动中/可见/缩略图
   - 类型分布（writer/dev/analyst/custom）
   - 状态分布（online/busy/offline/error）

3. **碰撞系统**
   - 检测次数/帧
   - 耗时（ms）
   - 性能提升百分比
   - 空间网格状态

4. **渲染系统**
   - 当前模式
   - 视口密度
   - Draw Calls
   - 可见Agent数量

5. **UI系统**
   - 组件数量
   - 事件队列大小
   - 渲染耗时

6. **内存使用**（可选）
   - 总内存
   - 纹理内存
   - 对象数量

---

## 🔧 核心文件清单

### 新建文件（11个）

```
src/stratix-rts/debug/
├── StatsCollector.ts              ✨ 性能数据收集器
├── DebugRenderer.ts               ✨ 调试渲染基类
├── CollisionDebugger.ts           ✨ 碰撞调试
├── MovementDebugger.ts            ✨ 移动调试
├── SpatialGridDebugger.ts         ✨ 网格调试
└── DebugManager.ts                ✨ 调试管理器

src/stratix-rts/ui/debug/
├── PerformanceWidget.ts           ✨ TopBar性能组件
└── PerformancePanel.ts            ✨ 详细性能面板

src/stratix-rts/systems/
└── SpatialHashGrid.ts             ✨ 空间哈希网格

docs/
├── RTS_DEBUG_TOOLS_GUIDE.md       ✨ 调试工具使用指南
└── RTS_PERFORMANCE_MONITORING.md  ✨ 性能监控说明
```

### 修改文件（4个）

```
src/stratix-rts/ui/v2/TopBarV2.ts
src/stratix-rts/systems/CollisionSystem.ts
src/stratix-rts/StratixRTSGameScene.ts
src/stratix-rts/events/types/RTSEventTypes.ts
```

---

## 📈 性能预期

### 性能监控开销

| 功能 | CPU开销 | 内存开销 |
|------|---------|----------|
| StatsCollector | <0.5ms/帧 | <1MB |
| PerformanceWidget | <0.1ms/帧 | <100KB |
| PerformancePanel（收起） | 0ms | <50KB |
| PerformancePanel（展开） | <1ms/帧 | <500KB |

### 空间网格性能提升

| Agent数量 | 暴力算法 | 空间网格 | 提升 |
|-----------|----------|----------|------|
| 50 | 1225次 | ~100次 | **12x** |
| 100 | 4950次 | ~200次 | **25x** |
| 200 | 19900次 | ~400次 | **50x** |

---

## 🎯 实施步骤

### Day 1: 核心系统（6-8小时）

**上午：**
1. StatsCollector.ts（性能数据收集）
2. SpatialHashGrid.ts（空间哈希网格）

**下午：**
3. 升级 CollisionSystem.ts（集成SpatialHash）
4. 集成到 StratixRTSGameScene.ts

### Day 2: UI和调试工具（6-8小时）

**上午：**
1. PerformanceWidget.ts（FPS按钮）
2. PerformancePanel.ts（前4个区域）

**下午：**
3. 完善 PerformancePanel.ts（剩余区域+控制）
4. 扩展 TopBarV2.ts

### Day 3: 调试工具和文档（4-6小时）

**上午：**
1. 5个调试渲染器文件

**下午：**
2. 文档和测试

---

## ✅ 验收标准

### 功能验收
- [ ] FPS正确显示并实时更新
- [ ] 点击FPS按钮可展开面板
- [ ] 所有数据区域正确显示
- [ ] FPS图表正确绘制
- [ ] 调试工具开关功能正常
- [ ] 空间网格性能提升 >10x

### 性能验收
- [ ] 性能监控开销 <1ms/帧
- [ ] 调试工具（关闭）无性能影响
- [ ] 调试工具（开启）<3ms/帧

---

**准备就绪！等待您的确认后开始实施。**
