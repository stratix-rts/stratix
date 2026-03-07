# Stratix 组件开发指南

**版本**: 1.0.0  
**最后更新**: 2026-02-26

---

## 快速开始

### 1. 选择组件类型

根据使用场景选择基类：

```
需要表单输入、复杂布局？
├─ 是 → 继承 DOMComponentBase
└─ 否 → 继续判断
    │
需要与游戏场景同步、高频动画？
├─ 是 → 继承 ContainerComponentBase
└─ 否 → 使用 Vue 组件
```

### 2. 基本模板

#### DOM 组件模板

```typescript
import { DOMComponentBase } from '@/stratix-core/ui';

export class MyComponent extends DOMComponentBase {
  constructor(scene: Phaser.Scene, config: any) {
    super(scene, config);
  }
  
  protected generateHTML(): string {
    return `
      <div class="my-component">
        <h3>标题</h3>
        <p>内容</p>
      </div>
    `;
  }
  
  protected setupEventListeners(): void {
    // 事件处理
  }
}
```

#### Container 组件模板

```typescript
import { ContainerComponentBase } from '@/stratix-core/ui';

export class MyComponent extends ContainerComponentBase {
  constructor(scene: Phaser.Scene, config: any) {
    super(scene, config);
  }
  
  protected createContent(): void {
    // 创建背景
    const bg = this.scene.add.rectangle(0, 0, 300, 200, 0x12121a);
    bg.setOrigin(0, 0);
    this.container.add(bg);
    
    // 创建文本
    this.createText(16, 16, '标题');
    
    // 创建按钮
    this.createButton(16, 160, 100, 36, '点击', onClick);
  }
}
```

---

## 设计 Token 使用

### 全局 Token

```typescript
import { getToken } from '@/design-system/config';

// 获取颜色
const primary = getToken('colors.primary');

// 获取间距
const spacing = getToken('spacing.md');

// 获取动画
const duration = getToken('animation.duration.fast');
```

### 语义 Token

```typescript
import { ButtonSemantic } from '@/design-system/semantic/buttons';

const btnStyle = ButtonSemantic.primary;
// {
//   background: '#00ffff',
//   hover: '#00e6e6',
//   ...
// }
```

### Component Token

```typescript
import { VueCommandPanelConfig } from '@/design-system/components/vue/commandPanel';

const config = VueCommandPanelConfig;
// {
//   width: '320px',
//   height: '400px',
//   ...
// }
```

---

## 组件开发最佳实践

### 1. 使用设计 Token

✅ **正确**
```typescript
const bg = this.scene.add.rectangle(
  0, 0, 300, 200,
  parseInt(getToken('colors.background.secondary').slice(1), 16)
);
```

❌ **错误**
```typescript
const bg = this.scene.add.rectangle(0, 0, 300, 200, 0x12121a);
```

### 2. 统一深度管理

✅ **正确**
```typescript
import { Depth } from '@/design-system/tokens/depth';
container.setDepth(Depth.UI_MODAL_CONTENT);
```

❌ **错误**
```typescript
container.setDepth(9999);
```

### 3. 图标使用规范

✅ **正确**
```typescript
import { getIconPath } from '@/design-system/icons/registry';
const icon = getIconPath('close');
```

❌ **错误**
```typescript
const icon = '❌'; // 禁止使用 Emoji
```

### 4. 动画系统

✅ **正确**
```typescript
this.scene.tweens.add({
  targets: this.container,
  alpha: 1,
  duration: getToken('animation.duration.normal'),
  ease: getToken('animation.easing.easeOut'),
});
```

❌ **错误**
```typescript
this.scene.tweens.add({
  targets: this.container,
  alpha: 1,
  duration: 250, // 硬编码
});
```

---

## Vue 组件开发

### 基础组件模板

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { getButtonToken } from '@/design-system/components/shared/button';

interface Props {
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'primary',
  size: 'md',
});

const token = computed(() => getButtonToken(props.variant));
</script>

<template>
  <button class="btn" :style="{
    background: token.background,
    padding: token.layout.padding,
  }">
    <slot />
  </button>
</template>

<style scoped>
.btn {
  transition: all v-bind('token.animation.duration')ms;
}
</style>
```

### 使用示例

```vue
<template>
  <StratixButton variant="primary" @click="handleClick">
    点击
  </StratixButton>
  
  <StratixInput v-model="value" placeholder="输入..." />
  
  <StratixPanel variant="elevated">
    <h3>标题</h3>
  </StratixPanel>
</template>

<script setup lang="ts">
import { StratixButton, StratixInput, StratixPanel } from '@/components/ui';
</script>
```

---

## Phaser 组件开发

### 基础结构

```typescript
import { ContainerComponentBase } from '@/stratix-core/ui';

export class MyPanel extends ContainerComponentBase {
  constructor(scene: Phaser.Scene, config: any) {
    super(scene, {
      x: 100,
      y: 100,
      width: 300,
      height: 200,
      depth: 3000,
    });
  }
  
  protected createContent(): void {
    // 1. 创建背景
    this.createBackground();
    
    // 2. 创建内容
    this.createHeader();
    this.createBody();
    this.createFooter();
    
    // 3. 设置事件
    this.setupEventListeners();
  }
  
  private createHeader(): void {
    this.createText(16, 16, '标题', {
      fontSize: '16px',
      color: '#ffffff',
    });
  }
}
```

### 使用示例

```typescript
import { MyPanel } from './MyPanel';

// 在 Scene 中
const panel = new MyPanel(this, config);
panel.create();
panel.show();
```

---

## 主题切换支持

### 运行时切换

```typescript
import { setTheme } from '@/design-system/config';

// 切换主题
setTheme('minimal');
```

### CSS 变量同步（Vue）

```css
/* 在组件中使用 CSS 变量 */
.btn {
  background: var(--color-primary);
  color: var(--color-text-primary);
}
```

### Phaser 主题监听

```typescript
// 监听主题变化
window.addEventListener('theme:change', (e: CustomEvent) => {
  const themeName = e.detail;
  // 重新渲染组件
  this.updateTheme(themeName);
});
```

---

## 性能优化

### 1. Token 缓存

```typescript
// 缓存常用 Token
const cachedTokens = new Map();

function getCachedToken(path: string) {
  if (!cachedTokens.has(path)) {
    cachedTokens.set(path, getToken(path));
  }
  return cachedTokens.get(path);
}
```

### 2. 组件懒加载

```typescript
// 按需导入组件
const StratixButton = defineAsync(() =>
  import('@/components/ui/StratixButton.vue')
);
```

### 3. 批量操作

```typescript
// 批量设置深度
DepthManager.setDepths([obj1, obj2, obj3], Depth.UI_MODAL_CONTENT);
```

---

## 无障碍支持

### 1. 键盘导航

```typescript
// 支持 Tab 键导航
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    handleSubmit();
  }
  if (e.key === 'Escape') {
    handleClose();
  }
});
```

### 2. ARIA 标签

```html
<button aria-label="关闭面板" @click="handleClose">
  <svg aria-hidden="true">...</svg>
</button>
```

### 3. 焦点管理

```typescript
// 管理焦点
onMounted(() => {
  firstInput.focus();
});
```

---

## 测试指南

### 单元测试

```typescript
import { describe, it, expect } from 'vitest';
import { getToken } from '@/design-system/config';

describe('MyComponent', () => {
  it('should use correct token', () => {
    const color = getToken('colors.primary');
    expect(color).toBe('#00ffff');
  });
});
```

### 快照测试

```typescript
import { render } from '@testing-library/vue';
import StratixButton from '@/components/ui/StratixButton.vue';

it('renders correctly', () => {
  const { container } = render(StratixButton);
  expect(container).toMatchSnapshot();
});
```

---

## 常见问题

### Q: 何时使用 DOM vs Container？

**A**: 根据使用场景：
- **DOM**: 表单、列表、复杂布局
- **Container**: 游戏内 UI、高频动画

### Q: 如何创建自定义主题？

**A**: 复制主题文件并修改：
```typescript
// themes/my-theme.ts
export const MyTheme: DesignSystemTokens = {
  colors: { ... },
  spacing: { ... },
  // ...
};
```

### Q: 图标如何自定义？

**A**: 添加到图标注册表：
```typescript
SVGIconRegistry['my-icon'] = '<path d="..."/>';
```

---

## 相关文档

- [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) - 设计系统文档
- [VUE_PHASER_BOUNDARY.md](./VUE_PHASER_BOUNDARY.md) - Vue/Phaser 边界
- [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) - 实施总结

---

**最后更新**: 2026-02-26  
**维护者**: Stratix Team
