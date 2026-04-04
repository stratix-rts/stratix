import { Subject, Observable } from 'rxjs';

import { rtsEventBus } from '../events/core/RTSEventBus';

export enum SelectionMode {
  Replace = 'replace',
  Add = 'add',
  Remove = 'remove',
  Toggle = 'toggle',
}

export interface SelectionChangeEvent {
  type: 'agent' | 'zone' | 'all' | 'preview';
  previous?: Set<string> | { agents: Set<string>; zones: Set<string> };
  current?: Set<string> | { agents: Set<string>; zones: Set<string> };
  added?: string[];
  removed?: string[];
}

export interface SelectionManager {
  selectAgent(agentId: string, mode?: SelectionMode): void;
  deselectAgent(agentId: string): void;
  getSelectedAgents(): Set<string>;
  clearAgentSelection(): void;

  selectZone(zoneId: string, mode?: SelectionMode): void;
  deselectZone(zoneId: string): void;
  getSelectedZones(): Set<string>;
  clearZoneSelection(): void;

  clearAll(): void;
  invertSelection(): void;
  selectAll(): void;

  setPreview(agentIds: Set<string>): void;
  clearPreview(): void;
  getPreview(): Set<string>;

  onSelectionChange: Observable<SelectionChangeEvent>;
  
  destroy(): void;
}

export class SelectionManagerImpl implements SelectionManager {
  private agents = new Set<string>();
  private zones = new Set<string>();
  private preview = new Set<string>();

  private selectionChange$ = new Subject<SelectionChangeEvent>();
  onSelectionChange = this.selectionChange$.asObservable();

  selectAgent(agentId: string, mode: SelectionMode = SelectionMode.Replace): void {
    const previousAgents = new Set(this.agents);
    let wasAdded = false;

    switch (mode) {
      case SelectionMode.Replace:
        this.agents.clear();
        this.agents.add(agentId);
        wasAdded = true;
        break;
      case SelectionMode.Add:
        if (!this.agents.has(agentId)) {
          this.agents.add(agentId);
          wasAdded = true;
        }
        break;
      case SelectionMode.Remove:
        this.agents.delete(agentId);
        break;
      case SelectionMode.Toggle:
        if (this.agents.has(agentId)) {
          this.agents.delete(agentId);
        } else {
          this.agents.add(agentId);
          wasAdded = true;
        }
        break;
    }

    this.emitChange({
      type: 'agent',
      previous: previousAgents,
      current: new Set(this.agents),
      added: wasAdded ? [agentId] : [],
    });
  }

  deselectAgent(agentId: string): void {
    const previousAgents = new Set(this.agents);
    this.agents.delete(agentId);

    this.emitChange({
      type: 'agent',
      previous: previousAgents,
      current: new Set(this.agents),
      removed: [agentId],
    });
  }

  getSelectedAgents(): Set<string> {
    return new Set(this.agents);
  }

  clearAgentSelection(): void {
    const previousAgents = new Set(this.agents);
    this.agents.clear();

    this.emitChange({
      type: 'agent',
      previous: previousAgents,
      current: new Set(),
    });
  }

  selectZone(zoneId: string, mode: SelectionMode = SelectionMode.Replace): void {
    const previousZones = new Set(this.zones);
    let wasAdded = false;

    switch (mode) {
      case SelectionMode.Replace:
        this.zones.clear();
        this.zones.add(zoneId);
        wasAdded = true;
        break;
      case SelectionMode.Add:
        if (!this.zones.has(zoneId)) {
          this.zones.add(zoneId);
          wasAdded = true;
        }
        break;
      case SelectionMode.Remove:
        this.zones.delete(zoneId);
        break;
      case SelectionMode.Toggle:
        if (this.zones.has(zoneId)) {
          this.zones.delete(zoneId);
        } else {
          this.zones.add(zoneId);
          wasAdded = true;
        }
        break;
    }

    this.emitChange({
      type: 'zone',
      previous: previousZones,
      current: new Set(this.zones),
      added: wasAdded ? [zoneId] : [],
    });
  }

  deselectZone(zoneId: string): void {
    const previousZones = new Set(this.zones);
    this.zones.delete(zoneId);

    this.emitChange({
      type: 'zone',
      previous: previousZones,
      current: new Set(this.zones),
      removed: [zoneId],
    });
  }

  getSelectedZones(): Set<string> {
    return new Set(this.zones);
  }

  clearZoneSelection(): void {
    const previousZones = new Set(this.zones);
    this.zones.clear();

    this.emitChange({
      type: 'zone',
      previous: previousZones,
      current: new Set(),
    });
  }

  clearAll(): void {
    const previousAgents = new Set(this.agents);
    const previousZones = new Set(this.zones);

    this.agents.clear();
    this.zones.clear();
    this.preview.clear();

    this.emitChange({
      type: 'all',
      previous: { agents: previousAgents, zones: previousZones },
      current: { agents: new Set(), zones: new Set() },
    });
  }

  invertSelection(): void {
    const previousAgents = new Set(this.agents);
    this.agents.clear();

    this.emitChange({
      type: 'agent',
      previous: previousAgents,
      current: new Set(this.agents),
    });
  }

  selectAll(): void {
    const previousAgents = new Set(this.agents);
    this.agents.clear();

    this.emitChange({
      type: 'agent',
      previous: previousAgents,
      current: new Set(this.agents),
    });
  }

  setPreview(agentIds: Set<string>): void {
    const previousPreview = new Set(this.preview);
    this.preview = new Set(agentIds);

    this.emitChange({
      type: 'preview',
      previous: previousPreview,
      current: new Set(this.preview),
    });
  }

  clearPreview(): void {
    const previousPreview = new Set(this.preview);
    this.preview.clear();

    this.emitChange({
      type: 'preview',
      previous: previousPreview,
      current: new Set(),
    });
  }

  getPreview(): Set<string> {
    return new Set(this.preview);
  }

  private emitChange(event: SelectionChangeEvent): void {
    this.selectionChange$.next(event);

    rtsEventBus.emit('scene:ui:update_selection' as any, {
      selectedAgentIds: Array.from(this.agents),
      selectedZoneIds: Array.from(this.zones),
    });
  }

  destroy(): void {
    this.agents.clear();
    this.zones.clear();
    this.preview.clear();
    this.selectionChange$.complete();
  }
}