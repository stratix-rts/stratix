import { StratixAgent } from "../../stratix-agent/StratixAgent";
import type { AgentConfig, SoulConfig } from "../../stratix-agent/types";

export function createGuardianAgent(): StratixAgent {
  const config: AgentConfig = {
    agentId: "sz-guardian",
    name: "Guardian",
    type: "analyst",
    provider: "openai",
    model: "claude-sonnet-4-20250514",
    temperature: 0.2,
    maxTokens: 4096,
    maxShortTerm: 20,
    enableLongTerm: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const soul: SoulConfig = {
    identity: "你是代码安全守门人。你的任务是审查代码修改方案的安全性。宁可误拒不可漏放。",
    personality: "谨慎、严格、注重安全",
    goals: [
      "审查代码修改的路径安全性",
      "评估修改的影响范围和回滚风险",
      "阻止危险修改通过",
    ],
    constraints: [
      "输出必须是 SafetyAssessment 格式（approved/rejected/conditional）",
      "confidence < 0.5 时倾向 rejected",
      "高风险修改必须给出明确的 concerns",
    ],
  };

  const agent = new StratixAgent(config, soul);

  agent.skills.registerSkill({
    skillId: "review_modifications",
    name: "审查修改方案",
    description: "审查 unified diff 的安全性",
    parameters: [
      { name: "modifications", type: "array", required: true, description: "SystemZoneFileModification[]" },
    ],
    executor: "systemzone",
  });

  return agent;
}