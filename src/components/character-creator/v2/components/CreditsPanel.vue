<script setup lang="ts">
/**
 * CreditsPanel.vue - 素材致谢面板
 *
 * 显示当前角色部件的作者和许可证信息
 * 紧凑模式：显示摘要，点击展开完整列表
 */

import { ref, computed } from 'vue';
import { StratixModal } from '@/components/ui';
import { partRegistry } from '@/stratix-character-creator/core/PartRegistry';
import type { PartSelection } from '@/stratix-character-creator/types';

const props = withDefaults(defineProps<{
  parts: Record<string, PartSelection>;
  compact?: boolean;
}>(), {
  compact: true,
});

const showModal = ref(false);

const allAuthors = computed(() => {
  const authorsSet = new Set<string>();
  const itemIds = Object.values(props.parts).map((p) => p.itemId);
  const credits = partRegistry.getCredits(itemIds);

  for (const credit of credits) {
    credit.authors.forEach((author) => authorsSet.add(author));
  }

  return Array.from(authorsSet);
});

const allLicenses = computed(() => {
  const licensesSet = new Set<string>();
  const itemIds = Object.values(props.parts).map((p) => p.itemId);
  const credits = partRegistry.getCredits(itemIds);

  for (const credit of credits) {
    credit.licenses.forEach((license) => licensesSet.add(license));
  }

  return Array.from(licensesSet);
});

const displayAuthors = computed(() => {
  return allAuthors.value.slice(0, 3);
});

const remainingCount = computed(() => {
  return Math.max(0, allAuthors.value.length - 3);
});

const hasCredits = computed(() => {
  return allAuthors.value.length > 0;
});

const licensesDisplay = computed(() => {
  return allLicenses.value.slice(0, 3).join(', ');
});

function openModal(): void {
  if (remainingCount.value > 0 || !props.compact) {
    showModal.value = true;
  }
}

function closeModal(): void {
  showModal.value = false;
}
</script>

<template>
  <div class="credits-panel">
    <div class="credits-divider"></div>
    <div class="credits-label">致谢 CREDITS</div>

    <div v-if="hasCredits" class="credits-content">
      <!-- 紧凑模式：显示前3个作者 + "+N more" -->
      <template v-if="compact">
        <div class="authors-list">
          <span
            v-for="(author, index) in displayAuthors"
            :key="author"
            class="author-name"
          >{{ author }}{{ index < displayAuthors.length - 1 ? ', ' : '' }}</span>
          <button
            v-if="remainingCount > 0"
            class="more-link"
            @click="openModal"
          >+{{ remainingCount }} more</button>
        </div>
        <div class="license-info">
          License: {{ licensesDisplay }}
        </div>
      </template>

      <!-- 非紧凑模式：显示全部 -->
      <template v-else>
        <div class="authors-list expanded">
          <div
            v-for="author in allAuthors"
            :key="author"
            class="author-name"
          >{{ author }}</div>
        </div>
        <div class="license-info">
          License: {{ allLicenses.join(', ') }}
        </div>
      </template>
    </div>

    <div v-else class="no-credits">
      No credits available
    </div>
  </div>

  <!-- 完整 credits 弹窗 -->
  <StratixModal
    :visible="showModal"
    title="致谢 CREDITS"
    size="sm"
    :closable="true"
    :mask-closable="true"
    @close="closeModal"
  >
    <div class="credits-modal-content">
      <div class="modal-subtitle">(排名不分先后 In No Particular Order)</div>

      <div class="authors-section">
        <div class="section-label">作者 AUTHORS</div>
        <div class="authors-full-list">
          <div
            v-for="author in allAuthors"
            :key="author"
            class="author-item"
          >{{ author }}</div>
        </div>
      </div>

      <div class="licenses-section">
        <div class="section-label">许可证 LICENSES</div>
        <div class="licenses-list">
          {{ allLicenses.join(', ') }}
        </div>
      </div>
    </div>

    <template #footer>
      <button class="close-btn" @click="closeModal">关闭 CLOSE</button>
    </template>
  </StratixModal>
</template>

<style scoped>
.credits-panel {
  padding-top: 8px;
}

.credits-divider {
  height: 1px;
  background: var(--ds-border);
  opacity: 0.5;
  margin-bottom: 8px;
}

.credits-label {
  font-size: 10px;
  font-family: 'SF Mono', 'Monaco', monospace;
  color: var(--ds-text-muted);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.credits-content {
  font-family: 'SF Mono', 'Monaco', monospace;
}

.authors-list {
  font-size: 9px;
  color: var(--ds-text-muted);
  line-height: 1.4;
  word-break: break-word;
}

.authors-list.expanded {
  max-height: 200px;
  overflow-y: auto;
}

.author-name {
  color: var(--ds-text-secondary);
}

.more-link {
  background: none;
  border: none;
  padding: 0;
  margin-left: 4px;
  color: var(--ds-color-primary);
  font-size: 9px;
  font-family: 'SF Mono', 'Monaco', monospace;
  cursor: pointer;
  text-decoration: none;
}

.more-link:hover {
  text-decoration: underline;
}

.license-info {
  font-size: 8px;
  color: var(--ds-text-muted);
  margin-top: 4px;
  font-family: 'SF Mono', 'Monaco', monospace;
}

.no-credits {
  font-size: 9px;
  font-family: 'SF Mono', 'Monaco', monospace;
  color: var(--ds-text-muted);
}

/* Modal content styles */
.credits-modal-content {
  font-family: 'SF Mono', 'Monaco', monospace;
}

.modal-subtitle {
  text-align: center;
  font-size: 10px;
  color: var(--ds-text-muted);
  margin-bottom: 16px;
}

.authors-section {
  margin-bottom: 16px;
}

.section-label {
  font-size: 10px;
  color: var(--ds-text-muted);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.authors-full-list {
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: 4px;
  padding: 12px;
  max-height: 200px;
  overflow-y: auto;
}

.author-item {
  font-size: 11px;
  color: var(--ds-text-secondary);
  line-height: 1.8;
}

.licenses-section {
  padding: 0 12px 12px;
}

.licenses-list {
  font-size: 9px;
  color: var(--ds-text-muted);
  word-break: break-word;
}

.close-btn {
  width: 100%;
  padding: 10px;
  background: transparent;
  border: 1px solid var(--ds-border);
  border-radius: 6px;
  color: var(--ds-text-secondary);
  font-family: 'SF Mono', 'Monaco', monospace;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.close-btn:hover {
  border-color: var(--ds-color-primary);
  color: var(--ds-color-primary);
}
</style>
