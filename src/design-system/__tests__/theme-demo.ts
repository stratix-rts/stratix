/**
 * 主题系统使用示例
 * 
 * 展示如何使用新的主题感知语义 Token
 */

import {
  // 主题管理
  setTheme,
  getCurrentTheme,
  getSemanticTokens,
  onThemeChange,
  initDesignSystem,
  
  // 语义 Token 获取
  getButtonSemantic,
  getPanelSemantic,
  getInputSemantic,
  getStatusSemantic,
  getFormSemantic,
  
  // 颜色
  Cyan,
  CyberpunkPrimitives,
  MinimalPrimitives,
} from '../index';

// ============ 示例 1: 基础主题切换 ============

function demoThemeSwitching() {
  console.log('=== 主题切换示例 ===\n');
  
  // 初始化设计系统（自动恢复保存的主题）
  initDesignSystem();
  
  // 切换到 Minimal 主题
  setTheme('minimal');
  
  // 获取当前主题
  const theme = getCurrentTheme();
  console.log('当前主题主色:', theme.colors.brand.primary);
  console.log('背景色:', theme.colors.background.base);
  
  // 切换回 Cyberpunk
  setTheme('cyberpunk');
  console.log('切换后主题主色:', theme.colors.brand.primary);
}

// ============ 示例 2: 使用语义 Token ============

function demoSemanticTokens() {
  console.log('\n=== 语义 Token 示例 ===\n');
  
  // 获取完整的语义 Token 集合
  const semantic = getSemanticTokens();
  
  // 使用按钮样式
  const primaryBtn = semantic.button.primary;
  console.log('主按钮背景:', primaryBtn.background);
  console.log('主按钮悬停:', primaryBtn.backgroundHover);
  console.log('主按钮文字:', primaryBtn.text);
  
  // 使用面板样式
  const elevatedPanel = semantic.panel.elevated;
  console.log('浮起面板背景:', elevatedPanel.background);
  console.log('浮起面板阴影:', elevatedPanel.shadow);
  
  // 使用输入框状态
  const inputFocus = semantic.input.focus;
  console.log('输入框聚焦边框:', inputFocus.border);
  console.log('输入框聚焦阴影:', inputFocus.shadow);
  
  // 使用状态样式
  const successStatus = semantic.status.success;
  console.log('成功状态背景:', successStatus.background);
  console.log('成功状态文字:', successStatus.text);
}

// ============ 示例 3: 主题感知函数 ============

function demoThemeAwareFunctions() {
  console.log('\n=== 主题感知函数示例 ===\n');
  
  const theme = getCurrentTheme();
  
  // 获取特定主题的按钮样式
  const buttons = getButtonSemantic(theme);
  console.log('Cyberpunk 次要按钮背景:', buttons.secondary.background);
  // 注意：不再是透明的！
  
  // 切换到 Minimal 主题再获取
  setTheme('minimal');
  const minimalTheme = getCurrentTheme();
  const minimalButtons = getButtonSemantic(minimalTheme);
  console.log('Minimal 次要按钮背景:', minimalButtons.secondary.background);
  console.log('Minimal 次要按钮边框:', minimalButtons.secondary.border);
  
  // 获取面板样式
  const panels = getPanelSemantic(minimalTheme);
  console.log('Minimal 面板圆角:', panels.default.borderRadius);
  
  // 恢复 Cyberpunk
  setTheme('cyberpunk');
}

// ============ 示例 4: 监听主题变化 ============

function demoThemeChangeListener() {
  console.log('\n=== 主题变化监听示例 ===\n');
  
  // 订阅主题变化
  const unsubscribe = onThemeChange(({ theme, semantic }) => {
    console.log(`主题切换为: ${theme}`);
    console.log(`新主题主按钮背景: ${semantic.button.primary.background}`);
    console.log(`新主题面板阴影: ${semantic.panel.elevated.shadow}`);
  });
  
  // 切换主题触发监听
  setTheme('professional');
  setTheme('minimal');
  setTheme('cyberpunk');
  
  // 取消订阅
  unsubscribe();
}

// ============ 示例 5: 应用到 DOM ============

function demoApplyToDOM() {
  console.log('\n=== DOM 应用示例 ===\n');
  
  if (typeof document === 'undefined') {
    console.log('Node 环境，跳过 DOM 示例');
    return;
  }
  
  // 创建按钮
  const button = document.createElement('button');
  button.textContent = '主题感知按钮';
  
  // 应用当前主题的按钮样式
  const semantic = getSemanticTokens();
  const btnStyle = semantic.button.secondary;
  
  button.style.backgroundColor = btnStyle.background;
  button.style.color = btnStyle.text;
  button.style.border = btnStyle.border;
  button.style.borderRadius = btnStyle.borderRadius;
  button.style.padding = btnStyle.padding;
  
  // 添加悬停效果
  button.addEventListener('mouseenter', () => {
    button.style.backgroundColor = btnStyle.backgroundHover;
  });
  button.addEventListener('mouseleave', () => {
    button.style.backgroundColor = btnStyle.background;
  });
  
  document.body.appendChild(button);
  
  // 监听主题变化自动更新
  onThemeChange(({ semantic: newSemantic }) => {
    const newStyle = newSemantic.button.secondary;
    button.style.backgroundColor = newStyle.background;
    button.style.color = newStyle.text;
    button.style.border = newStyle.border;
  });
}

// ============ 示例 6: 比较三个主题 ============

function demoCompareThemes() {
  console.log('\n=== 三主题对比 ===\n');
  
  const themes = ['cyberpunk', 'minimal', 'professional'] as const;
  
  themes.forEach(themeName => {
    setTheme(themeName);
    const semantic = getSemanticTokens();
    
    console.log(`\n${themeName.toUpperCase()} 主题:`);
    console.log('  主按钮:', semantic.button.primary.background);
    console.log('  次按钮:', semantic.button.secondary.background);
    console.log('  幽灵按钮:', semantic.button.ghost.background);
    console.log('  浮起面板:', semantic.panel.elevated.background);
    console.log('  输入框聚焦:', semantic.input.focus.border);
  });
}

// ============ 运行示例 ============

// 注意：在实际使用时，这些应该在浏览器环境中运行
// 这里仅作为 API 使用示例

// demoThemeSwitching();
// demoSemanticTokens();
// demoThemeAwareFunctions();
// demoThemeChangeListener();
// demoApplyToDOM();
// demoCompareThemes();

console.log('主题系统演示代码已加载');
console.log('运行函数查看效果：');
console.log('- demoThemeSwitching()');
console.log('- demoSemanticTokens()');
console.log('- demoThemeAwareFunctions()');
console.log('- demoCompareThemes()');
