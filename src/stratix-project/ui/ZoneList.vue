<template>
  <div class="zone-list">
    <div class="zone-list__header">
      <h3 class="zone-list__title">Zones</h3>
      <StratixButton size="sm" @click="handleCreateZone">
        <span class="zone-list__add-icon">+</span>
        New Zone
      </StratixButton>
    </div>

    <div v-if="zones.length > 3" class="zone-list__search">
      <input
        v-model="searchQuery"
        type="text"
        class="zone-list__search-input"
        placeholder="Search zones..."
      />
    </div>

    <div v-if="filteredZones.length === 0 && searchQuery" class="zone-list__empty">
      <div class="zone-list__empty-icon">🔍</div>
      <p class="zone-list__empty-text">No zones match "{{ searchQuery }}"</p>
    </div>

    <StratixEmpty
      v-else-if="filteredZones.length === 0"
      scenario="no-data"
      title="暂无 Zone"
      description="创建你的第一个 Zone 来开始"
      @action="handleCreateZone"
    >
      <template #action>
        <StratixButton size="sm" @click="handleCreateZone">
          <span class="zone-list__add-icon">+</span>
          New Zone
        </StratixButton>
      </template>
    </StratixEmpty>

    <div v-else class="zone-list__grid">
      <div
        v-for="zone in filteredZones"
        :key="zone.id"
        class="zone-card ds-ripple ds-tilt-card"
        :class="{ 'zone-card--active': activeZoneId === zone.id }"
        @click="handleZoneClick(zone)"
      >
        <div class="zone-card__header">
          <h4 class="zone-card__title">{{ zone.title }}</h4>
          <span class="zone-card__count">
            {{ zone.members?.length || 0 }} agents
          </span>
        </div>

        <p v-if="zone.prompt" class="zone-card__prompt">
          {{ truncatePrompt(zone.prompt) }}
        </p>

        <div class="zone-card__footer">
          <div class="zone-card__stats">
            <span class="zone-card__stat">
              <span class="zone-card__stat-icon">📄</span>
              {{ zone.files?.length || 0 }} files
            </span>
          </div>
          <span class="zone-card__time">
            {{ formatTime(zone.updatedAt) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import StratixButton from '@/components/ui/StratixButton.vue';
import { StratixEmpty } from '@/components/ui';
import type { Zone } from '../types';

interface Props {
  zones: Zone[];
  activeZoneId?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'zone-click': [zone: Zone];
  'create-zone': [];
}>();

const searchQuery = ref('');

const filteredZones = computed(() => {
  if (!searchQuery.value.trim()) {
    return props.zones;
  }
  const query = searchQuery.value.toLowerCase();
  return props.zones.filter(zone =>
    zone.title?.toLowerCase().includes(query) ||
    zone.prompt?.toLowerCase().includes(query)
  );
});

const handleZoneClick = (zone: Zone) => {
  emit('zone-click', zone);
};

const handleCreateZone = () => {
  emit('create-zone');
};

const truncatePrompt = (prompt: string, maxLength = 80): string => {
  if (prompt.length <= maxLength) return prompt;
  return prompt.substring(0, maxLength) + '...';
};

const formatTime = (timestamp: number): string => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};
</script>

<style scoped>
.zone-list {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-md);
  height: 100%;
}

.zone-list__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--ds-spacing-xs);
}

.zone-list__search {
  padding: 0 var(--ds-spacing-xs);
}

.zone-list__search-input {
  width: 100%;
  padding: var(--ds-spacing-sm) var(--ds-spacing-md);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-md);
  font-size: var(--ds-font-size-md);
  background: var(--ds-bg-secondary);
  color: var(--ds-text-primary);
}

.zone-list__search-input:focus {
  outline: none;
  border-color: var(--ds-border-focus);
}

.zone-list__title {
  margin: 0;
  font-size: var(--ds-font-size-lg);
  font-weight: 600;
  color: var(--ds-text-primary);
}

.zone-list__add-icon {
  font-size: var(--ds-font-size-lg);
  margin-right: 4px;
}

.zone-list__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: var(--ds-spacing-xl) var(--ds-spacing-lg);
  text-align: center;
}

.zone-list__grid {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-sm);
  overflow-y: auto;
}

.zone-card {
  padding: var(--ds-spacing-md) var(--ds-spacing-md);
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border-default);
  border-radius: var(--ds-radius-md);
  cursor: pointer;
  transition: all var(--ds-animation-duration-fast) ease;
}

.zone-card:hover {
  border-color: var(--ds-border-strong);
  background: var(--ds-bg-secondary);
}

.zone-card--active {
  border-color: var(--ds-info);
  background: rgba(0, 170, 255, 0.1);
}

.zone-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.zone-card__title {
  margin: 0;
  font-size: var(--ds-font-size-md);
  font-weight: 600;
  color: var(--ds-text-primary);
  line-height: 1.3;
}

.zone-card__count {
  flex-shrink: 0;
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
  background: var(--ds-bg-primary);
  padding: 2px var(--ds-spacing-xs);
  border-radius: var(--ds-radius-sm);
}

.zone-card__prompt {
  margin: 0 0 12px;
  font-size: var(--ds-font-size-sm);
  color: var(--ds-text-secondary);
  line-height: 1.4;
}

.zone-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ds-spacing-sm);
}

.zone-card__stats {
  display: flex;
  align-items: center;
  gap: 12px;
}

.zone-card__stat {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-xs);
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
}

.zone-card__stat-icon {
  font-size: var(--ds-font-size-xs);
}

.zone-card__time {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
}
</style>
