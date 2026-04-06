# Character Creator V2 — 功能补全 Task 列表

> **日期**: 2026-04-06  
> **基于**: V1 `CharacterCreatorScene.ts` (1539行) 全功能梳理  
> **原则**: 逐 task 分配给 Claude Code，每次一个，完成后 review

---

## Task 总览

| # | Task | 优先级 | 涉及文件 | V1 对应 |
|---|------|--------|----------|---------|
| T01 | 随机化三档 + usePartSelection 增强 | P0 | usePartSelection.ts, CharacterCreatorModal.vue | `randomizeCharacter()` `getRandomizationConfig()` `MINIMAL_SKIP_CATEGORIES` `OPTIONAL_CATEGORIES` `ALLOWED_SHIELDS` `getHumanHeadPart()` |
| T02 | 缩略图生成 + 纹理上传（save 流程） | P0 | useCharacterState.ts | `textureManager.generateThumbnail()` `generateAndUploadTexture()` |
| T03 | Credits 致谢展示 | P1 | 新建 CreditsPanel.vue, CharacterCreatorModal.vue | `createCreditsSection()` `updateCreditsDisplay()` `openCreditsModal()` |
| T04 | JSON 编辑器 | P1 | 新建 JsonEditor.vue, CharacterCreatorModal.vue | `createJsonEditorSection()` `openJsonEditor()` |
| T05 | 属性展示 | P1 | CharacterCreatorModal.vue 左侧面板 | `updateAttributesDisplay()` SkillTree 属性 |
| T06 | 棋盘格预览背景 | P1 | CanvasPreview.vue | `createCheckerboardTexture()` |
| T07 | AgentChatPanel（测试聊天） | P1 | 新建 AgentChatPanel.vue, CharacterCreatorModal.vue | `buildAgentChatPanel()` |
| T08 | OpenClaw 连接检查 + 步骤守卫 | P2 | StepNavigator.vue, CharacterCreatorModal.vue | `setStep()` 里检查 `unifiedOpenClawConnectionManager.isConnected()` |
| T09 | EventBus 集成 | P2 | CharacterCreatorModal.vue | `setupEventBus()` `characterCreatorEvents` |
| T10 | Loading 状态 + Toast 消息 | P2 | CharacterCreatorModal.vue | `createLoadingUI()` `showMessage()` |

---

## Task 详细说明

### T01: 随机化三档 + usePartSelection 增强

**V1 功能**:
- `randomizeCharacter(mode: 'minimal' | 'normal' | 'full')` 
- `MINIMAL_SKIP_CATEGORIES`: 大量可选分类（wings, weapon, shield 等）
- `OPTIONAL_CATEGORIES`: 概率性跳过的分类
- `ALLOWED_SHIELDS`: 限制盾牌选择
- `MINIMAL_HEAD_PREFIX = 'Human'`: minimal 模式只选人类头
- `getHumanHeadPart()`: 过滤人类头部
- `getRandomizationConfig()`: 三档配置

**V2 当前状态**: `usePartSelection.ts` 有 `randomize()` 但逻辑简化，没有三档配置

**需要做的**:
1. 在 `usePartSelection.ts` 中添加三档随机化配置（minimal/normal/full）
2. 从 V1 搬迁 `MINIMAL_SKIP_CATEGORIES`、`OPTIONAL_CATEGORIES`、`ALLOWED_SHIELDS`、`MINIMAL_HEAD_PREFIX` 常量
3. 实现 `randomizeMinimal()`、`randomizeNormal()`、`randomizeFull()`
4. 在 `CharacterCreatorModal.vue` 的随机按钮改为下拉或循环切换三档

---

### T02: 缩略图生成 + 纹理上传（save 流程）

**V1 功能** (`saveCharacter()`):
```typescript
// 1. 生成缩略图
this.currentCharacter.thumbnail = textureManager.generateThumbnail(result.canvas, 128);

// 2. 生成并上传纹理
const texture = await textureManager.generateAndUploadTexture({ ... });
if (texture) {
  this.currentCharacter.texture = texture;
}

// 3. 保存前清理 stratixConfig 中的 apiKey
if (characterToSave.stratixConfig) {
  const { apiKey: _apiKey, ...rest } = characterToSave.stratixConfig;
  characterToSave.stratixConfig = rest;
}
```

**V2 当前状态**: `useCharacterState.saveCharacter()` 只做 `characterStorage.save()`，没有缩略图和纹理

**需要做的**:
1. 在 `useCharacterState.ts` 的 `saveCharacter()` 中增加:
   - 调用 `characterComposer.composeCharacter()` 获取 canvas
   - 调用 `textureManager.generateThumbnail()` 生成缩略图
   - 调用 `textureManager.generateAndUploadTexture()` 上传纹理
   - 保存前清理 stratixConfig.apiKey
2. CanvasPreview 需要暴露当前渲染的 canvas 给外部使用（或通过 characterComposer 重新合成）

---

### T03: Credits 致谢展示

**V1 功能**:
- `createCreditsSection()`: 左侧面板底部显示 Credits 区域
- `updateCreditsDisplay()`: 每次部件变化时更新，汇总所有 authors/licenses
- `openCreditsModal()`: 点击 "more" 弹出完整 Credits 弹窗

**V2 当前状态**: 完全缺失

**需要做的**:
1. 新建 `src/components/character-creator/v2/components/CreditsPanel.vue`
2. 接收 parts 作为 prop，自动从 partRegistry 获取 credits
3. 展示汇总的 authors 和 licenses
4. "查看全部" 弹窗
5. 集成到 CharacterCreatorModal.vue 左侧面板

---

### T04: JSON 编辑器

**V1 功能**:
- `createJsonEditorSection()`: 左侧面板底部"JSON 编辑器"入口
- `openJsonEditor()`: 弹出 textarea，显示当前 parts 的 JSON
- 支持编辑并保存（格式校验）

**V2 当前状态**: 完全缺失

**需要做的**:
1. 新建 `src/components/character-creator/v2/components/JsonEditor.vue`
2. 显示 parts JSON，支持编辑
3. 校验 JSON 格式，保存时回写 parts
4. 集成到 CharacterCreatorModal.vue 左侧面板

---

### T05: 属性展示

**V1 功能**:
- `updateAttributesDisplay()`: 左侧面板显示 SkillTree 计算的属性加成
- 格式: `STR+2  DEX+1  INT+3`

**V2 当前状态**: 完全缺失

**需要做的**:
1. 在 CharacterCreatorModal.vue 左侧面板添加属性展示区
2. 使用 SkillTree 计算属性
3. 每次部件变化时更新

---

### T06: 棋盘格预览背景

**V1 功能**:
- `createCheckerboardTexture()`: 在预览区画棋盘格背景，表示透明区域

**V2 当前状态**: CanvasPreview 没有棋盘格

**需要做的**:
1. 在 CanvasPreview.vue 的 Phaser Scene 中添加棋盘格背景
2. 在角色精灵图下方显示

---

### T07: AgentChatPanel（测试聊天）

**V1 功能**:
- `buildAgentChatPanel()`: Step 3 的聊天测试界面
- 连接 OpenClaw 或 Stratix 后端
- 发送消息测试角色是否能正常响应
- onComplete 回调触发角色创建完成流程

**V2 当前状态**: 完全缺失

**需要做的**:
1. 新建 `src/components/character-creator/v2/components/AgentChatPanel.vue`
2. 参考 V1 的 `ui/AgentChatPanel.ts` 实现聊天界面
3. 集成到 CharacterCreatorModal.vue Step 3

---

### T08: OpenClaw 连接检查 + 步骤守卫

**V1 功能**:
- `setStep()` 中检查 `unifiedOpenClawConnectionManager.isConnected()`
- 未连接时不允许进入 agent 步骤
- 显示提示消息

**V2 当前状态**: 步骤切换无守卫

**需要做的**:
1. 在 StepNavigator 或 CharacterCreatorModal 中添加步骤守卫
2. 进入 openclaw/agent 步骤前检查连接状态
3. 未满足条件时显示提示

---

### T09: EventBus 集成

**V1 功能**:
- `setupEventBus()`: 监听 `characterCreatorEvents.onOpenCreator`
- 支持从外部打开角色创建器并加载指定角色

**V2 当前状态**: 缺失

**需要做的**:
1. 在 CharacterCreatorModal.vue 中监听 EventBus
2. 收到 `openCreator` 事件时加载指定角色

---

### T10: Loading 状态 + Toast 消息

**V1 功能**:
- `createLoadingUI()`: 加载时显示进度条
- `showMessage(text, type)`: 底部 toast 提示（success/error/info）

**V2 当前状态**: 缺少统一的 toast 系统

**需要做的**:
1. 在 CharacterCreatorModal.vue 中添加 toast 消息系统
2. 各操作（保存成功、随机化、错误等）触发对应 toast
3. 加载时显示 loading 状态

---

## 执行进度

| # | Task | 状态 | Commit |
|---|------|------|--------|
| T01 | 随机化三档 | 🔄 进行中 | |
| T02 | 缩略图/纹理 save 流程 | ✅ 完成 | 5d74660 |
| T03 | Credits 致谢展示 | ⬜ 待开始 | |
| T04 | JSON 编辑器 | ⬜ 待开始 | |
| T05 | 属性展示 | ⬜ 待开始 | |
| T06 | 棋盘格预览背景 | ✅ 完成 | 46c7387 |
| T07 | AgentChatPanel 测试聊天 | ⬜ 待开始 | |
| T08 | OpenClaw 连接守卫 | ⬜ 待开始 | |
| T09 | EventBus 集成 | ⬜ 待开始 | |
| T10 | Loading + Toast | ⬜ 待开始 | |

---

## 执行顺序

按依赖关系和优先级：

```
T06 (棋盘格) → T02 (save流程) → T01 (随机化) → T10 (toast) → T03 (credits) → T04 (JSON) → T05 (属性) → T07 (chat) → T08 (步骤守卫) → T09 (eventbus)
```

每个 Task 独立可验证，互不冲突。
