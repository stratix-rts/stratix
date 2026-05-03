export interface ControlGroup {
  readonly id: number;
  readonly agentIds: Set<string>;
}

export class ControlGroupSystem {
  private groups: Map<number, ControlGroup> = new Map();
  private maxGroups: number = 9;

  public createGroup(groupId: number, agentIds: string[]): boolean {
    if (groupId < 1 || groupId > this.maxGroups) return false;

    const group: ControlGroup = {
      id: groupId,
      agentIds: new Set(agentIds)
    };

    this.groups.set(groupId, group);
    return true;
  }

  public addToGroup(groupId: number, agentIds: string[]): boolean {
    if (groupId < 1 || groupId > this.maxGroups) return false;

    const group = this.groups.get(groupId);
    if (!group) {
      return this.createGroup(groupId, agentIds);
    }

    agentIds.forEach(id => group.agentIds.add(id));
    return true;
  }

  public removeFromGroup(groupId: number, agentIds: string[]): boolean {
    if (groupId < 1 || groupId > this.maxGroups) return false;

    const group = this.groups.get(groupId);
    if (!group) return false;

    agentIds.forEach(id => group.agentIds.delete(id));
    return true;
  }

  public getGroup(groupId: number): ControlGroup | undefined {
    return this.groups.get(groupId);
  }

  public getGroupAgentIds(groupId: number): string[] {
    const group = this.groups.get(groupId);
    return group ? Array.from(group.agentIds) : [];
  }

  public hasGroup(groupId: number): boolean {
    return this.groups.has(groupId);
  }

  public clearGroup(groupId: number): boolean {
    if (groupId < 1 || groupId > this.maxGroups) return false;
    return this.groups.delete(groupId);
  }

  public removeAgentFromAllGroups(agentId: string): void {
    this.groups.forEach(group => {
      group.agentIds.delete(agentId);
    });
  }

  public getAllGroups(): Map<number, ControlGroup> {
    return this.groups;
  }

  public getGroupCount(): number {
    return this.groups.size;
  }
}
