# 🎯 动画不播放问题 - 快速调试指南

## 📋 问题现象

- ✅ 纹理图完整（可以看到所有动画帧）
- ❌ walk动画未播放（角色移动时静止）

## 🔍 调试步骤

### Step 1: 检查控制台日志

打开浏览器开发者工具（F12），查看Console标签，寻找以下关键日志：

#### 1.1 角色创建日志
```
[CharacterComposer] 🎨 Composing character with 15 animations: [...]
[CharacterComposer] Canvas size: 832x3456
[CharacterComposer] Drew XX items to canvas
```

**如果没有看到这个日志** → 角色纹理未生成

#### 1.2 动画创建日志
```
[RTSCharacterRenderer] Creating frames for char-xxx, canvas: 832x3456
```

**如果没有看到这个日志** → 动画帧未创建

#### 1.3 动画播放日志
```
[AgentSprite] 🎬 Attempting to play: char-xxx_walk_2
[AgentSprite]    - Exists: true
```

**如果看到 `Exists: false`** → 动画未正确创建

### Step 2: 在浏览器控制台运行诊断命令

#### 检查已创建的动画
```javascript
// 获取Phaser game实例
const canvas = document.querySelector('canvas');
const game = canvas?.__phaser_game || window.game;

if (game) {
  // 检查所有场景的动画
  game.scene.scenes.forEach(scene => {
    const allAnims = Object.keys(scene.anims.anims);
    const charAnims = allAnims.filter(k => k.startsWith('char-'));
    
    console.log(`\n📍 Scene: ${scene.scene.key}`);
    console.log(`   Total animations: ${allAnims.length}`);
    console.log(`   Character animations: ${charAnims.length}`);
    
    if (charAnims.length > 0) {
      // 显示前10个动画
      console.log(`   First 10 character anims:`, charAnims.slice(0, 10));
      
      // 统计walk动画
      const walkAnims = charAnims.filter(k => k.includes('walk'));
      console.log(`   ✅ Walk animations: ${walkAnims.length}`, walkAnims);
    }
  });
} else {
  console.error('❌ Game instance not found');
}
```

#### 检查特定角色的纹理和动画
```javascript
// 替换 YOUR_CHARACTER_ID 为实际的角色ID
const characterId = 'YOUR_CHARACTER_ID';
const textureKey = `char-${characterId}`;
const canvas = document.querySelector('canvas');
const game = canvas?.__phaser_game || window.game;

if (game) {
  const scene = game.scene.scenes[0];
  
  // 检查纹理
  console.log(`\n🎨 Texture check for ${textureKey}:`);
  const textureExists = scene.textures.exists(textureKey);
  console.log(`   Texture exists: ${textureExists}`);
  
  if (textureExists) {
    const texture = scene.textures.get(textureKey);
    console.log(`   Texture source[0]: ${texture.source[0].width}x${texture.source[0].height}`);
  }
  
  // 检查动画
  console.log(`\n🎬 Animation check for ${textureKey}:`);
  const allAnims = Object.keys(scene.anims.anims);
  const thisCharAnims = allAnims.filter(k => k.startsWith(textureKey));
  console.log(`   Total animations: ${thisCharAnims.length}`);
  
  // 检查walk动画的每个方向
  for (let dir = 0; dir < 4; dir++) {
    const walkAnimKey = `${textureKey}_walk_${dir}`;
    const exists = scene.anims.exists(walkAnimKey);
    console.log(`   walk_${dir}: ${exists ? '✅' : '❌'} ${walkAnimKey}`);
    
    if (exists) {
      const anim = scene.anims.get(walkAnimKey);
      console.log(`      Frames: ${anim.frames.length}, FrameRate: ${anim.frameRate}`);
    }
  }
}
```

#### 手动播放动画测试
```javascript
// 找到一个agent并尝试播放动画
const canvas = document.querySelector('canvas');
const game = canvas?.__phaser_game || window.game;

if (game) {
  const scene = game.scene.scenes[0];
  
  // 查找所有AgentSprite
  const agents = scene.children.list.filter(child => 
    child.constructor.name === 'AgentSprite' || child.agentId
  );
  
  console.log(`Found ${agents.length} agents`);
  
  if (agents.length > 0) {
    const agent = agents[0];
    console.log(`\n🤖 Testing agent: ${agent.agentId}`);
    console.log(`   customTextureKey: ${agent.customTextureKey}`);
    console.log(`   currentAnimation: ${agent.currentAnimation}`);
    console.log(`   currentDirection: ${agent.currentDirection}`);
    
    // 尝试手动播放walk动画
    console.log(`\n   Attempting to play walk animation...`);
    agent.playAnimation('walk', 2);  // 2 = DOWN direction
    
    // 1秒后检查状态
    setTimeout(() => {
      console.log(`\n   After 1 second:`);
      console.log(`      sprite.anims.isPlaying: ${agent.sprite.anims?.isPlaying}`);
      console.log(`      sprite.anims.currentAnim.key: ${agent.sprite.anims?.currentAnim?.key}`);
    }, 1000);
  }
}
```

### Step 3: 检查纹理图片

```javascript
// 检查纹理内容
const canvas = document.querySelector('canvas');
const game = canvas?.__phaser_game || window.game;

if (game) {
  const scene = game.scene.scenes[0];
  
  // 获取所有以char-开头的纹理
  const textureKeys = Object.keys(scene.textures.list).filter(k => k.startsWith('char-'));
  
  console.log(`Found ${textureKeys.length} character textures:`, textureKeys);
  
  textureKeys.forEach(key => {
    const texture = scene.textures.get(key);
    const source = texture.source[0];
    console.log(`\n📍 ${key}:`);
    console.log(`   Source: ${source.width}x${source.height}`);
    console.log(`   Type: ${source.tagName || 'Canvas'}`);
    
    // 如果是canvas，可以导出为图片查看
    if (source instanceof HTMLCanvasElement) {
      console.log(`   Canvas size: ${source.width}x${source.height}`);
      // 可以在控制台运行: window.open(source.toDataURL())
    }
  });
}
```

### Step 4: 检查MovementSystem

```javascript
// 检查MovementSystem是否正在运行
const canvas = document.querySelector('canvas');
const game = canvas?.__phaser_game || window.game;

if (game) {
  const scene = game.scene.scenes[0];
  
  // 查找MovementSystem
  if (scene.movementSystem) {
    console.log(`\n🏃 MovementSystem check:`);
    console.log(`   Moving agents: ${scene.movementSystem.getMovingAgentCount()}`);
    console.log(`   Agent IDs:`, scene.movementSystem.getAllMovingAgents());
  } else {
    console.warn(`⚠️ MovementSystem not found on scene`);
  }
}
```

## 📊 诊断流程图

```
纹理图完整？
├─ YES → 检查动画是否创建
│   ├─ 检查控制台是否有 "[RTSCharacterRenderer] Creating frames"
│   │   ├─ YES → 检查动画是否存在
│   │   │   ├─ 运行诊断命令检查 walk_0/1/2/3 动画
│   │   │   │   ├─ 存在 → 检查playAnimation是否被调用
│   │   │   │   │   ├─ 检查控制台是否有 "[AgentSprite] 🎬 Attempting to play"
│   │   │   │   │   │   ├─ YES → 检查sprite.play()是否执行
│   │   │   │   │   │   └─ NO → playAnimation未被调用 → 检查MovementSystem
│   │   │   │   └─ 不存在 → 动画创建失败 → 检查createAnimationFrames逻辑
│   │   └─ NO → createAnimationFrames未被调用 → 检查纹理加载流程
└─ NO → 纹理生成失败 → 检查CharacterComposer
```

## ❓ 常见问题和解决方案

### Q1: 控制台没有看到任何日志
**A:** 可能是热重载问题，刷新页面重新加载

### Q2: 纹理存在但动画不存在
**A:** 可能是createAnimationFrames未被调用，检查RTSCharacterRenderer.loadCharacterTexture的执行路径

### Q3: 动画存在但播放失败
**A:** 可能是sprite.play()失败，检查sprite是否有正确的纹理

### Q4: 动画播放了但看不见
**A:** 可能是sprite的visible、alpha或scale问题，或者动画帧率太低/太高

## 📝 请提供以下信息

1. **控制台完整日志** - 特别是包含 `[CharacterComposer]`、`[RTSCharacterRenderer]`、`[AgentSprite]` 的部分
2. **诊断命令的输出** - 特别是"检查已创建的动画"命令的输出
3. **角色移动时的行为** - 角色是静止的？还是有轻微抖动？
4. **是否看到任何错误** - 红色的错误信息

这样我可以快速定位问题所在！🔍
