/**
 * useCharacterState - 角色状态管理（V4 Vue Composable）
 * 管理当前角色数据、isDirty 标记、已保存角色列表
 * 调用 characterStorage API 进行 CRUD 操作
 *
 * V3 对照：src/components/character-creator/v3/composables/useCharacterState.ts
 * V1 参考：src/stratix-character-creator/CharacterCreatorScene.ts saveCharacter()
 *
 * 保存流程（8 步）：
 * 1. composeCharacter → canvas
 * 2. generateThumbnail → thumbnail
 * 3. generateAndUploadTexture → texture
 * 4. updatedAt = Date.now()
 * 5. 深拷贝（剥离 Vue reactive proxy）+ 清理 apiKey
 * 6. characterStorage.save()
 * 7. isDirty = false
 * 8. loadSavedCharacters() 刷新列表
 */

import { ref, computed, toRaw } from 'vue';
import type { SavedCharacter, PartSelection } from '@/stratix-character-creator/types';
import type { BodyType } from '@/stratix-character-creator/constants';
import { characterStorage } from '@/stratix-character-creator/core/CharacterStorage';
import { characterComposer } from '@/stratix-character-creator/core/CharacterComposer';
import { textureManager } from '@/stratix-core/services';
import { DEFAULT_BODY_TYPE } from '@/stratix-character-creator/constants';

export interface UseCharacterStateOptions {
  initialCharacter?: SavedCharacter | null;
}

export function useCharacterState(options: UseCharacterStateOptions = {}) {
  // 当前编辑中的角色
  const currentCharacter = ref<SavedCharacter | null>(options.initialCharacter ?? null);

  // 是否已修改（未保存）
  const isDirty = ref<boolean>(false);

  // 已保存角色列表
  const savedCharacters = ref<SavedCharacter[]>([]);

  // 加载状态
  const isLoading = ref<boolean>(false);

  // 计算属性：是否有选中角色
  const hasCharacter = computed(() => currentCharacter.value !== null);

  // 加载已保存角色列表
  async function loadSavedCharacters(): Promise<void> {
    isLoading.value = true;
    try {
      savedCharacters.value = await characterStorage.list();
    } catch (error) {
      console.error('[useCharacterState] Failed to load saved characters:', error);
    } finally {
      isLoading.value = false;
    }
  }

  // 创建新角色
  function createNew(bodyType: BodyType = DEFAULT_BODY_TYPE as BodyType): SavedCharacter {
    const newChar = characterStorage.createNew(bodyType);
    currentCharacter.value = newChar;
    isDirty.value = true;
    return newChar;
  }

  // 加载角色
  async function loadCharacter(characterId: string): Promise<SavedCharacter | null> {
    isLoading.value = true;
    try {
      const character = await characterStorage.load(characterId);
      if (character) {
        currentCharacter.value = character;
        isDirty.value = false;
      }
      return character;
    } catch (error) {
      console.error('[useCharacterState] Failed to load character:', error);
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  // 保存角色（完整 8 步流程）
  async function saveCharacter(): Promise<boolean> {
    if (!currentCharacter.value) return false;

    try {
      const char = currentCharacter.value;

      // Step 1: composeCharacter → canvas
      const composeResult = await characterComposer.composeCharacter(char.parts, {
        bodyType: char.bodyType,
      });

      // Step 2: generateThumbnail → thumbnail
      currentCharacter.value.thumbnail = textureManager.generateThumbnail(composeResult.canvas, 128);

      // Step 3: generateAndUploadTexture → texture
      const texture = await textureManager.generateAndUploadTexture({
        characterId: char.characterId,
        name: char.name,
        bodyType: char.bodyType,
        parts: char.parts,
        thumbnail: char.thumbnail,
        createdAt: char.createdAt,
        updatedAt: char.updatedAt,
      });
      if (texture) {
        currentCharacter.value.texture = texture;
      }

      // Step 4: updatedAt
      currentCharacter.value.updatedAt = Date.now();

      // Step 5: 深拷贝（剥离 Vue reactive proxy）+ 清理 apiKey
      const toSave = JSON.parse(JSON.stringify(toRaw(currentCharacter.value))) as SavedCharacter;
      if (toSave.stratixConfig) {
        const { apiKey: _apiKey, ...stratixConfigWithoutKey } = toSave.stratixConfig;
        toSave.stratixConfig = stratixConfigWithoutKey;
      }

      // Step 6: characterStorage.save()
      await characterStorage.save(toSave);

      // Step 7: isDirty = false
      isDirty.value = false;

      // Step 8: loadSavedCharacters() 刷新列表
      await loadSavedCharacters();

      return true;
    } catch (error) {
      console.error('[useCharacterState] Failed to save character:', error);
      return false;
    }
  }

  // 删除角色
  async function deleteCharacter(characterId: string): Promise<boolean> {
    try {
      await characterStorage.delete(characterId);

      // 如果删除的是当前角色，清除当前角色
      if (currentCharacter.value?.characterId === characterId) {
        currentCharacter.value = null;
        isDirty.value = false;
      }

      await loadSavedCharacters();
      return true;
    } catch (error) {
      console.error('[useCharacterState] Failed to delete character:', error);
      return false;
    }
  }

  // 设置默认角色
  async function setDefaultCharacter(characterId: string): Promise<boolean> {
    try {
      for (const char of savedCharacters.value) {
        if (char.isDefault && char.characterId !== characterId) {
          char.isDefault = false;
          await characterStorage.save(char);
        }
      }
      const character = savedCharacters.value.find(c => c.characterId === characterId);
      if (character) {
        character.isDefault = true;
        await characterStorage.save(character);
      }
      await loadSavedCharacters();
      return true;
    } catch (error) {
      console.error('[useCharacterState] Failed to set default character:', error);
      return false;
    }
  }

  // 更新当前角色名称
  function updateName(name: string): void {
    if (currentCharacter.value) {
      currentCharacter.value.name = name;
      isDirty.value = true;
    }
  }

  // 更新当前角色体型
  function updateBodyType(bodyType: BodyType): void {
    if (currentCharacter.value) {
      currentCharacter.value.bodyType = bodyType;
      isDirty.value = true;
    }
  }

  // 更新当前角色部件
  function updatePart(category: string, selection: PartSelection | null): void {
    if (!currentCharacter.value) return;
    if (selection === null) {
      delete currentCharacter.value.parts[category];
    } else {
      currentCharacter.value.parts[category] = selection;
    }
    isDirty.value = true;
  }

  // 更新当前角色缩略图
  function updateThumbnail(thumbnail: string): void {
    if (currentCharacter.value) {
      currentCharacter.value.thumbnail = thumbnail;
      isDirty.value = true;
    }
  }

  // 重置当前角色（放弃修改）
  function resetCharacter(): void {
    if (currentCharacter.value) {
      characterStorage.load(currentCharacter.value.characterId).then(char => {
        if (char) {
          currentCharacter.value = char;
          isDirty.value = false;
        }
      });
    }
  }

  return {
    // State
    currentCharacter,
    savedCharacters,
    isLoading,
    isDirty,
    hasCharacter,

    // Actions
    loadSavedCharacters,
    createNew,
    loadCharacter,
    saveCharacter,
    deleteCharacter,
    setDefaultCharacter,
    updateName,
    updateBodyType,
    updatePart,
    updateThumbnail,
    resetCharacter,
  };
}
