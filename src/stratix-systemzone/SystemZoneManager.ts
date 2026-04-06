// ============================================
// SystemZoneManager.ts - System Zone Agent 架构管理器
// 串联 A1-A5 的所有组件
// ============================================

import { ZoneCoordinator } from '../stratix-orchestration/zone/ZoneCoordinator';
import {
  zoneRepository,
  zoneMemberRepository,
  agentCapabilityRepository,
} from '../stratix-database';
import { SystemZoneSkillExecutor } from '../stratix-agent/core/SystemZoneSkillExecutor';
import { DiffApplier } from './executor/DiffApplier';
import {
  createObserverAgent,
  createStrategistAgent,
  createExecutorAgent,
  createGuardianAgent,
} from './agents';
import type { StratixAgent } from '../stratix-agent/StratixAgent';

const SYSTEM_ZONE_ID = 'system-zone';
const SYSTEM_ZONE_TITLE = 'Stratix 项目自优化';

export class SystemZoneManager {
  private coordinator: ZoneCoordinator | null = null;
  private agents: {
    observer?: StratixAgent;
    strategist?: StratixAgent;
    executor?: StratixAgent;
    guardian?: StratixAgent;
  } = {};
  private skillExecutor: SystemZoneSkillExecutor | null = null;
  private diffApplier: DiffApplier | null = null;

  async initialize(): Promise<void> {
    // 1. 确保 Zone 存在
    const existing = zoneRepository.getZone(SYSTEM_ZONE_ID);
    if (!existing) {
      zoneRepository.createZone(
        'stratix',
        SYSTEM_ZONE_TITLE,
        '持续优化 Stratix 项目的代码质量、测试覆盖率、架构健康度'
      );
    }

    // 2. 创建 ZoneCoordinator
    this.coordinator = await ZoneCoordinator.create(SYSTEM_ZONE_ID);

    // 3. 创建 SystemZoneSkillExecutor（单一实例）
    this.skillExecutor = new SystemZoneSkillExecutor();

    // 4. 创建 DiffApplier
    this.diffApplier = new DiffApplier();

    // 5. 创建 4 个 Agent 实例
    this.agents.observer = createObserverAgent();
    this.agents.strategist = createStrategistAgent();
    this.agents.executor = createExecutorAgent();
    this.agents.guardian = createGuardianAgent();

    // 6. 为每个 Agent 注册 systemzone executor
    const agentList = [
      this.agents.observer,
      this.agents.strategist,
      this.agents.executor,
      this.agents.guardian,
    ];
    for (const agent of agentList) {
      if (agent) {
        agent.skills.registerExecutor('systemzone', this.skillExecutor);
      }
    }

    // 7. 注册为 Zone 成员
    zoneMemberRepository.addMember(SYSTEM_ZONE_ID, 'sz-observer', 'executor');
    zoneMemberRepository.addMember(SYSTEM_ZONE_ID, 'sz-strategist', 'executor');
    zoneMemberRepository.addMember(SYSTEM_ZONE_ID, 'sz-executor', 'executor');
    zoneMemberRepository.addMember(SYSTEM_ZONE_ID, 'sz-guardian', 'executor');

    // 8. 注册能力
    agentCapabilityRepository.setCapability('sz-observer', SYSTEM_ZONE_ID, 'analysis', 5);
    agentCapabilityRepository.setCapability('sz-observer', SYSTEM_ZONE_ID, 'research', 4);
    agentCapabilityRepository.setCapability('sz-strategist', SYSTEM_ZONE_ID, 'analysis', 5);
    agentCapabilityRepository.setCapability('sz-strategist', SYSTEM_ZONE_ID, 'coding', 4);
    agentCapabilityRepository.setCapability('sz-executor', SYSTEM_ZONE_ID, 'coding', 5);
    agentCapabilityRepository.setCapability('sz-guardian', SYSTEM_ZONE_ID, 'analysis', 5);

    // 9. 注入模块到 SkillExecutor
    this.skillExecutor.injectModules({
      diffApplier: this.diffApplier,
    });
  }

  getCoordinator(): ZoneCoordinator | null {
    return this.coordinator;
  }

  getAgents() {
    return this.agents;
  }

  getSkillExecutor(): SystemZoneSkillExecutor | null {
    return this.skillExecutor;
  }

  async shutdown(): Promise<void> {
    this.coordinator = null;
    this.agents = {};
    this.skillExecutor = null;
  }
}
