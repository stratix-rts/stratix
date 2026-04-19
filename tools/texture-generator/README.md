# Stratix Texture Generator

程序化生成装饰纹理工具，支持 **4 主题皮肤切换**，生成结果供 Stratix RTS 游戏使用。

## 使用方法

1. **直接打开** `index.html`（双击或在浏览器中打开）
2. **选择主题**（Fantasy / Cartoon / Cyberpunk / Nature）
3. **选择纹理类型**（Ground Base / Grass / Rock / Tree 等）
4. **点击生成**，满意后按 `S` 保存 PNG

## 批量生成

- **Generate Theme (12)** - 生成当前主题的 12 张纹理
- **Generate All 4 Themes (48)** - 生成全部 4 个主题（48 张纹理）

## 四种主题皮肤

| 主题 | 风格 | 主色调 |
|------|------|--------|
| **Fantasy** | 奇幻/魔法 | 翠绿 + 金色 |
| **Cartoon** | 卡通/明快 | 亮绿 + 天蓝 |
| **Cyberpunk** | 赛博/霓虹 | 深紫 + 青色 |
| **Nature** | 自然/写实 | 棕色 + 暖绿 |

## 纹理类型（每主题 12 张）

### 地表类（可平铺）
- `ground_base` - 基础地表
- `ground_dark` - 深色地表
- `ground_light` - 浅色地表

### 装饰类（独立使用）
- `grass_tuft` - 草叶簇
- `rock_small` - 小岩石
- `rock_large` - 大岩石群
- `flower` - 小花
- `tree` - 树
- `water` - 水塘
- `cloud` - 云朵

## 主题切换原理

```
ThemeManager.setTheme('fantasy')
    ↓
加载 fantasy/ground_base.png
加载 fantasy/grass_tuft.png
加载 fantasy/tree.png
    ↓
地面 + 装饰 自动切换
```

## 工作流程

```
1. 打开 index.html
2. 选择主题 + 纹理类型
3. 预览效果，按 S 保存
4. 放入 public/assets/textures/{theme}/
5. 游戏 ThemeManager.setTheme('xxx') 切换
```

## 技术细节

- p5.js 通过 CDN 加载，**不进入游戏包体积**
- 尺寸：64×64 PNG（可平铺）
- 噪声算法：Simplex Noise（可复现种子）
- 所有纹理纯代码生成，无需外部素材
