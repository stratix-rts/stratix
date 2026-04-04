<script setup lang="ts">
import { StratixModal, StratixButton, StratixInput, SvgIcon } from '@/components/ui';
import { StratixSkillConfig } from '../stratix-core';
import { getToken } from '@/design-system/config';

const zap = 'zap';

const props = defineProps<{
  visible: boolean;
  skill: StratixSkillConfig | null;
  paramValues: Record<string, any>;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'execute'): void;
  (e: 'cancel'): void;
  (e: 'update:visible', value: boolean): void;
  (e: 'update:param-values', values: Record<string, any>): void;
}>();

const handleClose = () => {
  emit('update:visible', false);
};

const handleExecute = () => {
  emit('execute');
};

const handleCancel = () => {
  emit('cancel');
};

const updateParamValue = (paramId: string, value: any) => {
  emit('update:param-values', {
    ...props.paramValues,
    [paramId]: value
  });
};

const handleObjectParamInput = (paramId: string, value: string) => {
  try {
    updateParamValue(paramId, JSON.parse(value));
  } catch {
    // Invalid JSON - don't update
  }
};
</script>

<template>
  <StratixModal
    :visible="visible"
    @update:visible="$emit('update:visible', $event)"
    :title="skill?.name ? `⚡ ${skill.name}` : '执行技能'"
    position="bottom"
    size="md"
    @close="handleClose"
  >
    <div v-if="!skill" class="empty-state">
      <div class="empty-icon">
        <SvgIcon :name="zap" :color="getToken('colors.warning')" :size="48" :stroke-width="1.5" />
      </div>
      <div class="empty-title">未选择技能</div>
    </div>
    
    <div v-else class="param-form">
      <div class="skill-description" v-if="skill.description">
        {{ skill.description }}
      </div>
      
      <div class="param-section">
        <h4>参数配置</h4>
        
        <div 
          v-for="param in skill.parameters" 
          :key="param.paramId"
          class="param-item"
        >
          <label class="param-label">
            <span class="param-name">{{ param.name }}</span>
            <span v-if="param.required" class="param-required">*</span>
            <span class="param-type">{{ param.type || 'string' }}</span>
          </label>
          
          <div class="param-input-wrapper">
            <StratixInput
              v-if="param.type === 'string'"
              :value="paramValues[param.paramId]"
              @update:value="updateParamValue(param.paramId, $event)"
              :placeholder="param.placeholder || ''"
            />
            
            <StratixInput
              v-else-if="param.type === 'number'"
              type="number"
              :value="paramValues[param.paramId]"
              @update:value="updateParamValue(param.paramId, Number($event))"
              :placeholder="String(param.defaultValue || 0)"
            />
            
            <div
              v-else-if="param.type === 'boolean'"
              class="param-toggle"
              :class="{ active: paramValues[param.paramId] }"
              @click="updateParamValue(param.paramId, !paramValues[param.paramId])"
            >
              <span class="toggle-text">{{ paramValues[param.paramId] ? '是' : '否' }}</span>
            </div>
            
            <textarea
              v-else-if="param.type === 'object'"
              class="param-textarea"
              :value="JSON.stringify(paramValues[param.paramId], null, 2)"
              @input="handleObjectParamInput(param.paramId, ($event.target as HTMLTextAreaElement).value)"
              rows="4"
            ></textarea>
          </div>
          
          <div class="param-desc" v-if="param.description">
            {{ param.description }}
          </div>
        </div>
      </div>
      
      <div class="form-actions">
        <StratixButton variant="secondary" size="sm" @click="handleCancel">
          取消
        </StratixButton>
        <StratixButton variant="primary" size="sm" :icon="zap" @click="handleExecute">
          执行
        </StratixButton>
      </div>
    </div>
  </StratixModal>
</template>

<style scoped>
.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: v-bind('getToken("colors.text.muted")');
}

.empty-icon {
  margin-bottom: 16px;
  opacity: 0.6;
}

.empty-title {
  font-size: 14px;
  color: v-bind('getToken("colors.text.secondary")');
}

.param-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.skill-description {
  padding: 12px;
  background: rgba(0, 212, 255, 0.1);
  border-radius: 8px;
  border: 1px solid rgba(0, 212, 255, 0.2);
  font-size: 13px;
  color: v-bind('getToken("colors.text.secondary")');
  line-height: 1.6;
}

.param-section h4 {
  margin: 0 0 12px 0;
  font-size: 13px;
  color: v-bind('getToken("colors.text.muted")');
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.param-item {
  margin-bottom: 16px;
}

.param-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 13px;
  color: v-bind('getToken("colors.text.primary")');
}

.param-name {
  font-weight: 500;
}

.param-required {
  color: v-bind('getToken("colors.semantic.danger")');
}

.param-type {
  font-size: 11px;
  color: v-bind('getToken("colors.text.muted")');
  padding: 1px 4px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 3px;
}

.param-input-wrapper {
  position: relative;
}

.param-toggle {
  padding: 10px 16px;
  background: v-bind('getToken("colors.background.tertiary")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: 6px;
  color: v-bind('getToken("colors.text.primary")');
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.param-toggle:hover {
  background: v-bind('getToken("colors.background.secondary")');
}

.param-toggle.active {
  background: rgba(0, 212, 255, 0.2);
  border-color: v-bind('getToken("colors.info")');
  color: v-bind('getToken("colors.semantic.success")');
}

.toggle-text {
  font-weight: 500;
}

.param-textarea {
  width: 100%;
  padding: 10px 12px;
  background: v-bind('getToken("colors.background.tertiary")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: 6px;
  color: v-bind('getToken("colors.text.primary")');
  font-size: 12px;
  font-family: 'SF Mono', 'Monaco', monospace;
  resize: vertical;
  transition: all 0.2s;
  box-sizing: border-box;
}

.param-textarea:focus {
  outline: none;
  border-color: v-bind('getToken("colors.info")');
  background: rgba(0, 212, 255, 0.05);
}

.param-desc {
  margin-top: 4px;
  font-size: 11px;
  color: v-bind('getToken("colors.text.muted")');
  line-height: 1.4;
}

.form-actions {
  display: flex;
  gap: 10px;
  padding-top: 8px;
  border-top: 1px solid v-bind('getToken("colors.border.default")');
}
</style>
