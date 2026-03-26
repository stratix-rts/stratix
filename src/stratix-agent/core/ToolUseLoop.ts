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
import { skillAuditLogger } from './SkillAuditLogger';

/**
 * ToolUseLoop - 处理 LLM → 工具执行 → LLM → ... 的完整循环
 *
 * 当 LLM 决定调用工具时，ToolUseLoop 会：
 * 1. 执行工具调用
 * 2. 将结果返回给 LLM
 * 3. 继续对话直到 LLM 输出纯文本
 *
 * 安全防护机制：
 * - AbortController：支持外部中断
 * - 工具去重：同一工具在同一次循环中不会被多次调用
 * - Token 预算：超过 maxTotalTokens 时停止
 * - 单工具超时：单个工具调用超过 maxToolTimeout 时超时
 * - 断路器：连续失败 maxConsecutiveErrors 次后停止
 * - 自适应回退：同一工具连续调用超过 3 次时记录警告
 */
export class ToolUseLoop {
  private skillRegistry: SkillRegistry;
  private llmConnector: LLMConnector;
  private config: ToolUseLoopConfig;
  private abortController: AbortController;
  private consecutiveErrors: number;
  private toolCallCount: Map<string, number>;
  private totalTokensUsed: number;

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
      maxTotalTokens: config.maxTotalTokens,
      maxToolTimeout: config.maxToolTimeout ?? 30000,  // 30 秒
      maxConsecutiveErrors: config.maxConsecutiveErrors ?? 3,
    };
    this.abortController = new AbortController();
    this.consecutiveErrors = 0;
    this.toolCallCount = new Map();
    this.totalTokensUsed = 0;
  }

  /**
   * 中断正在运行的循环
   */
  abort(): void {
    this.abortController.abort();
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

    // 重置状态
    this.abortController = new AbortController();
    this.consecutiveErrors = 0;
    this.toolCallCount.clear();
    this.totalTokensUsed = 0;

    // 工具名称到 skillId 的映射（统一命名）
    const toolToSkill = new Map<string, string>();
    for (const tool of tools) {
      toolToSkill.set(tool.name, tool.name);  // name 即 skillId
    }

    // 记录本次循环中已调用的工具（用于去重）
    const calledTools = new Set<string>();

    for (let iteration = 0; iteration < this.config.maxIterations!; iteration++) {
      // 检查中断信号
      if (this.abortController.signal.aborted) {
        return {
          finalContent: this.buildAbortMessage(iteration),
          toolCalls,
          totalIterations: iteration,
          totalExecutionTime: Date.now() - startTime,
          success: false,
          error: 'Execution aborted'
        };
      }

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

      // 检查 Token 预算
      if (this.config.maxTotalTokens && this.totalTokensUsed >= this.config.maxTotalTokens) {
        return {
          finalContent: this.buildTokenBudgetMessage(iteration),
          toolCalls,
          totalIterations: iteration,
          totalExecutionTime: Date.now() - startTime,
          success: false,
          error: 'Token budget exceeded'
        };
      }

      // 调用 LLM
      const result = await this.llmConnector.generateWithTools(messages, tools);

      // 累加 token 使用量
      if (result.usage) {
        this.totalTokensUsed += result.usage.totalTokens;
      }

      // 再次检查 Token 预算（LLM 返回后）
      if (this.config.maxTotalTokens && this.totalTokensUsed >= this.config.maxTotalTokens) {
        return {
          finalContent: this.buildTokenBudgetMessage(iteration + 1),
          toolCalls,
          totalIterations: iteration + 1,
          totalExecutionTime: Date.now() - startTime,
          success: false,
          error: 'Token budget exceeded'
        };
      }

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

      // 工具去重：过滤掉已调用的工具
      const uniqueToolCalls = result.tool_calls.filter(tc => {
        if (calledTools.has(tc.name)) {
          console.warn(`[ToolUseLoop] Tool "${tc.name}" already called in this loop, skipping duplicate`);
          return false;
        }
        calledTools.add(tc.name);
        return true;
      });

      // 如果所有工具都被去重过滤掉了，直接继续
      if (uniqueToolCalls.length === 0) {
        const toolResultMsg: ChatMessage = {
          role: 'user',
          content: '',
          tool_results: result.tool_calls.map(tc => ({
            type: 'tool_result' as const,
            tool_use_id: tc.id,
            content: `Tool "${tc.name}" was skipped due to deduplication (already called in this loop)`
          }))
        };
        messages.push(toolResultMsg);
        continue;
      }

      // 执行工具调用
      const toolResults = await this.executeToolCalls(
        uniqueToolCalls,
        context,
        toolToSkill
      );

      // 更新连续错误计数
      const hasErrors = toolResults.some(r => r.error);
      if (hasErrors) {
        this.consecutiveErrors++;
      } else {
        this.consecutiveErrors = 0;
      }

      // 断路器：连续失败超过阈值
      if (this.consecutiveErrors >= this.config.maxConsecutiveErrors!) {
        return {
          finalContent: this.buildCircuitBreakerMessage(iteration + 1),
          toolCalls,
          totalIterations: iteration + 1,
          totalExecutionTime: Date.now() - startTime,
          success: false,
          error: `Circuit breaker triggered: ${this.consecutiveErrors} consecutive errors`
        };
      }

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
   * 执行一组工具调用（并行执行，带超时控制）
   */
  private async executeToolCalls(
    toolCalls: ToolUseRequest[],
    context: ExecutionContext,
    toolToSkill: Map<string, string>
  ): Promise<ToolCall[]> {
    // 并行执行所有工具调用（每个带单独超时）
    const results = await Promise.allSettled(
      toolCalls.map(async (tc) => {
        const skillId = toolToSkill.get(tc.name);
        if (!skillId) {
          throw { type: 'unknown_tool', tc };
        }

        const callStart = Date.now();

        // 使用 Promise.race 实现单工具超时
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Tool "${tc.name}" execution timed out after ${this.config.maxToolTimeout}ms`));
          }, this.config.maxToolTimeout);
        });

        // 工具执行 Promise
        const executePromise = (async () => {
          const skillResult = await this.skillRegistry.execute(
            skillId,
            tc.input,
            context
          );

          // 更新工具调用计数（用于自适应回退警告）
          const count = (this.toolCallCount.get(tc.name) || 0) + 1;
          this.toolCallCount.set(tc.name, count);

          // 自适应回退：同一工具连续调用超过 3 次记录警告
          if (count > 3) {
            console.warn(`[ToolUseLoop] Tool "${tc.name}" has been called ${count} times consecutively. Consider optimizing.`);
          }

          // 审计日志记录
          skillAuditLogger.log({
            agentId: context.agentId,
            skillId: tc.name,
            params: tc.input,
            result: skillResult.result,
            error: skillResult.error,
            executionTime: Date.now() - callStart,
            sessionId: context.sessionId,
          });

          return skillResult;
        })();

        // race 执行
        const skillResult = await Promise.race([executePromise, timeoutPromise]);

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
        // 判断是否是超时错误
        const errorMsg = reason instanceof Error ? reason.message : 'Unknown error';
        const isTimeout = errorMsg.includes('timed out');
        return {
          id: tc.id,
          name: tc.name,
          input: tc.input,
          error: isTimeout ? `[TIMEOUT] ${errorMsg}` : errorMsg,
          executionTime: isTimeout ? this.config.maxToolTimeout! : 0
        };
      }

      return result.value;
    });
  }

  private buildAbortMessage(iteration: number): string {
    return `[Tool execution aborted after ${iteration} iterations. Partial results may be incomplete.]`;
  }

  private buildTimeoutMessage(iteration: number): string {
    return `[Tool execution timed out after ${iteration} iterations. Partial results may be incomplete.]`;
  }

  private buildTokenBudgetMessage(iteration: number): string {
    return `[Token budget exceeded after ${iteration} iterations. Consider optimizing tool usage or increasing maxTotalTokens.]`;
  }

  private buildCircuitBreakerMessage(iteration: number): string {
    return `[Circuit breaker triggered after ${iteration} iterations. Too many consecutive errors. Please check tool configurations.]`;
  }

  private buildMaxIterationsMessage(toolCalls: ToolCall[]): string {
    const summary = toolCalls.map(tc =>
      tc.error ? `[${tc.name}: ERROR - ${tc.error}]` : `[${tc.name}: OK]`
    ).join('\n');
    return `[Maximum tool iterations (${this.config.maxIterations}) reached. Tool execution summary:\n${summary}\n]`;
  }
}
