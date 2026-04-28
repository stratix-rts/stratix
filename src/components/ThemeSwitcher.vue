<template>
  <div class="theme-switcher">
    <button 
      v-for="theme in themes" 
      :key="theme.id"
      class="theme-btn"
      :class="{ active: currentTheme === theme.id }"
      :style="getThemePreviewStyle(theme)"
      @click="switchTheme(theme.id)"
      :title="theme.description"
    >
      <span class="theme-dot" :style="{ background: theme.preview.primary }"></span>
      <span class="theme-name">{{ theme.name }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { 
  setTheme, 
  getCurrentTheme, 
  onThemeChange,
  getAllThemes,
  type ThemeMeta 
} from '@/design-system';

const themes = ref<ThemeMeta[]>(getAllThemes());
const currentTheme = ref('cyberpunk');

// 获取主题预览样式
function getThemePreviewStyle(theme: ThemeMeta) {
  return {
    backgroundColor: theme.preview.background,
    color: theme.preview.text,
    borderColor: theme.preview.primary,
  };
}

// 切换主题
function switchTheme(themeId: string) {
  setTheme(themeId as 'cyberpunk' | 'minimal' | 'professional');
}

// 监听主题变化
let unsubscribe: (() => void) | null = null;

onMounted(() => {
  // 获取当前主题
  const theme = getCurrentTheme();
  // 从 localStorage 或直接获取当前主题名称
  const saved = localStorage.getItem('stratix-theme');
  currentTheme.value = saved || 'cyberpunk';
  
  // 订阅主题变化
  unsubscribe = onThemeChange(({ theme: themeName }) => {
    currentTheme.value = themeName;
  });
});

onUnmounted(() => {
  if (unsubscribe) {
    unsubscribe();
  }
});
</script>

<style scoped>
.theme-switcher {
  display: flex;
  gap: var(--ds-spacing-sm);
  padding: var(--ds-spacing-sm);
  background: var(--ds-glass-bg, var(--ds-bg-secondary));
  border: var(--ds-glass-border, 1px solid var(--ds-border));
  border-radius: var(--ds-radius-md);
  box-shadow: var(--ds-glass-shadow, none);
  backdrop-filter: blur(var(--ds-glass-blur)) saturate(var(--ds-glass-saturate));
  -webkit-backdrop-filter: blur(var(--ds-glass-blur)) saturate(var(--ds-glass-saturate));
}

.theme-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 2px solid transparent;
  border-radius: var(--ds-radius-md);
  cursor: pointer;
  font-size: var(--ds-font-size-sm);
  font-weight: 500;
  transition: all var(--ds-animation-duration-fast) ease;
}

.theme-btn:hover {
  transform: translateY(-1px);
  box-shadow: var(--ds-shadow-md);
}

.theme-btn.active {
  border-color: var(--ds-accent);
  box-shadow: 0 0 0 2px var(--ds-accent)40;
  background: var(--ds-gradient-brand-subtle);
}

.theme-dot {
  width: 12px;
  height: 12px;
  border-radius: var(--ds-radius-full);
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.3);
}

.theme-btn:hover .theme-dot {
  animation: ds-icon-bounce var(--ds-animation-duration-fast) ease;
}

.theme-name {
  font-size: var(--ds-font-size-sm);
}
</style>
