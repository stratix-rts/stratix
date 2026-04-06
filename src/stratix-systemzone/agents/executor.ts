import { StratixAgent } from "../../stratix-agent/StratixAgent";
import type { AgentConfig, SoulConfig } from "../../stratix-agent/types";

export function createExecutorAgent(): StratixAgent {
  const config: AgentConfig = {
    agentId: "sz-executor",
    name: "Executor",
    type: "custom",
    provider: "openai",
    model: "claude-sonnet-4-20250514",
    temperature: 0.1,
    maxTokens: 4096,
    maxShortTerm: 10,
    enableLongTerm: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const soul: SoulConfig = {
    identity: "你是代码执行者。你严格按修改方案操作，不做额外改动。",
    personality: "精确、保守、可验证",
    goals: [
      "在沙箱中应用 unified diff 修改",
      "运行测试验证修改正确性",
      "验证通过后提交修改",
    ],
    constraints: [
      "严格按照 modifications 执行，不做额外改动",
      "测试失败时报告失败原因",
      "不做任何假设或猜测",
    ],
  };

  const agent = new StratixAgent(config, soul);

  agent.skills.registerSkills([
    {
      skillId: "apply_diff",
      name: "应用修改",
      description: "在沙箱中应用 unified diff",
      parameters: [
        { name: "workDir", type: "string", required: true, description: "工作目录" },
        { name: "diff", type: "string", required: true, description: "unified diff 内容" },
      ],
      executor: "systemzone",
    },
    {
      skillId: "run_tests",
      name: "运行测试",
      description: "在沙箱中运行测试",
      parameters: [
        { name: "workDir", type: "string", required: true, description: "工作目录" },
      ],
      executor: "systemzone",
    },
    {
      skillId: "create_sandbox",
      name: "创建沙箱",
      description: "创建沙箱环境",
      parameters: [
        { name: "proposalId", type: "string", required: true, description: "提案 ID" },
      ],
      executor: "systemzone",
    },
    {
      skillId: "destroy_sandbox",
      name: "销毁沙箱",
      description: "销毁沙箱环境",
      parameters: [
        { name: "proposalId", type: "string", required: true, description: "提案 ID" },
      ],
      executor: "systemzone",
    },
    {
      skillId: "commit_changes",
      name: "提交修改",
      description: "提交沙箱中的修改",
      parameters: [
        { name: "message", type: "string", required: true, description: "commit message" },
      ],
      executor: "systemzone",
    },
    {
      skillId: "rollback",
      name: "回滚修改",
      description: "回滚已应用的修改",
      parameters: [
        { name: "snapshotId", type: "string", required: true, description: "快照 ID" },
        { name: "workDir", type: "string", required: true, description: "工作目录" },
      ],
      executor: "systemzone",
    },
  ]);

  return agent;
}