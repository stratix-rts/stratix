import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
import { LEGACY_ENTRY_HTML, NEW_ENTRY_HTML } from './src/app/entry-paths';

const ANALYZE = process.env.ANALYZE === 'true';

export default defineConfig(async () => {
  const plugins = [vue()];

  if (ANALYZE) {
    const { visualizer } = await import('rollup-plugin-visualizer');
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
        '@stratix-designer': resolve(__dirname, 'src/stratix-designer'),
        '@stratix-data-store': resolve(__dirname, 'src/stratix-data-store'),
        '@stratix-openclaw-adapter': resolve(__dirname, 'src/stratix-openclaw-adapter'),
        '@stratix-command-panel': resolve(__dirname, 'src/stratix-command-panel'),
        '@stratix-rts': resolve(__dirname, 'src/stratix-rts'),
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
         * 多入口构建：新游戏化 UI（NEW_ENTRY_HTML）与旧 Vue 入口（LEGACY_ENTRY_HTML）同时产出。
         * why 都进产物：回退开关 STRATIX_LEGACY=1 要在正式包里也能回退（Phase 3 只切换默认入口，不删旧入口）。
         * why 两个都要写：一旦显式给 input，vite 就不再默认收 index.html，不写就会把 legacy 产物弄丢。
         * 产物路径与输入同构 —— dist/frontend/index.html（legacy）与 dist/frontend/src/app/main/index.html（新），
         * 主进程按 src/app/entry-paths.ts 的常量拼路径，两边不会各写一份。
         */
        input: {
          main: resolve(__dirname, NEW_ENTRY_HTML),
          legacy: resolve(__dirname, LEGACY_ENTRY_HTML),
        },
        output: {
          manualChunks: (id) => {
            if (id.includes('node_modules')) {
              if (id.includes('phaser')) return 'phaser';
              if (id.includes('vue') || id.includes('@vue')) return 'vue-vendor';
              if (id.includes('vxe-pc-ui') || id.includes('vxe-table') || id.includes('xe-utils')) return 'vxe-ui';
              if (id.includes('@anthropic') || id.includes('openai') || id.includes('@langchain')) return 'ai-langchain';
            if (id.includes('highlight.js') || id.includes('marked')) return 'markdown-vendor';
            }
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
    },
  };
});
