<template>
  <StratixModal
    :visible="visible"
    @update:visible="$emit('cancel')"
    title="确认执行指令"
    size="sm"
    :closable="false"
    :keyboard="true"
    @ok="handleConfirm"
    @cancel="handleCancel"
  >
    <div class="confirm-info">
      <div class="info-item">
        <span class="info-label">技能名称</span>
        <span class="info-value">{{ skillName }}</span>
      </div>
      <div class="info-item">
        <span class="info-label">目标 Agent</span>
        <span class="info-value highlight">{{ agentCount }} 个 Agent</span>
      </div>
      <div v-if="hasParams" class="info-item params-preview">
        <span class="info-label">参数预览</span>
        <div class="params-list">
          <div v-for="(value, key) in params" :key="key" class="param-row">
            <span class="param-key">{{ key }}</span>
            <span class="param-value">{{ formatValue(value) }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="warning-text">
      <SvgIcon name="alert-circle" :size="18" />
      <span v-if="agentCount > 1">将同时向 {{ agentCount }} 个 Agent 发送执行指令</span>
      <span v-else>即将向 Agent 发送执行指令</span>
    </div>

    <template #footer>
      <div class="button-group">
        <StratixButton variant="secondary" size="sm" @click="handleCancel">
          取消
        </StratixButton>
        <StratixButton variant="primary" size="sm" @click="handleConfirm">
          确认执行
        </StratixButton>
      </div>
    </template>
  </StratixModal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { StratixModal, StratixButton, SvgIcon } from '@/components/ui';
import { getToken } from '@/design-system/config';

interface Props {
  visible: boolean;
  skillName: string;
  agentCount: number;
  params: Record<string, any>;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

const hasParams = computed(() => {
  return props.params && Object.keys(props.params).length > 0;
});

const formatValue = (value: any): string => {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const handleConfirm = () => {
  emit('confirm');
};

const handleCancel = () => {
  emit('cancel');
};
</script>

<style scoped>
.confirm-info {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-label {
  font-size: 12px;
  color: v-bind('getToken("colors.text.muted")');
  font-weight: 500;
}

.info-value {
  font-size: 14px;
  color: v-bind('getToken("colors.text.primary")');
  font-weight: 500;
}

.info-value.highlight {
  color: v-bind('getToken("colors.semantic.success")');
}

.params-preview {
  margin-top: 8px;
}

.params-list {
  background: v-bind('getToken("colors.background.secondary")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: 6px;
  padding: 12px;
  max-height: 120px;
  overflow-y: auto;
}

.param-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid v-bind('getToken("colors.border.default")');
}

.param-row:last-child {
  border-bottom: none;
}

.param-key {
  font-family: v-bind('getToken("typography.fontFamily.mono")');
  font-size: 12px;
  color: v-bind('getToken("colors.text.secondary")');
}

.param-value {
  font-size: 12px;
  color: v-bind('getToken("colors.semantic.success")');
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.warning-text {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 12px;
  background: v-bind('getToken("colors.warning") + "1A"');
  border: 1px solid v-bind('getToken("colors.warning") + "33"');
  border-radius: 6px;
  color: v-bind('getToken("colors.warning")');
  font-size: 13px;
}

.params-list::-webkit-scrollbar {
  width: 4px;
}

.params-list::-webkit-scrollbar-track {
  background: v-bind('getToken("colors.background.primary")');
}

.params-list::-webkit-scrollbar-thumb {
  background: v-bind('getToken("colors.border.default")');
  border-radius: 2px;
}

.button-group {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
