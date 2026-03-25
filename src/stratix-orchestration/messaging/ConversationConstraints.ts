import { getDatabase } from '../../stratix-database/StratixDatabase';

// Database row interface
interface PolicyRow {
  policy_id: string;
  scope: 'global' | 'zone' | 'agent';
  scope_id: string | null;
  allow_dm: number;
  allow_broadcast: number;
  allowed_participants: string | null;
  share_memory: number;
  share_context: number;
  share_files: number;
  created_at: number;
  updated_at: number;
}

export interface ConversationPolicy {
  policyId: string;
  scope: 'global' | 'zone' | 'agent';
  scopeId?: string;
  allowDM: boolean;
  allowBroadcast: boolean;
  allowedParticipants?: string[];
  shareMemory: boolean;
  shareContext: boolean;
  shareFiles: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
}

export class ConversationConstraints {
  private static instance: ConversationConstraints;

  private constructor() {}

  static getInstance(): ConversationConstraints {
    if (!ConversationConstraints.instance) {
      ConversationConstraints.instance = new ConversationConstraints();
    }
    return ConversationConstraints.instance;
  }

  /**
   * Check if a message can be sent between two agents
   */
  async canSend(
    senderId: string,
    recipientId: string,
    messageType: 'direct' | 'broadcast' | 'mention',
    options: { zoneId?: string } = {}
  ): Promise<PolicyCheckResult> {
    // Check agent-specific policy first
    const agentPolicy = await this.getAgentPolicy(senderId);
    if (agentPolicy) {
      if (messageType === 'direct' && !agentPolicy.allowDM) {
        return { allowed: false, reason: 'Agent has disabled direct messages' };
      }
      if (messageType === 'broadcast' && !agentPolicy.allowBroadcast) {
        return { allowed: false, reason: 'Agent has disabled broadcasts' };
      }
      if (agentPolicy.allowedParticipants && !agentPolicy.allowedParticipants.includes(recipientId)) {
        return { allowed: false, reason: 'Recipient not in allowed participants list' };
      }
    }

    // Check zone policy
    if (options.zoneId) {
      const zonePolicy = await this.getZonePolicy(options.zoneId);
      if (zonePolicy) {
        if (messageType === 'direct' && !zonePolicy.allowDM) {
          return { allowed: false, reason: 'Zone has disabled direct messages' };
        }
        if (messageType === 'broadcast' && !zonePolicy.allowBroadcast) {
          return { allowed: false, reason: 'Zone has disabled broadcasts' };
        }
        if (zonePolicy.allowedParticipants && !zonePolicy.allowedParticipants.includes(recipientId)) {
          return { allowed: false, reason: 'Recipient not in zone allowed participants' };
        }
      }
    }

    // Check global policy
    const globalPolicy = await this.getGlobalPolicy();
    if (globalPolicy) {
      if (messageType === 'direct' && !globalPolicy.allowDM) {
        return { allowed: false, reason: 'Global policy has disabled direct messages' };
      }
      if (messageType === 'broadcast' && !globalPolicy.allowBroadcast) {
        return { allowed: false, reason: 'Global policy has disabled broadcasts' };
      }
    }

    return { allowed: true };
  }

  /**
   * Check if an agent can share memory/context/files
   */
  async canShare(
    senderId: string,
    recipientId: string,
    shareType: 'memory' | 'context' | 'files',
    options: { zoneId?: string } = {}
  ): Promise<PolicyCheckResult> {
    // Get applicable policy (agent > zone > global)
    let policy: ConversationPolicy | null = await this.getAgentPolicy(senderId);

    if (!policy && options.zoneId) {
      policy = await this.getZonePolicy(options.zoneId);
    }

    if (!policy) {
      policy = await this.getGlobalPolicy();
    }

    if (!policy) {
      // Default: allow sharing context, deny memory and files
      if (shareType === 'context') {
        return { allowed: true };
      }
      return { allowed: false, reason: 'No policy found' };
    }

    switch (shareType) {
      case 'memory':
        return { allowed: policy.shareMemory, reason: policy.shareMemory ? undefined : 'Memory sharing disabled' };
      case 'context':
        return { allowed: policy.shareContext, reason: policy.shareContext ? undefined : 'Context sharing disabled' };
      case 'files':
        return { allowed: policy.shareFiles, reason: policy.shareFiles ? undefined : 'File sharing disabled' };
    }
  }

  // ==================== Policy CRUD ====================

  async createPolicy(policy: Omit<ConversationPolicy, 'createdAt' | 'updatedAt'>): Promise<ConversationPolicy> {
    const db = getDatabase().getDatabase();
    const now = Date.now();

    const fullPolicy: ConversationPolicy = {
      ...policy,
      createdAt: now,
      updatedAt: now,
    };

    db.prepare(`
      INSERT INTO conversation_policies
        (policy_id, scope, scope_id, allow_dm, allow_broadcast, allowed_participants,
         share_memory, share_context, share_files, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      policy.policyId,
      policy.scope,
      policy.scopeId || null,
      policy.allowDM ? 1 : 0,
      policy.allowBroadcast ? 1 : 0,
      policy.allowedParticipants ? JSON.stringify(policy.allowedParticipants) : null,
      policy.shareMemory ? 1 : 0,
      policy.shareContext ? 1 : 0,
      policy.shareFiles ? 1 : 0,
      now,
      now
    );

    return fullPolicy;
  }

  async getPolicy(policyId: string): Promise<ConversationPolicy | null> {
    const db = getDatabase().getDatabase();
    const row = db.prepare('SELECT * FROM conversation_policies WHERE policy_id = ?').get(policyId) as PolicyRow | undefined;
    return row ? this.rowToPolicy(row) : null;
  }

  async getAgentPolicy(agentId: string): Promise<ConversationPolicy | null> {
    const db = getDatabase().getDatabase();
    const row = db.prepare(
      "SELECT * FROM conversation_policies WHERE scope = 'agent' AND scope_id = ?"
    ).get(agentId) as PolicyRow | undefined;
    return row ? this.rowToPolicy(row) : null;
  }

  async getZonePolicy(zoneId: string): Promise<ConversationPolicy | null> {
    const db = getDatabase().getDatabase();
    const row = db.prepare(
      "SELECT * FROM conversation_policies WHERE scope = 'zone' AND scope_id = ?"
    ).get(zoneId) as PolicyRow | undefined;
    return row ? this.rowToPolicy(row) : null;
  }

  async getGlobalPolicy(): Promise<ConversationPolicy | null> {
    const db = getDatabase().getDatabase();
    const row = db.prepare(
      "SELECT * FROM conversation_policies WHERE scope = 'global' LIMIT 1"
    ).get() as PolicyRow | undefined;
    return row ? this.rowToPolicy(row) : null;
  }

  async updatePolicy(policyId: string, updates: Partial<ConversationPolicy>): Promise<ConversationPolicy | null> {
    const db = getDatabase().getDatabase();
    const now = Date.now();

    const setClauses: string[] = ['updated_at = ?'];
    const values: any[] = [now];

    if (updates.allowDM !== undefined) {
      setClauses.push('allow_dm = ?');
      values.push(updates.allowDM ? 1 : 0);
    }
    if (updates.allowBroadcast !== undefined) {
      setClauses.push('allow_broadcast = ?');
      values.push(updates.allowBroadcast ? 1 : 0);
    }
    if (updates.allowedParticipants !== undefined) {
      setClauses.push('allowed_participants = ?');
      values.push(JSON.stringify(updates.allowedParticipants));
    }
    if (updates.shareMemory !== undefined) {
      setClauses.push('share_memory = ?');
      values.push(updates.shareMemory ? 1 : 0);
    }
    if (updates.shareContext !== undefined) {
      setClauses.push('share_context = ?');
      values.push(updates.shareContext ? 1 : 0);
    }
    if (updates.shareFiles !== undefined) {
      setClauses.push('share_files = ?');
      values.push(updates.shareFiles ? 1 : 0);
    }

    values.push(policyId);
    db.prepare(`UPDATE conversation_policies SET ${setClauses.join(', ')} WHERE policy_id = ?`).run(...values);

    return this.getPolicy(policyId);
  }

  async deletePolicy(policyId: string): Promise<boolean> {
    const db = getDatabase().getDatabase();
    const result = db.prepare('DELETE FROM conversation_policies WHERE policy_id = ?').run(policyId);
    return result.changes > 0;
  }

  // ==================== Helpers ====================

  private rowToPolicy(row: PolicyRow): ConversationPolicy {
    let allowedParticipants: string[] | undefined;
    try {
      allowedParticipants = row.allowed_participants ? JSON.parse(row.allowed_participants) : undefined;
    } catch { /* ignore */ }

    return {
      policyId: row.policy_id,
      scope: row.scope,
      scopeId: row.scope_id ?? undefined,
      allowDM: row.allow_dm === 1,
      allowBroadcast: row.allow_broadcast === 1,
      allowedParticipants,
      shareMemory: row.share_memory === 1,
      shareContext: row.share_context === 1,
      shareFiles: row.share_files === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export default ConversationConstraints;
