# RTS 模块性能优化方案

## 📋 项目概述

**优化目标：** 提升RTS场景在大量Agent情况下的渲染性能和交互体验  
**优化策略：** 移动系统 → 碰撞系统 → 渲染优化  
**预计工期：** 6-9天

---

## 🎯 性能目标

- ✅ 支持50+ Agent流畅运行（60fps）
- ✅ 群体移动体验流畅（War3风格碰撞推挤）
- ✅ 动画方向与移动方向同步（4方向）
- ✅ 视口密度自动优化渲染模式

---

## 📊 当前状态分析

### 动画系统
- **命名格式：** `{textureKey}_{animation}_{direction}`
- **动画类型：** `idle` (4帧), `walk` (8帧), `run` (8帧)
- **方向：** 0=下, 1=左, 2=上, 3=右
- **示例：** `char-abc123_walk_2`

### 现有问题
- ❌ 所有Agent直接渲染，无视口裁剪
- ❌ Agent位置随机，可能堆叠
- ❌ 缺少移动执行逻辑
- ❌ 无碰撞检测系统
- ❌ 动画与移动未关联

---

## 🚀 优化方案详情

### 阶段一：移动系统 + 动画方向（优先级：1）

#### TODO-1.1: 创建 MovementSystem 基础类
**文件：** `src/stratix-rts/systems/MovementSystem.ts`

**核心功能：**
- [ ] 管理Agent移动状态（目标位置、速度、方向）
- [ ] 统一移动速度：300 像素/秒
- [ ] 4方向计算算法（0=下, 1=左, 2=上, 3=右）
- [ ] 每帧更新Agent位置（向量插值）
- [ ] 到达检测（距离<5px）

**关键代码：**
```typescript
interface MovementState {
  agentId: string;
  targetX: number;
  targetY: number;
  speed: number;
  startTime: number;
}

class MovementSystem {
  private readonly SPEED = 300; // 统一速度
  private movingAgents: Map<string, MovementState> = new Map();
  
  moveTo(agentId: string, x: number, y: number): void
  stop(agentId: string): void
  update(delta: number, agents: Map<string, AgentSprite>): void
  private angleToDirection(angle: number): number // 0-3
}
```

---

#### TODO-1.2: 扩展 AgentSprite 支持移动
**文件：** `src/stratix-rts/sprites/AgentSprite.ts`

**核心功能：**
- [ ] 添加移动相关属性（targetPosition, velocity）
- [ ] 扩展 `playAnimation()` 支持4方向
- [ ] 更新depth（y坐标排序）

**关键修改：**
```typescript
// 现有方法扩展
public playAnimation(anim: 'idle' | 'walk' | 'run', direction: number): void {
  const animKey = `${this.customTextureKey}_${anim}_${direction}`;
  if (this.scene.anims.exists(animKey)) {
    this.sprite.play(animKey);
  }
}

// 新增
public setDirection(direction: number): void {
  this.currentDirection = direction;
}
```

---

#### TODO-1.3: 实现队形系统（星际风格）
**文件：** `src/stratix-rts/systems/FormationSystem.ts`

**核心功能：**
- [ ] 计算选中Agent的中心点
- [ ] 保存每个Agent的相对偏移
- [ ] 目标位置 = 点击位置 + 相对偏移
- [ ] 碰撞系统自动微调最终位置

**算法示例：**
```typescript
moveGroup(agentIds: string[], targetX: number, targetY: number) {
  // 1. 计算中心点
  const center = calculateCenter(agentIds);
  
  // 2. 每个Agent保持相对位置
  agentIds.forEach(id => {
    const agent = getAgent(id);
    const offset = { x: agent.x - center.x, y: agent.y - center.y };
    movementSystem.moveTo(id, targetX + offset.x, targetY + offset.y);
  });
}
```

---

#### TODO-1.4: 集成到 StratixRTSGameScene
**文件：** `src/stratix-rts/StratixRTSGameScene.ts`

**核心功能：**
- [ ] 在 `create()` 初始化 MovementSystem 和 FormationSystem
- [ ] 在 `update()` 调用 `movementSystem.update()`
- [ ] 修改 `handleCommand()` 执行移动命令
- [ ] 群体移动时调用 FormationSystem

**关键修改：**
```typescript
// create()
this.movementSystem = new MovementSystem();
this.formationSystem = new FormationSystem(this);

// update()
update(time: number, delta: number) {
  this.inputHandler?.update();
  this.movementSystem.update(delta, this.agentSprites);
}

// handleCommand()
private handleCommand(target: { x: number; y: number }, commandType?: CommandType) {
  if (this.selectedAgentIds.size > 1) {
    this.formationSystem.moveGroup(
      Array.from(this.selectedAgentIds),
      target.x,
      target.y
    );
  } else {
    this.movementSystem.moveTo(agentId, target.x, target.y);
  }
}
```

---

#### TODO-1.5: 改进初始位置生成
**文件：** `src/stratix-rts/StratixRTSGameScene.ts`

**核心功能：**
- [ ] 替换随机位置生成
- [ ] 在地图边缘生成Agent
- [ ] 避开已有Agent位置
- [ ] 优先使用 `config.position`（如果提供）

**算法示例：**
```typescript
private findOptimalSpawnPosition(type: AgentType): { x: number, y: number } {
  const margin = 100;
  const minDistance = 50;
  
  // 尝试在边缘生成
  for (let attempts = 0; attempts < 50; attempts++) {
    const edge = Math.floor(Math.random() * 4);
    let x, y;
    
    switch (edge) {
      case 0: // 上边
        x = Phaser.Math.Between(margin, MAP_WIDTH - margin);
        y = margin;
        break;
      case 1: // 右边
        x = MAP_WIDTH - margin;
        y = Phaser.Math.Between(margin, MAP_HEIGHT - margin);
        break;
      // ... 其他边
    }
    
    // 检查是否与其他Agent冲突
    if (!this.hasAgentNearby(x, y, minDistance)) {
      return { x, y };
    }
  }
  
  // Fallback: 随机位置
  return {
    x: Phaser.Math.Between(margin, MAP_WIDTH - margin),
    y: Phaser.Math.Between(margin, MAP_HEIGHT - margin)
  };
}
```

---

### 阶段二：碰撞系统（优先级：2）

#### TODO-2.1: 创建 CollisionSystem
**文件：** `src/stratix-rts/systems/CollisionSystem.ts`

**核心功能：**
- [ ] 碰撞半径：20px（直径40px）
- [ ] O(n²) 简单碰撞检测（适合<100 Agent）
- [ ] War3风格碰撞推挤算法
- [ ] 每帧调用 `resolveCollisions()`

**关键算法：**
```typescript
class CollisionSystem {
  private readonly COLLISION_RADIUS = 20;
  
  resolveCollisions(agents: Map<string, AgentSprite>) {
    const agentArray = Array.from(agents.values());
    
    for (let i = 0; i < agentArray.length; i++) {
      for (let j = i + 1; j < agentArray.length; j++) {
        this.resolvePairCollision(agentArray[i], agentArray[j]);
      }
    }
  }
  
  private resolvePairCollision(a1: AgentSprite, a2: AgentSprite) {
    const dx = a2.x - a1.x;
    const dy = a2.y - a1.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const minDistance = this.COLLISION_RADIUS * 2;
    
    if (distance < minDistance && distance > 0) {
      const overlap = minDistance - distance;
      const pushX = (dx / distance) * overlap * 0.5;
      const pushY = (dy / distance) * overlap * 0.5;
      
      a1.x -= pushX;
      a1.y -= pushY;
      a2.x += pushX;
      a2.y += pushY;
    }
  }
}
```

---

#### TODO-2.2: 集成碰撞系统到 GameScene
**文件：** `src/stratix-rts/StratixRTSGameScene.ts`

**核心功能：**
- [ ] 在 `create()` 初始化 CollisionSystem
- [ ] 在 `update()` 调用 `collisionSystem.resolveCollisions()`
- [ ] 碰撞推挤发生在移动之后

**关键修改：**
```typescript
// create()
this.collisionSystem = new CollisionSystem();

// update()
update(time: number, delta: number) {
  this.inputHandler?.update();
  this.movementSystem.update(delta, this.agentSprites);
  this.collisionSystem.resolveCollisions(this.agentSprites); // 移动后处理碰撞
}
```

---

#### TODO-2.3: （可选）空间分区优化
**文件：** `src/stratix-rts/systems/SpatialHashGrid.ts`

**说明：** 仅当Agent数量超过100时实施

**核心功能：**
- [ ] 将地图划分为网格（例如64x64单元格）
- [ ] 快速查询附近Agent
- [ ] 降低碰撞检测复杂度到 O(n)

---

### 阶段三：渲染优化（优先级：3）

#### TODO-3.1: 创建 RenderModeSystem
**文件：** `src/stratix-rts/systems/RenderModeSystem.ts`

**核心功能：**
- [ ] 渲染模式：`'full'` | `'thumbnail'` | `'auto'`
- [ ] 用户手动设置优先
- [ ] 自动模式：视口密度 > 30 切换缩略图
- [ ] 计算视口内Agent数量

**关键逻辑：**
```typescript
type RenderMode = 'full' | 'thumbnail' | 'auto';

class RenderModeSystem {
  private currentMode: RenderMode = 'auto';
  private densityThreshold: number = 30;
  private userPreference: RenderMode | null = null;
  
  setUserMode(mode: RenderMode | null) {
    this.userPreference = mode;
  }
  
  update(agents: Map<string, AgentSprite>, camera: Phaser.Cameras.Scene2D.Camera) {
    if (this.userPreference) {
      this.currentMode = this.userPreference;
    } else {
      const density = this.calculateViewportDensity(agents, camera);
      this.currentMode = density > this.densityThreshold ? 'thumbnail' : 'full';
    }
    
    this.applyModeToAgents(agents);
  }
  
  private calculateViewportDensity(agents, camera): number {
    let count = 0;
    agents.forEach(agent => {
      if (this.isInViewport(agent, camera)) count++;
    });
    return count;
  }
}
```

---

#### TODO-3.2: 创建 ThumbnailGenerator
**文件：** `src/stratix-rts/services/ThumbnailGenerator.ts`

**核心功能：**
- [ ] 为每种type生成颜色圆块（32x32px）
- [ ] 从 `character.thumbnail` 加载缩略图
- [ ] 缓存已生成的纹理

**颜色映射：**
```typescript
const TYPE_COLORS = {
  writer: 0x4A90E2,   // 蓝色
  dev: 0x9B59B6,      // 紫色
  analyst: 0xE67E22,  // 橙色
  custom: 0x00ffff    // 青色
};

static generateTypeThumbnails(scene: Phaser.Scene) {
  Object.entries(TYPE_COLORS).forEach(([type, color]) => {
    const graphics = scene.make.graphics();
    graphics.fillStyle(color, 1);
    graphics.fillCircle(16, 16, 14);
    graphics.generateTexture(`type-${type}-thumbnail`, 32, 32);
    graphics.destroy();
  });
}
```

---

#### TODO-3.3: 扩展 AgentSprite 支持双模式
**文件：** `src/stratix-rts/sprites/AgentSprite.ts`

**核心功能：**
- [ ] 添加 `renderMode` 属性
- [ ] 添加 `thumbnailSprite` 子对象
- [ ] 实现 `setRenderMode()` 方法
- [ ] Full模式：显示所有子对象
- [ ] Thumbnail模式：只显示缩略图

**关键代码：**
```typescript
class AgentSprite {
  private renderMode: 'full' | 'thumbnail' = 'full';
  private thumbnailSprite: Phaser.GameObjects.Image | null = null;
  
  setRenderMode(mode: 'full' | 'thumbnail') {
    this.renderMode = mode;
    
    if (mode === 'thumbnail') {
      this.sprite.setVisible(false);
      this.nameText.setVisible(false);
      this.showThumbnail();
    } else {
      this.sprite.setVisible(true);
      this.nameText.setVisible(true);
      this.hideThumbnail();
    }
  }
  
  private showThumbnail() {
    if (!this.thumbnailSprite) {
      const thumbnailKey = this.getThumbnailKey();
      this.thumbnailSprite = this.scene.add.image(0, 0, thumbnailKey);
      this.thumbnailSprite.setScale(0.5);
      this.add(this.thumbnailSprite);
    }
    this.thumbnailSprite.setVisible(true);
  }
  
  private getThumbnailKey(): string {
    if (this.characterThumbnail) {
      return `thumbnail-${this.agentId}`;
    } else {
      return `type-${this.agentType}-thumbnail`;
    }
  }
}
```

---

#### TODO-3.4: 实现视口裁剪
**文件：** `src/stratix-rts/StratixRTSGameScene.ts`

**核心功能：**
- [ ] 计算视口边界（+100px缓冲区）
- [ ] 设置视口外Agent为不可见和inactive
- [ ] 每帧调用 `cullOffscreenAgents()`

**关键代码：**
```typescript
private cullOffscreenAgents() {
  const camera = this.cameras.main;
  const buffer = 100;
  const bounds = {
    left: camera.scrollX - buffer,
    right: camera.scrollX + camera.width + buffer,
    top: camera.scrollY - buffer,
    bottom: camera.scrollY + camera.height + buffer
  };
  
  this.agentSprites.forEach(sprite => {
    const inBounds = 
      sprite.x >= bounds.left && 
      sprite.x <= bounds.right &&
      sprite.y >= bounds.top && 
      sprite.y <= bounds.bottom;
    
    sprite.setVisible(inBounds);
    sprite.setActive(inBounds);
  });
}
```

---

#### TODO-3.5: 创建用户设置面板
**文件：** `src/components/RTSSettings.vue`

**核心功能：**
- [ ] 渲染模式选择（自动/完整/缩略图）
- [ ] 密度阈值滑块（仅自动模式）
- [ ] 显示Agent名称开关
- [ ] 通过事件总线通知RTS场景

**UI设计：**
```vue
<template>
  <div class="rts-settings">
    <h3>RTS 渲染设置</h3>
    
    <div class="setting-item">
      <label>渲染模式：</label>
      <select v-model="renderMode">
        <option value="auto">自动（推荐）</option>
        <option value="full">完整模式</option>
        <option value="thumbnail">缩略图模式</option>
      </select>
    </div>
    
    <div class="setting-item" v-if="renderMode === 'auto'">
      <label>密度阈值：{{ densityThreshold }}</label>
      <input type="range" v-model="densityThreshold" min="10" max="100" />
    </div>
    
    <div class="setting-item">
      <label>显示Agent名称：</label>
      <input type="checkbox" v-model="showAgentNames" />
    </div>
  </div>
</template>
```

---

### 阶段四：集成测试和优化（优先级：4）

#### TODO-4.1: 性能测试
**文件：** `src/stratix-rts/test/performance-test.ts`

**测试场景：**
- [ ] 10, 20, 50, 100 Agent性能对比
- [ ] 移动系统FPS测试
- [ ] 碰撞系统FPS测试
- [ ] 渲染模式切换测试
- [ ] 视口裁剪效果测试

**测试指标：**
- FPS (目标: 60fps)
- 内存占用
- 碰撞检测次数/帧
- 渲染Agent数量

---

#### TODO-4.2: 事件系统集成
**文件：** `src/stratix-rts/events/types/RTSEventTypes.ts`

**新增事件：**
```typescript
// 用户设置事件
'settings:render_mode_changed': {
  mode: 'full' | 'thumbnail' | 'auto';
  threshold?: number;
  showNames?: boolean;
}

// 移动事件
'agent:move_start': { agentId: string; targetX: number; targetY: number }
'agent:move_complete': { agentId: string; x: number; y: number }
```

---

#### TODO-4.3: 文档和代码审查
**文件：** `docs/RTS_SYSTEM_GUIDE.md`

**内容：**
- [ ] 移动系统使用指南
- [ ] 碰撞系统原理说明
- [ ] 渲染模式最佳实践
- [ ] 性能调优建议
- [ ] API文档

---

## 📁 文件结构

```
src/stratix-rts/
├── systems/
│   ├── MovementSystem.ts          [新建]
│   ├── FormationSystem.ts         [新建]
│   ├── CollisionSystem.ts         [新建]
│   ├── RenderModeSystem.ts        [新建]
│   └── SpatialHashGrid.ts         [新建, 可选]
├── services/
│   └── ThumbnailGenerator.ts      [新建]
├── sprites/
│   └── AgentSprite.ts             [修改]
├── StratixRTSGameScene.ts         [修改]
└── events/types/
    └── RTSEventTypes.ts           [修改]

src/components/
└── RTSSettings.vue                [新建]
```

---

## 🎮 用户体验流程

```
用户选中3个Agent (A, B, C)
    ↓
点击地图目标位置
    ↓
FormationSystem 计算：
  - 中心点: (100, 100)
  - A偏移: (-20, -20)
  - B偏移: (20, -20)
  - C偏移: (0, 20)
    ↓
MovementSystem 移动：
  - A → (目标X-20, 目标Y-20), 速度300px/s
  - B → (目标X+20, 目标Y-20), 速度300px/s
  - C → (目标X, 目标Y+20), 速度300px/s
    ↓
每帧 update():
  1. MovementSystem 更新位置
  2. 播放 walk 动画（根据方向0-3）
  3. CollisionSystem 推挤调整
  4. RenderModeSystem 检查密度
  5. 视口裁剪
    ↓
到达目标：
  - 播放 idle 动画
  - 最终位置可能微调（碰撞影响）
```

---

## ⚙️ 技术参数

| 参数 | 值 | 说明 |
|------|-----|------|
| 移动速度 | 300 px/s | 统一速度 |
| 碰撞半径 | 20 px | Agent间最小距离40px |
| 缩略图大小 | 32x32 px | 性能优化用 |
| 视口缓冲区 | 100 px | 裁剪边界 |
| 密度阈值 | 30 | 自动切换阈值 |
| 到达判定 | 5 px | 距离<5视为到达 |
| 方向数量 | 4 | 下/左/上/右 |

---

## 🔄 动画方向映射

```
角度范围 → 方向值 → 动画帧
0-90°    → 0      → walk_0 (向下)
90-180°  → 1      → walk_1 (向左)
180-270° → 2      → walk_2 (向上)
270-360° → 3      → walk_3 (向右)
```

**角度计算：**
```typescript
const angle = Phaser.Math.Angle.Between(fromX, fromY, toX, toY);
const deg = Phaser.Math.RadToDeg(angle);
const normalized = ((deg % 360) + 360) % 360;

if (normalized >= 315 || normalized < 45) return 0; // down
if (normalized >= 45 && normalized < 135) return 1; // left
if (normalized >= 135 && normalized < 225) return 2; // up
return 3; // right
```

---

## 📊 性能预期

### 优化前
- 50 Agent: ~40-50 FPS
- 无碰撞检测
- 无移动动画
- Agent可能堆叠

### 优化后
- 50 Agent: 60 FPS (稳定)
- War3风格碰撞推挤
- 4方向动画同步
- 队形保持
- 视口裁剪
- 自动渲染优化

---

## 🚨 注意事项

1. **碰撞检测优化**
   - 初始实现使用 O(n²) 简单算法
   - Agent数量超过100时需实施空间分区

2. **队形系统**
   - 不是严格阵型，只是保持相对位置
   - 最终位置由碰撞系统微调

3. **渲染模式**
   - 用户手动设置优先于自动模式
   - 缩略图生成需要在场景初始化时完成

4. **动画同步**
   - 确保4方向动画都已生成
   - 移动开始时播放walk，停止时播放idle

---

## ✅ 验收标准

### 阶段一：移动系统
- [ ] 单个Agent可以平滑移动到目标位置
- [ ] 移动时播放walk动画，停止时播放idle
- [ ] 动画方向与移动方向匹配（4方向）
- [ ] 多个Agent移动时保持相对队形
- [ ] 移动速度为300px/s

### 阶段二：碰撞系统
- [ ] Agent之间不会重叠
- [ ] 碰撞推挤效果自然（War3风格）
- [ ] 群体移动时自动避让
- [ ] 初始位置不会堆叠

### 阶段三：渲染优化
- [ ] 视口外Agent被裁剪（不可见）
- [ ] 密度>30时自动切换缩略图模式
- [ ] 用户可以手动切换渲染模式
- [ ] 缩略图正确显示（优先thumbnail字段，fallback到type颜色块）
- [ ] 50 Agent场景保持60 FPS

### 阶段四：整体测试
- [ ] 所有功能集成无冲突
- [ ] 性能测试通过
- [ ] 代码审查完成
- [ ] 文档完善

---

## 📝 开发日志

### Day 1-2: 移动系统
- [ ] TODO-1.1: MovementSystem 基础类
- [ ] TODO-1.2: AgentSprite 扩展
- [ ] TODO-1.3: FormationSystem

### Day 3: 集成和碰撞
- [ ] TODO-1.4: GameScene 集成
- [ ] TODO-1.5: 初始位置优化
- [ ] TODO-2.1: CollisionSystem
- [ ] TODO-2.2: GameScene 碰撞集成

### Day 4-5: 渲染优化
- [ ] TODO-3.1: RenderModeSystem
- [ ] TODO-3.2: ThumbnailGenerator
- [ ] TODO-3.3: AgentSprite 双模式
- [ ] TODO-3.4: 视口裁剪
- [ ] TODO-3.5: 设置面板

### Day 6: 测试和优化
- [ ] TODO-4.1: 性能测试
- [ ] TODO-4.2: 事件系统集成
- [ ] TODO-4.3: 文档和代码审查

---

## 🎯 下一步行动

1. **立即开始：** TODO-1.1 创建 MovementSystem
2. **并行任务：** 阅读现有 AgentSprite 代码，准备扩展
3. **准备工作：** 创建测试Agent配置文件

---

**文档版本：** v1.0  
**最后更新：** 2026-03-02  
**负责人：** AI Assistant  
**状态：** 待实施
