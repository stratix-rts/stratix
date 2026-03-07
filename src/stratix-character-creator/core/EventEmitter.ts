/**
 * CharacterCreatorEventEmitter - 角色生成器事件发射器
 * 与 StratixEventBus 集成，处理跨模块通信
 */

import StratixEventBus from '../../stratix-core/StratixEventBus';
import { EVENTS } from '../constants';
import type { SavedCharacter } from '../types';

class CharacterCreatorEventEmitter {
  private eventBus = StratixEventBus.getInstance();

  emitCharacterCreated(character: SavedCharacter): void {
    this.eventBus.emit({
      eventType: EVENTS.CHARACTER_CREATED,
      payload: {
        characterId: character.characterId,
        name: character.name,
        bodyType: character.bodyType,
        parts: character.parts,
        skillTree: character.skillTree,
        attributes: character.attributes,
      },
      timestamp: Date.now(),
      requestId: `char-creator-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    } as any);
  }

  emitCharacterUpdated(character: SavedCharacter): void {
    this.eventBus.emit({
      eventType: EVENTS.CHARACTER_UPDATED,
      payload: {
        characterId: character.characterId,
        name: character.name,
        bodyType: character.bodyType,
        parts: character.parts,
        skillTree: character.skillTree,
        attributes: character.attributes,
      },
      timestamp: Date.now(),
      requestId: `char-creator-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    } as any);
  }

  emitCharacterDeleted(characterId: string): void {
    this.eventBus.emit({
      eventType: EVENTS.CHARACTER_DELETED,
      payload: {
        characterId
      },
      timestamp: Date.now(),
      requestId: `char-creator-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    } as any);
  }

  emitCharacterSelected(character: SavedCharacter): void {
    this.eventBus.emit({
      eventType: EVENTS.CHARACTER_SELECTED,
      payload: {
        characterId: character.characterId,
        name: character.name,
        bodyType: character.bodyType
      },
      timestamp: Date.now(),
      requestId: `char-creator-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    } as any);
  }

  onOpenCreator(callback: (data: { targetCharacterId?: string }) => void): () => void {
    const handler = (event: any) => {
      callback(event.payload);
    };
    this.eventBus.subscribe(EVENTS.OPEN_CREATOR, handler);
    return () => this.eventBus.unsubscribe(EVENTS.OPEN_CREATOR, handler);
  }

  onCharacterCreated(callback: (character: SavedCharacter) => void): () => void {
    const handler = (event: any) => {
      callback(event.payload);
    };
    this.eventBus.subscribe(EVENTS.CHARACTER_CREATED, handler);
    return () => this.eventBus.unsubscribe(EVENTS.CHARACTER_CREATED, handler);
  }

  onCharacterUpdated(callback: (character: SavedCharacter) => void): () => void {
    const handler = (event: any) => {
      callback(event.payload);
    };
    this.eventBus.subscribe(EVENTS.CHARACTER_UPDATED, handler);
    return () => this.eventBus.unsubscribe(EVENTS.CHARACTER_UPDATED, handler);
  }

  onCharacterDeleted(callback: (characterId: string) => void): () => void {
    const handler = (event: any) => {
      callback(event.payload.characterId);
    };
    this.eventBus.subscribe(EVENTS.CHARACTER_DELETED, handler);
    return () => this.eventBus.unsubscribe(EVENTS.CHARACTER_DELETED, handler);
  }
}

export const characterCreatorEvents = new CharacterCreatorEventEmitter();
export default CharacterCreatorEventEmitter;
