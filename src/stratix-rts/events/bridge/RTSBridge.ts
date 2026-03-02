import { rtsEventBus } from '../core/RTSEventBus';
import type {
  RTSEventName,
  RTSEventData,
  AllRTSEvents,
  GameToVueEvents,
  VueToGameEvents,
} from '../types/RTSEventTypes';

type GameToVueEventName = keyof GameToVueEvents;
type VueToGameEventName = keyof VueToGameEvents;

class RTSBridge {
  private eventBus = rtsEventBus;

  on<K extends GameToVueEventName>(
    event: K,
    handler: (data: GameToVueEvents[K]) => void
  ): () => void {
    return this.eventBus.on(event, handler);
  }

  once<K extends GameToVueEventName>(
    event: K,
    handler: (data: GameToVueEvents[K]) => void
  ): () => void {
    return this.eventBus.once(event, handler);
  }

  off<K extends GameToVueEventName>(
    event: K,
    handler?: (data: GameToVueEvents[K]) => void
  ): void {
    this.eventBus.off(event, handler);
  }

  emit<K extends VueToGameEventName>(
    event: K,
    data: VueToGameEvents[K]
  ): void {
    this.eventBus.emit(event, data as AllRTSEvents[K]);
  }

  onGameReady(handler: (data: GameToVueEvents['game:vue:game_ready']) => void): () => void {
    return this.on('game:vue:game_ready', handler);
  }

  onSelectionChanged(
    handler: (data: GameToVueEvents['game:vue:selection_changed']) => void
  ): () => void {
    return this.on('game:vue:selection_changed', handler);
  }

  onAgentsUpdated(
    handler: (data: GameToVueEvents['game:vue:agents_updated']) => void
  ): () => void {
    return this.on('game:vue:agents_updated', handler);
  }

  onSkillExecuted(
    handler: (data: GameToVueEvents['game:vue:skill_executed']) => void
  ): () => void {
    return this.on('game:vue:skill_executed', handler);
  }

  onSkillSelected(
    handler: (data: GameToVueEvents['game:vue:skill_selected']) => void
  ): () => void {
    return this.on('game:vue:skill_selected', handler);
  }

  createAgent(config: VueToGameEvents['vue:game:create_agent']['config'], centerOnScreen?: boolean): void {
    this.emit('vue:game:create_agent', { config, centerOnScreen });
  }

  deleteAgents(agentIds: string[]): void {
    this.emit('vue:game:delete_agents', { agentIds });
  }

  selectAgents(agentIds: string[], addToSelection?: boolean): void {
    this.emit('vue:game:select_agents', { agentIds, addToSelection });
  }

  deselectAll(): void {
    this.emit('vue:game:deselect_all', {});
  }

  executeSkill(skill: VueToGameEvents['vue:game:execute_skill']['skill'], agentIds: string[], params?: Record<string, unknown>): void {
    this.emit('vue:game:execute_skill', { skill, agentIds, params });
  }

  loadCharacterTexture(characterId: string, agentId: string): void {
    this.emit('vue:game:load_character_texture', { characterId, agentId });
  }

  setZoneMode(enabled: boolean): void {
    this.emit('vue:game:set_zone_mode', { enabled });
  }

  requestStats(): void {
    this.emit('vue:game:request_stats', {});
  }

  requestSelection(): void {
    this.emit('vue:game:request_selection', {});
  }

  requestAgentsList(): void {
    this.emit('vue:game:request_agents_list', {});
  }

  getScene(name: 'game' | 'ui') {
    return this.eventBus.getScene(name);
  }

  async request<T extends keyof import('../types/RTSEventTypes').RequestResponseMap>(
    event: T,
    data: import('../types/RTSEventTypes').RequestResponseMap[T]['request']
  ): Promise<import('../types/RTSEventTypes').RequestResponseMap[T]['response']> {
    return this.eventBus.request(event, data);
  }
}

export const rtsBridge = new RTSBridge();
export default rtsBridge;
