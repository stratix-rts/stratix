# 主题切换指南

本文档介绍如何在 Stratix 应用中实现主题切换功能。

---

## 快速开始

### 1. 基础用法

```typescript
import { setTheme, getCurrentTheme } from '@/design-system';

// 切换到 Minimal 主题
setTheme('minimal');

// 获取当前主题
const theme = getCurrentTheme();
console.log(theme.colors.brand.primary);  // #4F46E5
```

### 2. 可用的主题

| 主题 ID | 名称 | 描述 |
|---------|------|------|
| `cyberpunk` | Cyberpunk | 赛博朋克风格，深色背景，霓虹强调色（默认） |
| `minimal` | Minimal | 极简风格，浅色背景，圆润边角 |
| `professional` | Professional | 商务风格，深蓝灰色系，专业稳重 |

---

## 监听主题变化

### 在 Vue 组件中使用

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { onThemeChange, getCurrentTheme } from '@/design-system';

const currentTheme = ref('cyberpunk');

let unsubscribe: (() => void) | null = null;

onMounted(() => {
  // 订阅主题变化
  unsubscribe = onThemeChange(({ theme, semantic }) => {
    console.log(`主题切换为: ${theme}`);
    currentTheme.value = theme;
    
    // semantic 包含完整的语义 Token
    console.log('按钮样式:', semantic.button.primary);
  });
});

onUnmounted(() => {
  // 取消订阅
  if (unsubscribe) {
    unsubscribe();
  }
});
</script>
```

### 在 TypeScript/JavaScript 中使用

```typescript
import { onThemeChange } from '@/design-system';

const unsubscribe = onThemeChange(({ theme, tokens, semantic }) => {
  // theme: 主题名称
  // tokens: 完整主题 Token
  // semantic: 语义 Token（按钮、面板等样式）
  
  console.log(`切换到 ${theme} 主题`);
});

// 取消监听
unsubscribe();
```

---

## 获取主题信息

### 获取所有可用主题

```typescript
import { getAllThemes, getThemeMeta } from '@/design-system/themes';

// 获取所有主题
const themes = getAllThemes();
// [
//   { id: 'cyberpunk', name: 'Cyberpunk', description: '...', preview: {...} },
//   { id: 'minimal', name: 'Minimal', description: '...', preview: {...} },
//   ...
// ]

// 获取特定主题信息
const cyberpunk = getThemeMeta('cyberpunk');
```

### 获取主题预览样式

```typescript
import { getThemePreviewStyles } from '@/design-system/themes';

const previewStyles = getThemePreviewStyles('minimal');
// {
//   backgroundColor: '#ffffff',
//   color: '#0f172a',
//   borderColor: '#4F46E5',
//   '--theme-primary': '#4F46E5',
//   '--theme-bg': '#ffffff',
//   '--theme-text': '#0f172a'
// }
```

---

## 完整示例：主题切换组件

```vue
<template>
  <div class="theme-switcher">
    <button 
      v-for="theme in themes" 
      :key="theme.id"
      :class="['theme-btn', { active: currentTheme === theme.id }]"
      @click="setTheme(theme.id)"
    >
      {{ theme.name }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { 
  setTheme as dsSetTheme,
  getAllThemes, 
  onThemeChange,
  type ThemeMeta,
  type ThemeName 
} from '@/design-system';

const themes = ref<ThemeMeta[]>(getAllThemes());
const currentTheme = ref<ThemeName>('cyberpunk');

function setTheme(themeId: ThemeName) {
  dsSetTheme(themeId);
}

onMounted(() => {
  // 监听主题变化
  onThemeChange(({ theme }) => {
    currentTheme.value = theme as ThemeName;
  });
});
</script>

<style scoped>
.theme-switcher {
  display: flex;
  gap: 8px;
}

.theme-btn {
  padding: 8px 16px;
  border: 1px solid var(--ds-border);
  background: var(--ds-bg-secondary);
  color: var(--ds-text-primary);
  border-radius: 6px;
  cursor: pointer;
}

.theme-btn.active {
  border-color: var(--ds-primary);
  background: var(--ds-primary);
  color: var(--ds-bg-primary);
}
</style>
```

---

## 在 CSS 中使用主题变量

切换主题后，CSS 变量会自动更新，所有使用这些变量的组件会立即响应变化。

```css
.my-component {
  /* 背景色 */
  background-color: var(--ds-bg-primary);
  
  /* 文字色 */
  color: var(--ds-text);
  
  /* 边框 */
  border: 1px solid var(--ds-border);
  
  /* 品牌色 */
  accent-color: var(--ds-primary);
}

.my-button {
  background: var(--ds-btn-primary-bg);
  color: var(--ds-btn-primary-text);
}

.my-button:hover {
  background: var(--ds-btn-primary-bg-hover);
}
```

### 可用的 CSS 变量

#### 颜色变量
- `--ds-primary` - 主色
- `--ds-secondary` - 辅色
- `--ds-accent` - 强调色
- `--ds-success` - 成功色
- `--ds-warning` - 警告色
- `--ds-danger` - 危险色
- `--ds-info` - 信息色

#### 背景色变量
- `--ds-bg-primary` - 主要背景
- `--ds-bg-secondary` - 次要背景
- `--ds-bg-tertiary` - 第三级背景

#### 文字色变量
- `--ds-text` - 主要文字
- `--ds-text-secondary` - 次要文字
- `--ds-text-muted` - 淡化文字

#### 边框变量
- `--ds-border` - 标准边框
- `--ds-border-subtle` - 淡边框
- `--ds-border-strong` - 强调边框

---

## 程序化切换主题

### 切换按钮

```typescript
const themes: ThemeName[] = ['cyberpunk', 'minimal', 'professional'];
let currentIndex = 0;

function toggleTheme() {
  currentIndex = (currentIndex + 1) % themes.length;
  setTheme(themes[currentIndex]);
}
```

### 根据系统主题自动切换

```typescript
import { setTheme } from '@/design-system';

// 监听系统主题变化
const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

function handleSystemThemeChange(e: MediaQueryListEvent) {
  if (e.matches) {
    setTheme('cyberpunk');  // 深色主题
  } else {
    setTheme('minimal');    // 浅色主题
  }
}

mediaQuery.addEventListener('change', handleSystemThemeChange);

// 初始设置
if (mediaQuery.matches) {
  setTheme('cyberpunk');
} else {
  setTheme('minimal');
}
```

### 根据时间自动切换

```typescript
import { setTheme } from '@/design-system';

function setThemeByTime() {
  const hour = new Date().getHours();
  
  // 晚上 6 点到早上 6 点使用深色主题
  if (hour >= 18 || hour < 6) {
    setTheme('cyberpunk');
  } else {
    setTheme('minimal');
  }
}

// 每小时检查一次
setInterval(setThemeByTime, 60 * 60 * 1000);
setThemeByTime();  // 初始设置
```

---

## Phaser/Canvas 场景中的主题切换

Phaser 场景中的 UI 组件也需要响应主题变化。

```typescript
import Phaser from 'phaser';
import { onThemeChange, getSemanticTokens } from '@/design-system';

export class GameScene extends Phaser.Scene {
  private unsubscribe: (() => void) | null = null;
  private panel: Phaser.GameObjects.Graphics | null = null;
  
  create() {
    this.createUI();
    
    // 监听主题变化
    this.unsubscribe = onThemeChange(({ semantic }) => {
      this.updateTheme(semantic);
    });
  }
  
  createUI() {
    const semantic = getSemanticTokens();
    
    // 创建面板
    this.panel = this.add.graphics();
    this.drawPanel(semantic.panel.default.background);
  }
  
  updateTheme(semantic: any) {
    // 更新面板颜色
    if (this.panel) {
      this.panel.clear();
      this.drawPanel(semantic.panel.default.background);
    }
  }
  
  drawPanel(color: string) {
    const hex = parseInt(color.replace('#', '0x'));
    this.panel!.fillStyle(hex, 1);
    this.panel!.fillRect(100, 100, 200, 150);
  }
  
  shutdown() {
    // 清理订阅
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }
}
```

---

## 持久化

主题设置会自动保存到 `localStorage`，刷新页面后仍然保持。

### 手动控制持久化

```typescript
// 切换主题但不保存
setTheme('minimal', { persist: false });

// 切换主题但不注入 CSS 变量
setTheme('minimal', { injectCSS: false });

// 两者都不做
setTheme('minimal', { injectCSS: false, persist: false });
```

### 恢复保存的主题

```typescript
import { initDesignSystem, restoreThemeFromStorage } from '@/design-system/config';

// 在应用启动时调用
initDesignSystem();  // 自动恢复主题并注入 CSS 变量

// 或单独调用
restoreThemeFromStorage();
```

---

## 创建自定义主题

如需添加更多主题，请编辑 `src/design-system/themes/` 目录：

1. 创建新的主题文件，如 `src/design-system/themes/dark.ts`
2. 定义主题配置
3. 导出并注册到 `index.ts`

```typescript
// themes/dark.ts
export const DarkTheme: DesignSystemTokens = {
  colors: DarkPrimitives,
  spacing: Spacing,
  radii: DarkRadii,
  // ... 其他配置
};

// themes/index.ts
export { DarkTheme } from './dark';

// config.ts
export const DesignSystemConfig = {
  themes: {
    cyberpunk: CyberpunkTheme,
    minimal: MinimalTheme,
    professional: ProfessionalTheme,
    dark: DarkTheme,  // 添加新主题
  }
};
```

---

## 调试

### 检查当前 CSS 变量

在浏览器控制台中运行：

```javascript
// 获取所有 ds 相关的 CSS 变量
const styles = getComputedStyle(document.documentElement);
const dsVars = {};

for (let i = 0; i < styles.length; i++) {
  const prop = styles[i];
  if (prop.startsWith('--ds-')) {
    dsVars[prop] = styles.getPropertyValue(prop).trim();
  }
}

console.table(dsVars);
```

### 检查当前主题

```typescript
import { getCurrentTheme, DesignSystemConfig } from '@/design-system';

console.log('当前主题:', DesignSystemConfig.activeTheme);
console.log('主题配置:', getCurrentTheme());
```
