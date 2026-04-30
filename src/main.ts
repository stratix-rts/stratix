import { createApp } from 'vue';
import { createPinia } from 'pinia';
import VXETable from 'vxe-table';

import App from './App.vue';
import { initDesignSystem, setTheme } from './design-system/config';

import { statusSyncWS } from './stratix-core/services/StatusSyncWebSocketService';

// Vxe Table 全局初始化
import 'vxe-table/lib/style.css';

// Highlight.js for syntax highlighting
import 'highlight.js/styles/github-dark.css';

// Design System 动画预设
import './design-system/animations.css';
import './design-system/micro-interactions.css';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);

// 使用 Vxe Table 插件
app.use(VXETable);

// 初始化 Design System（自动注入 CSS 变量）
initDesignSystem();

// 切换到赛博朋克主题
setTheme('cyberpunk');

// 连接 StatusSync WebSocket 服务，转发 zone 事件到 StratixEventBus
statusSyncWS.connect();

// 全局未捕获 Promise rejection 处理器
window.addEventListener('unhandledrejection', (event) => {
  const error = event.reason;
  if (error?.name === 'CannotRetryError') {
    console.warn('[Global] Unhandled CannotRetryError:', error.message);
    event.preventDefault();
    return;
  }
  console.error('[Global] Unhandled promise rejection:', error);
});

// 预加载角色部件元数据（延迟加载，减小首屏体积）
(async () => {
  try {
    const { partRegistry } = await import('./stratix-character-creator/core/PartRegistry');
    partRegistry.loadMetadata();
  } catch (error) {
    console.warn('[Main] Failed to preload part registry:', error);
  }
})();

app.mount('#app');
