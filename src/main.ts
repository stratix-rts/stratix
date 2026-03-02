import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import App from './App.vue';
import { getCurrentTheme } from './design-system/config';

const app = createApp(App);
app.use(ElementPlus);

// 设置 Design System CSS 变量
function setDesignSystemCSSVariables() {
  const theme = getCurrentTheme();
  const root = document.documentElement;
  
  // Background colors
  root.style.setProperty('--ds-bg-primary', theme.colors.background.primary);
  root.style.setProperty('--ds-bg-secondary', theme.colors.background.secondary);
  root.style.setProperty('--ds-bg-tertiary', theme.colors.background.tertiary);
  
  // Border colors
  root.style.setProperty('--ds-border', theme.colors.border.default);
  root.style.setProperty('--ds-border-strong', theme.colors.border.strong);
  
  // Text colors
  root.style.setProperty('--ds-text', theme.colors.text.primary);
  root.style.setProperty('--ds-text-secondary', theme.colors.text.secondary);
  root.style.setProperty('--ds-text-muted', theme.colors.text.muted);
  
  // Semantic colors
  root.style.setProperty('--ds-primary', theme.colors.primary);
  root.style.setProperty('--ds-secondary', theme.colors.secondary);
  root.style.setProperty('--ds-accent', theme.colors.accent);
  root.style.setProperty('--ds-info', theme.colors.semantic.info);
  root.style.setProperty('--ds-success', theme.colors.semantic.success);
  root.style.setProperty('--ds-warning', theme.colors.semantic.warning);
  root.style.setProperty('--ds-danger', theme.colors.semantic.danger);
}

setDesignSystemCSSVariables();

app.mount('#app');
