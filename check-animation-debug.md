# 📋 动画调试检查清单

## 1. 检查控制台日志

打开浏览器控制台（F12），查找以下关键日志：

### ✅ 应该看到的日志：

```
[CharacterComposer] 🎨 Composing character with 15 animations: [...]
[RTSCharacterRenderer] Creating frames for char-xxx, canvas: 832x3456
[RTSCharacterRenderer] ✅ Created animation: char-xxx_walk_0, frames: 8, frameRate: 10
[RTSCharacterRenderer] ✅ Created animation: char-xxx_walk_1, frames: 8, frameRate: 10
[RTSCharacterRenderer] ✅ Created animation: char-xxx_walk_2, frames: 8, frameRate: 10
[RTSCharacterRenderer] ✅ Created animation: char-xxx_walk_3, frames: 8, frameRate: 10
...
[AgentSprite] Playing animation: char-xxx_walk_2, exists: true
[AgentSprite] ✅ Animation playing: char-xxx_walk_2
```

### ❌ 可能的错误日志：

```
[RTSCharacterRenderer] Frame out of bounds for walk_2_1: x=64, y=576, canvas=832x3456
[RTSCharacterRenderer] No frames created for walk_2
[AgentSprite] ❌ Animation NOT FOUND: char-xxx_walk_2
```

## 2. 在浏览器控制台运行以下命令

### 检查已创建的动画：
```javascript
// 获取所有角色动画
const game = document.querySelector('canvas')?.__phaser_game;
if (game) {
  game.scene.scenes.forEach(scene => {
    const anims = Object.keys(scene.anims.anims).filter(k => k.includes('char-'));
    console.log(`Scene ${scene.scene.key}:`, anims);
  });
}
```

### 检查特定角色的动画：
```javascript
// 替换 'char-xxx' 为你的角色ID
const textureKey = 'char-xxx';
const game = document.querySelector('canvas')?.__phaser_game;
if (game) {
  const scene = game.scene.scenes[0];
  const anims = Object.keys(scene.anims.anims).filter(k => k.startsWith(textureKey));
  console.log(`Animations for ${textureKey}:`, anims);
  console.log(`Total: ${anims.length} animations`);
  
  // 检查walk动画
  const walkAnims = anims.filter(k => k.includes('walk'));
  console.log(`Walk animations:`, walkAnims);
}
```

## 3. 检查Canvas纹理

```javascript
// 检查canvas内容
const canvas = document.querySelector('canvas');
console.log(`Main canvas: ${canvas.width}x${canvas.height}`);

// 如果有纹理缓存
const game = document.querySelector('canvas')?.__phaser_game;
if (game) {
  const textures = game.textures;
  console.log(`Total textures:`, textures.length);
}
```

## 4. 复制完整日志

请将控制台的完整日志（特别是包含 `[CharacterComposer]`、`[RTSCharacterRenderer]`、`[AgentSprite]` 的部分）复制给我。
