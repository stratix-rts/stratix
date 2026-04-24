# Character Creator V4 技术文档

## 1. 需求理解
重写角色创建面板，架构从 Phaser 为主翻转为 Vue 为主。核心约束: Phaser 仅在 CanvasPreview.vue 中使用；core/ 目录不修改；Props/Emits 接口与 V1 一致。最容易出错的点: 保存流程链路长(合成→缩略图→纹理→清理→存储)，随机化三档的跳过分类策略复杂，AgentChatPanel 双后端调用。

## 2. 文件清单

| 文件 | 职责 | 关键接口 |
|------|------|---------|
| CharacterCreatorModal.vue | 主容器，三栏布局+步骤管理 | Props: visible/editCharacterId, Emits: close/created/updated/deleted |
| CanvasPreview.vue | Phaser Canvas预览(棋盘格+精灵图) | Props: bodyType/parts/animation/direction/scale |
| PartSelector.vue | 部件分类浏览选择 | Props: bodyType/selectedParts, Emits: select/deselect/randomize |
| CharacterList.vue | 已保存角色列表 | Props: characters/currentId/isLoading, Emits: load/delete/setDefault |
| BodyTypeSelector.vue | 体型切换 | Props: modelValue, Emits: change |
| AnimationControls.vue | 动画/方向/缩放控制 | Props: animation/direction/scale/isPlaying |
| StepNavigator.vue | 步骤导航条 | Props: currentStep/completedSteps, Emits: navigate |
| AgentConfigStep.vue | Agent配置(BackendSelector+SoulEditor) | v-model: agentConfig |
| BackendSelector.vue | OpenClaw/Stratix后端选择 | v-model: backendType+config |
| SoulEditor.vue | Soul文本编辑 | v-model: soul |
| AgentChatPanel.vue | 聊天测试面板 | Props: character/backendType/stratixConfig, Emits: complete/back |
| CreditsPanel.vue | 素材致谢展示 | Props: parts |
| JsonEditor.vue | parts JSON编辑弹窗 | Props: parts, Emits: save |
| AttributesDisplay.vue | SkillTree属性加成 | Props: skillTreeState |
| useCharacterState.ts | 角色CRUD+保存流程 | 依赖: characterStorage, characterComposer, textureManager |
| usePartSelection.ts | 部件选择+三档随机化 | 依赖: partRegistry, OPTIONAL_CATEGORIES, MINIMAL_SKIP_CATEGORIES, ALLOWED_SHIELDS |
| usePreviewControl.ts | 动画/方向/缩放状态 | animation/direction/scale/isPlaying |

## 3. 数据流

用户选择部件 → PartSelector emit select → CharacterCreatorModal.handlePartSelect → usePartSelection.selectPart → selectedParts ref 更新 → watch 触发 CanvasPreview props 更新 → CanvasPreview 内调用 characterComposer.composeCharacter → 渲染精灵图

用户保存 → CharacterCreatorModal.handleSave → useCharacterState.saveCharacter → characterComposer.composeCharacter → textureManager.generateThumbnail → textureManager.generateAndUploadTexture → 清理 stratixConfig.apiKey → characterStorage.save → loadSavedCharacters 刷新列表 → emit created/updated

外部打开 → characterCreatorEvents.onOpenCreator → handleLoadCharacter(characterId) → characterStorage.load → 同步到 partSelection + agentConfig

## 4. 保存流程

1. characterComposer.composeCharacter(parts, {bodyType}) → 获取 canvas
2. textureManager.generateThumbnail(canvas, 128) → thumbnail
3. textureManager.generateAndUploadTexture({...}) → texture
4. 更新 updatedAt = Date.now()
5. 克隆角色对象，清理 stratixConfig.apiKey
6. characterStorage.save(cloned) → 持久化
7. isDirty = false
8. loadSavedCharacters() → 刷新右侧列表
9. showToast("角色已保存", "success")

## 5. 风险

1. characterComposer.composeCharacter 是异步操作，Canvas 需要等合成完成 → 加 loading 状态
2. 纹理上传可能失败(网络/磁盘) → try-catch + toast error
3. 三档随机化的 MINIMAL_SKIP_CATEGORIES 有 40+ 个分类，复制时易遗漏 → 直接从 V1 搬迁常量
4. Phaser Game 生命周期(创建/销毁)在 Vue 组件卸载时需彻底清理 → onUnmounted 中 destroy
5. index.ts 切换时需同时提供 default 和 named export → export { default } + export { default as CharacterCreatorModal }

## 6. 验证步骤

- [ ] npx tsc --noEmit 编译通过
- [ ] 打开角色创建器 → 三栏布局正确显示
- [ ] 选择部件 → Canvas 预览实时更新 + 棋盘格背景
- [ ] 体型切换 → 预览更新
- [ ] 三档随机化 → 精简/普通/完全各有不同效果
- [ ] 角色名称可编辑
- [ ] 保存 → 缩略图+纹理生成 → 列表刷新
- [ ] 加载已保存角色 → 所有状态恢复
- [ ] 删除角色 → 列表更新 + EventBus 通知
- [ ] 步骤导航 → appearance/openclaw/agent 正常切换
- [ ] OpenClaw 后端未连接时 → 步骤守卫阻止 + toast 提示
- [ ] AgentChatPanel 发送消息 → 收到回复
- [ ] CreditsPanel 显示当前部件的作者和许可证
- [ ] JsonEditor 编辑保存 → parts 更新
- [ ] AttributesDisplay 显示属性加成
- [ ] Toast 消息在操作后出现并自动消失
