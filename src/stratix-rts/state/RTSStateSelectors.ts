import { stratixStateStore } from '@/stratix-core/state';

/**
 * Create a selector for an agent's current zone.
 * Used by UI for on-demand queries — not subscribed inside update().
 */
export const makeAgentZoneSelector = (agentId: string) =>
  stratixStateStore.createSelector(
    (state) => state.agents.get(agentId)?.currentZone
  );

/**
 * Create a selector for all connected agents.
 */
export const makeOnlineAgentsSelector = () =>
  stratixStateStore.createSelector(
    (state) =>
      Array.from(state.agents.values()).filter(
        (a) => a.status.connection === 'connected'
      )
  );
