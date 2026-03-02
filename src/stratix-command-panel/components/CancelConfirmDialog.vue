<template>
  <StratixModal
    :visible="visible"
    :size="'sm'"
    @update:visible="$emit('cancel')"
  >
    <template #header>
      <div class="header-content">
        <SvgIcon name="x-circle" class="header-icon" />
        <span>取消指令确认</span>
      </div>
    </template>

    <div class="dialog-body">
      <p class="dialog-desc">确定要取消此指令吗？此操作不可撤销。</p>
      
      <div v-if="log" class="command-info">
        <div class="info-row">
          <span class="info-label">指令 ID</span>
          <span class="info-value mono">{{ log.commandId.slice(0, 20) }}...</span>
        </div>
        <div class="info-row">
          <span class="info-label">技能名称</span>
          <span class="info-value">{{ log.skillName }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Agent</span>
          <span class="info-value">{{ log.agentName }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">当前状态</span>
          <span class="info-value">
            <span :class="['status-badge', `status-${log.status}`]">
              {{ statusText }}
            </span>
          </span>
        </div>
      </div>

      <div class="warning-box">
        <SvgIcon name="alert-triangle" class="warning-icon" />
        <span>取消后指令将终止执行，Agent 状态将恢复</span>
      </div>
    </div>

    <template #footer>
      <StratixButton variant="secondary" @click="$emit('cancel')">
        返回
      </StratixButton>
      <StratixButton variant="danger" @click="$emit('confirm')">
        确认取消
      </StratixButton>
    </template>
  </StratixModal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { StratixModal, StratixButton, SvgIcon } from '@/components/ui';
import { getToken } from '@/design-system/config';
import type { CommandLogItem } from './CommandLog.vue';

interface Props {
  visible: boolean;
  log: CommandLogItem | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

const statusText = computed(() => {
  if (!props.log) return '';
  const texts: Record<string, string> = {
    pending: '等待执行',
    running: '执行中',
    success: '执行成功',
    failed: '执行失败'
  };
  return texts[props.log.status] || props.log.status;
});
</script>

<style scoped>
.header-content {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-icon {
  color: v-bind('getToken("colors.semantic.danger")');
}

.dialog-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dialog-desc {
  margin: 0;
  font-size: 14px;
  color: v-bind('getToken("colors.text.secondary")');
}

.command-info {
  background: v-bind('getToken("colors.background.secondary")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: 6px;
  padding: 12px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid v-bind('getToken("colors.border.default")');
}

.info-row:last-child {
  border-bottom: none;
}

.info-label {
  font-size: 12px;
  color: v-bind('getToken("colors.text.muted")');
  font-weight: 500;
}

.info-value {
  font-size: 13px;
  color: v-bind('getToken("colors.text.primary")');
}

.info-value.mono {
  font-family: v-bind('getToken("typography.fontFamily.mono")');
  font-size: 11px;
  color: v-bind('getToken("colors.text.secondary")');
}

.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}

.status-badge.status-pending {
  background: v-bind('getToken("colors.info") + "26"');
  color: v-bind('getToken("colors.info")');
}

.status-badge.status-running {
  background: v-bind('getToken("colors.warning") + "26"');
  color: v-bind('getToken("colors.warning")');
}

.status-badge.status-success {
  background: v-bind('getToken("colors.semantic.success") + "26"');
  color: v-bind('getToken("colors.semantic.success")');
}

.status-badge.status-failed {
  background: v-bind('getToken("colors.semantic.danger") + "26"');
  color: v-bind('getToken("colors.semantic.danger")');
}

.warning-box {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  background: v-bind('getToken("colors.warning") + "1A"');
  border: 1px solid v-bind('getToken("colors.warning") + "33"');
  border-radius: 6px;
  color: v-bind('getToken("colors.warning")');
  font-size: 13px;
}

.warning-icon {
  flex-shrink: 0;
  margin-top: 1px;
}
</style>
