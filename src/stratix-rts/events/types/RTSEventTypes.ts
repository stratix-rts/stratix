import type { StratixAgentConfig, StratixSkillConfig } from '@/stratix-core/stratix-protocol';
import type { Skill } from '../../ui/v2/CommandPanelV2';

export interface TopBarStats {
  totalAgents: number;
  onlineAgents: number;
  busyAgents: number;
  totalZones: number;
  overallProgress: number;
}

export interface AgentInfo {
  agentId: string;
  name: string;
  type: string;
  status: string;
  position: { x: number; y: number };
}

export interface ZoneInfo {
  zoneId: string;
  name: string;
  status: string;
  agentCount: number;
}

export interface ViewportState {
  scrollX: number;
  scrollY: number;
  zoom: number;
  width: number;
  height: number;
}

export interface SceneToUIEvents {
  'scene:ui:update_stats': TopBarStats;
  'scene:ui:update_selection': {
    selectedAgentIds: string[];
    selectedZoneIds: string[];
  };
  'scene:ui:agent_info': AgentInfo | null;
  'scene:ui:zone_info': ZoneInfo | null;
  'scene:ui:viewport_change': ViewportState;
  'scene:ui:game_ready': {
    width: number;
    height: number;
  };
  'scene:ui:notification': {
    message: string;
    type: 'info' | 'success' | 'warning' | 'error';
  };
}

export interface UIToGameEvents {
  'scene:game:skill_select': {
    skill: Skill;
  };
  'scene:game:command': {
    command: 'move' | 'patrol' | 'stop' | 'hold' | 'return';
    agentIds: string[];
  };
  'scene:game:camera_center_on': {
    x: number;
    y: number;
  };
  'scene:game:camera_follow': {
    agentId: string | null;
  };
  'scene:game:zone_mode_toggle': {
    enabled: boolean;
  };
}

export interface VueToGameEvents {
  'vue:game:create_agent': {
    config: StratixAgentConfig;
    centerOnScreen?: boolean;
  };
  'vue:game:delete_agents': {
    agentIds: string[];
  };
  'vue:game:select_agents': {
    agentIds: string[];
    addToSelection?: boolean;
  };
  'vue:game:deselect_all': Record<string, never>;
  'vue:game:execute_skill': {
    skill: StratixSkillConfig;
    agentIds: string[];
    params?: Record<string, unknown>;
  };
  'vue:game:load_character_texture': {
    characterId: string;
    agentId: string;
  };
  'vue:game:set_zone_mode': {
    enabled: boolean;
  };
  'vue:game:request_stats': Record<string, never>;
  'vue:game:request_selection': Record<string, never>;
  'vue:game:request_agents_list': Record<string, never>;
}

export interface GameToVueEvents {
  'game:vue:agent_created': {
    agentId: string;
    config: StratixAgentConfig;
  };
  'game:vue:agent_deleted': {
    agentId: string;
  };
  'game:vue:agents_updated': {
    agents: Array<{
      agentId: string;
      name: string;
      type: string;
      status: string;
    }>;
  };
  'game:vue:selection_changed': {
    agentIds: string[];
    zoneIds: string[];
  };
  'game:vue:skill_executed': {
    skillId: string;
    agentIds: string[];
    result: 'started' | 'completed' | 'failed';
    data?: unknown;
  };
  'game:vue:zone_created': {
    zoneId: string;
    name: string;
  };
  'game:vue:zone_deleted': {
    zoneId: string;
  };
  'game:vue:game_ready': {
    width: number;
    height: number;
  };
  'game:vue:skill_selected': {
    skill: Skill;
  };
}

export interface RequestResponseMap {
  'request:get_agent': {
    request: { agentId: string };
    response: AgentInfo | null;
  };
  'request:get_selected_agents': {
    request: Record<string, never>;
    response: AgentInfo[];
  };
  'request:get_zones': {
    request: Record<string, never>;
    response: Array<{
      zoneId: string;
      name: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
  };
  'request:get_camera_state': {
    request: Record<string, never>;
    response: ViewportState;
  };
  'request:get_stats': {
    request: Record<string, never>;
    response: TopBarStats;
  };
}

export type AllRTSEvents = SceneToUIEvents & UIToGameEvents & VueToGameEvents & GameToVueEvents;

export type RTSEventName = keyof AllRTSEvents;

export type RTSEventData<K extends RTSEventName> = AllRTSEvents[K];

export type RTSEventHandler<T = unknown> = (data: T) => void;

export type RTSAsyncHandler<T = unknown, R = unknown> = (data: T) => R | Promise<R>;

export enum EventPriority {
  CRITICAL = 0,
  HIGH = 1,
  NORMAL = 2,
  LOW = 3,
}

export const EventPriorityConfig: Partial<Record<RTSEventName, EventPriority>> = {
  'vue:game:select_agents': EventPriority.CRITICAL,
  'vue:game:delete_agents': EventPriority.CRITICAL,
  'scene:game:skill_select': EventPriority.HIGH,
  'scene:game:command': EventPriority.HIGH,
  'vue:game:create_agent': EventPriority.HIGH,
  'vue:game:execute_skill': EventPriority.HIGH,
  'scene:ui:update_stats': EventPriority.LOW,
  'scene:ui:viewport_change': EventPriority.LOW,
  'game:vue:agents_updated': EventPriority.LOW,
};

export const ThrottleConfig: Partial<Record<RTSEventName, number>> = {
  'scene:ui:viewport_change': 16,
  'scene:ui:update_stats': 100,
};

export const BatchConfig: Partial<Record<RTSEventName, { window: number; maxBatch: number }>> = {
  'game:vue:agents_updated': { window: 50, maxBatch: 100 },
};
