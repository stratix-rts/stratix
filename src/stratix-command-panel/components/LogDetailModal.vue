<script setup lang="ts">
import { computed } from 'vue';
import { StratixModal, StratixButton, SvgIcon, ButtonGroup, InfoItem } from '@/components/ui';
import { getToken } from '@/design-system/config';

const copy = 'copy';
const check = 'check';

const props = defineProps<{
  visible: boolean;
  log: any;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'update:visible', value: boolean): void;
}>();

const statusText = computed(() => {
  const status = props.log?.status;
  if (status === 'success') return '成功';
  if (status === 'failed') return '失败';
  return '执行中';
});

const formatFullTime = (date: Date | string) => {
  if (!date) return '--';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

const formatJSON = (obj: any) => {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
};

const copyToClipboard = () => {
  if (props.log?.commandId) {
    navigator.clipboard.writeText(props.log.commandId);
  }
};
</script>

<template>
  <StratixModal
    :visible="visible"
    @update:visible="$emit('update:visible', $event)"
    title="指令详情"
    size="md"
    @close="emit('close')"
  >
    <div v-if="log" class="detail-sections">
      <section class="detail-section">
        <h4 class="section-title">基本信息</h4>
        <div class="info-grid">
          <InfoItem label="指令 ID" mono>
            {{ log.commandId }}
          </InfoItem>
          <InfoItem label="技能名称">
            {{ log.skillName }}
          </InfoItem>
          <InfoItem label="Agent">
            {{ log.agentName }}
          </InfoItem>
          <InfoItem label="执行时间">
            {{ formatFullTime(log.time) }}
          </InfoItem>
          <InfoItem v-if="log.duration" label="执行耗时">
            {{ log.duration }}ms
          </InfoItem>
        </div>
      </section>

      <section v-if="log.params && Object.keys(log.params).length > 0" class="detail-section">
        <h4 class="section-title">指令参数</h4>
        <div class="code-block">
          <pre><code>{{ formatJSON(log.params) }}</code></pre>
        </div>
      </section>

      <section v-if="log.status === 'success' && log.result !== undefined" class="detail-section">
        <h4 class="section-title success-title">执行结果</h4>
        <div class="code-block success">
          <pre><code>{{ formatJSON(log.result) }}</code></pre>
        </div>
      </section>

      <section v-if="log.status === 'failed' && log.error" class="detail-section">
        <h4 class="section-title error-title">错误信息</h4>
        <div class="error-block">
          <span>{{ log.error }}</span>
        </div>
      </section>
    </div>

    <template #footer>
      <ButtonGroup>
        <StratixButton variant="secondary" size="sm" @click="copyToClipboard">
          复制指令 ID
        </StratixButton>
        <StratixButton variant="primary" size="sm" @click="emit('close')">
          关闭
        </StratixButton>
      </ButtonGroup>
    </template>
  </StratixModal>
</template>

<style scoped>
.detail-sections {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.detail-section {
  margin: 0;
}

.section-title {
  margin: 0 0 12px 0;
  font-size: 13px;
  color: var(--ds-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}

.success-title {
  color: var(--ds-semantic-success);
}

.error-title {
  color: var(--ds-semantic-danger);
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.code-block {
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border-default);
  border-radius: 6px;
  padding: 12px;
  overflow-x: auto;
}

.code-block pre {
  margin: 0;
  font-family: 'SF Mono', 'Monaco', monospace;
  font-size: 12px;
  line-height: 1.6;
  color: var(--ds-text-secondary);
}

.code-block code {
  color: inherit;
}

.code-block.success {
  border-color: rgba(0, 255, 136, 0.2);
  background: rgba(0, 255, 136, 0.05);
}

.code-block.success code {
  color: var(--ds-semantic-success);
}

.error-block {
  background: rgba(255, 68, 68, 0.1);
  border: 1px solid rgba(255, 68, 68, 0.2);
  border-radius: 6px;
  padding: 12px;
  color: var(--ds-semantic-danger);
  font-size: 13px;
  line-height: 1.6;
}
</style>
