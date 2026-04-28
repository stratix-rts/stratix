# design-system 模块

> 分析时间：2026-04-28 21:12
> 文件数：51 | 代码行数：6833 | 文档覆盖：94%

## 概述

（待补充模块概述）

## 核心类

### `DepthManager`

> -


## 核心函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `isColorPrimitives` | `colors: Colors` | - |
| `createButtonStyle` | `variant: 'primary' | 'secondary' | 'ghos` | - |
| `createPanelStyle` | `variant: 'default' | 'elevated' | 'outli` | - |
| `getCurrentTheme` | `` | - |
| `getSemanticTokens` | `` | - |
| `invalidateSemanticTokenCache` | `` | - |
| `setTheme` | `themeName: keyof typeof DesignSystemConf` | - |
| `flattenSemanticTokens` | `semantic: CompleteSemanticTokens, prefix` | - |
| `injectThemeCSSVariables` | `` | - |
| `restoreThemeFromStorage` | `` | - |

## 依赖关系

### 本模块依赖

- @/design-system/semantic/tooltip
- ../themes/professional
- @/design-system/semantic/forms
- ../themes/cyberpunk
- ../../types
- ./types
- ../tokens/depth
- ../types
- ./semantic/_generator
- @/design-system/semantic/panels
- ../../tokens/depth
- @/design-system/semantic/buttons
- ../tokens/spacing
- @/design-system/semantic/inputs
- ./themes/professional

## 使用示例

```python
# 待补充
```

## 改进建议

- 补充模块概述文档
- 完善核心函数/类注释