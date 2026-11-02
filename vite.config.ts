import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve, relative, isAbsolute, sep } from 'path';
import { NEW_ENTRY_HTML } from './src/app/entry-paths';

const ANALYZE = process.env.ANALYZE === 'true';

/**
 * 需要"变更即整页刷新"的目录（相对项目根的 posix 风格相对路径）。
 * why 这四个目录是游戏化前端的全部运行时代码：组合根装配（src/app）、HUD 组件（src/hud）、
 *   核心域（src/core）、世界场景（src/world）。
 */
const FULL_RELOAD_DIRS = ['src/app', 'src/hud', 'src/core', 'src/world'];

/**
 * HMR 半更新防护（task_067）。
 *
 * why 局部 HMR 对本仓库天然不安全 —— 本仓库是 Web Components + 组合根装配架构：
 *   1. 自定义元素一旦 define 过，HMR 换掉模块也不会重建已存在的实例，
 *      老实例继续持有老模块的闭包 → 页面变成"半新半旧"的混血；
 *   2. main-entry 组合根的闭包持有启动那一刻的模块引用，
 *      单文件热替换根本改不到已经装配出去的实例；
 *   3. 事件常量 / 消息结构在模块间共享，局部替换会让新旧实例用不同版本的常量，
 *      表现为不可复现的交互报错（全新实例零错误）。
 *   实际事故：用户 dev 实例连跑 31 小时、跨 3 个提交，被 HMR 打成混血状态，
 *   出现快捷键弹窗关闭钮之类的诡异报错（已用 Playwright 全量交互扫描对照验证）。
 *
 * how 命中四目录的模块变更 → server.ws.send({ type: 'full-reload' }) 主动整页刷新，
 *   并 return [] 阻止 vite 默认的模块级 HMR patch。
 *   仅 dev 生效（apply: 'serve'），构建产物行为完全不变。
 */
function hmrFullReloadGuard(root: string): Plugin {
  return {
    name: 'stratix:hmr-full-reload-guard',
    apply: 'serve',
    handleHotUpdate(ctx) {
      // vite 传进来的是归一化后的绝对路径；统一成 posix 风格相对路径再比对目录前缀
      const rel = relative(root, ctx.file).split(sep).join('/');
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) return undefined;
      const guarded = FULL_RELOAD_DIRS.some(
        (dir) => rel === dir || rel.startsWith(`${dir}/`),
      );
      if (!guarded) return undefined;
      ctx.server.ws.send({ type: 'full-reload', path: '*' });
      // 留一行日志：让"这次是强制整页刷新（而非局部 HMR）"在 dev 终端里可见、可追溯
      ctx.server.config.logger.info(
        `[stratix] ${rel} 变更 → 强制整页 reload（禁用局部 HMR）`,
        { clear: false, timestamp: true },
      );
      // 返回空数组 = 不做任何模块级热更新，强制走上面的整页刷新
      return [];
    },
  };
}

export default defineConfig(async () => {
  const plugins = [vue(), hmrFullReloadGuard(__dirname)];

  if (ANALYZE) {
    // why 用变量形式的 specifier：rollup-plugin-visualizer 是可选的按需依赖（ANALYZE=true 才需要），
    // 不在 package.json 里。写成字符串字面量会让 tsc 报 TS2307，写成变量则跳过模块解析，
    // 运行时行为不变（没装依赖时 ANALYZE=true 依旧直接报错，符合"可选依赖"的预期）。
    const visualizerModule = 'rollup-plugin-visualizer';
    const { visualizer } = await import(visualizerModule);
    plugins.push(visualizer({
      filename: 'dist/.stats.html',
      open: true,
      gzipSize: true,
      template: 'treemap',
    }));
  }

  return {
    base: './',
    plugins,
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@stratix-core': resolve(__dirname, 'src/stratix-core'),
        '@stratix-gateway': resolve(__dirname, 'src/stratix-gateway'),
        '@stratix-data-store': resolve(__dirname, 'src/stratix-data-store'),
        '@stratix-openclaw-adapter': resolve(__dirname, 'src/stratix-openclaw-adapter'),
      },
    },

    publicDir: 'assets',

    server: {
      host: '127.0.0.1',
      port: 7523,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:7524',
          changeOrigin: true,
          ws: true,
        },
        '/textures': {
          target: 'http://127.0.0.1:7524',
          changeOrigin: true,
        },
        '/ws': {
          target: 'ws://127.0.0.1:7525',
          changeOrigin: true,
          ws: true,
        },
      },
    },

    build: {
      outDir: 'dist/frontend',
      sourcemap: true,
      rollupOptions: {
        /**
         * 单入口构建：只产出新游戏化 UI（NEW_ENTRY_HTML）。
         * why task_017 起只有这一个入口：D5「Zone 整体砍掉」把旧 Vue 链（index.html → src/main.ts → App.vue）
         * 的地基抽掉了 —— 旧战场场景本身就是 Zone 模型（zone 即建筑/任务区/移动目标），保不住旧链。
         * 回退开关 STRATIX_LEGACY 随之失效（已下线），回退手段改为 git 历史，
         * 见 src/app/entry-paths.ts 的「回退策略变更」。
         */
        input: {
          main: resolve(__dirname, NEW_ENTRY_HTML),
        },
        output: {
          // why 显式返回 undefined：noImplicitReturns 打开时"隐式落空"也算错误分支，
          // 而"不归入任何手写 chunk"正是这里想要的行为（交给 rollup 默认切分）。
          manualChunks: (id: string): string | undefined => {
            if (id.includes('node_modules')) {
              if (id.includes('phaser')) return 'phaser';
              if (id.includes('vue') || id.includes('@vue')) return 'vue-vendor';
              if (id.includes('@anthropic') || id.includes('openai') || id.includes('@langchain')) return 'ai-langchain';
            }
            if (id.includes('highlight.js') || id.includes('marked')) return 'markdown-vendor';
            return undefined;
          },
        },
        external: ['fs-extra', 'graceful-fs'],
      },
    },

    optimizeDeps: {
      include: ['vue', 'axios', 'phaser', 'mitt'],
      exclude: ['lowdb', 'fs-extra', 'graceful-fs'],
    },

    define: {
      'process.env': {},
      global: 'globalThis',
      /**
       * 开发期开关：首启向导强制触发（@since v3.9，task_026）。
       * why 不用 import.meta.env：本仓库的 tsc 构建走 CommonJS（tsconfig.json），
       *   import.meta 在那里编译不过（TS1343），故由构建期注入一个常量。
       * 取值口径：'1' = 开，其余（含未设置）= 关。见 src/app/main/dev-flags.ts。
       */
      __STRATIX_ONBOARDING_FORCE__: JSON.stringify(process.env.STRATIX_ONBOARDING_FORCE ?? ''),
      /**
       * 远程模式开关（@since v3.43，task_083，前后端分离 B3）。
       * '1' = Electron 壳退化为纯视图客户端（数据源 = world-sync 远程 store）。
       * why 也走 define（不 import.meta.env）：本仓库的 tsc 构建走 CommonJS，import.meta 编译不过。
       * 取值口径见 src/app/main/dev-flags.ts。
       */
      __STRATIX_REMOTE__: JSON.stringify(process.env.STRATIX_REMOTE ?? ''),
      /** world-sync 端点地址（远程模式的数据源；空串 = 用缺省地址）。 */
      __STRATIX_WORLD_SYNC_URL__: JSON.stringify(process.env.STRATIX_WORLD_SYNC_URL ?? ''),
      /**
       * 互聊单回合超时（ms，@since v3.44，task_090；空串 = 用缺省 120s）。
       * why 也要构建期这一路：纯浏览器 dev（不起 Electron）没有 preload 通道，
       *   只有 vite define 能把 shell 里的环境变量带进渲染层。
       */
      __STRATIX_PEER_TURN_TIMEOUT_MS__: JSON.stringify(process.env.STRATIX_PEER_TURN_TIMEOUT_MS ?? ''),
    },
  };
});
