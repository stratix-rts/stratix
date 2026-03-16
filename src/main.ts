import { createApp } from 'vue';
import App from './App.vue';
import { initDesignSystem, setTheme } from './design-system/config';

const app = createApp(App);

// 初始化 Design System（自动注入 CSS 变量）
initDesignSystem();

// 切换到赛博朋克主题
setTheme('cyberpunk');

app.mount('#app');
