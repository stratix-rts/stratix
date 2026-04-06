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

const DEFAULT_EXTRACTION_PROMPT = `You are a project architecture analysis expert. Your task is to perform deep, multi-dimensional analysis of project-related content and produce structured insights.

Analyze the user's input content thoroughly across the following dimensions:
- Architecture patterns and design decisions
- Security considerations and potential vulnerabilities
- Performance bottlenecks and optimization opportunities
- Code quality issues and technical debt
- Dependency management and external library usage
- Team collaboration patterns and workflow efficiency
- Risk factors that could impact project success
- Emerging trends or opportunities in the project context

You must output a single valid JSON object with these exact fields:

{
  "summary": "One-sentence concise summary of the key finding (max 50 characters)",
  "category": "The primary category of this insight - one of: architecture|security|performance|quality|dependency",
  "severity": "The severity level of this insight - one of: critical|warning|info",
  "details": "Detailed analysis of the finding in 2-3 sentences, explaining what it is, why it matters, and what the evidence suggests",
  "suggestion": "Concrete, actionable improvement suggestion addressing this finding",
  "affectedFiles": ["List of relevant file paths mentioned or inferred in the content (e.g. src/utils/auth.ts, config/database.yml). Empty array if no files are identified."],
  "entities": ["List of specific entities mentioned: project names, technologies, frameworks, tools, people, services, modules. Max 10."],
  "keywords": ["List of important topics, themes, or trends. Max 10."],
  "type": "The insight type - one of: trend|opportunity|risk|pattern",
  "confidence": "Your confidence in this analysis, a number between 0 and 1 (e.g. 0.85)"
}

Output format constraints:
- Output ONLY the JSON object, no markdown fences, no explanations, no preamble
- The JSON must be valid and parseable
- All string values must be properly escaped
- Use lowercase for enum values (category, severity, type)`;

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
        severity: extractionResult.severity,
        category: extractionResult.category,
        details: extractionResult.details,
        suggestion: extractionResult.suggestion,
        affectedFiles: extractionResult.affectedFiles,
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
            category: 'quality',
            severity: 'info',
            affectedFiles: [],
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
          category: 'quality',
          severity: 'info',
          affectedFiles: [],
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
          category: 'quality',
          severity: 'info',
          affectedFiles: [],
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
        category: 'quality',
        severity: 'info',
        affectedFiles: [],
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

    // Fallback 1: System Zone LLM config (set via UI panel)
    const szApiKey = process.env.LLM_API_KEY;
    if (szApiKey) {
      return {
        provider: (process.env.LLM_PROVIDER as 'openai' | 'anthropic') ?? 'openai',
        model: process.env.LLM_MODEL ?? 'gpt-4o',
        apiKey: szApiKey,
        baseUrl: process.env.LLM_BASE_URL,
      };
    }

    // Fallback 2: legacy env variables
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

      // Validate and normalize entities
      const entities = Array.isArray(parsed.entities)
        ? parsed.entities.filter((e: unknown) => typeof e === 'string')
        : [];

      // Validate and normalize keywords
      const keywords = Array.isArray(parsed.keywords)
        ? parsed.keywords.filter((k: unknown) => typeof k === 'string').slice(0, 10)
        : [];

      // Validate type
      const type = this.normalizeInsightType(parsed.type);

      // Validate category (only accept valid values, default to "quality")
      const category = this.normalizeCategory(parsed.category);

      // Validate severity (only accept valid values, default to "info")
      const severity = this.normalizeSeverity(parsed.severity);

      // Basic fields
      const summary = typeof parsed.summary === 'string' ? parsed.summary : '';
      const details = typeof parsed.details === 'string' ? parsed.details : undefined;
      const suggestion = typeof parsed.suggestion === 'string' ? parsed.suggestion : undefined;

      // Validate affectedFiles
      const affectedFiles = Array.isArray(parsed.affectedFiles)
        ? parsed.affectedFiles.filter((f: unknown) => typeof f === 'string')
        : [];

      // Validate confidence
      const confidence = typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5;

      return {
        entities,
        keywords,
        type,
        summary,
        confidence,
        category,
        severity,
        details,
        suggestion,
        affectedFiles,
      };
    } catch {
      // Try to salvage something from the content
      return this.fallbackParse(content);
    }
  }

  /**
   * 标准化 category
   */
  private normalizeCategory(category: unknown): 'architecture' | 'security' | 'performance' | 'quality' | 'dependency' | undefined {
    if (typeof category === 'string') {
      const normalized = category.toLowerCase().trim();
      if (['architecture', 'security', 'performance', 'quality', 'dependency'].includes(normalized)) {
        return normalized as 'architecture' | 'security' | 'performance' | 'quality' | 'dependency';
      }
    }
    return 'quality';
  }

  /**
   * 标准化 severity
   */
  private normalizeSeverity(severity: unknown): 'critical' | 'warning' | 'info' | undefined {
    if (typeof severity === 'string') {
      const normalized = severity.toLowerCase().trim();
      if (['critical', 'warning', 'info'].includes(normalized)) {
        return normalized as 'critical' | 'warning' | 'info';
      }
    }
    return 'info';
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
      // Default values for new fields (not available in fallback)
      category: 'quality',
      severity: 'info',
      affectedFiles: [],
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
      // Suppress unhandled rejection if timeout fires and promise later rejects
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      promise.catch(() => {});
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutId!);
      return result;
    } catch {
      clearTimeout(timeoutId!);
      return null;
    }
  }
}
