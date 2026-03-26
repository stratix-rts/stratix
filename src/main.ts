import { createApp } from 'vue';
import App from './App.vue';
import { initDesignSystem, setTheme } from './design-system/config';
import { statusSyncWS } from './stratix-core/services/StatusSyncWebSocketService';

// Vxe Table 全局初始化
import VXETable from 'vxe-table';
import 'vxe-table/lib/style.css';

const app = createApp(App);

// 使用 Vxe Table 插件
app.use(VXETable);

// 初始化 Design System（自动注入 CSS 变量）
initDesignSystem();

// 切换到赛博朋克主题
setTheme('cyberpunk');

// 连接 StatusSync WebSocket 服务，转发 zone 事件到 StratixEventBus
statusSyncWS.connect();

app.mount('#app');
