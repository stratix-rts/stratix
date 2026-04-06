import { SkillExecutor, SkillDefinition, ExecutionContext } from "../types";
import { LLMConnector } from "./LLMConnector";
import {
  MODIFICATIONS_SYSTEM_PROMPT,
  MODIFICATIONS_USER_TEMPLATE,
} from "../../stratix-systemzone/agents/strategist";
import {
  GUARDIAN_REVIEW_SYSTEM_PROMPT,
  GUARDIAN_REVIEW_USER_TEMPLATE,
} from "../../stratix-systemzone/agents/guardian";
import { PathProtection } from "../../stratix-systemzone/guardian/PathProtection";
import type { SystemZoneFileModification, SafetyAssessment } from "../../stratix-systemzone/types";

// ------------------------------------------------
// ModificationPlan 类型（本地定义，LLM 输出结构）
// ------------------------------------------------

export interface ModificationPlan {
  title: string;
  description: string;
  reasoning: string;
  modifications: SystemZoneFileModification[];
  riskLevel: "low" | "medium" | "high";
  effortEstimate: "small" | "medium" | "large";
}

// ------------------------------------------------
// SystemZoneSkillExecutor
// ------------------------------------------------

/**
 * SystemZoneSkillExecutor — 调用 System Zone 内部 TS 模块
 *
 * 所有 System Zone Agent 的 skill 都走这个 executor。
 * 模块实例通过 injectModules() 延迟注入。
 */
export class SystemZoneSkillExecutor implements SkillExecutor {
  private modules: {
    observer?: any;
    projectScanner?: any;
    strategistLLM?: any;
    diffApplier?: any;
    testRunner?: any;
    sandbox?: any;
    rollbackManager?: any;
    codeModifier?: any;
    pathProtection?: PathProtection;
  } = {};

  /** 延迟注入模块实例（SystemZoneManager.initialize() 中调用） */
  injectModules(modules: Partial<typeof this.modules>): void {
    Object.assign(this.modules, modules);
  }

  async execute(
    skill: SkillDefinition,
    params: Record<string, any>,
    context: ExecutionContext
  ): Promise<any> {
    switch (skill.skillId) {
      case "observe_input":
        return this.observeInput(params);
      case "scan_project":
        return this.scanProject(params);
      case "generate_modifications":
        return this.generateModifications(params);
      case "validate_diff":
        return this.validateDiff(params);
      case "apply_diff":
        return this.applyDiff(params);
      case "run_tests":
        return this.runTests(params);
      case "create_sandbox":
        return this.createSandbox(params);
      case "destroy_sandbox":
        return this.destroySandbox(params);
      case "rollback":
        return this.rollback(params);
      case "review_modifications":
        return this.reviewModifications(params);
      default:
        throw new Error("Unknown systemzone skill: " + skill.skillId);
    }
  }

  private async observeInput(params: any) {
    if (!this.modules.observer) throw new Error("Observer not injected");
    return this.modules.observer.receiveInput(params.content, params.source, params.type);
  }

  private async scanProject(params: any) {
    if (!this.modules.projectScanner) throw new Error("ProjectScanner not injected");
    return this.modules.projectScanner.scanAll();
  }

  private async generateModifications(params: {
    insights?: Array<{
      id: string;
      content: string;
      type: string;
      confidence?: number;
      category?: string;
      severity?: string;
      details?: string;
      suggestion?: string;
      affectedFiles?: string[];
    }>;
    scanResult?: {
      timestamp: string;
      coverage?: {
        totalStatements: number;
        coveredStatements: number;
        totalBranches: number;
        coveredBranches: number;
        totalFunctions: number;
        coveredFunctions: number;
        totalLines: number;
        coveredLines: number;
        uncoveredFiles?: string[];
        threshold?: number;
      };
      types?: {
        errors: Array<{ file: string; line: number; message: string; code?: number }>;
        warnings: Array<{ file: string; line: number; message: string; code?: number }>;
        success: boolean;
      };
      lint?: {
        errors: Array<{ file: string; line: number; message: string; rule?: string }>;
        warnings: Array<{ file: string; line: number; message: string; rule?: string }>;
        success: boolean;
        fatalErrorCount?: number;
      };
      sizes?: {
        files: Array<{ path: string; lines: number; isLarge: boolean }>;
        threshold?: number;
      };
    };
    targetFile?: string;
  }): Promise<ModificationPlan> {
    // Step 1: Extract inputs
    const insights = params.insights ?? [];
    const scanResult = params.scanResult;
    const targetFile = params.targetFile;

    // Step 2: Build user message
    const insightsText = insights.length > 0
      ? insights.map((i) => `- [${i.type}] ${i.content}${i.suggestion ? `\n  Suggestion: ${i.suggestion}` : ""}${i.affectedFiles?.length ? `\n  Affected: ${i.affectedFiles.join(", ")}` : ""}`).join("\n")
      : "无 insights 数据";

    const scanResultText = scanResult
      ? this.formatScanResult(scanResult)
      : "无 scanResult 数据";

    const targetFileSection = targetFile
      ? `### Target File\n\`${targetFile}\``
      : "### Target File\n未指定，将根据 insights 和 scanResult 自动推断目标文件";

    const userMessage = MODIFICATIONS_USER_TEMPLATE
      .replace("{insights}", insightsText)
      .replace("{scanResult}", scanResultText)
      .replace("{targetFileSection}", targetFileSection);

    // Step 3: Call LLM
    const llm = await this.getLLMConnector();
    if (!llm) {
      throw new Error("generate_modifications: No LLM provider configured");
    }

    const messages = [
      { role: "system" as const, content: MODIFICATIONS_SYSTEM_PROMPT },
      { role: "user" as const, content: userMessage },
    ];

    let result: { content?: string } | null = null;
    try {
      result = await llm.generate(messages);
    } catch (error) {
      throw new Error(`generate_modifications: LLM call failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!result?.content) {
      throw new Error("generate_modifications: LLM returned empty response");
    }

    // Step 4: Parse LLM output
    const plan = this.parseModificationPlan(result.content);

    // Step 5: Validate modifications
    this.validateModifications(plan.modifications);

    // Step 6: Return plan
    return plan;
  }

  /**
   * Format scan result for prompt
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private formatScanResult(scanResult: any): string {
    if (!scanResult) return "无数据";

    const parts: string[] = [];

    if (scanResult.coverage) {
      const cov = scanResult.coverage;
      const pct = cov.totalStatements > 0
        ? ((cov.coveredStatements / cov.totalStatements) * 100).toFixed(1)
        : "0";
      parts.push(`Coverage: ${cov.coveredStatements}/${cov.totalStatements} (${pct}%)`);
      if (cov.uncoveredFiles?.length) {
        parts.push(`Uncovered files: ${cov.uncoveredFiles.slice(0, 5).join(", ")}`);
      }
    }

    if (scanResult.types) {
      parts.push(`Type errors: ${scanResult.types.errors.length}`);
      if (scanResult.types.errors.length > 0) {
        scanResult.types.errors.slice(0, 3).forEach((e: { file: string; line: number; message: string }) => {
          parts.push(`  - ${e.file}:${e.line} ${e.message}`);
        });
      }
    }

    if (scanResult.lint) {
      parts.push(`Lint errors: ${scanResult.lint.errors.length}, warnings: ${scanResult.lint.warnings.length}`);
      if (scanResult.lint.errors.length > 0) {
        scanResult.lint.errors.slice(0, 3).forEach((e: { file: string; line: number; rule?: string; message: string }) => {
          parts.push(`  - ${e.file}:${e.line} [${e.rule ?? "unknown"}] ${e.message}`);
        });
      }
    }

    if (scanResult.sizes) {
      const largeFiles = scanResult.sizes.files.filter((f: { isLarge: boolean }) => f.isLarge);
      if (largeFiles.length > 0) {
        parts.push(`Large files (>${scanResult.sizes.threshold ?? 500} lines): ${largeFiles.length}`);
        largeFiles.slice(0, 3).forEach((f: { path: string; lines: number }) => {
          parts.push(`  - ${f.path}: ${f.lines} lines`);
        });
      }
    }

    return parts.length > 0 ? parts.join("\n") : "扫描完成，无明显问题";
  }

  /**
   * Get LLM connector using the same pattern as StrategistLLMEnhancer
   */
  private async getLLMConnector(): Promise<LLMConnector | null> {
    try {
      const module = await import("../../stratix-core/config/GlobalProviderSettings") as {
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
      if (GlobalProviderSettings && typeof GlobalProviderSettings.getInstance === "function") {
        const settings = GlobalProviderSettings.getInstance();
        const provider = settings.getDefaultProvider() ?? settings.getFirstAvailableProvider();

        if (provider) {
          return new LLMConnector({
            provider: provider.provider as "openai" | "anthropic" | "ollama" | "deepseek" | "qwen",
            model: provider.model,
            apiKey: provider.apiKey,
            baseUrl: provider.baseUrl,
            temperature: 0.4,
            maxTokens: 8192,
          });
        }
      }
    } catch {
      // GlobalProviderSettings not available
    }

    // Fallback: System Zone LLM config
    const szApiKey = process.env.LLM_API_KEY;
    if (szApiKey) {
      return new LLMConnector({
        provider: (process.env.LLM_PROVIDER as "openai" | "anthropic") ?? "openai",
        model: process.env.LLM_MODEL ?? "gpt-4o",
        apiKey: szApiKey,
        baseUrl: process.env.LLM_BASE_URL,
        temperature: 0.4,
        maxTokens: 8192,
      });
    }

    // Fallback: legacy env variables
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY;
    if (apiKey) {
      return new LLMConnector({
        provider: apiKey.startsWith("sk-ant") ? "anthropic" : "openai",
        model: apiKey.startsWith("sk-ant")
          ? (process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514")
          : (process.env.OPENAI_MODEL ?? "gpt-4o"),
        apiKey,
        baseUrl: process.env.LLM_BASE_URL,
        temperature: 0.4,
        maxTokens: 8192,
      });
    }

    return null;
  }

  /**
   * Parse LLM response into ModificationPlan
   */
  private parseModificationPlan(content: string): ModificationPlan {
    const jsonStr = this.extractJson(content);

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new Error("generate_modifications: Failed to parse LLM response as JSON");
    }

    const title = typeof parsed.title === "string" ? parsed.title : "Untitled Plan";
    const description = typeof parsed.description === "string" ? parsed.description : "";
    const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "";
    const modifications = Array.isArray(parsed.modifications) ? parsed.modifications : [];
    const riskLevel = this.normalizeRiskLevel(parsed.riskLevel);
    const effortEstimate = this.normalizeEffortEstimate(parsed.effortEstimate);

    return {
      title,
      description,
      reasoning,
      modifications: modifications as SystemZoneFileModification[],
      riskLevel,
      effortEstimate,
    };
  }

  /**
   * Extract JSON from LLM response (handles markdown code blocks)
   */
  private extractJson(content: string): string {
    // Try direct parse first
    try {
      JSON.parse(content);
      return content;
    } catch {
      // Not direct JSON
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

    throw new Error("generate_modifications: No JSON found in LLM response");
  }

  /**
   * Normalize risk level string
   */
  private normalizeRiskLevel(value: unknown): "low" | "medium" | "high" {
    const normalized = typeof value === "string" ? value.toLowerCase() : "";
    if (normalized === "low" || normalized === "medium" || normalized === "high") {
      return normalized;
    }
    return "medium";
  }

  /**
   * Normalize effort estimate string
   */
  private normalizeEffortEstimate(value: unknown): "small" | "medium" | "large" {
    const normalized = typeof value === "string" ? value.toLowerCase() : "";
    if (normalized === "small" || normalized === "medium" || normalized === "large") {
      return normalized;
    }
    return "medium";
  }

  /**
   * Validate that each modification has required fields
   */
  private validateModifications(modifications: SystemZoneFileModification[]): void {
    for (const mod of modifications) {
      if (!mod.type || !["create", "edit", "delete", "rename"].includes(mod.type)) {
        throw new Error(`generate_modifications: Invalid modification type "${mod.type}" at path "${mod.path}"`);
      }
      if (!mod.path || typeof mod.path !== "string") {
        throw new Error("generate_modifications: modification missing required field: path");
      }
      if (!mod.description || typeof mod.description !== "string") {
        throw new Error(`generate_modifications: modification missing required field: description at path "${mod.path}"`);
      }

      if (mod.type === "edit") {
        if (!mod.diff || typeof mod.diff !== "string") {
          throw new Error(`generate_modifications: edit modification missing required field: diff at path "${mod.path}"`);
        }
      }

      if (mod.type === "create") {
        if (!mod.content || typeof mod.content !== "string") {
          throw new Error(`generate_modifications: create modification missing required field: content at path "${mod.path}"`);
        }
      }
    }
  }

  private async validateDiff(params: any) {
    if (!this.modules.diffApplier) throw new Error("DiffApplier not injected");
    return this.modules.diffApplier.validateDiff(params.workDir, params.diff);
  }

  private async applyDiff(params: any) {
    if (!this.modules.diffApplier) throw new Error("DiffApplier not injected");
    return this.modules.diffApplier.applyDiff(params.workDir, params.diff);
  }

  private async runTests(params: any) {
    if (!this.modules.testRunner) throw new Error("TestRunner not injected");
    return this.modules.testRunner.runTests(params.workDir);
  }

  private async createSandbox(params: any) {
    if (!this.modules.sandbox) throw new Error("Sandbox not injected");
    return this.modules.sandbox.createSandbox(params.proposalId);
  }

  private async destroySandbox(params: any) {
    if (!this.modules.sandbox) throw new Error("Sandbox not injected");
    return this.modules.sandbox.destroySandbox(params.proposalId);
  }

  private async rollback(params: any) {
    if (!this.modules.rollbackManager) throw new Error("RollbackManager not injected");
    return this.modules.rollbackManager.rollback(params.snapshotId, params.workDir);
  }

  private async reviewModifications(params: any): Promise<SafetyAssessment> {
    // Step 1: Extract modifications
    const modifications = params.modifications;
    if (!modifications || !Array.isArray(modifications)) {
      return {
        decision: "rejected",
        riskLevel: "high",
        concerns: ["review_modifications: modifications 参数缺失或格式错误"],
        suggestions: ["提供有效的 SystemZoneFileModification[] 数组"],
        confidence: 1.0,
      };
    }

    // Step 2: Path protection check
    if (this.modules.pathProtection) {
      const forbiddenViolations: string[] = [];
      for (const mod of modifications) {
        const path = mod.path;
        // Use PathProtection's internal pattern matching
        const patterns = this.modules.pathProtection.getForbiddenPaths();
        for (const pattern of patterns) {
          if (this.modules.pathProtection.validateProposal({
            target: { file: path },
          } as any).pathType === 'forbidden') {
            forbiddenViolations.push(`路径 "${path}" 匹配禁止模式 "${pattern}"`);
          }
        }
      }
      if (forbiddenViolations.length > 0) {
        return {
          decision: "rejected",
          riskLevel: "high",
          concerns: forbiddenViolations,
          suggestions: ["移除对禁止路径的修改操作"],
          confidence: 1.0,
        };
      }
    }

    // Step 3: Build modifications summary for prompt
    const modificationsText = modifications.map((m) => {
      const lines = m.diff ? m.diff.split("\n").length : (m.content ? m.content.split("\n").length : 0);
      return `- [${m.type}] ${m.path}${m.description ? `: ${m.description}` : ""} (~${lines} 行)`;
    }).join("\n");

    const userMessage = GUARDIAN_REVIEW_USER_TEMPLATE.replace("{modifications}", modificationsText);

    // Step 4: Call LLM
    const llm = await this.getLLMConnector();
    if (!llm) {
      return {
        decision: "rejected",
        riskLevel: "high",
        concerns: ["review_modifications: No LLM provider configured"],
        suggestions: ["配置 LLM provider 后重试"],
        confidence: 1.0,
      };
    }

    const messages = [
      { role: "system" as const, content: GUARDIAN_REVIEW_SYSTEM_PROMPT.replace("{modifications}", modificationsText) },
      { role: "user" as const, content: userMessage },
    ];

    let result: { content?: string } | null = null;
    try {
      result = await llm.generate(messages);
    } catch (error) {
      return {
        decision: "rejected",
        riskLevel: "high",
        concerns: [`review_modifications: LLM call failed: ${error instanceof Error ? error.message : String(error)}`],
        suggestions: ["检查 LLM 配置和网络连接"],
        confidence: 1.0,
      };
    }

    if (!result?.content) {
      return {
        decision: "rejected",
        riskLevel: "high",
        concerns: ["review_modifications: LLM returned empty response"],
        suggestions: ["重试或检查 LLM 配置"],
        confidence: 1.0,
      };
    }

    // Step 5: Parse LLM response
    const assessment = this.parseSafetyAssessment(result.content);

    // Step 6: High-risk fast-path — rejected / high always returns immediately
    if (assessment.decision === "rejected" || assessment.riskLevel === "high") {
      return assessment;
    }

    // Step 7: Low confidence guard
    if (assessment.confidence < 0.5) {
      return { ...assessment, decision: "rejected" };
    }

    return assessment;
  }

  private parseSafetyAssessment(content: string): SafetyAssessment {
    const jsonStr = this.extractJson(content);

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      // Fallback: return high-risk rejection on parse failure
      return {
        decision: "rejected",
        riskLevel: "high",
        concerns: ["review_modifications: LLM response is not valid JSON"],
        suggestions: ["重试或检查 LLM 输出格式"],
        confidence: 1.0,
      };
    }

    const decision = this.normalizeDecision(parsed.decision);
    const riskLevel = this.normalizeRiskLevel(parsed.riskLevel);
    const concerns = Array.isArray(parsed.concerns) ? parsed.concerns.filter((c) => typeof c === "string") : [];
    const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions.filter((s) => typeof s === "string") : [];
    const confidence = typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5;

    return { decision, riskLevel, concerns, suggestions, confidence };
  }

  private normalizeDecision(value: unknown): "approved" | "rejected" | "conditional" {
    const normalized = typeof value === "string" ? value.toLowerCase() : "";
    if (normalized === "approved" || normalized === "rejected" || normalized === "conditional") {
      return normalized;
    }
    return "conditional";
  }
}