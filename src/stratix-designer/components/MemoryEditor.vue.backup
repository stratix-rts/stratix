<script setup lang="ts">
import { ref, computed } from 'vue';
import { StratixMemoryConfig } from '@/stratix-core/stratix-protocol';

const props = defineProps<{
  modelValue: StratixMemoryConfig;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: StratixMemoryConfig): void;
}>();

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
  
  emit('update:modelValue', {
    ...props.modelValue,
    [type]: [...props.modelValue[type], value.trim()],
  });
  
  if (type === 'shortTerm') {
    newShortTerm.value = '';
  } else {
    newLongTerm.value = '';
  }
};

const removeItem = (type: 'shortTerm' | 'longTerm', index: number) => {
  const newList = [...props.modelValue[type]];
  newList.splice(index, 1);
  emit('update:modelValue', { ...props.modelValue, [type]: newList });
};

const handleKeydown = (type: 'shortTerm' | 'longTerm', event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addItem(type);
  }
};
</script>

<template>
  <div class="memory-editor">
    <div class="section-header">
      <svg class="section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"/>
      </svg>
      <span class="section-title">记忆配置 Memory</span>
    </div>

    <div class="panels">
      <div class="panel" :class="{ expanded: activePanel.includes('shortTerm') }">
        <div class="panel-header" @click="activePanel.includes('shortTerm') ? activePanel = activePanel.filter(p => p !== 'shortTerm') : activePanel.push('shortTerm')">
          <svg class="panel-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <span class="panel-title">短期记忆</span>
          <span class="panel-count">{{ modelValue.shortTerm.length }}</span>
          <svg class="chevron" :class="{ rotated: activePanel.includes('shortTerm') }" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
          </svg>
        </div>
        <div class="panel-body" v-show="activePanel.includes('shortTerm')">
          <div class="tags-container" v-if="modelValue.shortTerm.length">
            <div v-for="(item, index) in modelValue.shortTerm" :key="index" class="memory-tag">
              <span class="tag-text">{{ item }}</span>
              <button class="tag-remove" @click="removeItem('shortTerm', index)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
          </div>
          <div class="add-input-row">
            <input
              v-model="newShortTerm"
              class="input-field"
              placeholder="添加短期记忆..."
              @keydown="handleKeydown('shortTerm', $event)"
            />
            <button class="btn-add-inline" @click="addItem('shortTerm')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
              </svg>
            </button>
          </div>
          <span class="hint">短期记忆用于存储当前对话的临时信息</span>
        </div>
      </div>

      <div class="panel" :class="{ expanded: activePanel.includes('longTerm') }">
        <div class="panel-header" @click="activePanel.includes('longTerm') ? activePanel = activePanel.filter(p => p !== 'longTerm') : activePanel.push('longTerm')">
          <svg class="panel-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/>
          </svg>
          <span class="panel-title">长期记忆</span>
          <span class="panel-count">{{ modelValue.longTerm.length }}</span>
          <svg class="chevron" :class="{ rotated: activePanel.includes('longTerm') }" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
          </svg>
        </div>
        <div class="panel-body" v-show="activePanel.includes('longTerm')">
          <div class="tags-container" v-if="modelValue.longTerm.length">
            <div v-for="(item, index) in modelValue.longTerm" :key="index" class="memory-tag long-term">
              <span class="tag-text">{{ item }}</span>
              <button class="tag-remove" @click="removeItem('longTerm', index)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
          </div>
          <div class="add-input-row">
            <input
              v-model="newLongTerm"
              class="input-field"
              placeholder="添加长期记忆..."
              @keydown="handleKeydown('longTerm', $event)"
            />
            <button class="btn-add-inline" @click="addItem('longTerm')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
              </svg>
            </button>
          </div>
          <span class="hint">长期记忆用于存储持久化的知识信息</span>
        </div>
      </div>

      <div class="panel expanded">
        <div class="panel-header">
          <svg class="panel-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <span class="panel-title">上下文 Context</span>
        </div>
        <div class="panel-body">
          <textarea
            v-model="context"
            class="textarea-field"
            :rows="4"
            placeholder="描述英雄的上下文背景，例如：我是 Stratix 星策系统的文案英雄..."
          />
          <span class="hint">上下文会作为系统提示词的一部分注入到对话中</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700&family=Fira+Sans:wght@300;400;500;600;700&display=swap');

.memory-editor {
  font-family: 'Fira Sans', sans-serif;
  padding: 20px;
  animation: fadeIn 200ms ease;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #1E293B;
}

.section-icon {
  width: 20px;
  height: 20px;
  color: #22C55E;
}

.section-title {
  font-family: 'Fira Code', monospace;
  font-size: 14px;
  font-weight: 600;
  color: #F8FAFC;
}

.panels {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.panel {
  background: #0F172A;
  border: 1px solid #1E293B;
  border-radius: 8px;
  overflow: hidden;
  transition: border-color 200ms ease;
}

.panel.expanded {
  border-color: #334155;
}

.panel-header {
  display: flex;
  align-items: center;
  padding: 12px;
  cursor: pointer;
  transition: background 200ms ease;
}

.panel-header:hover {
  background: #1E293B;
}

.panel-icon {
  width: 18px;
  height: 18px;
  color: #64748B;
  margin-right: 10px;
}

.panel-title {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: #F8FAFC;
}

.panel-count {
  font-size: 11px;
  color: #64748B;
  background: #1E293B;
  padding: 2px 8px;
  border-radius: 10px;
  margin-right: 8px;
}

.chevron {
  width: 16px;
  height: 16px;
  color: #64748B;
  transition: transform 200ms ease;
}

.chevron.rotated {
  transform: rotate(180deg);
}

.panel-body {
  padding: 12px;
  border-top: 1px solid #1E293B;
  animation: fadeIn 150ms ease;
}

.tags-container {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.memory-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.3);
  border-radius: 16px;
  font-size: 12px;
  color: #22C55E;
  max-width: 200px;
}

.memory-tag.long-term {
  background: rgba(74, 144, 226, 0.1);
  border-color: rgba(74, 144, 226, 0.3);
  color: #4A90E2;
}

.tag-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  background: transparent;
  border: none;
  color: inherit;
  opacity: 0.6;
  cursor: pointer;
  transition: opacity 200ms ease;
}

.tag-remove:hover {
  opacity: 1;
}

.tag-remove svg {
  width: 12px;
  height: 12px;
}

.add-input-row {
  display: flex;
  gap: 8px;
}

.input-field {
  flex: 1;
  padding: 8px 12px;
  background: #020617;
  border: 1px solid #1E293B;
  border-radius: 6px;
  color: #F8FAFC;
  font-size: 13px;
  transition: border-color 200ms ease;
}

.input-field::placeholder {
  color: #475569;
}

.input-field:focus {
  outline: none;
  border-color: #22C55E;
}

.btn-add-inline {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #22C55E;
  border: none;
  border-radius: 6px;
  color: #020617;
  cursor: pointer;
  transition: background 200ms ease;
}

.btn-add-inline:hover {
  background: #16A34A;
}

.btn-add-inline svg {
  width: 16px;
  height: 16px;
}

.textarea-field {
  width: 100%;
  padding: 10px 14px;
  background: #020617;
  border: 1px solid #1E293B;
  border-radius: 8px;
  color: #F8FAFC;
  font-size: 13px;
  resize: vertical;
  min-height: 80px;
  transition: border-color 200ms ease;
}

.textarea-field::placeholder {
  color: #475569;
}

.textarea-field:focus {
  outline: none;
  border-color: #22C55E;
}

.hint {
  display: block;
  font-size: 11px;
  color: #64748B;
  margin-top: 8px;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .memory-editor { animation: none; }
  .panel-body { animation: none; }
}
</style>
