import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig({
  plugins: [vue()],
  
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
        target: 'ws://127.0.0.1:3011',
        changeOrigin: true,
        ws: true,
      },
    },
  },

  build: {
    outDir: 'dist/frontend',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'phaser': ['phaser'],
          'vue-vendor': ['vue'],
        },
      },
    },
  },

  optimizeDeps: {
    include: ['vue', 'axios', 'phaser', 'mitt'],
    exclude: ['lowdb', 'fs-extra'],
  },

  define: {
    'process.env': {},
    global: 'globalThis',
  },
});
