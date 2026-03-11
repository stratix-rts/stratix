/**
 * Stratix CharacterCreator 模块
 * 基于 LPC 素材的角色生成器
 */

import Phaser from 'phaser';
import CharacterCreatorScene from './CharacterCreatorScene';
import { getToken } from '@/design-system/config';

export interface CharacterCreatorConfig {
  parent: string | HTMLElement;
  width?: number;
  height?: number;
  targetCharacterId?: string;
  onCharacterCreated?: (character: import('./types').SavedCharacter) => void;
  onCharacterUpdated?: (character: import('./types').SavedCharacter) => void;
  onCharacterDeleted?: (characterId: string) => void;
}

export function createCharacterCreator(config: CharacterCreatorConfig): Phaser.Game {
  const width = config.width ?? 800;
  const height = config.height ?? 600;

  const gameConfig: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: config.parent,
    width,
    height,
    backgroundColor: parseInt(getToken('colors.background.base').replace('#', ''), 16),
    pixelArt: true,
    scene: [CharacterCreatorScene],
    scale: {
      mode: Phaser.Scale.NONE,
      width,
      height
    },
    dom: {
      createContainer: true
    }
  };

  const game = new Phaser.Game(gameConfig);

  game.events.once('ready', () => {
    const scene = game.scene.getScene('CharacterCreatorScene') as CharacterCreatorScene;
    if (scene && config.targetCharacterId) {
      scene.loadCharacterById(config.targetCharacterId);
    }
    
    if (config.onCharacterCreated) {
      scene?.events?.on('character:created', config.onCharacterCreated);
    }
    if (config.onCharacterUpdated) {
      scene?.events?.on('character:updated', config.onCharacterUpdated);
    }
    if (config.onCharacterDeleted) {
      scene?.events?.on('character:deleted', config.onCharacterDeleted);
    }
    
    game.events.emit('ready');
  });

  return game;
}

export { CharacterCreatorScene } from './CharacterCreatorScene';
export type { CharacterCreatorSceneData } from './CharacterCreatorScene';

export { characterComposer } from './core/CharacterComposer';
export { characterStorage } from './core/CharacterStorage';
export { partRegistry } from './core/PartRegistry';
export { SkillTree } from './core/SkillTree';
export { characterCreatorEvents } from './core/EventEmitter';

export { PartSelector, CharacterPreview, CharacterList, ButtonGroup, SkillTreeUI } from './ui';
export type { PartSelectorConfig, CharacterPreviewConfig, CharacterListConfig, ButtonGroupConfig, SkillTreeUIConfig } from './ui';

export * from './constants';
export * from './types';
export * from './config/animationConfig';
export * from './config/partConfig';
export * from './config/skillTreeConfig';
