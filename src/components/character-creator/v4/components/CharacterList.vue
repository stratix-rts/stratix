<script setup lang="ts">
/**
 * CharacterList.vue — 已保存角色列表 (V4)
 *
 * 展示已保存角色列表（缩略图 + 名称 + 创建时间）
 * 点击角色加载编辑，删除角色（带确认），设置默认角色
 *
 * Props:
 *   characters: SavedCharacter[]
 *   currentCharacterId?: string
 *   isLoading?: boolean
 *
 * Emits:
 *   load: [characterId: string]
 *   delete: [characterId: string]
 *   setDefault: [characterId: string]
 *
 * 美学约束: A1-A8，全部使用 var(--ds-*) tokens
 */

import { ref } from 'vue';
import { StratixConfirmDialog, StratixLoading } from '@/components/ui';
import type { SavedCharacter } from '@/stratix-character-creator/types';

// ============================================================================

const props = defineProps<{
  characters: SavedCharacter[];
  currentCharacterId?: string;
  isLoading?: boolean;
}>();

const emit = defineEmits<{
  load: [characterId: string];
  delete: [characterId: string];
  setDefault: [characterId: string];
}>();

// 删除确认弹窗状态
const showDeleteConfirm = ref(false);
const characterToDelete = ref<string | null>(null);
const pendingDeleteName = ref('');

// 体型标签映射
const bodyTypeLabels: Record<string, string> = {
  male: '男',
  female: '女',
  teen: '少年',
  muscular: '肌肉',
  pregnant: '孕妇',
};

// 格式化日期
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString();
}

// 获取缩略图 URL
function getThumbnailUrl(character: SavedCharacter): string {
  return character.thumbnail || '';
}

// 获取体型首字母（占位符用）
function getBodyTypeInitial(character: SavedCharacter): string {
  return bodyTypeLabels[character.bodyType]?.[0] || character.bodyType[0].toUpperCase();
}

// 处理角色点击
function handleLoad(characterId: string): void {
  emit('load', characterId);
}

// 处理删除按钮点击
function handleDeleteClick(characterId: string, event: Event): void {
  event.stopPropagation();
  const character = props.characters.find((c) => c.characterId === characterId);
  if (character) {
    characterToDelete.value = characterId;
    pendingDeleteName.value = character.name;
    showDeleteConfirm.value = true;
  }
}

// 确认删除
function confirmDelete(): void {
  if (characterToDelete.value) {
    emit('delete', characterToDelete.value);
  }
  closeDeleteConfirm();
}

// 关闭删除确认
function closeDeleteConfirm(): void {
  showDeleteConfirm.value = false;
  characterToDelete.value = null;
  pendingDeleteName.value = '';
}

// 处理设置默认
function handleSetDefault(characterId: string, event: Event): void {
  event.stopPropagation();
  emit('setDefault', characterId);
}
</script>

<template>
  <div class="character-list">
    <!-- 头部 -->
    <div class="character-list__header">
      <span class="character-list__title">已保存角色</span>
      <span class="character-list__count">{{ characters.length }}</span>
    </div>

    <!-- 角色列表内容 -->
    <div class="character-list__content">
      <!-- 加载状态 -->
      <div v-if="isLoading" class="character-list__loading">
        <StratixLoading mode="spinner" size="md" text="加载中..." />
      </div>

      <!-- 空状态 -->
      <div v-else-if="characters.length === 0" class="character-list__empty">
        <p class="character-list__empty-text">暂无保存的角色</p>
        <p class="character-list__empty-hint">创建一个开始吧</p>
      </div>

      <!-- 角色项列表 -->
      <div
        v-for="character in characters"
        v-else
        :key="character.characterId"
        class="character-item"
        :class="{
          'character-item--active': character.characterId === currentCharacterId,
          'character-item--default': character.isDefault,
        }"
        @click="handleLoad(character.characterId)"
      >
        <!-- 缩略图 -->
        <div class="character-item__thumb">
          <img
            v-if="getThumbnailUrl(character)"
            :src="getThumbnailUrl(character)"
            :alt="character.name"
          />
          <span v-else class="character-item__thumb-placeholder">
            {{ getBodyTypeInitial(character) }}
          </span>
        </div>

        <!-- 信息区 -->
        <div class="character-item__info">
          <div class="character-item__name">{{ character.name }}</div>
          <div class="character-item__meta">
            {{ bodyTypeLabels[character.bodyType] || character.bodyType }}
            · {{ formatDate(character.updatedAt) }}
          </div>
        </div>

        <!-- 默认标记 -->
        <span v-if="character.isDefault" class="character-item__badge">默认</span>

        <!-- 操作按钮 -->
        <div class="character-item__actions">
          <button
            v-if="!character.isDefault"
            class="character-item__action"
            title="设为默认"
            @click="handleSetDefault(character.characterId, $event)"
          >
            ★
          </button>
          <button
            class="character-item__action character-item__action--danger"
            title="删除"
            @click="handleDeleteClick(character.characterId, $event)"
          >
            ✕
          </button>
        </div>
      </div>
    </div>

    <!-- 删除确认弹窗 -->
    <StratixConfirmDialog
      :visible="showDeleteConfirm"
      type="warning"
      title="删除角色"
      :content="`确定删除角色「${pendingDeleteName}」吗？此操作不可恢复。`"
      ok-text="删除"
      cancel-text="取消"
      :ok-danger="true"
      @update:visible="closeDeleteConfirm"
      @ok="confirmDelete"
      @cancel="closeDeleteConfirm"
    />
  </div>
</template>

<style scoped>
/* 容器 — A2: flex column 布局 */
.character-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--ds-bg-secondary, #1a1a2e);
  border: 1px solid var(--ds-border, #333);
  border-radius: var(--ds-radii-lg, 8px);
  overflow: hidden;
}

/* 头部 — A1: padding 12/16, A2: flex + justify/align */
.character-list__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--ds-spacing-sm, 8px) var(--ds-spacing-md, 16px);
  border-bottom: 1px solid var(--ds-border, #333);
}

.character-list__title {
  font-size: var(--ds-font-size-md, 14px);
  font-weight: 500;
  color: var(--ds-color-primary, #00d4ff);
}

.character-list__count {
  font-size: var(--ds-font-size-xs, 10px);
  color: var(--ds-text-muted, #666);
  background: var(--ds-bg-tertiary, #252540);
  padding: var(--ds-spacing-xs, 2px) var(--ds-spacing-sm, 8px);
  border-radius: var(--ds-radii-md, 4px);
}

/* 内容区 — A2: flex-1 + overflow */
.character-list__content {
  flex: 1;
  overflow-y: auto;
  padding: var(--ds-spacing-sm, 8px);
  background: var(--ds-bg-base, #111);
}

/* 加载/空状态 — A7: 居中留白 */
.character-list__loading,
.character-list__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--ds-spacing-2xl, 48px) var(--ds-spacing-md, 16px);
  text-align: center;
}

.character-list__empty-text {
  font-size: var(--ds-font-size-sm, 12px);
  color: var(--ds-text-muted, #666);
}

.character-list__empty-hint {
  margin-top: var(--ds-spacing-sm, 8px);
  font-size: var(--ds-font-size-xs, 10px);
  color: var(--ds-color-primary, #00d4ff);
}

/* 角色项 — A2: flex + align-items, A1: consistent padding */
.character-item {
  display: flex;
  align-items: center;
  padding: var(--ds-spacing-sm, 8px) var(--ds-spacing-md, 12px);
  margin-bottom: var(--ds-spacing-xs, 4px);
  background: var(--ds-bg-secondary, #1a1a2e);
  border: 1px solid transparent;
  border-radius: var(--ds-radii-md, 4px);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.character-item:hover {
  background: var(--ds-bg-tertiary, #252540);
  border-color: var(--ds-border, #333);
}

/* 选中态 */
.character-item--active {
  background: var(--ds-color-primary, #00d4ff);
  border-color: var(--ds-color-primary, #00d4ff);
}

.character-item--active:hover {
  background: var(--ds-color-primary, #00d4ff);
  border-color: var(--ds-color-primary, #00d4ff);
}

/* 默认标记边线 */
.character-item--default {
  border-left: 2px solid var(--ds-status-success, #00e676);
}

/* 缩略图 — A4: 40x40, 8px 基准 */
.character-item__thumb {
  width: 40px;
  height: 40px;
  background: var(--ds-bg-base, #111);
  border: 1px solid var(--ds-border, #333);
  border-radius: var(--ds-radii-md, 4px);
  margin-right: var(--ds-spacing-sm, 8px);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}

.character-item--active .character-item__thumb {
  border-color: rgba(255, 255, 255, 0.3);
}

.character-item__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  image-rendering: pixelated;
}

.character-item__thumb-placeholder {
  font-size: var(--ds-font-size-lg, 16px);
  color: var(--ds-text-muted, #666);
}

.character-item--active .character-item__thumb-placeholder {
  color: rgba(255, 255, 255, 0.7);
}

/* 信息区 — A5: 名称 + 元信息层级 */
.character-item__info {
  flex: 1;
  min-width: 0;
}

.character-item__name {
  font-size: var(--ds-font-size-sm, 12px);
  font-weight: 500;
  color: var(--ds-text-primary, #eee);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.character-item--active .character-item__name {
  color: var(--ds-text-on-color, #000);
}

.character-item__meta {
  font-size: var(--ds-font-size-xs, 10px);
  color: var(--ds-text-muted, #666);
  margin-top: 2px;
}

.character-item--active .character-item__meta {
  color: rgba(0, 0, 0, 0.6);
}

/* 默认标记 — A5: badge 视觉标记 */
.character-item__badge {
  font-size: var(--ds-font-size-xs, 10px);
  font-weight: 500;
  color: var(--ds-text-on-accent, #000);
  background: var(--ds-status-success, #00e676);
  padding: 2px var(--ds-spacing-xs, 6px);
  border-radius: var(--ds-radii-sm, 2px);
  margin-right: var(--ds-spacing-xs, 4px);
  flex-shrink: 0;
}

/* 操作按钮组 — A2: flex + gap */
.character-item__actions {
  display: flex;
  gap: var(--ds-spacing-xs, 4px);
  margin-left: var(--ds-spacing-sm, 8px);
  flex-shrink: 0;
}

/* 操作按钮 — A4: 24x24 (8*3), A6: 共享样式 */
.character-item__action {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--ds-border, #333);
  border-radius: var(--ds-radii-md, 4px);
  color: var(--ds-text-muted, #666);
  font-size: var(--ds-font-size-sm, 12px);
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.character-item__action:hover {
  border-color: var(--ds-color-primary, #00d4ff);
  color: var(--ds-color-primary, #00d4ff);
}

.character-item--active .character-item__action {
  border-color: rgba(255, 255, 255, 0.3);
  color: rgba(255, 255, 255, 0.7);
}

.character-item--active .character-item__action:hover {
  border-color: #fff;
  color: #fff;
}

/* 删除按钮危险色 */
.character-item__action--danger:hover {
  border-color: var(--ds-status-danger, #ff4757);
  color: var(--ds-status-danger, #ff4757);
}

/* 滚动条 — 简洁样式 */
.character-list__content::-webkit-scrollbar {
  width: 6px;
}

.character-list__content::-webkit-scrollbar-track {
  background: var(--ds-bg-base, #111);
}

.character-list__content::-webkit-scrollbar-thumb {
  background: var(--ds-border, #333);
  border-radius: var(--ds-radii-sm, 2px);
}

.character-list__content::-webkit-scrollbar-thumb:hover {
  background: var(--ds-color-primary, #00d4ff);
}
</style>
