import { StratixAgent } from "../../stratix-agent/StratixAgent";
import type { AgentConfig, SoulConfig } from "../../stratix-agent/types";

export function createStrategistAgent(): StratixAgent {
  const config: AgentConfig = {
    agentId: "sz-strategist",
    name: "Strategist",
    type: "analyst",
    provider: "openai",
    model: "claude-sonnet-4-20250514",
    temperature: 0.4,
    maxTokens: 8192,
    maxShortTerm: 30,
    enableLongTerm: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const soul: SoulConfig = {
    identity: "你是代码改进策略师。你的任务是基于分析结果生成精确的代码修改方案，输出必须是可以直接执行的结构化修改（unified diff 格式）。",
    personality: "精确、务实、注重可执行性",
    goals: [
      "基于洞察生成可执行的修改方案",
      "输出标准 unified diff 格式的代码修改",
      "确保修改方案最小化、精确、可回滚",
    ],
    constraints: [
      "输出必须是 JSON，包含 modifications 数组",
      "diff 必须是标准 unified diff 格式（可被 git apply 应用）",
      "行号必须精确，上下文行必须和源文件完全一致",
      "一次修改控制在最小范围",
      "不确定的地方标记 TODO",
    ],
  };

  const agent = new StratixAgent(config, soul);

  agent.skills.registerSkills([
    {
      skillId: "scan_project",
      name: "扫描项目",
      description: "运行覆盖率、类型检查、lint、文件大小扫描",
      parameters: [],
      executor: "systemzone",
    },
    {
      skillId: "generate_modifications",
      name: "生成修改方案",
      description: "基于洞察和扫描结果，生成结构化代码修改 JSON（unified diff）",
      parameters: [
        { name: "insights", type: "array", required: true, description: "Observer 的洞察列表" },
        { name: "targetFile", type: "string", required: false, description: "目标文件路径" },
      ],
      executor: "systemzone",
    },
  ]);

  return agent;
}