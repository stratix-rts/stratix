<template>
  <div class="param-form">
    <div class="form-header">
      <h3 class="form-title">参数配置</h3>
      <div v-if="selectedSkill" class="skill-badge">
        {{ selectedSkill.name }}
      </div>
    </div>

    <div v-if="!selectedSkill" class="empty-state">
      <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
      </svg>
      <p>请先选择一个技能</p>
    </div>

    <template v-else>
      <div v-if="parameters.length === 0" class="empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M5 13l4 4L19 7"></path>
        </svg>
        <p>该技能无需配置参数</p>
      </div>

      <form v-else class="form-body" @submit.prevent="handleSubmit">
        <StratixFormField
          v-for="param in parameters"
          :key="param.paramId"
          :error="!!errors[param.paramId]"
          size="md"
        >
          <template #label>
            <StratixLabel :for="`param-${param.paramId}`" :required="param.required">
              {{ param.name }}
            </StratixLabel>
          </template>

          <template v-if="param.type === 'string'">
            <StratixInput
              :id="`param-${param.paramId}`"
              v-model="formValues[param.paramId]"
              type="text"
              :placeholder="`请输入${param.name}`"
              :error="!!errors[param.paramId]"
              @blur="validateField(param)"
              @focus="clearError(param.paramId)"
            />
          </template>

          <template v-else-if="param.type === 'number'">
            <StratixInput
              :id="`param-${param.paramId}`"
              v-model.number="formValues[param.paramId]"
              type="number"
              :placeholder="`请输入${param.name}`"
              :error="!!errors[param.paramId]"
              @blur="validateField(param)"
              @focus="clearError(param.paramId)"
            />
          </template>

          <template v-else-if="param.type === 'boolean'">
            <div class="toggle-wrapper">
              <button
                type="button"
                class="toggle-switch"
                :class="{ active: formValues[param.paramId] }"
                @click="toggleBoolean(param.paramId)"
              >
                <span class="toggle-slider"></span>
              </button>
              <span class="toggle-label">{{ formValues[param.paramId] ? '开启' : '关闭' }}</span>
            </div>
          </template>

          <template v-else-if="param.type === 'object'">
            <StratixTextarea
              :id="`param-${param.paramId}`"
              v-model="formValues[param.paramId]"
              :placeholder="`请输入 JSON 格式的 ${param.name}`"
              :error="!!errors[param.paramId]"
              rows="3"
              @blur="validateField(param)"
              @focus="clearError(param.paramId)"
            />
          </template>

          <template v-if="errors[param.paramId]" #error>
            {{ errors[param.paramId] }}
          </template>
        </StratixFormField>

        <div class="form-actions">
          <StratixButton variant="secondary" @click="resetForm">
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
            </svg>
            重置
          </StratixButton>
          <StratixButton variant="primary" type="submit" :disabled="!isFormValid">
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M13 10V3L4 14h7v7l9-11h-7z"></path>
            </svg>
            执行
          </StratixButton>
        </div>
      </form>
    </template>

    <ConfirmDialog
      :visible="showConfirmDialog"
      :skill-name="selectedSkill?.name || ''"
      :agent-count="selectedAgentIds.length"
      :params="formValues"
      @confirm="executeCommands"
      @cancel="showConfirmDialog = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { StratixInput, StratixTextarea, StratixLabel, StratixFormField, StratixButton } from '@/components/ui';
import type { StratixSkillConfig, StratixSkillParameter, StratixFrontendOperationEvent } from '@/stratix-core/stratix-protocol';
import StratixEventBus from '../../stratix-core/StratixEventBus';
import { ParamValidator } from '../utils/ParamValidator';
import { CommandBuilder } from '../utils/CommandBuilder';
import ConfirmDialog from './ConfirmDialog.vue';

const selectedSkill = ref<StratixSkillConfig | null>(null);
const selectedAgentIds = ref<string[]>([]);
const formValues = ref<Record<string, any>>({});
const errors = ref<Record<string, string>>({});
const showConfirmDialog = ref<boolean>(false);

const parameters = computed<StratixSkillParameter[]>(() => {
  return selectedSkill.value?.parameters || [];
});

const isFormValid = computed(() => {
  return Object.keys(errors.value).length === 0;
});

const validateField = (param: StratixSkillParameter) => {
  const result = ParamValidator.validate(param, formValues.value[param.paramId]);
  
  if (!result.isValid) {
    errors.value[param.paramId] = result.errorMessage;
  } else {
    delete errors.value[param.paramId];
  }
};

const clearError = (paramId: string) => {
  if (errors.value[paramId]) {
    delete errors.value[paramId];
  }
};

const toggleBoolean = (paramId: string) => {
  formValues.value[paramId] = !formValues.value[paramId];
};

const resetForm = () => {
  if (selectedSkill.value) {
    formValues.value = ParamValidator.initializeFormValues(selectedSkill.value.parameters);
    errors.value = {};
  }
};

const handleSubmit = () => {
  if (!selectedSkill.value) return;

  const { isValid, errors: validationErrors } = ParamValidator.validateAll(
    selectedSkill.value.parameters,
    formValues.value
  );

  if (!isValid) {
    errors.value = validationErrors;
    return;
  }

  showConfirmDialog.value = true;
};

const executeCommands = () => {
  if (!selectedSkill.value || selectedAgentIds.value.length === 0) {
    showConfirmDialog.value = false;
    return;
  }

  const events = CommandBuilder.buildBatchCommandEvents(
    selectedAgentIds.value,
    selectedSkill.value,
    formValues.value
  );

  for (const event of events) {
    StratixEventBus.getInstance().emit(event);
  }

  showConfirmDialog.value = false;
};

const handleSkillSelected = (event: StratixFrontendOperationEvent) => {
  selectedSkill.value = event.payload.skill || null;
  selectedAgentIds.value = event.payload.agentIds || [];
  
  if (selectedSkill.value) {
    formValues.value = ParamValidator.initializeFormValues(selectedSkill.value.parameters);
    errors.value = {};
  }
};

watch(selectedSkill, (newSkill) => {
  if (newSkill) {
    formValues.value = ParamValidator.initializeFormValues(newSkill.parameters);
    errors.value = {};
  }
});

onMounted(() => {
  StratixEventBus.getInstance().subscribe('stratix:skill_selected', handleSkillSelected);
});

onUnmounted(() => {
  StratixEventBus.getInstance().unsubscribe('stratix:skill_selected', handleSkillSelected);
});
</script>

<style scoped>
.param-form {
  font-family: v-bind('getToken("typography.fontFamily.sans")');
  background: v-bind('getToken("colors.background.secondary")');
  border-radius: 12px;
  padding: 16px;
  color: v-bind('getToken("colors.text.primary")');
  height: 100%;
  display: flex;
  flex-direction: column;
}

.form-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid v-bind('getToken("colors.border.default")');
}

.form-title {
  font-family: v-bind('getToken("typography.fontFamily.mono")');
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: v-bind('getToken("colors.text.primary")');
}

.skill-badge {
  font-size: 12px;
  color: v-bind('getToken("colors.semantic.success")');
  background: v-bind('getToken("colors.semantic.success") + "1A"');
  padding: 4px 12px;
  border-radius: 12px;
  font-weight: 500;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: v-bind('getToken("colors.text.muted")');
  flex: 1;
}

.empty-icon {
  width: 48px;
  height: 48px;
  color: v-bind('getToken("colors.text.muted")');
  stroke-width: 2;
  margin-bottom: 12px;
}

.empty-state p {
  margin: 0;
  font-size: 14px;
}

.form-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}

.toggle-wrapper {
  display: flex;
  align-items: center;
  gap: 12px;
}

.toggle-switch {
  position: relative;
  width: 48px;
  height: 26px;
  background: v-bind('getToken("colors.background.tertiary")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: 13px;
  cursor: pointer;
  transition: all 200ms ease;
  padding: 0;
}

.toggle-switch:hover {
  background: v-bind('getToken("colors.border.default")');
}

.toggle-switch.active {
  background: v-bind('getToken("colors.semantic.success")');
  border-color: v-bind('getToken("colors.semantic.success")');
}

.toggle-slider {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  background: v-bind('getToken("colors.text.primary")');
  border-radius: 50%;
  transition: transform 200ms ease;
}

.toggle-switch.active .toggle-slider {
  transform: translateX(22px);
}

.toggle-label {
  font-size: 13px;
  color: v-bind('getToken("colors.text.secondary")');
}

.form-actions {
  display: flex;
  gap: 12px;
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid v-bind('getToken("colors.border.default")');
}

.btn-icon {
  width: 16px;
  height: 16px;
  stroke-width: 2;
}

.form-body::-webkit-scrollbar {
  width: 6px;
}

.form-body::-webkit-scrollbar-track {
  background: v-bind('getToken("colors.background.tertiary")');
  border-radius: 3px;
}

.form-body::-webkit-scrollbar-thumb {
  background: v-bind('getToken("colors.border.default")');
  border-radius: 3px;
}
</style>

<script setup lang="ts">
import { getToken } from '@/design-system/config';
</script>
