# Character Creator V3 — Task 列表 (第三轮)

> **创建时间**: 2026-04-07 (第三轮)
> **目标**: 从 V1（Phaser 为主）翻转为 V3（Vue 为主 + Phaser 仅 CanvasPreview）
> **约束**: core/ 不修改；所有接口必须对照 V1 源码 + App.vue 调用方
> **代码量表**: `CC_V3_RUBRIC.md` | **需求量表**: `CC_V3_REQUIREMENTS_RUBRIC.md`

---

## V1 → V3 组件对照（仅保留 V1 中确实存在的）

| V1 文件 | V3 对应 | V1 行数 |
|---------|---------|---------|
| `CharacterCreatorScene.ts` | `CharacterCreatorModal.vue` | 1539 |
| `ui/CharacterPreview.ts` | `CanvasPreview.vue` | 226 |
| `ui/PartSelector.ts` | `PartSelector.vue` | 270 |
| `ui/CharacterList.ts` | `CharacterList.vue` | 327 |
| `ui/BackendSelector.ts` | `BackendSelector.vue` | 628 |
| `ui/AgentConfigPanel.ts` | `AgentConfigStep.vue` | 1543 |
| `ui/AgentChatPanel.ts` | `AgentChatPanel.vue` | 426 |
| `ui/SoulEditor.ts` | `SoulEditor.vue` | 1266 |
| `ui/SkillTreeUI.ts` | `SkillTreePanel.vue` | 391 |
| `ui/RulesEditor.ts` | `RulesEditor.vue` | 304 |
| 保存/加载/CRUD (Scene 内) | `useCharacterState.ts` | — |
| 随机化逻辑 (Scene 内) | `usePartSelection.ts` | — |
| 动画/方向/缩放 (Scene 内) | `usePreviewControl.ts` | — |

### 砍掉的组件（V1 不存在，上一轮凭空造的）

| 组件 | 原因 |
|------|------|
| ~~AttributesDisplay~~ | V1 没有独立属性面板，属性从 SkillTree 推算 |
| ~~BodyTypeSelector~~ | V1 体型切换内嵌在 PartSelector，不是独立组件 |
| ~~StepNavigator~~ | V1 步骤指示器只有三个文字按钮，不需要独立组件（内嵌主容器） |
| ~~CreditsPanel~~ | V1 信用信息在 Scene.saveCharacter 时收集，不需要独立展示组件 |

## 目录结构

```
src/components/character-creator/
├── index.ts
├── v3/
│   ├── CharacterCreatorModal.vue   ← 主容器 + 步骤导航 + 名称编辑 + Toast
│   ├── components/
│   │   ├── CanvasPreview.vue       ← 唯一使用 Phaser 的组件
│   │   ├── PartSelector.vue        ← 部件选择 + 体型切换（合并）
│   │   ├── CharacterList.vue       ← 已保存角色列表
│   │   ├── AnimationControls.vue   ← 动画/方向/缩放
│   │   ├── BackendSelector.vue     ← 后端选择（OpenClaw/Stratix/Direct）
│   │   ├── AgentConfigStep.vue     ← Agent 配置容器
│   │   ├── SoulEditor.vue          ← Soul 编辑
│   │   ├── RulesEditor.vue         ← Rules 编辑
│   │   ├── SkillTreePanel.vue      ← 技能树可视化
│   │   ├── AgentChatPanel.vue      ← 聊天测试
│   │   └── JsonEditor.vue          ← Parts JSON 编辑（弹窗）
│   ├── composables/
│   │   ├── useCharacterState.ts    ← 角色 CRUD + 保存流程
│   │   ├── usePartSelection.ts     ← 部件选择 + 随机化
│   │   └── usePreviewControl.ts    ← 动画/方向/缩放
│   └── types.ts                    ← V3 特有类型
```

## Task 列表

### Phase 1: 骨架 + 预览

| # | Task | 文件 | 说明 |
|---|------|------|------|
| T01 | 目录结构 + types.ts | `v3/`, `types.ts` | 创建目录，定义 CreatorStep 类型 |
| T02 | CharacterCreatorModal 主容器 | `CharacterCreatorModal.vue` | Props/Emits 与 App.vue 完全一致 |
| T03 | CanvasPreview | `CanvasPreview.vue` | Phaser 隔离，参考 V1 CharacterPreview.ts |
| T04 | usePreviewControl | `usePreviewControl.ts` | 参考 V2 同名 composable |

### Phase 2: 外观编辑

| # | Task | 文件 | 说明 |
|---|------|------|------|
| T05 | usePartSelection | `usePartSelection.ts` | 三档随机化，参考 V1 Scene 内逻辑 |
| T06 | PartSelector | `PartSelector.vue` | 含体型切换，参考 V1 ui/PartSelector.ts |
| T07 | AnimationControls | `AnimationControls.vue` | 参考 V2 同名组件 |

### Phase 3: 角色管理

| # | Task | 文件 | 说明 |
|---|------|------|------|
| T08 | useCharacterState | `useCharacterState.ts` | CRUD + 缩略图 + 保存流程，参考 V1 Scene |
| T09 | CharacterList | `CharacterList.vue` | 参考 V1 ui/CharacterList.ts |
| T10 | JsonEditor | `JsonEditor.vue` | Parts JSON 编辑弹窗 |

### Phase 4: 服务配置

| # | Task | 文件 | 说明 |
|---|------|------|------|
| T11 | BackendSelector | `BackendSelector.vue` | 参考 V1 ui/BackendSelector.ts |

### Phase 5: AI Agent 配置

| # | Task | 文件 | 说明 |
|---|------|------|------|
| T12 | SoulEditor | `SoulEditor.vue` | 参考 V1 ui/SoulEditor.ts |
| T13 | RulesEditor | `RulesEditor.vue` | 参考 V1 ui/RulesEditor.ts |
| T14 | SkillTreePanel | `SkillTreePanel.vue` | 参考 V1 ui/SkillTreeUI.ts |
| T15 | AgentConfigStep | `AgentConfigStep.vue` | 整合 Backend + Soul + Rules + SkillTree |
| T16 | AgentChatPanel | `AgentChatPanel.vue` | 参考 V1 ui/AgentChatPanel.ts |

### Phase 6: 集成

| # | Task | 文件 | 说明 |
|---|------|------|------|
| T17 | EventBus + 数据流串联 | `CharacterCreatorModal.vue` | 外部打开创建器 + 所有 composables 联动 |
| T18 | 编译验证 + index.ts 切换 | 全部 | tsc --noEmit + 切换 index.ts |

---

## 执行顺序

```
Phase 1: T01 → T02 → T03 → T04 (串行，骨架依赖)
Phase 2: T05 → T06 → T07 (T06 依赖 T05, T07 独立)
Phase 3: T08 → T09 → T10 (T09 依赖 T08, T10 独立)
Phase 4: T11 (独立)
Phase 5: T12+T13+T14 并行 → T15 → T16
Phase 6: T17 → T18 (串行)
```

---

## 进度追踪

| # | Task | 状态 | 评分 | 备注 |
|---|------|------|------|------|
| T01 | 目录结构 + types | ✅ | 5.0 | 自己实现 |
| T02 | 主容器骨架 | ✅ | — | Claude Code, 473→726行 |
| T03 | CanvasPreview | ✅ | — | Claude Code, 384行 |
| T04 | usePreviewControl | ✅ | — | Claude Code, 64行 |
| T05 | usePartSelection | ✅ | — | Claude Code, 416行 |
| T06 | PartSelector | ✅ | — | Claude Code, 594行 |
| T07 | AnimationControls | ✅ | — | Claude Code, 342行 |
| T08 | useCharacterState | ✅ | — | Claude Code, 264行 |
| T09 | CharacterList | ✅ | — | Claude Code, ~300行 |
| T10 | JsonEditor | ✅ | — | Claude Code, 158行 |
| T11 | BackendSelector | ✅ | — | Claude Code, 666行 |
| T12 | SoulEditor | ✅ | — | Claude Code, 652行 |
| T13 | RulesEditor | ✅ | — | Claude Code, 504行 |
| T14 | SkillTreePanel | ✅ | — | Claude Code, 491行 |
| T15 | AgentConfigStep | ✅ | — | Claude Code, 418行 |
| T16 | AgentChatPanel | ✅ | — | Claude Code, 575行 |
| T17 | EventBus + 数据流 | ✅ | — | Claude Code |
| T18 | 编译验证 + 切换 | ✅ | 5.0 | tsc --noEmit 零错误 |
