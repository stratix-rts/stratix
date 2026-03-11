<template>
  <div class="theme-demo">
    <h2>主题切换演示</h2>
    
    <!-- 主题切换器 -->
    <div class="section">
      <h3>切换主题</h3>
      <div class="theme-buttons">
        <button 
          v-for="theme in availableThemes" 
          :key="theme.id"
          class="theme-option"
          :class="{ active: currentTheme === theme.id }"
          @click="changeTheme(theme.id)"
        >
          <div class="theme-preview" :style="{
            background: theme.preview.background,
            borderColor: theme.preview.primary
          }">
            <div class="preview-dot" :style="{ background: theme.preview.primary }"></div>
          </div>
          <span>{{ theme.name }}</span>
        </button>
      </div>
    </div>
    
    <!-- 当前主题信息 -->
    <div class="section">
      <h3>当前主题: {{ currentThemeName }}</h3>
      <div class="color-palette">
        <div class="color-item">
          <div class="color-box" :style="{ background: colors.primary }"></div>
          <span>主色</span>
        </div>
        <div class="color-item">
          <div class="color-box" :style="{ background: colors.secondary }"></div>
          <span>辅色</span>
        </div>
        <div class="color-item">
          <div class="color-box" :style="{ background: colors.accent }"></div>
          <span>强调色</span>
        </div>
        <div class="color-item">
          <div class="color-box" :style="{ background: colors.bg }"></div>
          <span>背景色</span>
        </div>
        <div class="color-item">
          <div class="color-box" :style="{ background: colors.text }"></div>
          <span>文字色</span>
        </div>
      </div>
    </div>
    
    <!-- 组件预览 -->
    <div class="section">
      <h3>组件预览</h3>
      <div class="component-preview">
        <div class="preview-panel">
          <h4>面板样式</h4>
          <p>这是面板内容的示例文字</p>
          <button class="preview-btn primary">主要按钮</button>
          <button class="preview-btn secondary">次要按钮</button>
        </div>
        
        <div class="preview-status">
          <h4>状态样式</h4>
          <div class="status-badge success">成功</div>
          <div class="status-badge warning">警告</div>
          <div class="status-badge danger">错误</div>
          <div class="status-badge info">信息</div>
        </div>
      </div>
    </div>
    
    <!-- 手动控制 -->
    <div class="section">
      <h3>程序化控制</h3>
      <div class="controls">
        <button @click="toggleTheme">切换下一个主题</button>
        <button @click="resetToDefault">恢复默认 (Cyberpunk)</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import {
  setTheme,
  getCurrentTheme,
  getSemanticTokens,
  onThemeChange,
  getAllThemes,
  type ThemeMeta,
  type ThemeName
} from '@/design-system';

// 主题列表
const availableThemes = ref<ThemeMeta[]>(getAllThemes());

// 当前主题
const currentTheme = ref<ThemeName>('cyberpunk');

// 计算当前主题名称
const currentThemeName = computed(() => {
  const theme = availableThemes.value.find(t => t.id === currentTheme.value);
  return theme?.name || currentTheme.value;
});

// 颜色值
const colors = ref({
  primary: '',
  secondary: '',
  accent: '',
  bg: '',
  text: ''
});

// 更新颜色值
function updateColors() {
  const theme = getCurrentTheme();
  const semantic = getSemanticTokens();
  
  colors.value = {
    primary: theme.colors.brand.primary,
    secondary: theme.colors.brand.secondary,
    accent: theme.colors.brand.accent,
    bg: theme.colors.background.base,
    text: theme.colors.text.primary
  };
}

// 切换主题
function changeTheme(themeId: string) {
  setTheme(themeId as ThemeName);
}

// 切换到下一个主题
function toggleTheme() {
  const themes: ThemeName[] = ['cyberpunk', 'minimal', 'professional'];
  const currentIndex = themes.indexOf(currentTheme.value);
  const nextIndex = (currentIndex + 1) % themes.length;
  setTheme(themes[nextIndex]);
}

// 恢复默认
function resetToDefault() {
  setTheme('cyberpunk');
}

// 订阅主题变化
let unsubscribe: (() => void) | null = null;

onMounted(() => {
  // 初始化
  updateColors();
  
  // 从 localStorage 读取当前主题
  const saved = localStorage.getItem('stratix-theme') as ThemeName | null;
  if (saved && ['cyberpunk', 'minimal', 'professional'].includes(saved)) {
    currentTheme.value = saved;
  }
  
  // 订阅主题变化
  unsubscribe = onThemeChange(({ theme }) => {
    currentTheme.value = theme as ThemeName;
    updateColors();
  });
});

onUnmounted(() => {
  if (unsubscribe) {
    unsubscribe();
  }
});
</script>

<style scoped>
.theme-demo {
  padding: 20px;
  max-width: 800px;
  margin: 0 auto;
}

.section {
  margin-bottom: 32px;
  padding: 20px;
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border);
  border-radius: 12px;
}

h2 {
  margin: 0 0 20px;
  color: var(--ds-text-primary);
}

h3 {
  margin: 0 0 16px;
  color: var(--ds-text-secondary);
  font-size: 16px;
}

/* 主题按钮 */
.theme-buttons {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.theme-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: var(--ds-bg-tertiary);
  border: 2px solid var(--ds-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  min-width: 80px;
}

.theme-option:hover {
  border-color: var(--ds-accent);
  transform: translateY(-2px);
}

.theme-option.active {
  border-color: var(--ds-primary);
  box-shadow: 0 0 0 3px var(--ds-primary)40;
}

.theme-preview {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  border: 2px solid;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
}

/* 颜色展示 */
.color-palette {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.color-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.color-box {
  width: 60px;
  height: 60px;
  border-radius: 8px;
  border: 2px solid var(--ds-border);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.color-item span {
  font-size: 12px;
  color: var(--ds-text-muted);
}

/* 组件预览 */
.component-preview {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 16px;
}

.preview-panel,
.preview-status {
  padding: 16px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: 8px;
}

.preview-panel h4,
.preview-status h4 {
  margin: 0 0 12px;
  color: var(--ds-text-primary);
  font-size: 14px;
}

.preview-panel p {
  margin: 0 0 16px;
  color: var(--ds-text-secondary);
  font-size: 13px;
}

.preview-btn {
  padding: 8px 16px;
  margin-right: 8px;
  margin-bottom: 8px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.preview-btn.primary {
  background: var(--ds-btn-primary-bg);
  color: var(--ds-btn-primary-text);
}

.preview-btn.secondary {
  background: var(--ds-btn-secondary-bg);
  color: var(--ds-btn-secondary-text);
  border: 1px solid var(--ds-primary);
}

/* 状态徽章 */
.status-badge {
  display: inline-block;
  padding: 4px 12px;
  margin: 4px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.status-badge.success {
  background: var(--ds-success);
  color: var(--ds-bg-primary);
}

.status-badge.warning {
  background: var(--ds-warning);
  color: var(--ds-bg-primary);
}

.status-badge.danger {
  background: var(--ds-danger);
  color: white;
}

.status-badge.info {
  background: var(--ds-info);
  color: var(--ds-bg-primary);
}

/* 控制按钮 */
.controls {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.controls button {
  padding: 10px 20px;
  background: var(--ds-primary);
  color: var(--ds-bg-primary);
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.controls button:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}
</style>
