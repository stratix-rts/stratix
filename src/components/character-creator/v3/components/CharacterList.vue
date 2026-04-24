<script setup lang="ts">
/**
 * CharacterList.vue - 已保存角色列表
 *
 * 展示已保存角色列表（缩略图 + 名称）
 * 点击角色加载编辑，删除角色（带确认），设置默认角色
 *
 * emit: load(characterId) / delete(characterId) / setDefault(characterId)
 */

import { ref } from 'vue';
import { StratixConfirmDialog } from '@/components/ui';
import type { SavedCharacter } from '@/stratix-character-creator/types';

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

// 取消删除
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

// HTML 转义
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
</script>

<template>
  <div class="character-list">
    <!-- 头部 -->
    <div class="character-list__header">
      <span class="character-list__title">已保存角色</span>
      <span class="character-list__subtitle">SAVED</span>
    </div>

    <!-- 角色列表 -->
    <div class="character-list__content">
      <!-- 加载状态 -->
      <div v-if="isLoading" class="character-list__loading">
        加载中...
      </div>

      <!-- 空状态 -->
      <div v-else-if="characters.length === 0" class="character-list__empty">
        <p>暂无保存的角色</p>
        <p class="character-list__empty-sub">No saved characters</p>
        <p class="character-list__empty-hint">创建一个开始吧</p>
      </div>

      <!-- 角色项 -->
      <template v-else>
        <div
          v-for="character in characters"
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
              :alt="escapeHtml(character.name)"
            />
            <span v-else class="character-item__thumb-placeholder">
              {{ bodyTypeLabels[character.bodyType] || character.bodyType[0].toUpperCase() }}
            </span>
          </div>

          <!-- 信息 -->
          <div class="character-item__info">
            <div class="character-item__name">{{ escapeHtml(character.name) }}</div>
            <div class="character-item__meta">
              {{ bodyTypeLabels[character.bodyType] || character.bodyType }} | {{ formatDate(character.updatedAt) }}
            </div>
          </div>

          <!-- 默认标记 -->
          <div v-if="character.isDefault" class="character-item__badge">
            默认
          </div>

          <!-- 操作按钮 -->
          <div class="character-item__actions">
            <button
              v-if="!character.isDefault"
              class="action-btn action-btn--default"
              title="设为默认"
              @click="handleSetDefault(character.characterId, $event)"
            >
              ★
            </button>
            <button
              class="action-btn action-btn--delete"
              title="删除"
              @click="handleDeleteClick(character.characterId, $event)"
            >
              ✕
            </button>
          </div>
        </div>
      </template>
    </div>

    <!-- 删除确认弹窗 -->
    <StratixConfirmDialog
      :visible="showDeleteConfirm"
      type="warning"
      title="删除角色"
      :content="`确定删除角色「${escapeHtml(pendingDeleteName)}」吗？此操作不可恢复。`"
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
.character-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border);
  border-radius: 8px;
  overflow: hidden;
  font-family: 'SF Mono', 'Monaco', monospace;
}

.character-list__header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--ds-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.character-list__title {
  font-size: 14px;
  color: var(--ds-color-primary);
  font-weight: 500;
}

.character-list__subtitle {
  font-size: 10px;
  color: var(--ds-text-muted);
  letter-spacing: 1px;
}

.character-list__content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  background: var(--ds-bg-base);
}

.character-list__loading,
.character-list__empty {
  text-align: center;
  padding: 40px 20px;
  color: var(--ds-text-muted);
  font-size: 12px;
}

.character-list__empty-sub {
  margin-top: 4px;
  font-size: 11px;
}

.character-list__empty-hint {
  margin-top: 16px;
  color: var(--ds-color-primary);
  font-size: 11px;
}

.character-item {
  display: flex;
  align-items: center;
  padding: 12px;
  margin-bottom: 4px;
  background: var(--ds-bg-secondary);
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  position: relative;
}

.character-item:hover {
  background: var(--ds-bg-tertiary);
  border-color: var(--ds-border);
}

.character-item--active {
  background: var(--ds-color-secondary);
  border-color: var(--ds-color-secondary);
}

.character-item--default {
  border-left: 2px solid var(--ds-status-success);
}

.character-item__thumb {
  width: 40px;
  height: 40px;
  background: var(--ds-bg-base);
  border: 1px solid var(--ds-border);
  border-radius: 4px;
  margin-right: 12px;
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
  font-size: 16px;
  color: var(--ds-text-muted);
}

.character-item--active .character-item__thumb-placeholder {
  color: rgba(255, 255, 255, 0.7);
}

.character-item__info {
  flex: 1;
  min-width: 0;
}

.character-item__name {
  font-size: 12px;
  font-weight: 500;
  color: var(--ds-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.character-item--active .character-item__name {
  color: var(--ds-text-on-color);
}

.character-item__meta {
  font-size: 10px;
  color: var(--ds-text-muted);
  margin-top: 2px;
}

.character-item--active .character-item__meta {
  color: rgba(255, 255, 255, 0.7);
}

.character-item__badge {
  position: absolute;
  top: 4px;
  right: 4px;
  padding: 2px 6px;
  background: var(--ds-status-success);
  border-radius: 3px;
  font-size: 9px;
  color: var(--ds-text-on-accent);
  font-weight: 500;
}

.character-item__actions {
  display: flex;
  gap: 4px;
  margin-left: 8px;
}

.action-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--ds-border);
  border-radius: 4px;
  color: var(--ds-text-muted);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.action-btn:hover {
  border-color: var(--ds-color-primary);
  color: var(--ds-color-primary);
}

.character-item--active .action-btn {
  border-color: rgba(255, 255, 255, 0.3);
  color: rgba(255, 255, 255, 0.7);
}

.character-item--active .action-btn:hover {
  border-color: var(--ds-text-inverse);
  color: var(--ds-text-inverse);
}

.action-btn--delete:hover {
  border-color: var(--ds-status-danger);
  color: var(--ds-status-danger);
}

.action-btn--default:hover {
  border-color: var(--ds-status-success);
  color: var(--ds-status-success);
}

/* 滚动条样式 */
.character-list__content::-webkit-scrollbar {
  width: 6px;
}

.character-list__content::-webkit-scrollbar-track {
  background: var(--ds-bg-base);
}

.character-list__content::-webkit-scrollbar-thumb {
  background: var(--ds-border);
  border-radius: 3px;
}

.character-list__content::-webkit-scrollbar-thumb:hover {
  background: var(--ds-color-primary);
}
</style>
