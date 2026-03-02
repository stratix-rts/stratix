<script setup lang="ts">
import { SvgIcon } from '@/components/ui';
import { ref, computed, onMounted } from 'vue';
import { StratixAgentConfig } from '@/stratix-core/stratix-protocol';
import { StratixButton, StratixPanel } from '@/components/ui';
import { getToken } from '@/design-system/config';
import { StratixHeroDesigner } from '../StratixHeroDesigner';
import { HeroType } from '../templates/types';
import SoulEditor from './SoulEditor.vue';
import SkillEditor from './SkillEditor.vue';
import MemoryEditor from './MemoryEditor.vue';
import ModelConfig from './ModelConfig.vue';

const props = defineProps<{
  agentId?: string;
  heroType?: HeroType;
  designer?: StratixHeroDesigner;
}>();

const emit = defineEmits<{
  (e: 'saved', config: StratixAgentConfig): void;
  (e: 'cancel'): void;
}>();

const designer = props.designer || new StratixHeroDesigner();
const activeTab = ref<'soul' | 'skills' | 'memory' | 'model'>('soul');
const saving = ref(false);

const isNew = computed(() => !props.agentId);
const config = ref<StratixAgentConfig>(designer.createNewHero(props.heroType || 'writer'));

const heroTypeOptions = [
  { value: 'writer' as HeroType, label: '文案英雄' },
  { value: 'dev' as HeroType, label: '开发英雄' },
  { value: 'analyst' as HeroType, label: '分析英雄' },
];

const tabs = [
  { key: 'soul' as const, label: 'Soul' },
  { key: 'skills' as const, label: '技能' },
  { key: 'memory' as const, label: '记忆' },
  { key: 'model' as const, label: '模型' },
];

const handleSave = async () => {
  try {
    saving.value = true;
    const result = await designer.saveHeroConfig(config.value);
    if (result.code === 200) {
      emit('saved', config.value);
    } else {
      alert(result.message);
    }
  } catch (error) {
    alert('保存失败');
  } finally {
    saving.value = false;
  }
};

const handleCancel = () => {
  emit('cancel');
};

const getHeroColor = (type: string) => {
  const colors: Record<string, string> = {
    writer: getToken('colors.semantic.success'),
    dev: getToken('colors.info'),
    analyst: '#ff6b9d',
    custom: getToken('colors.accent')
  };
  return colors[type] || getToken('colors.text.muted');
};

const heroColor = computed(() => getHeroColor(config.value.type));

// Icons
</script>

<template>
  <div class="hero-form">
    <header class="form-header">
      <div class="header-left">
        <StratixButton variant="secondary" size="sm" :icon="arrowLeft" @click="handleCancel">
          返回
        </StratixButton>
        <div class="hero-badge" :style="{ background: heroColor }">
          {{ config.name?.charAt(0) || '?' }}
        </div>
        <div class="header-info">
          <h2 class="header-title">{{ isNew ? '创建英雄' : '编辑英雄' }}</h2>
          <span class="header-id">{{ config.agentId }}</span>
        </div>
      </div>
      <div class="header-actions">
        <StratixButton variant="secondary" :icon="download" @click="designer.downloadHeroConfig(config.agentId)">
          导出
        </StratixButton>
        <StratixButton variant="primary" :icon="save" :loading="saving" @click="handleSave">
          保存
        </StratixButton>
      </div>
    </header>

    <div class="form-body">
      <aside class="sidebar">
        <nav class="tabs">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            :class="['tab-btn', { active: activeTab === tab.key }]"
            @click="activeTab = tab.key"
          >
            {{ tab.label }}
          </button>
        </nav>

        <div class="type-selector">
          <label class="type-label">英雄类型</label>
          <select 
            v-model="config.type" 
            class="type-select"
            :style="{ borderColor: heroColor }"
          >
            <option 
              v-for="option in heroTypeOptions" 
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </div>
      </aside>

      <main class="editor-area">
        <SoulEditor v-if="activeTab === 'soul'" v-model="config" />
        <SkillEditor v-else-if="activeTab === 'skills'" v-model="config" />
        <MemoryEditor v-else-if="activeTab === 'memory'" v-model="config" />
        <ModelConfig v-else-if="activeTab === 'model'" v-model="config" />
      </main>
    </div>
  </div>
</template>

<style scoped>
.hero-form {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: v-bind('getToken("colors.background.primary")');
}

.form-header {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border-bottom: 1px solid v-bind('getToken("colors.border.default")');
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.hero-badge {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: v-bind('getToken("colors.background.primary")');
  font-weight: 700;
  font-size: 18px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.header-info {
  display: flex;
  flex-direction: column;
}

.header-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: v-bind('getToken("colors.text.primary")');
}

.header-id {
  font-size: 12px;
  color: v-bind('getToken("colors.text.muted")');
  font-family: v-bind('getToken("typography.fontFamily.mono")');
}

.header-actions {
  display: flex;
  gap: 12px;
}

.form-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.sidebar {
  width: 240px;
  background: v-bind('getToken("colors.background.secondary")');
  border-right: 1px solid v-bind('getToken("colors.border.default")');
  display: flex;
  flex-direction: column;
  padding: 20px 16px;
  gap: 24px;
}

.tabs {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tab-btn {
  padding: 10px 14px;
  background: v-bind('getToken("colors.background.tertiary")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: 6px;
  color: v-bind('getToken("colors.text.secondary")');
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
}

.tab-btn:hover {
  background: v-bind('getToken("colors.background.primary")');
  color: v-bind('getToken("colors.text.primary")');
}

.tab-btn.active {
  background: v-bind('getToken("colors.info") + "1A"');
  border-color: v-bind('getToken("colors.info")');
  color: v-bind('getToken("colors.info")');
}

.type-selector {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.type-label {
  font-size: 12px;
  color: v-bind('getToken("colors.text.muted")');
  font-weight: 500;
}

.type-select {
  padding: 8px 12px;
  background: v-bind('getToken("colors.background.tertiary")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: 6px;
  color: v-bind('getToken("colors.text.primary")');
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.type-select:focus {
  border-color: v-bind('heroColor');
}

.editor-area {
  flex: 1;
  overflow: hidden;
  padding: 20px;
}
</style>
