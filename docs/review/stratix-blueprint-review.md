# stratix-blueprint Review

## 概览

| 文件 | 职责 |
|------|------|
| `BlueprintIntegration.ts` | 蓝图生成集成层，对接 AI service 和 layout engine |
| `types.ts` | 类型定义（Blueprint, BlueprintNode, BlueprintEdge, LayoutConfig） |
| `core/LayoutEngine.ts` | DAG 布局算法 |
| `core/BlueprintCanvas.ts` | Phaser Scene 渲染蓝图 |
| `core/TaskNode.ts` | Phaser GameObjects.Container 渲染任务节点 |
| `core/DependencyLine.ts` | Phaser Graphics 渲染依赖连线 |
| `core/colors.ts` | 任务类型 → 颜色映射 |
| `ui/` | Vue 组件（RequirementPanel, BlueprintPreview） |

**测试**: 无测试文件。

---

## 代码质量

### BlueprintIntegration

**优点**:
- 清晰的两阶段处理（parse → split → layout）
- Fallback 策略完善（多个 strategy fallback + manual tasks）

**问题**:

| 问题 | 位置 | 说明 |
|------|------|------|
| Fallback 递归调用可能无限循环 | L78 | `return await this.generateBlueprint(requirement, fallbackStrategy, streamCallback)` — 递归 fallback，如果所有 strategy 都失败会无限递归 |
| `handleFallback` 调用 `generateBlueprint` 时没有 try-catch | L78 | 如果 fallback `generateBlueprint` 内部抛出异常，外层 catch 会再次触发 handleFallback |
| `createManualTasks` 硬编码 ID | L100-145 | ID 为 `'task_1'` 到 `'task_5'`，多个 blueprint 会冲突 |
| `streamCallback` 传递但未统一处理 | L28, L33, L40 | 所有方法都接受 `streamCallback` 但某些分支可能没有调用它 |

### LayoutEngine

**优点**:
- DAG 层构建算法正确（基于 dependency 的 layer 计算）
- Layer-based 布局（同一 layer 的节点水平排列）
- Memoization (`layerCache`) 避免重复计算

**问题**:

| 问题 | 位置 | 说明 |
|------|------|------|
| `calculatePositions` 同一 layer 内节点可能重叠 | L76-80 | 同一 layer 节点水平排列，但如果节点过多（> 10 个），可能超出视口 |
| `getBounds` 返回的坐标是节点中心而非边界 | L136-139 | `minX = node.x - node.width / 2` — 但调用方 `centerCamera` 期望中心点 |
| `updateNodePosition` 返回新数组而非修改原数组 | L116-123 | 符合纯函数风格，但调用方 `BlueprintIntegration.updateTaskPosition` 忽略返回值 |
| `getLayer` 如果有循环依赖会 stack overflow | L42-44 | `Math.max(...task.dependencies.map(dep => getLayer(dep)))` — 如果有循环引用会无限递归 |

### BlueprintCanvas

**优点**:
- 正确继承 Phaser.Scene
- Node/Line 管理清晰（Map<string, TaskNode>）
- Camera 控制（拖拽、缩放）

**问题**:

| 问题 | 位置 | 说明 |
|------|------|------|
| `camera.startDrag` 类型断言 | L56 | `(camera as any).startDrag(pointer)` — camera 类型没有 `startDrag` 方法 |
| `loadBlueprint` 时 `blueprint.id` 用 `Date.now()` | L82 | `id: blueprint_${Date.now()}` — 快速连续调用会生成重复 ID |
| `updateLines` 中直接修改 line 对象 | L143-144 | `line.fromNode = fromNode; line.toNode = toNode` — 直接修改 line 实例的 property，可能破坏封装 |
| 右键拖拽实现不完整 | L55-56 | 只有 `startDrag` 调用，没有 `stopDrag` 或 drag 状态清理 |
| Grid 尺寸硬编码 | L33-34 | `width = 2000, height = 2000` — 固定尺寸，大型 blueprint 可能不够 |

### TaskNode

**优点**:
- 正确的 Phaser.Container 用法
- Hover/Selected 状态管理
- Priority badge 显示

**问题**:

| 问题 | 位置 | 说明 |
|------|------|------|
| `priorityBadge` 使用 `getAt(1)` 假设结构 | L162 | 假设 `badge.getAt(1)` 返回 Text，但实际上可能是其他类型 |
| `typeNames` 映射硬编码 | L53-62 | 中文标签 `'需求分析'`, `'设计'` 等硬编码，不支持国际化 |
| `updateNode` 时 `nameText` 不更新 | L157-159 | 只更新 `nameText`，如果 type 或其他属性变化不会更新 |
| 拖拽时没有边界检查 | L121-127 | `dragX/dragY` 可以拖到任意位置，可能拖出 grid |

### DependencyLine

**优点**:
- 正确使用 Phaser.Graphics
- 箭头绘制逻辑正确

**问题**:

| 问题 | 位置 | 说明 |
|------|------|------|
| `fromNode` / `toNode` 是 public 属性直接赋值 | L143-144 (BlueprintCanvas) | 绕过了 constructor 的类型检查，应该在 constructor 时传入 |
| Arrow 角度计算在某些边界情况可能出错 | L48-64 | `Math.atan2(toY - fromY, toX - fromX)` — 当 from 和 to 在同一点时会返回 NaN |

---

## 安全

### 潜在风险

| 风险 | 位置 | 说明 |
|------|------|------|
| BlueprintIntegration 接受外部 `requirement` string | L26 | 直接传给 `RequirementParser.parse()`，可能有 prompt injection 风险 |
| Node position 无验证 | L151-157 | 允许任意 x/y 值，负数也可能 |
| `streamCallback` 外部传入 | BlueprintIntegration 多个方法 | 如果 `streamCallback` 实现不当可能造成 DoS |

### Prompt Injection

```typescript
// BlueprintIntegration.ts:33
const parsed = await this.requirementParser.parse(requirement, streamCallback);
```

如果 `requirement` 包含恶意构造的 prompt，可能影响 AI 的行为。但这是 AI service 层的问题，blueprint 层只是传递。

---

## 性能

### BlueprintCanvas

| 问题 | 说明 |
|------|------|
| Node/Line 渲染无虚拟化 | 100+ 节点的 blueprint 会渲染所有 node，可能掉帧 |
| Grid 固定 2000x2000 | 如果节点超出范围会看不到 |
| 没有请求动画帧控制 | Phaser 默认 60fps，复杂 blueprint 可能卡顿 |

### LayoutEngine

| 问题 | 说明 |
|------|------|
| `buildLayers` 递归深度 | 深层依赖链（如 100 层）可能导致 stack overflow |
| 同一 layer 内节点排列无优化 | 没有考虑节点宽度差异，简单平均分配 |

### TaskNode

| 问题 | 说明 |
|------|------|
| 每个 node 都创建独立的 Graphics 对象 | 100 个 nodes = 100 个 Graphics 对象 |
| Priority badge 是额外的 container | 增加了 display list 层级 |

---

## 架构

### 模块边界

```
stratix-blueprint/
├── BlueprintIntegration.ts  → 依赖 stratix-ai-service, stratix-blueprint/core
├── core/
│   ├── LayoutEngine.ts      → 纯算法，无外部依赖
│   ├── BlueprintCanvas.ts   → 依赖 Phaser, TaskNode, DependencyLine
│   ├── TaskNode.ts         → 依赖 Phaser, colors
│   └── DependencyLine.ts   → 依赖 Phaser
└── ui/                    → Vue 组件

被依赖方：
├── stratix-project        → 可能使用 BlueprintIntegration
└── stratix-ai-service     → 被 BlueprintIntegration 导入
```

### 循环依赖风险

```
stratix-blueprint → stratix-ai-service (RequirementParser, TaskSplitter)
```

如果 `stratix-ai-service` 又导入 `stratix-blueprint` 的任何 module，会形成循环依赖。

### BlueprintCanvas 与 Phaser 耦合

`BlueprintCanvas` 继承 `Phaser.Scene`，这是强耦合。如果未来要迁移到其他渲染引擎（如 Pixi、SVG、Canvas），需要完全重写。

---

## 测试覆盖

**无任何测试文件** — `stratix-blueprint/` 下没有任何 `__tests__` 目录或 `.test.ts` 文件。

`LayoutEngine` 是纯算法，最容易测试，应该优先添加。

---

## 横向联动

### 依赖关系

| 模块 | 依赖 | 被依赖 |
|------|------|--------|
| BlueprintIntegration | stratix-ai-service | stratix-project |
| LayoutEngine | 无外部依赖 | BlueprintIntegration, BlueprintCanvas |
| BlueprintCanvas | Phaser, TaskNode, DependencyLine | Vue components |
| TaskNode | Phaser | BlueprintCanvas |

### 外部依赖

```typescript
// BlueprintIntegration.ts
import { RequirementParser } from '../stratix-ai-service/parsers/RequirementParser';
import { TaskSplitter } from '../stratix-ai-service/parsers/TaskSplitter';
```

BlueprintIntegration 强依赖 `stratix-ai-service` 的 parser。如果 RequirementParser API 变化，BlueprintIntegration 也需要更新。

---

## 改进建议

### 高优先级

1. **添加 LayoutEngine 单元测试**
   - DAG 层构建正确性
   - 循环依赖检测
   - 层内节点排列

2. **修复循环依赖导致 stack overflow** (`LayoutEngine.ts:42-44`)
   ```typescript
   // 添加 visited 集合检测循环
   const visited = new Set<string>();
   const getLayer = (taskId: string): number => {
     if (visited.has(taskId)) return 0; // 或抛出错误
     visited.add(taskId);
     // ...
   };
   ```

3. **BlueprintCanvas 右键拖拽完善** (`BlueprintCanvas.ts:55-67`)
   - 添加 drag start/end 状态
   - 确保 drag 结束后清理状态

4. **移除 `camera as any` 类型断言** (`BlueprintCanvas.ts:56`)
   - 定义 Phaser.Camera 扩展类型，或使用安全的 camera API

### 中优先级

5. **BlueprintCanvas grid 动态扩展** (`BlueprintCanvas.ts:33-34`)
   - 根据节点数量动态调整 grid 尺寸

6. **BlueprintIntegration fallback 递归保护** (`BlueprintIntegration.ts:72-83`)
   - 限制 fallback 尝试次数

7. **TaskNode `typeNames` 国际化** (`TaskNode.ts:53-62`)
   - 从外部配置或 i18n 系统获取

8. **BlueprintCanvas 节点虚拟化** — 如果节点数量可能超过 50+

9. **DependencyLine `fromNode`/`toNode` 通过 constructor 传入** — 而非直接赋值

### 低优先级

10. **`updateNodePosition` 返回值被忽略** (`BlueprintIntegration.ts:154`)
    - 应该使用返回值更新状态

11. **`loadBlueprint` 生成 ID 可能重复** (`BlueprintCanvas.ts:82`)
    - 改用 `crypto.randomUUID()`

12. **TaskNode drag 边界检查** (`TaskNode.ts:121-127`)
    - 限制在 grid 范围内拖拽
