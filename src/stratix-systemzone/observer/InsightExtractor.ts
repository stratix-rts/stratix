// ============================================
// InsightExtractor - LLM 语义提取
// Phase 1: Step 4 - Observer（规则预处理 + LLM）
// ============================================

import { LLMConnector } from '../../stratix-agent/core/LLMConnector';

import type {
  Insight,
  InsightExtractionResult,
  InsightType,
} from '../types';

import type {
  ObserverExtractorConfig,
  ExtractionContext,
  InsightExtractorResult,
} from './types';

// ------------------------------------------------
// 常量定义
// ------------------------------------------------

const DEFAULT_EXTRACTION_PROMPT = `You are an insight extraction assistant. Your task is to analyze user-provided content and extract structured insights.

Given the user's input content, you must extract:
1. **entities**: List of specific entities mentioned (project names, technologies, people, events, etc.)
2. **keywords**: List of important topics, themes, or trends (max 10)
3. **type**: The category of insight - one of:
   - "trend": Emerging patterns or shifts in the industry/technology
   - "opportunity": Potential improvements, new possibilities, or chances to explore
   - "risk": Potential problems, threats, or concerns
   - "pattern": Recurring themes, established practices, or noticed behaviors
4. **summary**: A concise summary of the key insight (1-2 sentences)
5. **confidence**: Your confidence in this extraction, from 0 to 1

IMPORTANT: Return your response as a valid JSON object with these exact fields:
{
  "entities": ["entity1", "entity2"],
  "keywords": ["keyword1", "keyword2"],
  "type": "trend|opportunity|risk|pattern",
  "summary": "Your summary here",
  "confidence": 0.85
}

Only output the JSON, nothing else.`;

const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_TIMEOUT_MS = 30000;

// ------------------------------------------------
// InsightExtractor 类
// ------------------------------------------------

export class InsightExtractor {
  private config: Required<ObserverExtractorConfig>;
  private llm: LLMConnector | null = null;

  constructor(config: ObserverExtractorConfig = {}) {
    this.config = {
      providerId: config.providerId || 'default',
      model: config.model || 'claude-sonnet-4-20250514',
      maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: config.temperature ?? DEFAULT_TEMPERATURE,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
  }

  /**
   * 使用 LLM 提取洞察
   */
  async extract(context: ExtractionContext): Promise<InsightExtractorResult> {
    const { input, preprocessed, zoneId } = context;

    try {
      // Get LLM config from dependencies (lazy initialization)
      if (!this.llm) {
        const llmConfig = await this.getLLMConfig();
        if (!llmConfig) {
          return {
            success: false,
            error: 'No LLM provider configured',
          };
        }

        this.llm = new LLMConnector({
          provider: llmConfig.provider as 'openai' | 'anthropic' | 'ollama' | 'deepseek' | 'qwen',
          model: llmConfig.model,
          apiKey: llmConfig.apiKey,
          baseUrl: llmConfig.baseUrl,
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
        });
      }

      // Build the extraction prompt
      const prompt = this.buildPrompt(preprocessed.cleaned);

      // Call LLM
      const result = await this.callLLM(prompt);

      if (!result.success) {
        return {
          success: false,
          error: result.error,
        };
      }

      // Parse LLM response
      const extractionResult = this.parseLLMResponse(result.content);

      if (!extractionResult) {
        return {
          success: false,
          error: 'Failed to parse LLM response',
        };
      }

      // Create Insight object
      const insight: Insight = {
        id: `insight_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        timestamp: new Date(),
        sourceInputId: input.id,
        type: extractionResult.type,
        content: extractionResult.summary,
        entities: extractionResult.entities,
        confidence: extractionResult.confidence,
        archived: false,
      };

      return {
        success: true,
        insight,
        usage: result.usage,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 提取洞察（从原始文本）
   * 便捷方法，直接输入文本返回 InsightExtractionResult
   */
  async extractFromText(text: string): Promise<InsightExtractionResult> {
    try {
      if (!this.llm) {
        const llmConfig = await this.getLLMConfig();
        if (!llmConfig) {
          return {
            entities: [],
            keywords: [],
            type: 'pattern',
            summary: 'No LLM provider configured',
            confidence: 0,
          };
        }

        this.llm = new LLMConnector({
          provider: llmConfig.provider as 'openai' | 'anthropic' | 'ollama' | 'deepseek' | 'qwen',
          model: llmConfig.model,
          apiKey: llmConfig.apiKey,
          baseUrl: llmConfig.baseUrl,
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
        });
      }

      const prompt = this.buildPrompt(text);
      const result = await this.callLLM(prompt);

      if (!result.success) {
        return {
          entities: [],
          keywords: [],
          type: 'pattern',
          summary: result.error ?? 'Extraction failed',
          confidence: 0,
        };
      }

      const parsed = this.parseLLMResponse(result.content);
      if (!parsed) {
        return {
          entities: [],
          keywords: [],
          type: 'pattern',
          summary: 'Failed to parse response',
          confidence: 0,
        };
      }

      return parsed;
    } catch {
      return {
        entities: [],
        keywords: [],
        type: 'pattern',
        summary: 'Extraction failed',
        confidence: 0,
      };
    }
  }

  /**
   * 获取 LLM 配置
   * 子类可以重写此方法以提供自定义配置
   */
  protected async getLLMConfig(): Promise<{
    provider: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
  } | undefined> {
    // Default: try to use GlobalProviderSettings
    try {
      const module = await import('../../stratix-core/config/GlobalProviderSettings') as {
        default: { getInstance: () => { getDefaultProvider: () => { provider: string; model: string; apiKey?: string; baseUrl?: string } | undefined; getFirstAvailableProvider: () => { provider: string; model: string; apiKey?: string; baseUrl?: string } | undefined } };
      };
      const GlobalProviderSettings = module.default;
      if (GlobalProviderSettings && typeof GlobalProviderSettings.getInstance === 'function') {
        const settings = GlobalProviderSettings.getInstance();
        const provider = settings.getDefaultProvider() ?? settings.getFirstAvailableProvider();

        if (provider) {
          return {
            provider: provider.provider,
            model: provider.model,
            apiKey: provider.apiKey,
            baseUrl: provider.baseUrl,
          };
        }
      }
    } catch {
      // GlobalProviderSettings not available, continue
    }

    // Fallback: check environment variables
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY;
    if (apiKey) {
      return {
        provider: apiKey.startsWith('sk-ant') ? 'anthropic' : 'openai',
        model: apiKey.startsWith('sk-ant')
          ? (process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514')
          : (process.env.OPENAI_MODEL ?? 'gpt-4o'),
        apiKey,
        baseUrl: process.env.LLM_BASE_URL,
      };
    }

    return undefined;
  }

  /**
   * 构建提取 prompt
   */
  private buildPrompt(content: string): string {
    return `${DEFAULT_EXTRACTION_PROMPT}

User content to analyze:
---
${content}
---

Return JSON now:`;
  }

  /**
   * 调用 LLM
   */
  private async callLLM(prompt: string): Promise<{
    success: boolean;
    content?: string;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    error?: string;
  }> {
    if (!this.llm) {
      return { success: false, error: 'LLM not initialized' };
    }

    try {
      const messages = [{ role: 'user' as const, content: prompt }];

      const result = await this.callWithTimeout(
        this.llm.generate(messages),
        this.config.timeoutMs
      );

      if (!result) {
        return { success: false, error: 'LLM call timed out' };
      }

      return {
        success: true,
        content: result.content,
        usage: result.usage ? {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          totalTokens: result.usage.totalTokens,
        } : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 解析 LLM 响应
   */
  private parseLLMResponse(content: string | undefined): InsightExtractionResult | null {
    if (!content) return null;

    try {
      // Try to extract JSON from the response
      const jsonStr = this.extractJson(content);
      const parsed = JSON.parse(jsonStr);

      // Validate and normalize
      const entities = Array.isArray(parsed.entities)
        ? parsed.entities.filter((e: unknown) => typeof e === 'string')
        : [];

      const keywords = Array.isArray(parsed.keywords)
        ? parsed.keywords.filter((k: unknown) => typeof k === 'string').slice(0, 10)
        : [];

      const type = this.normalizeInsightType(parsed.type);
      const summary = typeof parsed.summary === 'string' ? parsed.summary : '';
      const confidence = typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5;

      return {
        entities,
        keywords,
        type,
        summary,
        confidence,
      };
    } catch {
      // Try to salvage something from the content
      return this.fallbackParse(content);
    }
  }

  /**
   * 从 LLM 输出中提取 JSON
   */
  private extractJson(content: string): string {
    // Try direct parse first
    try {
      JSON.parse(content);
      return content;
    } catch {
      // Not direct JSON, try to find JSON block
    }

    // Look for JSON code block
    const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }

    // Look for JSON object
    const objectMatch = content.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return objectMatch[0];
    }

    throw new Error('No JSON found in response');
  }

  /**
   * 标准化洞察类型
   */
  private normalizeInsightType(type: unknown): InsightType {
    if (typeof type === 'string') {
      const normalized = type.toLowerCase().trim();
      if (['trend', 'opportunity', 'risk', 'pattern'].includes(normalized)) {
        return normalized as InsightType;
      }
    }
    return 'pattern';
  }

  /**
   * 回退解析（当 JSON 解析失败时）
   */
  private fallbackParse(content: string): InsightExtractionResult | null {
    // Try to extract what we can using simple heuristics
    const lines = content.split('\n').filter(l => l.trim());

    // Look for type indicator
    let type: InsightType = 'pattern';
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (lower.includes('trend')) type = 'trend';
      else if (lower.includes('opportunit')) type = 'opportunity';
      else if (lower.includes('risk')) type = 'risk';
      else if (lower.includes('pattern')) type = 'pattern';
    }

    // Try to extract entities and keywords from lists
    const entities: string[] = [];
    const keywords: string[] = [];
    let capturing: 'entities' | 'keywords' | null = null;

    for (const line of lines) {
      const lower = line.toLowerCase();
      if (lower.includes('entities') || lower.includes('entity')) {
        capturing = 'entities';
        continue;
      }
      if (lower.includes('keywords') || lower.includes('keyword')) {
        capturing = 'keywords';
        continue;
      }
      if (lower.includes('summary') || lower.includes('type')) {
        capturing = null;
        continue;
      }

      if (capturing === 'entities' && line.includes('-')) {
        const items = line.split('-').slice(1).map(s => s.trim()).filter(Boolean);
        entities.push(...items);
      }
      if (capturing === 'keywords' && line.includes('-')) {
        const items = line.split('-').slice(1).map(s => s.trim()).filter(Boolean);
        keywords.push(...items);
      }
    }

    const summary = lines[lines.length - 1]?.slice(0, 200) ?? 'Unable to parse summary';

    return {
      entities,
      keywords: keywords.slice(0, 10),
      type,
      summary,
      confidence: 0.3, // Low confidence since we had to fallback
    };
  }

  /**
   * 带超时的 Promise 调用
   */
  private async callWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T | null> {
    let timeoutId: NodeJS.Timeout;

    const timeoutPromise = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => resolve(null), timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutId!);
      return result;
    } catch {
      clearTimeout(timeoutId!);
      return null;
    }
  }
}
