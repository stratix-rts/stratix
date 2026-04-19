# Stratix RTS 地面美化系统设计

## 核心理念：网格与纹理分离

```
网格层（固定）     → 定义地块边界、大小、Zone 区域
    ↓
纹理层（可切换）   → 4 种主题皮肤，一键切换
    ↓
装饰层（可选）     → 植被/岩石/树木 叠加在纹理上
```

## 四种主题皮肤

| 主题 | 风格 | 主色调 | 适合场景 |
|------|------|--------|----------|
| **Fantasy 奇幻** | 精灵/魔法 | 翠绿 + 金色 + 紫色 | 奇幻冒险 |
| **Cartoon 卡通** | 低多边形/明快 | 亮绿 + 天蓝 + 橙色 | 轻松休闲 |
| **Cyberpunk 赛博** | 霓虹/科技 | 深紫 + 青色 + 粉色 | 未来科幻 |
| **Nature 自然** | 写实/自然 | 暖绿 + 棕色 + 灰蓝 | 策略经营 |

## 纹理清单

每个主题需要 **12 张基础纹理**：

### 1. 地表类（可平铺）
- `ground_base` - 基础地表（主色调）
- `ground_dark` - 深色地表（阴影/边缘）
- `ground_light` - 浅色地表（高光）
- `path` - 泥土路/石板路

### 2. 自然物（可平铺或独立）
- `grass_tuft` - 草叶簇
- `rock_small` - 小岩石
- `rock_large` - 大岩石
- `flower` - 小花/蘑菇
- `tree` - 树（独立 sprite）
- `water` - 水塘/湖泊

### 3. 天空/云（可选，放 UI 层）
- `cloud` - 云朵

## 系统架构

```
StratixRTSGameScene
├── GroundDecorationSystem    # 地面装饰系统
│   ├── ThemeManager          # 主题切换管理
│   ├── GroundLayer           # 地表层（tileSprite）
│   └── DecorationsLayer     # 装饰物层（sprites）
│
└── 切换流程
    1. ThemeManager.setTheme('fantasy')
    2. GroundLayer.swapTextures(themeName)
    3. DecorationsLayer.swapTextures(themeName)
```

## 文件生成计划

```
tools/texture-generator/
├── index.html                    # 主界面（增加主题选择器）
├── generators/
│   ├── noise.js                  # 噪声算法
│   ├── themes/
│   │   ├── fantasy.js            # 奇幻主题生成器
│   │   ├── cartoon.js           # 卡通主题生成器
│   │   ├── cyberpunk.js         # 赛博主题生成器
│   │   └── nature.js            # 自然主题生成器
│   └── shared/                  # 共享绘制函数
│       ├── grass.js
│       ├── rocks.js
│       ├── trees.js
│       ├── water.js
│       └── flowers.js
└── output/
    ├── fantasy/                 # 奇幻主题纹理
    ├── cartoon/                 # 卡通主题纹理
    ├── cyberpunk/               # 赛博主题纹理
    └── nature/                  # 自然主题纹理
```

## 纹理尺寸

- **地表类**：`TILE_SIZE` × `TILE_SIZE`（当前 32×32）
- **独立装饰物**：`32×32` / `64×64` 两种尺寸
- **树**：统一 `64×64`（含透明 alpha）

## 下一步

1. 在 `index.html` 添加主题选择器 UI
2. 为每个主题创建生成器
3. 批量生成所有纹理
4. 导出到 `public/assets/textures/{theme}/`

---

## Theme Config Example

```typescript
// 纹理注册表
export const TEXTURE_PATHS = {
  fantasy: {
    ground_base: 'textures/fantasy/ground_base.png',
    ground_dark: 'textures/fantasy/ground_dark.png',
    grass_tuft: 'textures/fantasy/grass.png',
    // ...
  },
  cartoon: {
    ground_base: 'textures/cartoon/ground_base.png',
    // ...
  },
  // ...
};

// 主题切换 API
groundSystem.setTheme('fantasy');
groundSystem.setTheme('cyberpunk');
```
