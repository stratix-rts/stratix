# Stratix Design System

**一人成军，万智听命** - 统一的设计语言系统

---

## 快速开始

```typescript
// 导入设计系统
import { DesignSystemConfig, getToken } from '@/design-system/config';

// 获取 Token
const primaryColor = getToken('colors.primary');
const buttonStyle = getToken('button.primary');

// 切换主题
import { setTheme } from '@/design-system/config';
setTheme('minimal');
```

---

## 架构分层

```
Level 1: Global Tokens (全局令牌)
├─ colors, spacing, radii, borders, shadows
├─ typography, animation, depth, icons
└─ 平台无关，Vue 和 Phaser 共享

Level 2: Semantic Tokens (语义令牌)
├─ button.primary, panel.border, status.success
└─ 跨框架一致体验

Level 3: Component Tokens (组件令牌)
├─ Vue 组件配置
├─ Phaser 组件配置
└─ 平台特定实现
```

---

## 文件结构

```
src/design-system/
├── config.ts              # 主配置（主题切换）
├── types.ts               # TypeScript 类型定义
├── tokens/                # Level 1: 全局 Token
│   ├── colors.ts
│   ├── spacing.ts
│   ├── radii.ts
│   ├── borders.ts
│   ├── shadows.ts
│   ├── typography.ts
│   ├── animation.ts
│   ├── depth.ts
│   └── icons.ts
├── semantic/              # Level 2: 语义 Token
│   ├── buttons.ts
│   ├── inputs.ts
│   ├── panels.ts
│   ├── status.ts
│   └── navigation.ts
├── components/            # Level 3: 组件 Token
│   ├── vue/               # Vue 组件配置
│   ├── phaser/            # Phaser 组件配置
│   └── shared/            # 共享配置
├── icons/                 # 图标系统
│   ├── registry.ts        # 注册表
│   ├── lucide/            # SVG 图标（本地）
│   └── custom/            # 自定义图标
└── themes/                # 主题系统
    ├── cyberpunk.ts
    ├── minimal.ts
    └── professional.ts
```

---

## Vue vs Phaser 边界

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

## 主题系统

### Cyberpunk (当前)
- 深色背景 `#0d0d14`
- 青色强调 `#00ffff`
- 锐利边角

### Minimal (极简)
- 浅色/深色双模式
- 柔和强调色 `#4F46E5`
- 圆润边角

### Professional (商务)
- 深蓝/灰色系
- 保守配色
- 标准圆角

---

## 图标系统

**禁止使用 Emoji**，使用以下方案：

1. **DOM 组件**: Lucide SVG (下载到本地)
2. **Phaser 组件**: Graphics 绘制函数

```typescript
import { getIconPath } from '@/design-system/icons/registry';

const closeIcon = getIconPath('close');
// SVG path 字符串
```

---

## 设计原则

1. **一致性优先** - Vue 和 Phaser 使用相同 Token
2. **离线优先** - 图标资源本地化
3. **文档即代码** - TypeScript 类型即文档
4. **渐进式增强** - 从全局 → 语义 → 组件
5. **大模型友好** - 命名清晰，节约 Token

---

## 开发状态

- [x] 目录结构创建
- [ ] Level 1: Global Tokens
- [ ] Level 2: Semantic Tokens
- [ ] Level 3: Component Tokens
- [ ] 图标系统
- [ ] 主题系统
- [ ] Vue 组件迁移
- [ ] Phaser 组件迁移

---

## 相关文档

- [DESIGN_SYSTEM.md](../../docs/DESIGN_SYSTEM.md) - 完整设计文档
- [COMPONENT_GUIDE.md](../../docs/COMPONENT_GUIDE.md) - 组件开发指南
- [VUE_PHASER_BOUNDARY.md](../../docs/VUE_PHASER_BOUNDARY.md) - 边界说明
