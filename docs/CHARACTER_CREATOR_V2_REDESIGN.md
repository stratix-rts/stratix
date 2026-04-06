# Character Creator V2 重写设计

> **日期**: 2026-04-06  
> **状态**: 待确认  
> **目标**: 重写角色创建面板，架构从「Phaser 为主 + DOM 嵌套」翻转为「Vue 为主 + Phaser 仅负责 Canvas 预览」

---

## 一、背景与问题

### V1 架构（当前）
```
Phaser Game (CharacterCreatorScene, 1539行)
├── Phaser DOM 容器内嵌套所有 UI
├── PartSelector (Phaser UI, 270行)
├── CharacterPreview (Phaser UI, 226行)
├── CharacterList (Phaser UI, 327行)
├── AgentConfigPanel (Phaser UI, 1543行)
├── BackendSelector (Phaser UI, 628行)
├── OpenClawConnectionPanel (Phaser UI, 854行)
├── SoulEditor (Phaser UI, 1266行)
├── ... 其他 Phaser UI 组件
└── CharacterCreatorModal.vue (214行, 仅挂载 Phaser)
```

### 核心问题
1. **维护困难**: 所有 UI 都在 Phaser 的 DOM 容器里，样式、交互、调试都不方便
2. **代码膨胀**: CharacterCreatorScene.ts 1539 行，单个文件承载太多职责
3. **V2 废弃代码**: 现有 V2 尝试（2672 行散落在 src/components/）UI 设计差、模块拆分破碎

### V2 重写目标
- Vue 为主框架，管理所有 UI 状态和交互
- Phaser 仅负责 Canvas 内的角色预览渲染（精灵图合成、动画播放）
- 功能层（core/）尽量不动，UI 层全部重写
- V1/V2 文件夹隔离，统一导出入口方便切换

---

## 二、目录结构

```
src/
├── components/
│   └── character-creator/
│       ├── index.ts                    ← 统一导出，App.vue 只改这里切换 V1/V2
│       ├── v1/                         ← V1 现有代码（搬迁进来）
│       │   ├── CharacterCreatorModal.vue
│       │   └── types.ts               ← V1 特有类型（如果有的话）
│       └── v2/                         ← V2 重写
│           ├── CharacterCreatorModal.vue   ← 主容器（Vue 组件）
│           ├── components/                 ← V2 子组件
│           │   ├── CanvasPreview.vue       ← Phaser Canvas 预览区（仅此组件接触 Phaser）
│           │   ├── PartSelector.vue        ← 部件选择器
│           │   ├── CharacterList.vue       ← 已保存角色列表
│           │   ├── BodyTypeSelector.vue    ← 体型选择
│           │   ├── AnimationControls.vue   ← 动画/方向/缩放控制
│           │   ├── StepNavigator.vue       ← 步骤导航（外观→连接→配置）
│           │   ├── AgentConfigStep.vue     ← Agent 配置步骤
│           │   ├── BackendSelector.vue     ← 后端选择（OpenClaw/Stratix）
│           │   └── SoulEditor.vue          ← Soul 编辑器
│           ├── composables/                ← Vue Composables（状态逻辑）
│           │   ├── useCharacterState.ts    ← 角色状态管理
│           │   ├── usePartSelection.ts     ← 部件选择逻辑
│           │   └── usePreviewControl.ts    ← 预览控制（动画/缩放）
│           └── types.ts                   ← V2 特有类型
├── stratix-character-creator/            ← 功能层（不动或微调）
│   ├── core/                             ← 保持不变
│   │   ├── CharacterComposer.ts
│   │   ├── CharacterStorage.ts
│   │   ├── PartRegistry.ts
│   │   ├── EventEmitter.ts
│   │   ├── SkillTree.ts
│   │   ├── BrowserStorage.ts
│   │   ├── SharedSkillStore.ts
│   │   ├── SoulTemplateRenderer.ts
│   │   └── ZoneContextManager.ts
│   ├── config/                           ← 保持不变
│   ├── types/                            ← 保持不变
│   ├── constants.ts                      ← 保持不变
│   ├── index.ts                          ← 保持不变（功能层导出）
│   ├── CharacterCreatorScene.ts          ← V1 专用，V2 不使用
│   └── ui/                               ← V1 Phaser UI 组件，V2 不使用
└── ...
```

### 统一导出（index.ts）

```typescript
// src/components/character-creator/index.ts
// 切换版本只需改这一处

// V1（当前）
export { default as CharacterCreatorModal } from './v1/CharacterCreatorModal.vue';

// V2（重写完成后切换）
// export { default as CharacterCreatorModal } from './v2/CharacterCreatorModal.vue';
```

---

## 三、V2 架构设计

### 3.1 整体布局

```
┌──────────────────────────────────────────────────────────────────┐
│  HEADER: 角色创建器              [体型选择]  [随机] [保存] [返回] │
├──────────────┬─────────────────────────────────┬─────────────────┤
│              │                                 │                 │
│  CANVAS      │      PART SELECTOR              │   SAVED         │
│  PREVIEW     │      (步骤式工作区)              │   CHARACTERS    │
│  (Phaser)    │                                 │                 │
│              │  Step 1: 外观 → Step 2: 连接 → Step 3: 配置      │
│  [动画控制]   │                                 │                 │
│  [缩放控制]   │                                 │                 │
│              │                                 │                 │
└──────────────┴─────────────────────────────────┴─────────────────┘
```

### 3.2 职责分离

| 层 | 职责 | 技术 |
|---|------|------|
| **CharacterCreatorModal.vue** | 主容器，管理布局和步骤流转 | Vue |
| **CanvasPreview.vue** | 唯一接触 Phaser 的组件，渲染精灵图预览 | Vue + Phaser |
| **PartSelector.vue** | 部件分类浏览和选择 | Vue |
| **CharacterList.vue** | 已保存角色列表 | Vue |
| **composables/** | 状态逻辑抽取，与 UI 解耦 | Vue Composables |
| **core/** | 功能层（部件注册、角色合成、存储） | TypeScript（不动）|

### 3.3 CanvasPreview.vue — Phaser 隔离方案

这是 V2 最关键的组件。职责极小：

```
Props:
  - bodyType: BodyType
  - parts: Record<string, PartSelection>
  - animation: AnimationName
  - direction: number
  - scale: number

行为:
  1. 挂载时创建 Phaser.Game（只包含一个极简 Scene）
  2. 监听 props 变化 → 调用 CharacterComposer 合成纹理 → 更新 Canvas
  3. 卸载时销毁 Phaser.Game
```

**与 V1 的本质区别**：
- V1: Phaser 管理整个应用，Vue 只是外壳
- V2: Vue 管理整个应用，Phaser 只管理一个小 Canvas 区域

### 3.4 数据流

```
CharacterCreatorModal.vue (主状态)
  │
  ├── useCharacterState() ←→ characterStorage (core层)
  │     ├── currentCharacter
  │     ├── isDirty
  │     └── savedCharacters
  │
  ├── usePartSelection() ←→ partRegistry (core层)
  │     ├── availableParts
  │     ├── selectedParts
  │     └── randomize()
  │
  ├── usePreviewControl()
  │     ├── animation / direction / scale
  │     └── isPlaying
  │
  ├── CanvasPreview.vue ← 接收 parts/animation/direction/scale 作为 props
  │     └── 内部调用 characterComposer.toCanvas() 渲染
  │
  ├── PartSelector.vue ← 接收 availableParts，emit('select', part)
  │
  └── CharacterList.vue ← 接收 savedCharacters，emit('load', id) / emit('delete', id)
```

---

## 四、开发步骤

### Phase 1: 基础搭建（搬迁 + 脚手架）
1. 创建 `components/character-creator/` 目录结构
2. 将 V1 的 `CharacterCreatorModal.vue` 搬入 `v1/`
3. 创建 `index.ts` 统一导出（先指向 V1）
4. 更新 `App.vue` 的 import 路径
5. **验证**: V1 功能不受影响，编译通过

### Phase 2: CanvasPreview 组件
6. 实现 `CanvasPreview.vue`（Phaser 隔离，只做渲染）
7. 内部创建极简 Phaser Scene，接收 props 驱动合成
8. **验证**: 能正确显示角色预览、动画、方向切换

### Phase 3: 核心子组件
9. 实现 `PartSelector.vue`（部件浏览和选择）
10. 实现 `CharacterList.vue`（已保存角色列表）
11. 实现 `BodyTypeSelector.vue`（体型切换）
12. 实现 `AnimationControls.vue`（动画/方向/缩放控制）
13. **验证**: 外观编辑步骤完整可用

### Phase 4: 高级功能
14. 实现 `StepNavigator.vue`（步骤导航）
15. 实现 `BackendSelector.vue`（后端连接选择）
16. 实现 `AgentConfigStep.vue`（Agent 配置）
17. 实现 `SoulEditor.vue`（Soul 编辑）
18. **验证**: 所有步骤流转正常，角色创建/编辑/删除功能完整

### Phase 5: 集成与清理
19. 更新 `index.ts` 指向 V2
20. 删除 `src/components/` 下散落的 V2 废弃文件
21. 全面功能测试
22. **验证**: V2 功能与 V1 完全一致，UI 体验更好

---

## 五、验收标准

- [ ] V1 搬迁后功能不受影响
- [ ] V2 所有功能与 V1 一致（创建/编辑/删除角色、部件选择、动画预览、Agent 配置、后端选择）
- [ ] Phaser 仅在 CanvasPreview.vue 中使用
- [ ] CharacterCreatorModal.vue 不直接引用 Phaser
- [ ] 所有 Vue 组件使用 design-system tokens（无硬编码样式）
- [ ] 切换 V1/V2 只需改 index.ts 一处
- [ ] TypeScript 编译无错误
- [ ] 现有测试（如有）全部通过

---

## 六、风险评估

| 风险 | 影响 | 应对 |
|------|------|------|
| CharacterComposer API 不适配 Vue 响应式 | 中 | composables 层做适配，不直接改 core |
| Phaser Canvas 生命周期管理（创建/销毁） | 低 | CanvasPreview 封装完整生命周期 |
| V2 废弃代码残留导致混淆 | 低 | Phase 5 清理所有废弃文件 |
| Agent 配置面板复杂度高 | 中 | 拆分为独立子组件，逐步实现 |

---

## 七、删除清单（Phase 5 清理）

以下 V2 废弃文件在 V2 重写完成后删除：
- `src/components/CharacterCreatorModalV2.vue`
- `src/components/PartSelectorV2.vue`
- `src/components/BackendSelectorV2.vue`
- `src/components/AgentConfigV2.vue`
- `src/components/CanvasPreviewScene.ts`
