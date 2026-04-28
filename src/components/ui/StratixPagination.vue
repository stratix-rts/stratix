<script setup lang="ts">
import { computed, ref } from 'vue';
import { getToken } from '@/design-system/config';
import SvgIcon from './SvgIcon.vue';

interface Props {
  total: number;
  pageSize?: number;
  modelValue?: number;
  showQuickJumper?: boolean;
  showSizeChanger?: boolean;
  pageSizeOptions?: number[];
}

const props = withDefaults(defineProps<Props>(), {
  pageSize: 10,
  modelValue: 1,
  showQuickJumper: false,
  showSizeChanger: false,
  pageSizeOptions: () => [10, 20, 50, 100],
});

const emit = defineEmits<{
  'update:modelValue': [page: number];
  'update:pageSize': [size: number];
  change: [page: number, pageSize: number];
}>();

const totalPages = computed(() => Math.ceil(props.total / props.pageSize));

const jumpInput = ref('');

const pages = computed(() => {
  const current = props.modelValue;
  const total = totalPages.value;
  const items: (number | string)[] = [];

  if (total <= 7) {
    for (let i = 1; i <= total; i++) items.push(i);
    return items;
  }

  items.push(1);
  if (current > 3) items.push('...');

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) items.push(i);

  if (current < total - 2) items.push('...');
  items.push(total);

  return items;
});

const goTo = (page: number) => {
  if (page < 1 || page > totalPages.value || page === props.modelValue) return;
  emit('update:modelValue', page);
  emit('change', page, props.pageSize);
};

const handleJump = () => {
  const page = parseInt(jumpInput.value, 10);
  if (!isNaN(page)) {
    goTo(Math.max(1, Math.min(page, totalPages.value)));
    jumpInput.value = '';
  }
};

const handleSizeChange = (size: number) => {
  emit('update:pageSize', size);
  emit('change', 1, size);
};
</script>

<template>
  <div class="stratix-pagination">
    <button
      class="stratix-pagination__btn stratix-pagination__btn--prev"
      :disabled="modelValue <= 1"
      @click="goTo(modelValue - 1)"
    >
      <SvgIcon name="chevron-left" :size="14" />
    </button>

    <div class="stratix-pagination__pages">
      <template v-for="(page, index) in pages" :key="`${page}-${index}`">
        <button
          v-if="typeof page === 'number'"
          class="stratix-pagination__btn"
          :class="{ 'stratix-pagination__btn--active': page === modelValue }"
          @click="goTo(page)"
        >
          {{ page }}
        </button>
        <span v-else class="stratix-pagination__ellipsis">{{ page }}</span>
      </template>
    </div>

    <button
      class="stratix-pagination__btn stratix-pagination__btn--next"
      :disabled="modelValue >= totalPages"
      @click="goTo(modelValue + 1)"
    >
      <SvgIcon name="chevron-right" :size="14" />
    </button>

    <div v-if="showSizeChanger" class="stratix-pagination__size">
      <select @change="(e) => handleSizeChange(Number((e.target as HTMLSelectElement).value))">
        <option
          v-for="opt in pageSizeOptions"
          :key="opt"
          :value="opt"
          :selected="opt === pageSize"
        >
          {{ opt }} 条/页
        </option>
      </select>
    </div>

    <div v-if="showQuickJumper" class="stratix-pagination__jumper">
      <span>跳至</span>
      <input
        v-model="jumpInput"
        type="text"
        @keyup.enter="handleJump"
      />
      <span>页</span>
    </div>
  </div>
</template>

<style scoped>
.stratix-pagination {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--ds-font-size-sm);
}

.stratix-pagination__pages {
  display: flex;
  align-items: center;
  gap: 4px;
}

.stratix-pagination__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  background: v-bind('getToken("colors.background.overlay")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: var(--ds-radius-sm);
  color: v-bind('getToken("colors.text.primary")');
  font-size: var(--ds-font-size-sm);
  cursor: pointer;
  transition: all var(--ds-animation-duration-fast) ease;
}

.stratix-pagination__btn:hover:not(:disabled) {
  border-color: v-bind('getToken("colors.status.info")');
  color: v-bind('getToken("colors.status.info")');
}

.stratix-pagination__btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.stratix-pagination__btn--active {
  background: v-bind('getToken("colors.status.info")');
  border-color: v-bind('getToken("colors.status.info")');
  color: v-bind('getToken("colors.background.base")');
  font-weight: 600;
}

.stratix-pagination__btn--active:hover {
  color: v-bind('getToken("colors.background.base")');
}

.stratix-pagination__ellipsis {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  color: v-bind('getToken("colors.text.muted")');
  user-select: none;
}

.stratix-pagination__size select {
  height: 28px;
  padding: 0 8px;
  background: v-bind('getToken("colors.background.overlay")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: var(--ds-radius-sm);
  color: v-bind('getToken("colors.text.primary")');
  font-size: var(--ds-font-size-sm);
  cursor: pointer;
  outline: none;
}

.stratix-pagination__jumper {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: v-bind('getToken("colors.text.muted")');
}

.stratix-pagination__jumper input {
  width: 40px;
  height: 28px;
  padding: 0 4px;
  background: v-bind('getToken("colors.background.overlay")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: var(--ds-radius-sm);
  color: v-bind('getToken("colors.text.primary")');
  font-size: var(--ds-font-size-sm);
  text-align: center;
  outline: none;
  transition: border-color var(--ds-animation-duration-fast) ease;
}

.stratix-pagination__jumper input:focus {
  border-color: v-bind('getToken("colors.status.info")');
  box-shadow: 0 0 0 2px color-mix(in srgb, v-bind('getToken("colors.status.info")') 20%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .stratix-pagination__btn {
    transition: none;
  }
}
</style>
