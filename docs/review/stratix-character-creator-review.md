# stratix-character-creator 模块审查报告

## 概览

**模块目的**: 基于 LPC (Liberated Pixel Cup) 素材的角色生成器，支持体型选择、部位拼装、技能树配置、Agent 后端连接

**文件统计**: 25+ 文件
- 入口: `index.ts`
- 核心: `CharacterComposer.ts`, `CharacterStorage.ts`, `PartRegistry.ts`, `SkillTree.ts`, `EventEmitter.ts`, `BrowserStorage.ts`, `ZoneContextManagerManager.ts`, `SoulTemplateRenderer.ts`, `SharedSkillStore.ts`
- UI: `CharacterCreatorScene.ts`, `PartSelector.ts`, `CharacterPreview.ts`, `CharacterList.ts`, `BackendSelector.ts`, `AgentChatPanel.ts`, `AgentConfigPanel.ts`, `StratixAgentConfigPanel.ts`, `SkillTreeUI.ts`, `OpenClawConnectionPanel.ts`, `SoulEditor.ts`, `WorkflowEditorPanel.ts`, `WorkflowConfigPanel.ts`, `AgentListPanel.ts`, `ButtonGroup.ts`, `RulesEditor.ts`
- 配置: `constants.ts`, `partConfig.ts`, `skillTreeConfig.ts`, `animationConfig.ts`, `providerConfig.ts`, `agencyAgents.ts`, `skillHubConfig.ts`, `ruleTemplates.ts`, `soulTemplates.ts`
- 类型: `types/index.ts`

**关键导出**: `createCharacterCreator()`, `characterComposer`, `characterStorage`, `partRegistry`, `SkillTree`, `characterCreatorEvents`

---

## 代码质量

### 优点

- **良好的关注点分离**: core/ 处理业务逻辑，ui/ 处理展示，config/ 处理配置
- **TypeScript 类型覆盖完整**: `types/index.ts` 定义了所有关键接口
- **常量管理清晰**: `constants.ts` 集中管理 LPC 精灵表相关的帧大小、动画偏移量、层级 Z 轴等
- **API Key 保护**: 保存前剥离敏感信息 (`CharacterCreatorScene.ts:1359`)
  ```typescript
  const { apiKey: _apiKey, ...stratixConfigWithoutKey } = characterToSave.stratixConfig as any;
  characterToSave.stratixConfig = stratixConfigWithoutKey;
  ```
- **HTML 转义**: `CharacterList.ts:318` 有 `escapeHtml()` 防护 XSS

### 问题

| 位置 | 问题 | 严重性 |
|------|------|--------|
| `CharacterCreatorScene.ts:83-1537` | 主场景类 1450+ 行，`create()` 方法虽只有 30 行但整体类过大 | 中 |
| `CharacterCreatorScene.ts:1198-1220` | `MINIMAL_SKIP_CATEGORIES` 数组 40+ 项，维护困难 | 低 |
| `PartRegistry.ts:143-165` | `supportsAnimation()` 与 `CharacterComposer.ts:131-154` 重复实现动画别名映射 | 中 |
| `CharacterPreview.ts:102-105` | 动画帧创建时使用 `Date.now()` 作为 key 一部分，导致每次 setTexture 调用创建新纹理而非复用 | 中 |
| `AgentChatPanel.ts:329` | `innerHTML = renderMarkdown(message.content)` - 需确认 renderMarkdown 有 XSS 防护 | 中 |

### 函数长度

- `CharacterComposer.composeCharacter()`: 42 行 - 合理
- `PartRegistry.buildSpritePath()`: 20 行 - 合理
- `CharacterCreatorScene.create()`: ~30 行 - 合理，但场景整体过大
- `SkillTree.selectNode()`: 10 行 - 合理

### 死代码/无用代码

- `CharacterCreatorScene.ts:1029-1055` `buildStratixAgentConfigPanel()` 方法从未被调用（被 `buildAgentPanel()` 直接跳过进入聊天流程）
- `PartSelector.ts:150-152` `createCategoryTabs()` 返回空字符串，无实际作用

---

## 安全

### 注入风险

| 位置 | 风险 | 评估 |
|------|------|------|
| `CharacterCreatorScene.ts:448-466` | `createNameInput()` 中 character.name 直接插入 HTML value | **高** |
| `BackendSelector.ts:199,214,229` | endpoint, accountId, apiKey 直接插入 HTML value | **高** |
| `CharacterList.ts:242-248` | 角色名通过 `escapeHtml()` 转义后插入 HTML | 低 |
| `AgentChatPanel.ts:329` | `renderMarkdown()` 输出直接用 innerHTML | 需确认 |
| `PartSelector.ts:196-217` | part 名称直接插入 innerHTML | 低（来源于可信元数据） |

### 认证/授权

- 无直接认证逻辑，依赖外部 `unifiedOpenClawConnectionManager` 和 `textureManager`
- API Key 在内存中处理，但保存到 IndexedDB 前会剥离（`CharacterCreatorScene.ts:1359`）

### 数据暴露

- `SavedCharacter` 包含完整的 `stratixConfig`，但 `saveCharacter()` 已做脱敏处理
- `CharacterStorage.export()` 输出完整 JSON（包含 API Key 内存值），建议检查调用链

---

## 性能

### 优点

- **图片缓存**: `CharacterComposer.imageCache` 缓存已加载图片，避免重复请求
- **PartRegistry 元数据单次加载**: `loadMetadata()` 只执行一次，后续直接使用 Map 缓存
- **IndexedDB 异步操作**: 所有 DB 操作均为异步，不阻塞主线程
- **Phaser 纹理管理**: 使用 `textures.createCanvas()` 和 `refresh()` 正确管理 GPU 资源

### 问题

| 位置 | 问题 | 影响 |
|------|------|------|
| `CharacterComposer.imageCache` | 无上限的 Map 缓存 | 内存泄漏风险 - 长时间使用后图片缓存无限增长 |
| `CharacterPreview.createdFrameKeys` | 每次 `setTexture()` 调用创建新帧纹理，旧纹理虽 destroy 但频繁 GC | 性能抖动 |
| `CharacterCreatorScene.eventUnsubscribers` | `shutdown()` 有清理，但场景重建（如重置角色）时可能漏掉 | 内存泄漏 |
| `PartRegistry.byCategory` | 使用字符串 key 存储 alias 映射，内存占用略高 | 低 |

### N+1 查询

- `CharacterStorage.list()` 返回所有角色后 sort - 合理，无 N+1 问题
- `PartRegistry.getCredits()` 对每个 itemId 单独查询 meta，但 meta 已在内存中 - 合理

---

## 架构

### 模块边界

```
index.ts (入口)
├── CharacterCreatorScene (Phaser.Scene)
│   ├── PartSelector (部位选择 UI)
│   ├── CharacterPreview (动画预览)
│   ├── CharacterList (已保存角色列表)
│   ├── BackendSelector (后端选择)
│   └── AgentChatPanel (Agent 对话)
├── core/
│   ├── CharacterComposer (精灵拼接)
│   ├── CharacterStorage (IndexedDB 持久化)
│   ├── PartRegistry (部位元数据)
│   ├── SkillTree (技能树逻辑)
│   ├── EventEmitter (跨模块事件)
│   └── BrowserStorage (通用浏览器存储)
└── config/ (各类配置)
```

### 依赖方向

```
CharacterCreatorScene
  ├── partRegistry (单向依赖)
  ├── characterStorage (单向依赖)
  ├── characterComposer (单向依赖)
  ├── textureManager (stratix-core)
  ├── unifiedOpenClawConnectionManager (stratix-core)
  └── StratixEventBus (stratix-core)
```

**依赖方向正确**: 场景依赖核心模块，核心模块不依赖 UI

### 耦合

- **低耦合**: `CharacterComposer`、`PartRegistry`、`SkillTree` 均为独立可测试类
- **中等耦合**: UI 组件与 Phaser.Scene 紧耦合，但这是 Phaser 架构决定的
- **EventEmitter 通过 StratixEventBus 解耦**: 跨模块通信通过事件而非直接调用

---

## 测试

### 覆盖率缺口

| 模块 | 状态 | 说明 |
|------|------|------|
| `CharacterComposer` | 无测试 | 核心拼接逻辑无单元测试 |
| `PartRegistry` | 无测试 | 元数据解析、路径构建无测试 |
| `SkillTree` | 无测试 | 技能树状态机逻辑无测试 |
| `CharacterStorage` | 无测试 | IndexedDB 操作无测试 |
| `CharacterPreview` | 无测试 | UI 组件无测试 |
| `AgentChatPanel` | 无测试 | API 调用无测试 |

### Mock 过度使用风险

- 当前无测试，所以无 mock 风险
- 建议测试时避免 mock `textureManager`（涉及文件上传）和 `unifiedOpenClawConnectionManager`（涉及网络）

### 边界情况

- `CharacterStorage.import()`: JSON 格式错误处理正确
- `PartRegistry.buildSpritePath()`: meta 不存在时返回 null - 正确处理
- `SkillTree.canSelectNode()`: 前置条件检查完整
- 缺失边界测试: 空角色列表、损坏的 IndexedDB、PartRegistry 元数据加载失败

---

## 横向联动

### 依赖的模块

| 模块 | 用途 |
|------|------|
| `@/stratix-core/services` (textureManager) | 纹理生成与上传 |
| `@/stratix-core/UnifiedOpenClawConnectionManager` | OpenClaw Agent 连接 |
| `@/stratix-core/stratix-protocol` | 类型定义 |
| `@/stratix-core/StratixEventBus` | 跨模块事件 |
| `@/stratix-core/ui/DOMContainer` | Phaser DOM 容器 |
| `@/design-system/config` | 主题 token |
| `@/design-system/tokens/depth` | UI 层级 |

### 依赖本模块的模块

- `stratix-project`: 通过 `CharacterCreatorModal.vue` 使用
- `stratix-rts`: 通过 `RTSMoveAPI` 使用角色数据
- 其他模块通过 `characterCreatorEvents` 监听事件

---

## 改进建议

### P0 - 必须修复

1. **XSS 漏洞** - HTML 插值未转义
   - `CharacterCreatorScene.ts:448-466` `createNameInput()`
   - `BackendSelector.ts:199,214,229` `generateHTML()`
   - 修复：使用 `textContent` 设置值，或对用户输入进行 HTML 转义

2. **CharacterComposer 缓存无限增长** (`CharacterComposer.ts:30`)
   ```typescript
   // 当前：无上限 Map
   private imageCache: Map<string, HTMLImageElement> = new Map();
   ```
   建议：添加 maxCacheSize，使用 LRU 淘汰策略

3. **XSS 风险 - innerHTML 使用** (`AgentChatPanel.ts:329`)
   ```typescript
   contentDiv.innerHTML = renderMarkdown(message.content);
   ```
   建议：确认 `renderMarkdown()` 是否做了 HTML 转义/净化，否则改用 `textContent` 或 DOMPurify

### P1 - 应修复

4. **PartRegistry 与 CharacterComposer 动画别名重复** (`PartRegistry.ts:143-165`, `CharacterComposer.ts:131-154`)
   建议：提取到 `constants.ts` 作为共享常量

5. **CharacterPreview 帧纹理泄漏** (`CharacterPreview.ts:58-65`)
   ```typescript
   // cleanupFrameTextures 清理了，但 createdFrameKeys 在每次 setTexture 时累加新 key
   ```
   建议：在 `setTexture` 调用前先 cleanup，或使用静态帧纹理池

6. **buildStratixAgentConfigPanel 从未被调用** (`CharacterCreatorScene.ts:1029-1055`)
   建议：删除死代码，或如果是有意跳过则添加注释说明

### P2 - 可改进

7. **MINIMAL_SKIP_CATEGORIES 维护性差** (`CharacterCreatorScene.ts:1200`)
   建议：改用 `Set<string>` 并从配置读取

8. **场景类过大** (`CharacterCreatorScene.ts`)
   建议：将 `createLeftPanel`/`createMainPanel`/`createRightPanel` 等提取到独立文件或使用 Strategy 模式

9. **缺少单元测试**
   建议：至少为 `CharacterComposer`、`PartRegistry`、`SkillTree` 添加 Jest 单元测试

10. **EventEmitter 订阅未在场景 shutdown 外清理**
    `CharacterCreatorScene.setupEventBus()` 注册的订阅在 `shutdown()` 中有清理，但需确认所有 eventUnsubscribers 都已处理

---

## 总结

| 维度 | 评分 | 说明 |
|------|------|------|
| 代码质量 | B+ | 整体良好，类型完备，但场景类过于庞大 |
| 安全 | C+ | 存在多处 XSS 风险，HTML 插值未转义 |
| 性能 | B | 图片缓存无上限是主要风险点 |
| 架构 | A- | 模块边界清晰，依赖方向正确 |
| 测试 | D | 完全缺失测试覆盖 |
| 可维护性 | B+ | 代码可读性好，但部分配置（如 MINIMAL_SKIP_CATEGORIES）维护困难 |

**总体评估**: 模块设计合理，核心逻辑清晰，UI 集成良好。主要风险点是 XSS 漏洞（HTML 插值未转义）和图片缓存无限增长。
