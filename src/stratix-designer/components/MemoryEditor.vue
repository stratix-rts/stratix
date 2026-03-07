<script setup lang="ts">
import { SvgIcon } from '@/components/ui';
import { ref, computed } from 'vue';
import { StratixInput, StratixButton, StratixTextarea } from '@/components/ui';
import { getToken } from '@/design-system/config';
import { StratixMemoryConfig } from '@/stratix-core/stratix-protocol';

const props = defineProps<{ modelValue: StratixMemoryConfig }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: StratixMemoryConfig): void }>();

const activePanel = ref<string[]>(['context']);
const context = computed({
  get: () => props.modelValue.context,
  set: (value) => emit('update:modelValue', { ...props.modelValue, context: value }),
});

const newShortTerm = ref('');
const newLongTerm = ref('');

const addItem = (type: 'shortTerm' | 'longTerm') => {
  const value = type === 'shortTerm' ? newShortTerm.value : newLongTerm.value;
  if (!value.trim()) return;
  emit('update:modelValue', { ...props.modelValue, [type]: [...props.modelValue[type], value.trim()] });
  if (type === 'shortTerm') newShortTerm.value = '';
  else newLongTerm.value = '';
};

const removeItem = (type: 'shortTerm' | 'longTerm', index: number) => {
  const newList = [...props.modelValue[type]];
  newList.splice(index, 1);
  emit('update:modelValue', { ...props.modelValue, [type]: newList });
};

</script>

<template>
  <div class="memory-editor">
    <div class="section-header">
      <svg class="section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <SvgIcon name="brain" size="16" />
      </svg>
      <span class="section-title">记忆配置 Memory</span>
    </div>

    <div class="panels">
      <!-- Short Term -->
      <div class="panel" :class="{ expanded: activePanel.includes('shortTerm') }">
        <div class="panel-header" @click="activePanel.includes('shortTerm') ? activePanel = activePanel.filter(p => p !== 'shortTerm') : activePanel.push('shortTerm')">
          <svg class="panel-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <SvgIcon name="clock" size="16" />
          </svg>
          <span class="panel-title">短期记忆</span>
          <span class="panel-count">{{ modelValue.shortTerm.length }}</span>
          <svg class="chevron" :class="{ rotated: activePanel.includes('shortTerm') }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <SvgIcon name="chevron-down" size="16" />
          </svg>
        </div>
        <div class="panel-body" v-show="activePanel.includes('shortTerm')">
          <div class="tags-container" v-if="modelValue.shortTerm.length">
            <div v-for="(item, index) in modelValue.shortTerm" :key="index" class="memory-tag">
              <span class="tag-text">{{ item }}</span>
              <button class="tag-remove" @click="removeItem('shortTerm', index)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><SvgIcon name="x" size="16" /></svg>
              </button>
            </div>
          </div>
          <div class="add-input-row">
            <StratixInput v-model="newShortTerm" placeholder="添加短期记忆..." @keydown.enter.prevent="addItem('shortTerm')" class="flex-1" />
            <StratixButton variant="secondary" size="sm" icon="plus" @click="addItem('shortTerm')" />
          </div>
          <span class="hint">短期记忆用于存储当前对话的临时信息</span>
        </div>
      </div>

      <!-- Long Term -->
      <div class="panel" :class="{ expanded: activePanel.includes('longTerm') }">
        <div class="panel-header" @click="activePanel.includes('longTerm') ? activePanel = activePanel.filter(p => p !== 'longTerm') : activePanel.push('longTerm')">
          <svg class="panel-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <SvgIcon name="bookmark" size="16" />
          </svg>
          <span class="panel-title">长期记忆</span>
          <span class="panel-count">{{ modelValue.longTerm.length }}</span>
          <svg class="chevron" :class="{ rotated: activePanel.includes('longTerm') }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <SvgIcon name="chevron-down" size="16" />
          </svg>
        </div>
        <div class="panel-body" v-show="activePanel.includes('longTerm')">
          <div class="tags-container" v-if="modelValue.longTerm.length">
            <div v-for="(item, index) in modelValue.longTerm" :key="index" class="memory-tag long-term">
              <span class="tag-text">{{ item }}</span>
              <button class="tag-remove" @click="removeItem('longTerm', index)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><SvgIcon name="x" size="16" /></svg>
              </button>
            </div>
          </div>
          <div class="add-input-row">
            <StratixInput v-model="newLongTerm" placeholder="添加长期记忆..." @keydown.enter.prevent="addItem('longTerm')" class="flex-1" />
            <StratixButton variant="secondary" size="sm" icon="plus" @click="addItem('longTerm')" />
          </div>
          <span class="hint">长期记忆用于存储持久化的知识信息</span>
        </div>
      </div>

      <!-- Context -->
      <div class="panel expanded">
        <div class="panel-header">
          <svg class="panel-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <span class="panel-title">上下文 Context</span>
        </div>
        <div class="panel-body">
          <StratixTextarea v-model="context" :rows="4" placeholder="输入上下文信息..." />
          <span class="hint">上下文信息将作为所有对话的背景</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.memory-editor { font-family: v-bind('getToken("typography.fontFamily.sans")'); padding: 20px; }
.section-header { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 1px solid v-bind('getToken("colors.border.default")'); }
.section-icon { width: 20px; height: 20px; color: v-bind('getToken("colors.warning")'); }
.section-title { font-family: v-bind('getToken("typography.fontFamily.mono")'); font-size: 14px; font-weight: 600; color: v-bind('getToken("colors.text.primary")'); }
.panels { display: flex; flex-direction: column; gap: 12px; }
.panel { background: v-bind('getToken("colors.background.tertiary")'); border: 1px solid v-bind('getToken("colors.border.default")'); border-radius: 8px; overflow: hidden; }
.panel-header { display: flex; align-items: center; gap: 8px; padding: 12px 16px; cursor: pointer; background: v-bind('getToken("colors.background.primary")'); }
.panel-header:hover { background: v-bind('getToken("colors.background.secondary")'); }
.panel-icon { width: 18px; height: 18px; color: v-bind('getToken("colors.info")'); }
.panel-title { font-size: 13px; font-weight: 600; color: v-bind('getToken("colors.text.primary")'); flex: 1; }
.panel-count { font-size: 12px; color: v-bind('getToken("colors.text.muted")'); background: v-bind('getToken("colors.background.tertiary")'); padding: 2px 8px; border-radius: 12px; }
.chevron { width: 16px; height: 16px; color: v-bind('getToken("colors.text.muted")'); transition: transform 0.2s; }
.chevron.rotated { transform: rotate(180deg); }
.panel-body { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.tags-container { display: flex; flex-direction: column; gap: 8px; }
.memory-tag { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: v-bind('getToken("colors.background.secondary")'); border-radius: 6px; }
.tag-text { flex: 1; font-size: 13px; color: v-bind('getToken("colors.text.primary")'); }
.tag-remove { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; background: transparent; border: none; cursor: pointer; border-radius: 4px; color: v-bind('getToken("colors.text.muted")'); }
.tag-remove:hover { background: v-bind('getToken("colors.semantic.danger")'); color: white; }
.add-input-row { display: flex; gap: 8px; }
.hint { font-size: 12px; color: v-bind('getToken("colors.text.muted")'); }
</style>
