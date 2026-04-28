# components 模块代码审查

## 概览

**模块职责**: 提供 Stratix 应用的所有 UI 组件，包括通用 UI 组件库 (`components/ui/`) 和业务组件两大部分。

**文件统计**: 80+ Vue 组件，分布如下：
- `components/ui/` - 通用 UI 组件 (30+ 个)
- `components/character-creator/` - 角色创建器 (v1/v2/v3/v4 多版本)
- `components/` 根目录 - 业务组件 (AgentPanel, TaskPanel, MainLayout 等)

**子模块**:
| 子模块 | 组件数 | 说明 |
|--------|--------|------|
| `ui/` | 30+ | StratixButton, StratixModal, StratixInput 等基础组件 |
| `character-creator/v4/` | 15+ | 最新版角色创建器 |
| `character-creator/v3/` | 12+ | 第三版 |
| `character-creator/v2/` | 10+ | 第二版 |
| `character-creator/v1/` | 1 | 第一版 (遗留) |
| 根目录业务组件 | 15+ | MainLayout, AgentPanel, TaskPanel 等 |

---

## 代码质量

### 优点

1. **TypeScript 集成良好**: 大量使用 `defineProps<T>()` 泛型定义，类型安全
2. **Composition API**: 正确使用 Vue 3 Composition API (`ref`, `computed`, `watch`, `onMounted`)
3. **Design Token 使用**: 统一使用 `getToken()` 读取设计系统变量
4. **组件封装**: StratixModal 等组件封装完善，支持多种 position、size、动画
5. **响应式设计**: 关键组件有 `@media` 断点处理

### 问题

#### 1. `StratixButton.vue:131-133` - 重复 CSS 声明

```css
.stratix-btn__text {
  line-height: 1;
  display: inline-flex;
  align-items: center;
}

.stratix-btn__text {
  line-height: 1;  // 重复声明
}
```

#### 2. `AgentPanel.vue:68-69` - 遗留注释代码

```typescript
const getAgentThumbnail = (agent: any) => {
  return agent.profile?.thumbnail || null;  // 始终返回 null 或 thumbnail
};

const getAgentStatus = (agent: any) => {
  return agent.status || 'online';  // 'online' 硬编码
};
```

#### 3. `TaskPanel.vue:125-134` - Emoji 用于状态图标

```typescript
const getStatusIcon = (status: string) => {
  const icons: Record<string, string> = {
    pending: '⏳',
    in_progress: '▶️',
    completed: '✅',
    failed: '❌',
    paused: '⏸️'
  };
  return icons[status] || '❓';
};
```

Emoji 在不同平台渲染不一致，建议使用 SVG 图标（已有 `SvgIcon` 组件）。

#### 4. `CommandPanel.vue` - 类型定义缺失

```typescript
const props = defineProps<{
  selectedIds?: string[];
  isRefreshing?: boolean;
}>();

const emit = defineEmits<{
  (e: 'create', type: 'writer' | 'dev' | 'analyst'): void;
  (e: 'delete', agentId: string): void;
  (e: 'select', agentId: string): void;
  // ...
}>();
```

Props 和 emits 定义完整，但缺少 JSDoc 注释说明。

#### 5. `MainLayout.vue:385-387` - console.log 遗留

```typescript
@workflowChange="(def) => console.log('Workflow changed:', def)"
@execute="(status, def) => console.log('Workflow execute:', status, def)"
```

生产代码不应有 console.log。

#### 6. 多版本 CharacterCreator 重复

`character-creator/v1/` 到 `v4/` 存在大量重复代码，未提取公共组件。

**建议**: 提取 `character-creator/v4/` 作为稳定版本，删除 v1/v2/v3。

---

## 安全

### 风险点

| 风险 | 等级 | 位置 | 说明 |
|------|------|------|------|
| XSS (低) | 低 | TaskPanel.vue:252 | error message 直接渲染，但来自内部 |
| console.log 泄露 | 低 | MainLayout.vue:385 | 调试代码遗留 |
| 任意 URL 跳转 | 低 | MainLayout.vue:59-62 | `window.open` 使用 `window.location.href` 构造 |

### 良好实践

1. **StratixModal.vue:204-208** - 正确阻止事件冒泡，防止点击穿透 Phaser Canvas
2. **useModalState composable** - 管理弹窗状态，避免多层嵌套

---

## 性能

### 优点

1. **StratixModal.vue:186-189** - `destroyOnClose` 支持卸载组件，减少 DOM 节点
2. **StratixModal.vue:74** - `shouldRender` 控制渲染时机
3. **TaskPanel.vue:53-67** - `sortedTasks` 使用 computed 缓存排序结果
4. **LRAWatcher 定时器** - TaskPanel 正确清理 `lraWatcher`

### 问题

#### 1. `MainLayout.vue:156-185` - 事件订阅未清理

```typescript
const unsubscribeSkillSelected = rtsBridge.onSkillSelected((data) => {
  handleExecuteSkill(data.skill);
});

const unsubscribeZoneDeleteConfirm = rtsEventBus.on(...);

onUnmounted(() => {
  unsubscribeSkillSelected();
  unsubscribeZoneDeleteConfirm();
});
```

虽然有 `onUnmounted` 清理，但组件可能被 keep-alive 缓存，导致 `onUnmounted` 不触发。

#### 2. `TaskPanel.vue:90-101` - Watcher 重复创建

```typescript
watch(() => props.projectPath, (newPath) => {
  if (props.visible && newPath) {
    teardownWatcher();  // 先清理
    setupWatcher();     // 再创建
  }
});
```

每次 path 变化都重新创建 watcher，可能导致短暂的时间窗口内没有监听。

#### 3. `TaskPanel.vue:248-249` - 固定 skeleton 行数

```vue
<StratixLoading v-if="loading" mode="skeleton" :skeleton-lines="5" />
```

骨架屏行数硬编码为 5，不适应实际数据量。

---

## 架构

### 模块边界

```
components/
├── ui/                    # 通用 UI 组件库
│   ├── StratixButton.vue
│   ├── StratixModal.vue
│   ├── StratixInput.vue
│   └── ...
├── character-creator/     # 角色创建器 (多版本)
│   ├── v1/ (遗留)
│   ├── v2/
│   ├── v3/
│   └── v4/ (最新)
├── MainLayout.vue         # 主布局
├── AgentPanel.vue         # Agent 列表
├── TaskPanel.vue          # 任务面板
└── ...
```

### 依赖关系

```
components/
├── 依赖: @/components/ui (UI 组件库)
├── 依赖: @/design-system/config (Design Token)
├── 依赖: @/stores/agent (Agent Store)
├── 依赖: @/stratix-core (StratixEventBus 等)
└── 依赖: @/composables/* (usePerformanceMonitor, useSound 等)
```

### 架构问题

1. **多版本 CharacterCreator**: v1/v2/v3/v4 并存，代码重复，维护成本高
2. **UI 组件分散**: 部分样式在组件内，部分在 design-system
3. **类型定义重复**: `StratixAgentConfig` 在多文件重复定义

---

## 测试

### 现有覆盖

无测试文件（.spec.ts / .test.ts）

### 缺失测试

1. **StratixModal** - 组件测试
   - 键盘事件 (Escape)
   - 拖拽功能
   - 动画过渡

2. **StratixButton** - 组件测试
   - variant/size 组合
   - loading 状态
   - disabled 状态

3. **TaskPanel** - 集成测试
   - LRAWatcher 交互
   - 任务排序逻辑

---

## 横向联动

### 依赖该模块的模块

| 模块 | 使用组件 |
|------|----------|
| `stratix-project` | MainLayout, AgentPanel, TaskPanel |
| `stratix-rts` | CommandPanel |
| `stratix-command-panel` | SkillList, ParamForm, ConfirmDialog |
| `electron` | 主窗口渲染 MainLayout |

---

## 改进建议

### P0 (关键)

1. **删除遗留版本 character-creator/v1-v3**
   - 方案: 保留 v4，删除旧版本减少 30+ 重复文件
   - 风险: 需确认无引用

2. **清理 console.log**
   - 文件: `MainLayout.vue:385-387`
   - 方案: 使用统一的日志系统或删除

### P1 (重要)

3. **替换 Emoji 为 SVG 图标**
   - 文件: `TaskPanel.vue:125-134`
   - 方案: 使用 `SvgIcon` 组件 + 主题化图标

4. **StratixButton 重复 CSS 修复**
   - 文件: `src/components/ui/StratixButton.vue:131-133`
   - 方案: 删除重复的 `.stratix-btn__text` 块

5. **添加单元测试**
   - 优先级: StratixModal > StratixButton > TaskPanel
   - 框架: Vitest + Vue Test Utils

### P2 (优化)

6. **统一类型定义**
   - 方案: 将 `StratixAgentConfig` 等抽取到 `@/stratix-core/types/`

7. **Watcher 逻辑优化**
   - 文件: `TaskPanel.vue:168-174`
   - 方案: 避免重复创建 watcher

---

## 总结

| 维度 | 评分 | 说明 |
|------|------|------|
| 功能完整性 | A | 组件丰富，覆盖全面 |
| 代码质量 | B | 良好，部分重复和遗留代码 |
| 安全性 | B+ | 整体安全，少量 console.log 泄露 |
| 性能 | B | 基本良好，watcher 逻辑可优化 |
| 可维护性 | B- | 多版本 CharacterCreator 增加负担 |
| 测试覆盖 | D | 完全缺失 |

**核心改进方向**:
1. 清理遗留版本 (v1-v3) 减少重复
2. 替换 Emoji 为 SVG 图标
3. 清理调试代码
4. 建立组件测试体系

**模块规模评估**: 这是一个大型 UI 模块，建议拆分为:
- `@stratix/ui` - 通用 UI 组件
- `@stratix/components` - 业务组件
- `@stratix/character-creator` - 独立发布的角色创建器
