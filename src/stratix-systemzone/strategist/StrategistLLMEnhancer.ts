// ============================================
// StrategistLLMEnhancer.ts - LLM 辅助分析
// Phase 1: Step 5 - Strategist（扫描映射 + LLM 增强）
// ============================================

import * as fs from 'fs';
import * as path from 'path';

import { LLMConnector } from '../../stratix-agent/core/LLMConnector';

import type {
  Proposal,
  ScanResult,
  ProposalType,
} from '../types';

// ------------------------------------------------
// 常量定义
// ------------------------------------------------

const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_TIMEOUT_MS = 30000;

// Enrich prompt for single proposal enhancement
const ENRICH_PROPOSAL_PROMPT = `You are a code review expert with deep knowledge of software engineering best practices, design patterns, and TypeScript/Node.js idioms.

## Proposal to Improve
- **Type**: {proposalType}
- **Title**: {title}
- **Description**: {description}
- **Target file**: {targetFile}

## Source Code Context
\`\`\`{language}
{sourceCode}
\`\`\`

## Your Task
Analyze the source code in the context of the proposal above and generate a concrete improvement plan.

## Output Requirements
Return ONLY a JSON object with this exact structure:
{
  "title": "改进标题（简洁，描述核心改动）",
  "description": "详细描述，包括改了什么、为什么改、预期效果",
  "codeSuggestion": "具体的代码修改建议，包含实际代码片段（可用 ... 表示省略）",
  "riskLevel": "high|medium|low",
  "effortEstimate": "small|medium|large",
  "reasoning": "深入分析：为什么建议这样改，权衡利弊，当前实现的问题根源"
}

## Guidelines
- **Be specific**: 避免泛泛而谈，必须基于源码上下文给出可操作的建议
- **Code suggestion**: 给出具体代码片段或修改方向，不要只说"应该重构"
- **Risk assessment**: high=可能破坏功能，medium=有风险但可控，low=安全改动
- **Effort**: small=1-2处修改，medium=涉及多个文件或较复杂，large=需要大量重写

Only output JSON, nothing else.`;

// Architecture analysis prompt
const ARCHITECTURE_ANALYSIS_PROMPT = `You are a software architecture expert. Analyze the following project scan results and provide architecture-level improvement proposals.

Scan Results Summary:
- Total statements: {totalStatements}, Covered: {coveredStatements} ({coveragePercent}%)
- Type errors: {typeErrorCount}
- Lint errors: {lintErrorCount}, Warnings: {lintWarningCount}
- Large files (>500 lines): {largeFileCount}

Files with issues:
{issueFiles}

Your task:
1. Identify architectural patterns and problems from the scan results
2. Provide high-level improvement proposals (not line-by-line fixes)
3. Focus on:
   - Module organization and coupling
   - Code complexity management
   - Testing strategy gaps
   - Technical debt prioritization
4. Return your response as JSON with this exact format:
{
  "proposals": [
    {
      "type": "improve_architecture|improve_test|improve_code",
      "title": "Short descriptive title",
      "description": "Detailed description of the architectural improvement needed",
      "target": { "file": "optional-file-path", "component": "optional-component" },
      "confidence": 0.0-1.0,
      "cost": 1-10,
      "benefit": 1-10,
      "risk": "low|medium|high"
    }
  ]
}

Only output JSON, nothing else.`;

// ------------------------------------------------
// Types
// ------------------------------------------------

export interface StrategistLLMEnhancerConfig {
  /** LLM provider ID (optional, uses default if not specified) */
  providerId?: string;
  /** LLM 模型 */
  model?: string;
  /** 最大 token 数 */
  maxTokens?: number;
  /** temperature */
  temperature?: number;
  /** 调用超时（毫秒） */
  timeoutMs?: number;
  /** 工作目录 */
  cwd?: string;
}

export interface EnrichResult {
  success: boolean;
  suggestions?: Array<{
    action: string;
    reason: string;
    risk: 'low' | 'medium' | 'high';
    confidence: number;
  }>;
  enhancedDescription?: string;
  estimatedCost?: number;
  estimatedBenefit?: number;
  error?: string;
}

export interface ArchitectureAnalysisResult {
  success: boolean;
  proposals?: Proposal[];
  error?: string;
}

// ------------------------------------------------
// StrategistLLMEnhancer 类
// ------------------------------------------------

export class StrategistLLMEnhancer {
  private config: Required<StrategistLLMEnhancerConfig>;
  private llm: LLMConnector | null = null;

  constructor(config: StrategistLLMEnhancerConfig = {}) {
    this.config = {
      providerId: config.providerId || 'default',
      model: config.model || 'claude-sonnet-4-20250514',
      maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: config.temperature ?? DEFAULT_TEMPERATURE,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      cwd: config.cwd ?? path.resolve(__dirname, '../../../../'),
    };
  }

  // ------------------------------------------------
  // 公共方法
  // ------------------------------------------------

  /**
   * 增强单个提案
   * 读取目标源码，通过 LLM 生成具体改进建议
   */
  async enrichProposal(proposal: Proposal): Promise<Proposal> {
    // If no target file, return as-is
    if (!proposal.target.file) {
      return proposal;
    }

    const sourceCode = await this.readSourceCode(proposal.target.file);
    if (!sourceCode) {
      return proposal;
    }

    const result = await this.callEnrichLLM(proposal, sourceCode);

    if (result.success && result.enhancedDescription) {
      return {
        ...proposal,
        description: result.enhancedDescription,
        selection: {
          ...proposal.selection,
          cost: result.estimatedCost ?? proposal.selection.cost,
          benefit: result.estimatedBenefit ?? proposal.selection.benefit,
          confidence: result.suggestions?.[0]?.confidence ?? proposal.selection.confidence,
        },
      };
    }

    return proposal;
  }

  /**
   * 分析扫描结果，生成架构级改进提案
   */
  async analyzeArchitecture(scanResult: ScanResult): Promise<Proposal[]> {
    const result = await this.callArchitectureLLM(scanResult);

    if (!result.success || !result.proposals) {
      return [];
    }

    return result.proposals.map((p) => ({
      ...p,
      id: `arch_proposal_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date(),
      status: 'pending' as const,
    }));
  }

  /**
   * 批量增强提案
   */
  async enrichProposals(proposals: Proposal[]): Promise<Proposal[]> {
    const enriched: Proposal[] = [];

    for (const proposal of proposals) {
      try {
        const enrichedProposal = await this.enrichProposal(proposal);
        enriched.push(enrichedProposal);
      } catch {
        // On error, keep original proposal
        enriched.push(proposal);
      }
    }

    return enriched;
  }

  // ------------------------------------------------
  // LLM 调用方法
  // ------------------------------------------------

  /**
   * 获取 LLM 配置
   */
  private async getLLMConfig(): Promise<{
    provider: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
  } | undefined> {
    try {
      const module = await import('../../stratix-core/config/GlobalProviderSettings') as {
        default: {
          getInstance: () => {
            getDefaultProvider: () => {
              provider: string;
              model: string;
              apiKey?: string;
              baseUrl?: string;
            } | undefined;
            getFirstAvailableProvider: () => {
              provider: string;
              model: string;
              apiKey?: string;
              baseUrl?: string;
            } | undefined;
          };
        };
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
   * 初始化 LLM 连接
   */
  private async ensureLLM(): Promise<LLMConnector | null> {
    if (!this.llm) {
      const llmConfig = await this.getLLMConfig();
      if (!llmConfig) {
        return null;
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

    return this.llm;
  }

  /**
   * 调用 LLM 增强提案
   */
  private async callEnrichLLM(proposal: Proposal, sourceCode: string): Promise<EnrichResult> {
    const llm = await this.ensureLLM();
    if (!llm) {
      return { success: false, error: 'No LLM provider configured' };
    }

    try {
      const language = this.detectLanguage(proposal.target.file ?? '');
      const prompt = ENRICH_PROPOSAL_PROMPT
        .replace('{proposalType}', proposal.type)
        .replace('{title}', proposal.title)
        .replace('{description}', proposal.description)
        .replace('{targetFile}', proposal.target.file ?? 'unknown')
        .replace('{language}', language)
        .replace('{sourceCode}', this.truncateSource(sourceCode, 3000));

      const messages = [{ role: 'user' as const, content: prompt }];
      const result = await this.callWithTimeout(
        llm.generate(messages),
        this.config.timeoutMs
      );

      if (!result) {
        return { success: false, error: 'LLM call timed out' };
      }

      return this.parseEnrichResponse(result.content);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * 调用 LLM 进行架构分析
   */
  private async callArchitectureLLM(scanResult: ScanResult): Promise<ArchitectureAnalysisResult> {
    const llm = await this.ensureLLM();
    if (!llm) {
      return { success: false, error: 'No LLM provider configured' };
    }

    try {
      const coveragePercent =
        scanResult.coverage.totalStatements > 0
          ? ((scanResult.coverage.coveredStatements / scanResult.coverage.totalStatements) * 100).toFixed(1)
          : '0';

      // Collect issue files
      const issueFiles: string[] = [];
      for (const file of scanResult.types.errors.slice(0, 10)) {
        issueFiles.push(`Type error: ${file.file} (line ${file.line})`);
      }
      for (const file of scanResult.lint.errors.slice(0, 10)) {
        issueFiles.push(`Lint error: ${file.file} (${file.rule})`);
      }
      for (const file of scanResult.sizes.files.filter((f) => f.isLarge).slice(0, 5)) {
        issueFiles.push(`Large file: ${file.path} (${file.lines} lines)`);
      }

      const prompt = ARCHITECTURE_ANALYSIS_PROMPT
        .replace('{totalStatements}', String(scanResult.coverage.totalStatements))
        .replace('{coveredStatements}', String(scanResult.coverage.coveredStatements))
        .replace('{coveragePercent}', coveragePercent)
        .replace('{typeErrorCount}', String(scanResult.types.errors.length))
        .replace('{lintErrorCount}', String(scanResult.lint.errors.length))
        .replace('{lintWarningCount}', String(scanResult.lint.warnings.length))
        .replace('{largeFileCount}', String(scanResult.sizes.files.filter((f) => f.isLarge).length))
        .replace('{issueFiles}', issueFiles.join('\n') || 'No specific issues identified');

      const messages = [{ role: 'user' as const, content: prompt }];
      const result = await this.callWithTimeout(
        llm.generate(messages),
        this.config.timeoutMs
      );

      if (!result) {
        return { success: false, error: 'LLM call timed out' };
      }

      return this.parseArchitectureResponse(result.content);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ------------------------------------------------
  // 解析方法
  // ------------------------------------------------

  /**
   * 解析增强响应
   */
  private parseEnrichResponse(content: string | undefined): EnrichResult {
    if (!content) {
      return { success: false, error: 'Empty LLM response' };
    }

    try {
      const jsonStr = this.extractJson(content);
      const parsed = JSON.parse(jsonStr);

      // Map new format to EnrichResult fields
      const title = parsed.title ?? '';
      const description = parsed.description ?? '';
      const codeSuggestion = parsed.codeSuggestion ?? '';
      const reasoning = parsed.reasoning ?? '';

      // Build enhancedDescription combining title, description and code suggestion
      let enhancedDescription = title ? `## ${title}\n\n${description}` : description;
      if (codeSuggestion) {
        enhancedDescription += `\n\n\`\`\`\n${codeSuggestion}\n\`\`\``;
      }
      if (reasoning) {
        enhancedDescription += `\n\n**Reasoning**: ${reasoning}`;
      }

      // Map effortEstimate to cost (1-10 scale)
      const effortMap: Record<string, number> = { small: 2, medium: 5, large: 8 };
      const estimatedCost = parsed.effortEstimate
        ? effortMap[parsed.effortEstimate.toLowerCase()] ?? 5
        : parsed.estimatedCost;

      // Map riskLevel to benefit inversely (high risk = lower benefit)
      const riskMap: Record<string, number> = { low: 8, medium: 5, high: 3 };
      const estimatedBenefit = parsed.riskLevel
        ? riskMap[parsed.riskLevel.toLowerCase()] ?? 5
        : parsed.estimatedBenefit;

      // Convert riskLevel to confidence
      const confidenceMap: Record<string, number> = { low: 0.9, medium: 0.7, high: 0.5 };
      const confidence = parsed.riskLevel
        ? confidenceMap[parsed.riskLevel.toLowerCase()] ?? 0.7
        : 0.7;

      return {
        success: true,
        suggestions: [{ action: codeSuggestion || title, reason: reasoning, risk: (parsed.riskLevel ?? 'medium') as 'low' | 'medium' | 'high', confidence }],
        enhancedDescription,
        estimatedCost,
        estimatedBenefit,
      };
    } catch {
      return { success: false, error: 'Failed to parse LLM response' };
    }
  }

  /**
   * 解析架构分析响应
   */
  private parseArchitectureResponse(content: string | undefined): ArchitectureAnalysisResult {
    if (!content) {
      return { success: false, error: 'Empty LLM response' };
    }

    try {
      const jsonStr = this.extractJson(content);
      const parsed = JSON.parse(jsonStr);

      const proposals: Proposal[] = (parsed.proposals ?? []).map(
        (p: {
          type: string;
          title: string;
          description: string;
          target?: { file?: string; component?: string };
          confidence: number;
          cost: number;
          benefit: number;
          risk: string;
        }) => ({
          id: `arch_proposal_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          timestamp: new Date(),
          type: this.normalizeProposalType(p.type),
          title: p.title ?? 'Architecture improvement',
          description: p.description ?? '',
          target: {
            file: p.target?.file,
            component: p.target?.component,
          },
          selection: {
            confidence: typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : 0.5,
            cost: typeof p.cost === 'number' ? Math.max(1, Math.min(10, p.cost)) : 5,
            benefit: typeof p.benefit === 'number' ? Math.max(1, Math.min(10, p.benefit)) : 5,
            risk: this.normalizeRisk(p.risk),
          },
          status: 'pending' as const,
        })
      );

      return { success: true, proposals };
    } catch {
      return { success: false, error: 'Failed to parse architecture analysis response' };
    }
  }

  // ------------------------------------------------
  // 工具方法
  // ------------------------------------------------

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
   * 读取源码文件
   */
  private async readSourceCode(filePath: string): Promise<string | null> {
    try {
      // Resolve relative to cwd
      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(this.config.cwd, filePath);

      const content = await fs.promises.readFile(fullPath, 'utf-8');
      return content;
    } catch {
      return null;
    }
  }

  /**
   * 截断源码（避免超出 token 限制）
   */
  private truncateSource(source: string, maxChars: number): string {
    if (source.length <= maxChars) {
      return source;
    }
    return source.slice(0, maxChars) + '\n\n... (truncated)';
  }

  /**
   * 检测语言
   */
  private detectLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const languageMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.vue': 'vue',
      '.py': 'python',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java',
    };
    return languageMap[ext] ?? 'typescript';
  }

  /**
   * 标准化提案类型
   */
  private normalizeProposalType(type: string): ProposalType {
    const typeMap: Record<string, ProposalType> = {
      improve_code: 'improve_code',
      improve_test: 'improve_test',
      improve_architecture: 'improve_architecture',
      new_zone: 'new_zone',
    };
    return typeMap[type.toLowerCase()] ?? 'improve_code';
  }

  /**
   * 标准化风险等级
   */
  private normalizeRisk(risk: string): 'low' | 'medium' | 'high' {
    const normalized = risk?.toLowerCase();
    if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
      return normalized;
    }
    return 'medium';
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