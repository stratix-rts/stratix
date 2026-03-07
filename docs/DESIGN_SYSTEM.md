# Stratix Design System - 完整设计文档

**版本**: 1.0.0  
**最后更新**: 2026-02-26  
**维护者**: Stratix Team

---

## 快速开始

### 安装

```bash
# 下载图标（离线使用）
python scripts/download-icons.py
```

### 使用

```typescript
// 1. 导入设计系统
import { DesignSystemConfig, getToken } from '@/design-system/config';

// 2. 获取 Token
const primaryColor = getToken('colors.primary');
const buttonStyle = getToken('button.primary');

// 3. 切换主题
import { setTheme } from '@/design-system/config';
setTheme('minimal');
```

---

## 架构分层

```
┌─────────────────────────────────────────────────────────┐
│ Level 1: Global Tokens (全局令牌)                        │
│ - colors, spacing, radii, borders, shadows              │
│ - typography, animation, depth, icons                   │
│ - 平台无关，Vue 和 Phaser 共享                            │
└─────────────────────────────────────────────────────────┘
                        ↓ 继承
┌─────────────────────────────────────────────────────────┐
│ Level 2: Semantic Tokens (语义化令牌)                    │
│ - button.primary, panel.border, status.success          │
│ - 跨框架一致体验                                        │
└─────────────────────────────────────────────────────────┘
                        ↓ 组合
┌─────────────────────────────────────────────────────────┐
│ Level 3: Component Tokens (组件级令牌)                   │
│ - Vue 组件配置：CommandPanel.vue                        │
│ - Phaser 组件配置：CommandPanel.ts                      │
└─────────────────────────────────────────────────────────┘
```

---

## 设计 Token

### Level 1: Global Tokens

#### Colors 颜色

```typescript
import { getToken } from '@/design-system/config';

const primary = getToken('colors.primary');      // #00ffff (Cyberpunk)
const bg = getToken('colors.background.primary'); // #0d0d14
const text = getToken('colors.text.primary');     // #ffffff
```

**主题色板**:
- **Cyberpunk**: 青色 `#00ffff` + 品红 `#ff00ff`
- **Minimal**: 靛蓝 `#4F46E5` + 白色 `#FFFFFF`
- **Professional**: 深蓝 `#1E40AF` + 浅灰 `#F8FAFC`

#### Spacing 间距

基于 **8px** 基准：

| Token | 值 | 场景 |
|-------|-----|------|
| `spacing.xs` | 4px | 最小间距 |
| `spacing.sm` | 8px | 基础单位 |
| `spacing.md` | 16px | 标准间距 |
| `spacing.lg` | 24px | 大间距 |
| `spacing.xl` | 32px | 超大间距 |
| `spacing.2xl` | 48px | 巨大间距 |

#### Radii 圆角

| Token | 值 | 场景 |
|-------|-----|------|
| `radii.none` | 0 | 锐利边角 |
| `radii.sm` | 2px | 小圆角 |
| `radii.md` | 4px | 标准圆角 |
| `radii.lg` | 8px | 大圆角 |
| `radii.xl` | 16px | 超大圆角 |
| `radii.full` | 9999px | 完全圆形 |

#### Animation 动画

```typescript
// 基础配置
const duration = getToken('animation.duration.fast'); // 150ms
const easing = getToken('animation.easing.easeOut');  // ease-out

// 预设动画
const fadeIn = getToken('animation.presets.fadeIn');
```

**持续时间**:
- `fast`: 150ms - 按钮悬停
- `normal`: 250ms - 模态框
- `slow`: 400ms - 页面过渡

**扩展接口**:
```typescript
// 组件级自定义
animation: {
  components?: {
    button?: { hover?: number; active?: number };
    modal?: { enter?: number; exit?: number };
  };
}
```

### Level 2: Semantic Tokens

#### Button 按钮

```typescript
import { ButtonSemantic } from '@/design-system/semantic/buttons';

const primaryBtn = ButtonSemantic.primary;
// {
//   background: '#00ffff',
//   hover: '#00e6e6',
//   text: '#0d0d14',
//   padding: '8px 16px',
//   ...
// }
```

**可用变体**:
- `primary` - 主按钮
- `secondary` - 次按钮
- `success` - 成功
- `danger` - 危险
- `disabled` - 禁用

#### Panel 面板

```typescript
import { PanelSemantic } from '@/design-system/semantic/panels';

const defaultPanel = PanelSemantic.default;
const elevatedPanel = PanelSemantic.elevated;
```

**可用变体**:
- `default` - 默认面板
- `elevated` - 浮起面板
- `outlined` - 描边面板
- `ghost` - 幽灵面板

### Level 3: Component Tokens

#### Vue 组件配置

```typescript
// src/design-system/components/vue/commandPanel.ts
export const VueCommandPanelConfig = {
  width: '320px',
  height: '400px',
  responsive: {
    mobile: {
      width: '100%',
      height: '300px',
    },
  },
} as const;
```

#### Phaser 组件配置

```typescript
// src/design-system/components/phaser/commandPanel.ts
export const PhaserCommandPanelConfig = {
  width: 320,
  height: 400,
  depth: 3000,
} as const;
```

---

## 图标系统

### 使用规范

**禁止使用 Emoji**，使用以下方案：

1. **DOM 组件**: Lucide SVG（下载到本地）
2. **Phaser 组件**: Graphics 绘制函数

### SVG 图标

```typescript
import { getIconPath, createSVGIcon } from '@/design-system/icons/registry';

// 获取 SVG 路径
const closeIcon = getIconPath('close');

// 生成 SVG HTML
const svg = createSVGIcon('close', 24, '#ffffff');
// <svg viewBox="0 0 24 24" width="24" height="24">...</svg>
```

### 自定义图标（Phaser）

```typescript
import { getCustomIcon, drawIcon } from '@/design-system/icons/registry';

const agentIcon = getCustomIcon('agent-writer');
drawIcon(graphics, 'agent-writer', 10, 10, 24, '#00ffff');
```

### 下载图标

```bash
# 下载所有 Lucide 图标到本地
python scripts/download-icons.py
```

---

## 主题系统

### 可用主题

| 主题 | 描述 | 场景 |
|------|------|------|
| `cyberpunk` | 赛博朋克风格 | 当前默认 |
| `minimal` | 极简风格 | 办公场景 |
| `professional` | 商务风格 | 企业场景 |

### 切换主题

```typescript
import { setTheme, getCurrentTheme } from '@/design-system/config';

// 运行时切换
setTheme('minimal');

// 获取当前主题
const theme = getCurrentTheme();
```

### CSS 变量同步（Vue）

```css
/* src/styles/design-system.css */
[data-theme="cyberpunk"] {
  --color-primary: #00ffff;
  --color-background: #0d0d14;
}

[data-theme="minimal"] {
  --color-primary: #4F46E5;
  --color-background: #FFFFFF;
}
```

### Phaser 主题监听

```typescript
window.addEventListener('theme:change', (e: CustomEvent) => {
  const themeName = e.detail;
  // 重新渲染场景
});
```

---

## Vue vs Phaser 边界

### 决策矩阵

```
用户交互需求
    │
    ├─ 需要原生表单输入？ ──► Vue 3
    │                        （输入框、下拉菜单）
    │
    ├─ 需要复杂滚动？ ──────► Vue 3
    │                        （列表、表格）
    │
    ├─ 需要与游戏场景同步？ ─► Phaser
    │                        （游戏内 HUD）
    │
    ├─ 需要高频动画？ ──────► Phaser
    │                        （粒子效果、拖拽）
    │
    └─ 否则 ────────────────► 优先 Vue 3
                             （开发效率）
```

### 明确划分

| 场景 | 技术栈 | 案例 |
|------|--------|------|
| 应用框架 | Vue 3 | MainLayout, App.vue |
| 模态框 | Vue 3 | HeroManagementModal |
| 表单输入 | Vue 3 | ParamFormModal |
| 列表/表格 | Vue 3 | CommandLog |
| RTS 游戏场景 | Phaser | StratixRTSGameScene |
| Agent Sprite | Phaser | AgentSprite |
| TaskZone | Phaser | TaskZone |
| 游戏内 HUD | Phaser | CommandPanel, DetailPanel |
| 角色创建器 | 混合 | CharacterCreatorScene |

---

## 开发指南

### 创建新组件

1. **选择基类**:
   - Vue: 使用 `defineComponent`
   - Phaser: 继承 `ContainerComponentBase`

2. **定义配置**:
   ```typescript
   // 组件 Token
   const config = {
     width: 320,
     height: 400,
     depth: 3000,
   };
   ```

3. **使用 Token**:
   ```typescript
   const token = getToken('panel.default');
   ```

4. **实现交互**:
   - Vue: 使用 `v-model`, `@click`
   - Phaser: 使用 `on('pointerdown')`

### 最佳实践

#### ✅ 正确做法

```typescript
// 使用全局 Token
import { getToken } from '@/design-system/config';
const color = getToken('colors.primary');

// 语义化命名
const btnStyle = ButtonSemantic.primary;

// 统一深度
import { Depth } from '@/design-system/tokens/depth';
container.setDepth(Depth.UI_MODAL_CONTENT);
```

#### ❌ 错误做法

```typescript
// 硬编码颜色
const color = '#00ffff';

// 随意深度
container.setDepth(9999);

// 使用 Emoji
const icon = '⚙️';
```

---

## 性能优化

### DOM 组件

- 使用事件委托
- 虚拟滚动长列表
- 防抖/节流频繁操作

### Phaser 组件

- 复用对象池
- 批量绘制 Graphics
- 使用 Texture Atlas

### 主题切换

```typescript
// 缓存 Token
const cachedTokens = new Map();

function getCachedToken(path: string) {
  if (!cachedTokens.has(path)) {
    cachedTokens.set(path, getToken(path));
  }
  return cachedTokens.get(path);
}
```

---

## 测试

### Token 测试

```typescript
import { describe, it, expect } from 'vitest';
import { getToken } from '@/design-system/config';

describe('Design Tokens', () => {
  it('should return primary color', () => {
    const color = getToken('colors.primary');
    expect(color).toBe('#00ffff');
  });
});
```

### 视觉回归测试

```typescript
// 使用 Percy 或 Chromatic
// 比较主题切换前后的截图
```

---

## 相关文档

- [README.md](../src/design-system/README.md) - 快速开始
- [COMPONENT_GUIDE.md](./COMPONENT_GUIDE.md) - 组件开发指南
- [VUE_PHASER_BOUNDARY.md](./VUE_PHASER_BOUNDARY.md) - 边界说明

---

## 更新日志

### v1.0.0 (2026-02-26)

- ✅ 创建 Global Tokens
- ✅ 创建 Semantic Tokens
- ✅ 创建图标系统
- ✅ 创建三个主题
- ✅ 创建配置系统

### 待完成

- [ ] Component Tokens
- [ ] Vue 组件迁移
- [ ] Phaser 组件迁移
- [ ] 自动化测试
