import type { Skill } from '../../ui/v2/CommandPanelV2';

import type { StratixAgentConfig, StratixSkillConfig } from '@/stratix-core/stratix-protocol';

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
  'vue:game:confirm_delete_zones': {
    zoneIds: string[];
  };
  'vue:game:zone_delete_confirmed': {
    zoneIds: string[];
  };
  'settings:render_mode_changed': {
    mode: 'auto' | 'full' | 'thumbnail' | null;
    threshold?: number;
    showNames?: boolean;
  };
  'settings:render_density_changed': {
    threshold: number;
  };
  'settings:collision_enabled_changed': {
    enabled: boolean;
  };
  'settings:collision_radius_changed': {
    radius: number;
  };
}

export interface ZoneSyncEvents {
  'zone:status_change': {
    zoneId: string;
    oldStatus: string;
    newStatus: string;
    timestamp: number;
  };
  'zone:synced': {
    zoneId: string;
    status: string;
  };
  'zone:sync_complete': {
    zoneId: string;
    status: string;
    version: number;
  };
  'zone:sync_failed': {
    zoneId: string;
    error: string;
  };
}

export interface ErrorEvents {
  'error:occurred': {
    error: Error;
    classified: any;
    context?: any;
  };
  'toast:updated': {
    toasts: any[];
  };
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
'game:ui:project_created': {
    project: any;
    needsConfig: boolean;
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
  'request:confirm_delete_zones': {
    request: { zoneIds: string[] };
    response: boolean;
  };
}

export interface ReplayEvents {
  'replay:state_changed': {
    state: 'idle' | 'playing' | 'paused' | 'ended';
  };
  'replay:progress': {
    state: 'idle' | 'playing' | 'paused' | 'ended';
    currentTime: number;
    duration: number;
    percentage: number;
    eventIndex: number;
    totalEvents: number;
  };
  'replay:recording_started': {
    sessionId: string;
  };
  'replay:recording_stopped': {
    session: {
      id: string;
      name: string;
      startTime: number;
      endTime: number;
      events: Array<{
        event: string;
        data: unknown;
        timestamp: number;
      }>;
      duration: number;
    };
  };
  'replay:session_loaded': {
    session: {
      id: string;
      name: string;
      startTime: number;
      endTime: number;
      events: Array<{
        event: string;
        data: unknown;
        timestamp: number;
      }>;
      duration: number;
    };
  };
  'replay:error': {
    error: string;
  };
}

export type AllRTSEvents = SceneToUIEvents & UIToGameEvents & VueToGameEvents & GameToVueEvents & ZoneSyncEvents & ErrorEvents & ReplayEvents;

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
