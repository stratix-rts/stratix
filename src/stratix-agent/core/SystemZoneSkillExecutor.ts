import { SkillExecutor, SkillDefinition, ExecutionContext } from "../types";

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

  private async generateModifications(params: any) {
    throw new Error("generate_modifications: not yet implemented (Phase B1)");
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

  private async reviewModifications(params: any) {
    throw new Error("review_modifications: not yet implemented (Phase B3)");
  }
}