import {
  ChatMessage,
  ToolDefinition,
  ToolCall,
  ToolUseResult,
  ExecutionContext,
  ToolUseLoopResult,
  ToolUseLoopConfig,
  ToolUseRequest
} from '../types';
import { SkillRegistry } from './SkillRegistry';
import { LLMConnector } from './LLMConnector';

/**
 * ToolUseLoop - 处理 LLM → 工具执行 → LLM → ... 的完整循环
 *
 * 当 LLM 决定调用工具时，ToolUseLoop 会：
 * 1. 执行工具调用
 * 2. 将结果返回给 LLM
 * 3. 继续对话直到 LLM 输出纯文本
 */
export class ToolUseLoop {
  private skillRegistry: SkillRegistry;
  private llmConnector: LLMConnector;
  private config: ToolUseLoopConfig;

  constructor(
    skillRegistry: SkillRegistry,
    llmConnector: LLMConnector,
    config: ToolUseLoopConfig = {}
  ) {
    this.skillRegistry = skillRegistry;
    this.llmConnector = llmConnector;
    this.config = {
      maxIterations: config.maxIterations ?? 10,
      maxTotalTime: config.maxTotalTime ?? 120000,  // 2 分钟
      continueOnError: config.continueOnError ?? true,
    };
  }

  /**
   * 执行 Tool Use 循环
   *
   * @param initialMessages 初始消息（包含 system + user）
   * @param tools 可用工具列表
   * @param context 执行上下文
   * @returns 最终结果
   */
  async execute(
    initialMessages: ChatMessage[],
    tools: ToolDefinition[],
    context: ExecutionContext
  ): Promise<ToolUseLoopResult> {
    const startTime = Date.now();
    const toolCalls: ToolCall[] = [];
    let messages = [...initialMessages];

    // 工具名称到 skillId 的映射（统一命名）
    const toolToSkill = new Map<string, string>();
    for (const tool of tools) {
      toolToSkill.set(tool.name, tool.name);  // name 即 skillId
    }

    for (let iteration = 0; iteration < this.config.maxIterations!; iteration++) {
      // 检查超时
      if (Date.now() - startTime > this.config.maxTotalTime!) {
        return {
          finalContent: this.buildTimeoutMessage(iteration),
          toolCalls,
          totalIterations: iteration,
          totalExecutionTime: Date.now() - startTime,
          success: false,
          error: 'Maximum execution time exceeded'
        };
      }

      // 调用 LLM
      const result = await this.llmConnector.generateWithTools(messages, tools);

      // 检查是否有 tool_calls
      if (!result.tool_calls || result.tool_calls.length === 0) {
        // 没有工具调用，返回最终内容
        return {
          finalContent: result.content,
          toolCalls,
          totalIterations: iteration + 1,
          totalExecutionTime: Date.now() - startTime,
          success: true
        };
      }

      // 添加入栈 assistant 消息（包含 tool_calls）
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: result.content || '',
        tool_calls: result.tool_calls
      };
      messages.push(assistantMsg);

      // 执行工具调用
      const toolResults = await this.executeToolCalls(
        result.tool_calls,
        context,
        toolToSkill
      );

      // 添加 tool 结果消息
      const toolResultMsg: ChatMessage = {
        role: 'user',
        content: '',
        tool_results: toolResults.map(tr => ({
          type: 'tool_result' as const,
          tool_use_id: tr.id,
          content: tr.error || JSON.stringify(tr.result)
        }))
      };
      messages.push(toolResultMsg);

      // 记录 tool calls
      toolCalls.push(...toolResults);

      // 如果配置不允许继续且有错误，停止
      if (!this.config.continueOnError && toolResults.some(r => r.error)) {
        break;
      }
    }

    // 达到最大迭代次数，返回当前累积的内容
    return {
      finalContent: this.buildMaxIterationsMessage(toolCalls),
      toolCalls,
      totalIterations: this.config.maxIterations!,
      totalExecutionTime: Date.now() - startTime,
      success: false,
      error: 'Maximum iterations exceeded'
    };
  }

  /**
   * 执行一组工具调用（并行执行）
   */
  private async executeToolCalls(
    toolCalls: ToolUseRequest[],
    context: ExecutionContext,
    toolToSkill: Map<string, string>
  ): Promise<ToolCall[]> {
    // 并行执行所有工具调用
    const results = await Promise.allSettled(
      toolCalls.map(async (tc) => {
        const skillId = toolToSkill.get(tc.name);
        if (!skillId) {
          throw { type: 'unknown_tool', tc };
        }

        const callStart = Date.now();
        const skillResult = await this.skillRegistry.execute(
          skillId,
          tc.input,
          context
        );

        return {
          id: tc.id,
          name: tc.name,
          input: tc.input,
          result: skillResult.result,
          executionTime: Date.now() - callStart
        };
      })
    );

    // 处理结果
    return results.map((result, index) => {
      const tc = toolCalls[index];

      if (result.status === 'rejected') {
        const reason = result.reason;
        if (reason?.type === 'unknown_tool') {
          return {
            id: tc.id,
            name: tc.name,
            input: tc.input,
            error: `Unknown tool: ${tc.name}`,
            executionTime: 0
          };
        }
        return {
          id: tc.id,
          name: tc.name,
          input: tc.input,
          error: reason instanceof Error ? reason.message : 'Unknown error',
          executionTime: 0
        };
      }

      return result.value;
    });
  }

  private buildTimeoutMessage(iteration: number): string {
    return `[Tool execution timed out after ${iteration} iterations. Partial results may be incomplete.]`;
  }

  private buildMaxIterationsMessage(toolCalls: ToolCall[]): string {
    const summary = toolCalls.map(tc =>
      tc.error ? `[${tc.name}: ERROR - ${tc.error}]` : `[${tc.name}: OK]`
    ).join('\n');
    return `[Maximum tool iterations (${this.config.maxIterations}) reached. Tool execution summary:\n${summary}\n]`;
  }
}
