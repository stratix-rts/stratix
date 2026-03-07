# 🐛 角色创建调试指南

## 📍 日志检查点

点击"完成创建"按钮后，请在浏览器控制台（F12）中查看以下日志：

### 1️⃣ CharacterCreatorScene（角色创建器场景）

```
[CharacterCreatorScene] 🔵 onComplete callback triggered
[CharacterCreatorScene] 📦 Character snapshot: {...}
[CharacterCreatorScene] ✅ Emitting character:created event
[CharacterCreatorScene] 💾 Starting async save...
```

### 2️⃣ App.vue（主应用）

```
========================================
[App] 🔵 handleCharacterCreated called
[App] 📦 Character: {...}
[App] 🎮 Game instance exists: true
[App] 🎬 Scene exists: true
[App] 🚀 Emitting character:spawning event
[App] 🔄 Starting async agent creation...
[App] ✅ handleCharacterCreated completed (async operations running in background)
========================================
```

### 3️⃣ StratixRTSGameScene（RTS 游戏场景）

```
========================================
[StratixRTSGameScene] 🔵 onCharacterSpawning called
[StratixRTSGameScene] 📦 Spawn data: {...}
[StratixRTSGameScene] 📍 Safe spawn position: {x: ..., y: ...}
[StratixRTSGameScene] ✨ Creating spawn effect...
[StratixRTSGameScene] 🎬 Starting spawn effect animation
[StratixRTSGameScene] ✅ Spawn effect created and started
========================================
```

### 4️⃣ CharacterSpawnEffect（召唤特效）

```
[CharacterSpawnEffect] 🔵 Constructor called
[CharacterSpawnEffect] 📍 Position: {x: ..., y: ...}
[CharacterSpawnEffect] 🆔 Character ID: ...
[CharacterSpawnEffect] 📛 Character Name: ...
[CharacterSpawnEffect] 🎨 Creating magic circle...
[CharacterSpawnEffect] ✨ Creating particle system...
[CharacterSpawnEffect] 📝 Creating status text...
[CharacterSpawnEffect] ✅ Constructor completed
[CharacterSpawnEffect] 🚀 start() called
[CharacterSpawnEffect] 📊 Current phase: idle
[CharacterSpawnEffect] ⏱️ Start time: ...
[CharacterSpawnEffect] 🎬 Starting magic circle animation
[CharacterSpawnEffect] ⏰ Scheduling phase transition (500ms)
[CharacterSpawnEffect] 🔄 Starting update loop
[CharacterSpawnEffect] ✅ start() completed
```

### 5️⃣ MagicCircle（魔法阵）

```
[MagicCircle] 🚀 start() called
[MagicCircle] 📊 Active: true
[MagicCircle] 📏 Expand progress: 0
[MagicCircle] 💫 Starting expand tween
```

### 6️⃣ 完成阶段（API 返回后）

```
========================================
[StratixRTSGameScene] 🎉 onCharacterSpawnComplete called
[StratixRTSGameScene] 📦 Agent config: {...}
[StratixRTSGameScene] 🆔 Agent ID: ...
[StratixRTSGameScene] 🎨 Spawn effect exists: true
[StratixRTSGameScene] 📍 Getting spawn position...
[StratixRTSGameScene] 📍 Spawn position: {...}
[StratixRTSGameScene] 🎬 Playing complete animation...
[CharacterSpawnEffect] 🎉 playCompleteAnimation() called
[CharacterSpawnEffect] 📊 Current phase: gathering
[CharacterSpawnEffect] 💫 Showing flash effect...
[CharacterSpawnEffect] 🎆 Bursting particles...
[CharacterSpawnEffect] 🌟 Fading out...
[CharacterSpawnEffect] ✅ playCompleteAnimation() completed
[StratixRTSGameScene] 💥 Destroying spawn effect...
[StratixRTSGameScene] 🎮 Setting agent position...
[StratixRTSGameScene] 🤖 Adding agent sprite...
[StratixRTSGameScene] 🎥 Panning camera to spawn position...
[StratixRTSGameScene] ✅ Character spawned successfully at: {...}
========================================
```

## 🔍 故障排查

### 问题 1: 没有看到任何日志

**可能原因**:
- 弹窗没有正确关闭
- 事件监听器未注册

**检查**:
```javascript
// 在控制台执行
console.log('Game exists:', !!window.game);
console.log('Scene exists:', !!window.game?.scene?.getScene('StratixRTSGameScene'));
```

### 问题 2: 只看到前面的日志，没有 RTS 场景日志

**可能原因**:
- `character:spawning` 事件未正确触发
- Scene 未正确初始化

**检查**:
```javascript
// 在控制台手动触发测试
const scene = window.game.scene.getScene('StratixRTSGameScene');
scene.events.emit('character:spawning', {
  characterId: 'test-123',
  name: 'Test Character',
  bodyType: 'male',
  parts: {}
});
```

### 问题 3: 看到召唤日志但看不到视觉效果

**可能原因**:
- 特效被其他对象遮挡
- 深度层级设置问题

**检查**:
```javascript
// 检查召唤特效对象
const scene = window.game.scene.getScene('StratixRTSGameScene');
console.log('Active spawn effects:', scene.spawnEffects.size);
```

### 问题 4: API 调用失败

**可能原因**:
- 网络错误
- 后端 API 问题

**检查**:
```
查看 Network 面板中的以下请求：
POST /api/stratix/texture/upload
POST /api/stratix/config/agent/create
```

## 🎨 视觉效果检查

召唤特效应该按以下顺序出现：

1. **0-500ms**: 魔法阵从中心展开
   - 青色外环 + 粉色内环
   - 旋转 + 脉冲效果

2. **500-3000ms**: 粒子聚集
   - 30-50 个粒子从四周向中心移动
   - 顶部显示 "⚡ 召唤中..." 文字

3. **API 返回后**: 完成动画
   - 白色闪光
   - 粒子向外爆发
   - 角色实体出现
   - 相机平滑移动到角色位置

## 🚨 失败情况

如果创建失败，应该看到：

```
[App] ❌ Failed to create agent: [错误信息]
========================================
[StratixRTSGameScene] ❌ onCharacterSpawnFailed called
[StratixRTSGameScene] 🆔 Character ID: ...
[StratixRTSGameScene] ❌ Error: ...
[StratixRTSGameScene] 🎨 Spawn effect exists: true
[StratixRTSGameScene] 🎬 Playing failed animation...
[CharacterSpawnEffect] ❌ playFailedAnimation() called
========================================
```

视觉上会看到：
- 文字变为红色 "❌ 召唤失败"
- 魔法阵红色闪烁 6 次
- Toast 提示显示错误信息

## 📊 性能指标

正常流程的预期时间：

| 阶段 | 预期时间 |
|------|----------|
| 弹窗关闭 | 0ms（立即） |
| 魔法阵展开 | 500ms |
| 粒子聚集 | 500-3000ms |
| API 调用 | 1000-3000ms |
| 完成动画 | 800ms |
| 相机移动 | 800ms |
| **总计** | **约 3-5 秒** |

## 🔧 手动测试命令

在浏览器控制台执行以下命令进行测试：

```javascript
// 1. 测试召唤特效
const scene = game.scene.getScene('StratixRTSGameScene');
scene.events.emit('character:spawning', {
  characterId: 'test-char',
  name: 'Test Hero',
  bodyType: 'male',
  parts: {}
});

// 2. 等待 2 秒后测试完成
setTimeout(() => {
  scene.events.emit('character:spawn-complete', {
    agentId: 'test-char',
    name: 'Test Hero',
    type: 'custom',
    profile: {
      characterId: 'test-char',
      name: 'Test Hero',
      bodyType: 'male',
      parts: {}
    }
  });
}, 2000);

// 3. 测试失败动画
scene.events.emit('character:spawn-failed', {
  characterId: 'test-char',
  error: 'Test error'
});
```

## 📝 日志级别说明

- 🔵 流程开始
- ✅ 操作成功
- ❌ 错误/失败
- 📦 数据对象
- 🎬 动画/特效
- 🚀 启动/开始
- 💥 销毁/清理
- 🎉 完成
- ⚠️ 警告

---

**提示**: 如果问题仍然存在，请提供控制台的完整日志输出，包括所有带有 `[CharacterCreatorScene]`, `[App]`, `[StratixRTSGameScene]`, `[CharacterSpawnEffect]`, `[MagicCircle]` 前缀的日志。
