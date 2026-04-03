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
      <InfoItem label="技能名称" plain>
        {{ skillName }}
      </InfoItem>
      <InfoItem label="目标 Agent" plain value-color="var(--ds-semantic-success)">
        {{ agentCount }} 个 Agent
      </InfoItem>
      <div v-if="hasParams" class="params-preview">
        <InfoItem label="参数预览" plain>
          <div class="params-list">
            <div v-for="(value, key) in params" :key="key" class="param-row">
              <span class="param-key">{{ key }}</span>
              <span class="param-value">{{ formatValue(value) }}</span>
            </div>
          </div>
        </InfoItem>
      </div>
    </div>

    <WarningBox type="warning">
      <template v-if="agentCount > 1">将同时向 {{ agentCount }} 个 Agent 发送执行指令</template>
      <template v-else>即将向 Agent 发送执行指令</template>
    </WarningBox>

    <template #footer>
      <ButtonGroup>
        <StratixButton variant="secondary" size="sm" @click="handleCancel">
          取消
        </StratixButton>
        <StratixButton variant="primary" size="sm" @click="handleConfirm">
          确认执行
        </StratixButton>
      </ButtonGroup>
    </template>
  </StratixModal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { StratixModal, StratixButton, ButtonGroup, InfoItem, WarningBox } from '@/components/ui';

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

.params-preview {
  margin-top: 8px;
}

.params-list {
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border-default);
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
  border-bottom: 1px solid var(--ds-border-default);
}

.param-row:last-child {
  border-bottom: none;
}

.param-key {
  font-family: var(--ds-fontFamily-mono);
  font-size: 12px;
  color: var(--ds-text-secondary);
}

.param-value {
  font-size: 12px;
  color: var(--ds-semantic-success);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.params-list::-webkit-scrollbar {
  width: 4px;
}

.params-list::-webkit-scrollbar-track {
  background: var(--ds-bg-primary);
}

.params-list::-webkit-scrollbar-thumb {
  background: var(--ds-border-default);
  border-radius: 2px;
}
</style>
