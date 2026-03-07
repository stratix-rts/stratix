<template>
  <StratixModal
    :visible="visible"
    title="项目配置"
    width="500px"
    :maskClosable="false"
    @close="handleClose"
    @cancel="handleClose"
  >
    <div class="project-config-form">
      <div v-if="projectStatus" class="status-banner" :class="`status-banner--${projectStatus}`">
        <span class="status-icon">{{ statusInfo.icon }}</span>
        <span class="status-text">{{ statusInfo.text }}</span>
        <span v-if="projectStatus === 'pending'" class="status-hint">
          拖拽英雄到项目区域即可启动
        </span>
      </div>

      <StratixFormField label="项目名称" required>
        <StratixInput
          v-model="config.name"
          placeholder="请输入项目名称"
          @blur="validateName"
        />
        <div v-if="errors.name" class="error-message">{{ errors.name }}</div>
      </StratixFormField>

      <StratixFormField label="项目描述">
        <StratixTextarea
          v-model="config.description"
          placeholder="请输入项目描述（可选）"
          :rows="3"
        />
      </StratixFormField>

      <StratixFormField label="优先级">
        <StratixSelect 
          v-model="config.priority" 
          :options="priorityOptions"
        />
      </StratixFormField>

      <StratixFormField label="本地文件夹路径" required>
        <div class="input-with-button">
          <StratixInput
            v-model="config.localFolderPath"
            placeholder="例如: /Users/yourname/projects/my-project"
            @blur="validatePath"
          />
          <StratixButton @click="browseFolder">浏览</StratixButton>
        </div>
        <div v-if="errors.localFolderPath" class="error-message">{{ errors.localFolderPath }}</div>
      </StratixFormField>

      <StratixFormField label="Agent模式">
        <StratixSelect 
          v-model="config.agentMode" 
          :options="agentModeOptions"
        />
      </StratixFormField>

      <StratixFormField label="执行权限">
        <StratixSelect 
          v-model="config.executionPermission" 
          :options="executionPermissionOptions"
        />
      </StratixFormField>

      <StratixFormField label="需求描述" required>
        <StratixTextarea
          v-model="config.requirement.content"
          placeholder="请输入项目需求描述"
          :rows="5"
          @blur="validateRequirement"
        />
        <div v-if="errors.requirement" class="error-message">{{ errors.requirement }}</div>
      </StratixFormField>

      <StratixFormField label="规划规则">
        <StratixSelect 
          v-model="config.planningRule" 
          :options="planningRuleOptions"
        />
      </StratixFormField>

      <StratixFormField label="进度同步规则">
        <StratixSelect 
          v-model="config.progressRule" 
          :options="progressRuleOptions"
        />
      </StratixFormField>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <StratixButton @click="handleClose" :disabled="saving">取消</StratixButton>
        <StratixButton type="primary" @click="handleSave" :disabled="!isValid || saving">
          {{ saving ? '保存中...' : '保存' }}
        </StratixButton>
      </div>
      <div v-if="saveError" class="save-error">
        <span class="error-icon">⚠️</span>
        {{ saveError }}
      </div>
    </template>
  </StratixModal>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue';
import StratixModal from '@/components/ui/StratixModal.vue';
import StratixButton from '@/components/ui/StratixButton.vue';
import StratixInput from '@/components/ui/StratixInput.vue';
import StratixTextarea from '@/components/ui/StratixTextarea.vue';
import StratixSelect from '@/components/ui/StratixSelect.vue';
import StratixFormField from '@/components/ui/StratixFormField.vue';
import type { ProjectConfig, ProjectStatus } from '../types';

interface Props {
  visible: boolean;
  projectId?: string;
  initialConfig?: Partial<ProjectConfig>;
  projectStatus?: ProjectStatus;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  close: [];
  save: [config: ProjectConfig];
}>();

const defaultConfig: ProjectConfig = {
  name: '',
  description: '',
  priority: 3,
  localFolderPath: '',
  agentMode: 'openclaw',
  planningRule: 'sequential',
  executionPermission: 'auto',
  requirement: {
    type: 'text',
    content: ''
  },
  progressRule: 'average'
};

const config = reactive<ProjectConfig>({
  ...defaultConfig,
  ...props.initialConfig
});

const errors = reactive({
  name: '',
  localFolderPath: '',
  requirement: ''
});

const saving = ref(false);
const saveError = ref('');

const priorityOptions = [
  { value: 1, label: '1级（最高）' },
  { value: 2, label: '2级（高）' },
  { value: 3, label: '3级（中）' },
  { value: 4, label: '4级（低）' },
  { value: 5, label: '5级（最低）' }
];

const agentModeOptions = [
  { value: 'openclaw', label: 'OpenClaw外部Agent' },
  { value: 'llm', label: 'LLM模式Agent' }
];

const executionPermissionOptions = [
  { value: 'auto', label: 'AI自主执行' },
  { value: 'confirm', label: '用户确认后执行' },
  { value: 'mark_only', label: '仅标记不执行' }
];

const planningRuleOptions = [
  { value: 'sequential', label: '按流程顺序拆分' },
  { value: 'by_type', label: '按任务类型分类拆分' },
  { value: 'by_priority', label: '按优先级拆分' }
];

const progressRuleOptions = [
  { value: 'average', label: '按任务区数量平均分配' },
  { value: 'all_complete', label: '所有任务区完成后项目才标记完成' }
];

const statusInfo = computed(() => {
  const statusMap: Record<ProjectStatus, { icon: string; text: string }> = {
    pending: { icon: '⏸', text: '未启动' },
    active: { icon: '▶', text: '执行中' },
    paused: { icon: '⏸', text: '已暂停' },
    completed: { icon: '✓', text: '已完成' },
    failed: { icon: '✗', text: '失败' }
  };
  return statusMap[props.projectStatus || 'pending'];
});

const validateName = () => {
  if (!config.name || config.name.trim() === '') {
    errors.name = '项目名称不能为空';
    return false;
  }
  errors.name = '';
  return true;
};

const validatePath = () => {
  if (!config.localFolderPath || config.localFolderPath.trim() === '') {
    errors.localFolderPath = '本地文件夹路径不能为空';
    return false;
  }
  errors.localFolderPath = '';
  return true;
};

const validateRequirement = () => {
  if (!config.requirement.content || config.requirement.content.trim() === '') {
    errors.requirement = '需求描述不能为空';
    return false;
  }
  errors.requirement = '';
  return true;
};

const isValid = computed(() => {
  return (
    config.name.trim() !== '' &&
    config.localFolderPath.trim() !== '' &&
    config.requirement.content.trim() !== '' &&
    errors.name === '' &&
    errors.localFolderPath === '' &&
    errors.requirement === ''
  );
});

const browseFolder = async () => {
  console.log('Browse folder - to be implemented with Electron API');
};

const handleSave = async () => {
  saveError.value = '';
  
  const isNameValid = validateName();
  const isPathValid = validatePath();
  const isRequirementValid = validateRequirement();

  if (isNameValid && isPathValid && isRequirementValid) {
    saving.value = true;
    try {
      await emit('save', { ...config });
      handleClose();
    } catch (error: any) {
      saveError.value = error?.message || '保存失败，请重试';
      console.error('Save failed:', error);
    } finally {
      saving.value = false;
    }
  }
};

const handleClose = () => {
  emit('close');
};

watch(
  () => props.initialConfig,
  (newConfig) => {
    if (newConfig) {
      Object.assign(config, { ...defaultConfig, ...newConfig });
    }
  },
  { immediate: true }
);

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      errors.name = '';
      errors.localFolderPath = '';
      errors.requirement = '';
    }
  }
);
</script>

<style scoped>
.project-config-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 8px 0;
}

.status-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 8px;
}

.status-banner--pending {
  background: rgba(136, 136, 136, 0.15);
  border: 1px solid rgba(136, 136, 136, 0.3);
}

.status-banner--active {
  background: rgba(0, 170, 255, 0.15);
  border: 1px solid rgba(0, 170, 255, 0.3);
}

.status-banner--paused {
  background: rgba(255, 170, 0, 0.15);
  border: 1px solid rgba(255, 170, 0, 0.3);
}

.status-banner--completed {
  background: rgba(0, 255, 0, 0.15);
  border: 1px solid rgba(0, 255, 0, 0.3);
}

.status-banner--failed {
  background: rgba(255, 0, 0, 0.15);
  border: 1px solid rgba(255, 0, 0, 0.3);
}

.status-icon {
  font-size: 20px;
}

.status-text {
  font-size: 14px;
  font-weight: 600;
  color: #ffffff;
}

.status-hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  margin-left: auto;
}

.input-with-button {
  display: flex;
  gap: 8px;
}

.input-with-button > *:first-child {
  flex: 1;
}

.error-message {
  color: #ff4444;
  font-size: 12px;
  margin-top: 4px;
  padding: 4px 8px;
  background: rgba(255, 68, 68, 0.1);
  border-left: 3px solid #ff4444;
  border-radius: 3px;
  animation: shake 0.3s ease-in-out;
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-5px); }
  75% { transform: translateX(5px); }
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 16px;
}

.save-error {
  margin-top: 12px;
  padding: 12px;
  background: rgba(255, 68, 68, 0.15);
  border: 1px solid #ff4444;
  border-radius: 6px;
  color: #ff4444;
  display: flex;
  align-items: center;
  gap: 8px;
  animation: fadeIn 0.3s ease-in;
}

.error-icon {
  font-size: 16px;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>