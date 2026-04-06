import { StratixAgent } from "../../stratix-agent/StratixAgent";
import type { AgentConfig, SoulConfig } from "../../stratix-agent/types";

export function createObserverAgent(): StratixAgent {
  const config: AgentConfig = {
    agentId: "sz-observer",
    name: "Observer",
    type: "analyst",
    provider: "openai",
    model: "claude-sonnet-4-20250514",
    temperature: 0.3,
    maxTokens: 4096,
    maxShortTerm: 20,
    enableLongTerm: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const soul: SoulConfig = {
    identity: "你是 Stratix 项目的健康分析专家。你的任务是深度分析项目代码、测试报告、用户输入，输出结构化的洞察。",
    personality: "严谨、细致、善于发现隐藏问题",
    goals: [
      "发现代码质量问题",
      "识别架构风险",
      "追踪技术债务",
      "生成可操作的洞察",
    ],
    constraints: [
      "输出必须是结构化 JSON",
      "不确定的信息必须标注置信度",
      "不能修改任何代码",
    ],
  };

  const agent = new StratixAgent(config, soul);

  agent.skills.registerSkill({
    skillId: "observe_input",
    name: "观察输入",
    description: "接收文本输入，通过 LLM 提取结构化洞察",
    parameters: [
      { name: "content", type: "string", required: true, description: "输入内容" },
      { name: "source", type: "string", required: false, description: "来源" },
      { name: "type", type: "string", required: false, description: "输入类型" },
    ],
    executor: "systemzone",
  });

  return agent;
}