# Stratix Design System v2.0 更新日志

## 🎯 主要改进

### 1. 修复次要颜色透明问题
- **问题**：`button.secondary.background` 原来是 `transparent`
- **解决**：现在次要按钮有正确的背景色，随主题变化
  - Cyberpunk: `#12121a` (深色卡片背景)
  - Minimal: `#f8fafc` (浅色卡片背景)
  - Professional: `#ffffff` (白色背景)

### 2. 主题感知的语义 Token 系统
- **旧方式**：所有语义 Token 硬编码，切换主题不生效
- **新方式**：语义 Token 根据当前主题动态生成

```typescript
// 使用示例
import { getSemanticTokens, setTheme } from '@/design-system';

setTheme('cyberpunk');
const cyberpunk = getSemanticTokens();
cyberpunk.button.secondary.background; // #12121a

setTheme('minimal');
const minimal = getSemanticTokens();
minimal.button.secondary.background; // #f8fafc
```

### 3. 完整的颜色系统重构
新增基础色板：
- `Cyan` - 青色系（Cyberpunk 主色）
- `Magenta` - 品红色系（Cyberpunk 辅色）
- `Indigo` - 靛蓝色系（Minimal/Professional 主色）
- `Gray` - 中性灰色
- `Slate` - 冷灰色系（Professional 主题）
- `Green`, `Amber`, `Red`, `Blue` - 功能色板

### 4. 三个完整主题实现

| 主题 | 主色 | 次要按钮背景 | 圆角特点 | 阴影风格 |
|------|------|--------------|----------|----------|
| Cyberpunk | `#00ffff` | `#12121a` | 锐利 (2-8px) | 深色强烈 |
| Minimal | `#4F46E5` | `#f8fafc` | 圆润 (4-20px) | 柔和浅色 |
| Professional | `#1E40AF` | `#ffffff` | 标准 (2-16px) | 稳重保守 |

### 5. 扩展的语义 Token 集合

#### 按钮变体（8种）
- `primary` - 主按钮（填充品牌色）
- `secondary` - 次按钮（描边样式）✨ **修复透明问题**
- `tertiary` - 第三按钮（灰底）
- `success` - 成功按钮
- `danger` - 危险按钮
- `warning` - 警告按钮
- `ghost` - 幽灵按钮（透明，用于悬停效果）
- `disabled` - 禁用状态

#### 面板变体（5种）
- `default` - 默认面板
- `elevated` - 浮起面板（阴影）
- `outlined` - 描边面板
- `ghost` - 幽灵面板（半透明）
- `sunken` - 凹陷面板（内阴影）

#### 输入框状态（7种）
- `default`, `hover`, `focus`, `error`, `success`, `disabled`, `readonly`

#### 状态类型（5种）
- `success`, `warning`, `danger`, `info`, `neutral`

### 6. CSS 变量自动注入
切换主题时自动注入 CSS 变量：
```css
:root {
  --ds-color-primary: #00ffff;
  --ds-color-secondary: #ff00ff;
  --ds-bg-base: #0d0d14;
  --ds-btn-primary-bg: #00ffff;
  --ds-btn-secondary-bg: #12121a;
  --ds-panel-elevated-shadow: 0 8px 16px rgba(0,0,0,0.5);
  /* ... */
}
```

### 7. 新的 API

```typescript
// 获取语义 Token（推荐）
const semantic = getSemanticTokens();

// 主题感知函数
const buttons = getButtonSemantic(theme);
const panels = getPanelSemantic(theme);
const inputs = getInputSemantic(theme);

// 监听主题变化
const unsubscribe = onThemeChange(({ theme, semantic }) => {
  console.log(`切换到 ${theme}`);
});

// 初始化设计系统
initDesignSystem(); // 自动恢复主题并注入 CSS 变量
```

## 📁 文件变更

### 新增文件
- `src/design-system/semantic/_generator.ts` - 语义 Token 生成器核心
- `src/design-system/__tests__/theme-demo.ts` - 使用示例

### 重大更新
- `src/design-system/tokens/colors.ts` - 完整的基础色板和主题原语
- `src/design-system/config.ts` - 支持动态语义 Token 和 CSS 注入
- `src/design-system/types.ts` - 新的类型定义（ColorPrimitives）
- `src/design-system/semantic/*.ts` - 所有语义 Token 文件支持主题感知
- `src/design-system/themes/*.ts` - 三个主题完整实现
- `src/design-system/index.ts` - 新的导出结构
- `src/design-system/README.md` - 更新文档

## 🔄 迁移指南

### 从 v1.x 迁移

**颜色访问方式变化：**
```typescript
// v1.x (旧)
getToken('colors.primary');

// v2.0 (新)
getCurrentTheme().colors.brand.primary;
```

**语义 Token 使用方式：**
```typescript
// v1.x (旧) - 硬编码，不随主题变化
import { ButtonSemantic } from '@/design-system/semantic/buttons';
ButtonSemantic.primary.background;

// v2.0 (新) - 动态生成，随主题变化
import { getSemanticTokens } from '@/design-system';
getSemanticTokens().button.primary.background;
```

**应用初始化：**
```typescript
// v2.0 新增
import { initDesignSystem } from '@/design-system';
initDesignSystem(); // 在应用入口调用
```

## 🧪 验证主题切换

运行以下代码验证主题系统：

```typescript
import { setTheme, getSemanticTokens } from '@/design-system';

// 测试三个主题
['cyberpunk', 'minimal', 'professional'].forEach(theme => {
  setTheme(theme as any);
  const s = getSemanticTokens();
  
  console.log(`${theme}:`);
  console.log('  次要按钮背景:', s.button.secondary.background);
  console.log('  浮起面板阴影:', s.panel.elevated.shadow);
  console.log('  输入框聚焦边框:', s.input.focus.border);
});
```

## ✅ 检查清单

- [x] 次要按钮不再透明
- [x] 三个主题完整实现
- [x] 语义 Token 随主题变化
- [x] CSS 变量自动注入
- [x] TypeScript 类型完整
- [x] 向后兼容旧 API
- [x] 文档更新
