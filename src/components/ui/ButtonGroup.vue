<script setup lang="ts">
interface Props {
  /** 水平对齐方式 */
  justify?: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around';
  /** 垂直对齐方式 */
  align?: 'flex-start' | 'flex-end' | 'center' | 'baseline' | 'stretch';
  /** 元素之间的间距 */
  gap?: string | number;
}

withDefaults(defineProps<Props>(), {
  justify: 'flex-end',
  align: 'center',
  gap: 8,
});

const gap = typeof gap === 'number' ? `${gap}px` : gap;
</script>

<template>
  <div
    class="button-group"
    :style="{
      justifyContent: justify,
      alignItems: align,
      gap: gap,
    }"
  >
    <slot />
  </div>
</template>

<style scoped>
.button-group {
  display: flex;
}
</style>
