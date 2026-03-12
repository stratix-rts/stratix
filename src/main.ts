import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import App from './App.vue';
import { initDesignSystem, setTheme } from './design-system/config';

const app = createApp(App);
app.use(ElementPlus);

// 初始化 Design System（自动注入 CSS 变量）
initDesignSystem();

// 切换到专业主题
setTheme('professional');

app.mount('#app');
