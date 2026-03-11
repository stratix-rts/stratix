# Stratix Design System v2.0

**一人成军，万智听命** - 统一的设计语言系统

---

## 🚀 快速开始

### 安装与初始化

```typescript
// 在应用入口初始化
import { initDesignSystem } from '@/design-system';

initDesignSystem(); // 自动恢复保存的主题并注入 CSS 变量
```

### 基础使用

```typescript
import { 
  setTheme, 
  getCurrentTheme, 
  getSemanticTokens 
} from '@/design-system';

// 切换主题
setTheme('minimal');

// 获取当前主题
const theme = getCurrentTheme();
console.log(theme.colors.brand.primary);  // #4F46E5

// 获取语义 Token（推荐方式）
const semantic = getSemanticTokens();
```

### 🎨 主题切换示例

```vue
<template>
  <div class="theme-switcher">
    <button 
      v-for="t in themes" 
      :key="t.id"
      :class="{ active: currentTheme === t.id }"
      @click="setTheme(t.id)"
    >
      {{ t.name }}
    </button>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { setTheme, onThemeChange, getAllThemes } from '@/design-system';

const themes = getAllThemes();
const currentTheme = ref('cyberpunk');

onMounted(() => {
  onThemeChange(({ theme }) => {
    currentTheme.value = theme;
  });
});
</script>
```

📖 [完整主题切换指南](../../docs/THEME_SWITCHING.md)

---

## 🎨 架构分层

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
│ - button.primary.background                             │
│ - panel.elevated.shadow                                 │
│ - input.focus.border                                    │
│ - 随主题变化，动态生成                                    │
└─────────────────────────────────────────────────────────┘
                           ↓ 组合
┌─────────────────────────────────────────────────────────┐
│ Level 3: Component Tokens (组件级令牌)                   │
│ - Vue 组件配置                                          │
│ - Phaser 组件配置                                       │
└─────────────────────────────────────────────────────────┘
```

---

## 📦 文件结构

```
src/design-system/
├── config.ts              # 主配置（主题切换、CSS 注入）
├── types.ts               # TypeScript 类型定义
├── index.ts               # 统一入口
├── tokens/                # Level 1: 全局 Token
│   ├── colors.ts         # 颜色系统（Primitives + Themes）
│   ├── spacing.ts
│   ├── radii.ts
│   ├── borders.ts
│   ├── shadows.ts
│   ├── typography.ts
│   ├── animation.ts
│   └── depth.ts
├── semantic/              # Level 2: 语义 Token（主题感知）
│   ├── _generator.ts     # 语义 Token 生成器
│   ├── buttons.ts        # 按钮样式
│   ├── panels.ts         # 面板样式
│   ├── inputs.ts         # 输入框状态
│   ├── status.ts         # 状态/反馈
│   ├── forms.ts          # 表单元素
│   └── index.ts          # 统一导出
├── components/            # Level 3: 组件 Token
│   ├── vue/
│   └── phaser/
├── themes/                # 主题系统
│   ├── cyberpunk.ts      # 赛博朋克主题
│   ├── minimal.ts        # 极简主题
│   ├── professional.ts   # 商务主题
│   └── index.ts
├── icons/                 # 图标系统
│   ├── registry.ts
│   └── lucide/
└── composables/           # Vue 组合式函数
    ├── useZIndexManager.ts
    └── useSizeContext.ts
```

---

## 🎭 主题系统

### 可用主题

| 主题 | 描述 | 主色 | 背景 | 特点 |
|------|------|------|------|------|
| `cyberpunk` | 赛博朋克风格 | `#00ffff` | `#0d0d14` | 深色、高对比、霓虹 |
| `minimal` | 极简风格 | `#4F46E5` | `#ffffff` | 浅色、圆润、留白 |
| `professional` | 商务风格 | `#1E40AF` | `#f8fafc` | 稳重、保守、易读 |

### 切换主题

```typescript
import { setTheme, onThemeChange } from '@/design-system';

// 切换主题
setTheme('minimal');

// 监听主题变化
const unsubscribe = onThemeChange(({ theme, semantic }) => {
  console.log(`切换到 ${theme} 主题`);
  console.log('新的按钮样式:', semantic.button.primary);
});

// 取消监听
unsubscribe();
```

---

## 🔮 语义 Token 使用指南

### 为什么使用语义 Token？

**旧方式（硬编码）**:
```typescript
// ❌ 问题：颜色硬编码，切换主题不生效
const buttonStyle = {
  background: '#00ffff',  // 始终是青色
  text: '#0d0d14',
};
```

**新方式（语义 Token）**:
```typescript
// ✅ 正确：自动随主题变化
import { getSemanticTokens } from '@/design-system';

const semantic = getSemanticTokens();
const buttonStyle = semantic.button.primary;
// Cyberpunk: { background: '#00ffff', text: '#0d0d14' }
// Minimal: { background: '#4F46E5', text: '#ffffff' }
```

### 按钮样式

```typescript
import { getSemanticTokens } from '@/design-system';

const { button } = getSemanticTokens();

// 可用变体
button.primary;    // 主按钮（填充主色）
button.secondary;  // 次按钮（描边样式）✨ 不再是透明的！
button.tertiary;   // 第三按钮（灰底）
button.success;    // 成功按钮
button.danger;     // 危险按钮
button.warning;    // 警告按钮
button.ghost;      // 幽灵按钮（透明）
button.disabled;   // 禁用状态

// 使用示例
myButton.style.backgroundColor = button.primary.background;
myButton.style.color = button.primary.text;
myButton.style.border = button.primary.border;
```

### 面板样式

```typescript
const { panel } = getSemanticTokens();

// 可用变体
panel.default;    // 默认面板
panel.elevated;   // 浮起面板（有阴影）
panel.outlined;   // 描边面板
panel.ghost;      // 幽灵面板（半透明）
panel.sunken;     // 凹陷面板（内阴影）
```

### 输入框状态

```typescript
const { input } = getSemanticTokens();

// 所有状态
input.default;   // 默认状态
input.hover;     // 悬停状态
input.focus;     // 聚焦状态（带光晕阴影）
input.error;     // 错误状态（红色边框）
input.success;   // 成功状态（绿色边框）
input.disabled;  // 禁用状态
input.readonly;  // 只读状态
```

### 状态/反馈

```typescript
const { status } = getSemanticTokens();

// 状态类型
status.success;  // 成功（绿）
status.warning;  // 警告（黄）
status.danger;   // 错误（红）
status.info;     // 信息（蓝）
status.neutral;  // 中性（灰）

// 每个状态包含
status.success.background;       // 背景色（15% 透明度）
status.success.backgroundSubtle; // 淡背景（8% 透明度）
status.success.border;           // 边框色
status.success.text;             // 文字色
status.success.icon;             // 图标色
```

---

## 💅 CSS 变量

设计系统会自动注入 CSS 变量到文档根元素：

```css
:root {
  /* 品牌色 */
  --ds-color-primary: #00ffff;
  --ds-color-secondary: #ff00ff;
  
  /* 背景色 */
  --ds-bg-base: #0d0d14;
  --ds-bg-elevated: #12121a;
  --ds-bg-overlay: #1a1a2e;
  
  /* 按钮变量 */
  --ds-btn-primary-bg: #00ffff;
  --ds-btn-primary-text: #0d0d14;
  --ds-btn-secondary-bg: #12121a;
  --ds-btn-secondary-text: #00ffff;
  
  /* 更多变量... */
}
```

在 CSS 中使用：

```css
.my-button {
  background-color: var(--ds-btn-primary-bg);
  color: var(--ds-btn-primary-text);
}
```

---

## 🎮 Vue vs Phaser 边界

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

**统一使用 Token**：
```typescript
// Vue 组件
import { getSemanticTokens } from '@/design-system';

const semantic = getSemanticTokens();
const style = {
  backgroundColor: semantic.panel.elevated.background,
};

// Phaser 组件
import { getSemanticTokens } from '@/design-system';

const semantic = getSemanticTokens();
this.panel.setFillStyle(semantic.panel.elevated.background);
```

---

## 🧪 完整示例

```vue
<template>
  <div 
    class="custom-panel"
    :style="panelStyle"
  >
    <button 
      class="action-btn"
      :style="buttonStyle"
      @mouseenter="hover = true"
      @mouseleave="hover = false"
    >
      确认
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { getSemanticTokens, onThemeChange } from '@/design-system';

const hover = ref(false);

// 获取语义 Token
const semantic = getSemanticTokens();

// 计算样式
const panelStyle = computed(() => ({
  backgroundColor: semantic.panel.elevated.background,
  border: semantic.panel.elevated.border,
  borderRadius: semantic.panel.elevated.borderRadius,
  boxShadow: semantic.panel.elevated.shadow,
  padding: semantic.panel.elevated.padding,
}));

const buttonStyle = computed(() => ({
  backgroundColor: hover.value 
    ? semantic.button.primary.backgroundHover 
    : semantic.button.primary.background,
  color: semantic.button.primary.text,
  border: semantic.button.primary.border,
  borderRadius: semantic.button.primary.borderRadius,
  padding: semantic.button.primary.padding,
  cursor: 'pointer',
  transition: 'all 150ms ease',
}));

// 监听主题变化自动更新
onThemeChange(() => {
  // Vue 的 computed 会自动响应，无需额外操作
  console.log('主题已更新');
});
</script>
```

---

## 📚 API 参考

### 核心函数

| 函数 | 描述 | 示例 |
|------|------|------|
| `setTheme(name)` | 切换主题 | `setTheme('minimal')` |
| `getCurrentTheme()` | 获取当前主题 | `getCurrentTheme().colors.brand.primary` |
| `getSemanticTokens()` | 获取语义 Token | `getSemanticTokens().button.primary` |
| `onThemeChange(cb)` | 监听主题变化 | `onThemeChange(({ theme }) => {...})` |
| `initDesignSystem()` | 初始化设计系统 | `initDesignSystem()` |

### 语义 Token 获取器

| 函数 | 描述 |
|------|------|
| `getButtonSemantic(theme)` | 获取按钮样式 |
| `getPanelSemantic(theme)` | 获取面板样式 |
| `getInputSemantic(theme)` | 获取输入框状态 |
| `getStatusSemantic(theme)` | 获取状态样式 |
| `getFormSemantic(theme)` | 获取表单样式 |

---

## 🔄 迁移指南

### 从 v1.x 迁移到 v2.0

**1. 颜色访问方式**
```typescript
// v1.x (旧)
import { getToken } from '@/design-system';
getToken('colors.primary');

// v2.0 (新)
import { getCurrentTheme } from '@/design-system';
getCurrentTheme().colors.brand.primary;
```

**2. 语义 Token 使用**
```typescript
// v1.x (旧) - 硬编码，不随主题变化
import { ButtonSemantic } from '@/design-system/semantic/buttons';
ButtonSemantic.primary.background;  // 始终是 #00ffff

// v2.0 (新) - 动态生成，随主题变化
import { getSemanticTokens } from '@/design-system';
getSemanticTokens().button.primary.background;  // 根据当前主题变化
```

**3. 初始化**
```typescript
// v2.0 新增初始化步骤
import { initDesignSystem } from '@/design-system';

// 在应用启动时调用
initDesignSystem();
```

---

## 📝 设计原则

1. **主题感知** - 所有语义 Token 随主题自动变化
2. **一致性优先** - Vue 和 Phaser 使用相同 Token
3. **离线优先** - 图标资源本地化
4. **文档即代码** - TypeScript 类型即文档
5. **渐进式增强** - 从全局 → 语义 → 组件
6. **大模型友好** - 命名清晰，节约 Token

---

## 📄 相关文档

- [DESIGN_SYSTEM.md](../../docs/DESIGN_SYSTEM.md) - 完整设计文档
- [COMPONENT_GUIDE.md](../../docs/COMPONENT_GUIDE.md) - 组件开发指南
- [API_REFERENCE.md](./API.md) - API 详细参考

---

**版本**: 2.0.0  
**最后更新**: 2026-03-10  
**维护者**: Stratix Team
