// ============================================
// CodeModifier.ts - 代码修改引擎
// Phase 2: CodeModifier 代码修改 + 回滚
// ============================================

import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';

import type { FileModification, ModificationPlan } from './types';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  errors: string[];
  warnings: string[];
}

export interface CodeModifierConfig {
  maxFileSizeBytes: number;         // 默认 1MB
  forbiddenPathPatterns: string[];  // 禁止修改的路径模式
  requireBackup: boolean;           // 是否要求备份
}

export const DEFAULT_CODE_MODIFIER_CONFIG: CodeModifierConfig = {
  maxFileSizeBytes: 1024 * 1024,   // 1MB
  forbiddenPathPatterns: [
    '**/stratix-systemzone/executor/**',
    '**/stratix-systemzone/guardian/**',
    '**/stratix-systemzone/permission/**',
  ],
  requireBackup: true,
};

/**
 * CodeModifier - 代码修改引擎
 *
 * 职责：
 * - 应用代码修改（create/edit/delete/rename）
 * - 回滚修改
 * - 校验修改计划合法性
 * - 生成 diff
 */
export class CodeModifier {
  private config: Required<CodeModifierConfig>;

  constructor(config: Partial<CodeModifierConfig> = {}) {
    this.config = {
      maxFileSizeBytes: config.maxFileSizeBytes ?? DEFAULT_CODE_MODIFIER_CONFIG.maxFileSizeBytes,
      forbiddenPathPatterns: config.forbiddenPathPatterns ?? DEFAULT_CODE_MODIFIER_CONFIG.forbiddenPathPatterns,
      requireBackup: config.requireBackup ?? DEFAULT_CODE_MODIFIER_CONFIG.requireBackup,
    };
  }

  /**
   * 校验修改计划合法性
   */
  validateModifications(plan: ModificationPlan): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!plan.modifications || plan.modifications.length === 0) {
      errors.push('Modification plan has no modifications');
      return { valid: false, errors, warnings };
    }

    if (!plan.proposalId) {
      errors.push('Modification plan has no proposalId');
    }

    // 校验每个修改
    for (const mod of plan.modifications) {
      // 路径校验
      const pathValidation = this.validatePath(mod.path);
      if (!pathValidation.valid) {
        errors.push(pathValidation.reason!);
      }
      warnings.push(...pathValidation.warnings);

      // rename 目标路径校验
      if (mod.type === 'rename' && mod.newPath) {
        const newPathValidation = this.validatePath(mod.newPath);
        if (!newPathValidation.valid) {
          errors.push(`Rename target path error: ${newPathValidation.reason}`);
        }
        warnings.push(...newPathValidation.warnings);
      }

      // edit 需要原文件存在
      if (mod.type === 'edit' && !mod.originalContent) {
        warnings.push(`Edit modification for ${mod.path} does not have originalContent for backup`);
      }

      // 内容大小校验
      if (mod.content && mod.content.length > this.config.maxFileSizeBytes) {
        errors.push(`File ${mod.path} content exceeds ${this.config.maxFileSizeBytes} bytes limit`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 校验路径是否安全
   */
  private validatePath(filePath: string): { valid: boolean; reason?: string; warnings: string[] } {
    const warnings: string[] = [];

    // 检查是否匹配禁止路径
    for (const pattern of this.config.forbiddenPathPatterns) {
      if (this.matchesGlob(filePath, pattern)) {
        return {
          valid: false,
          reason: `Path matches forbidden pattern: ${pattern}`,
          warnings,
        };
      }
    }

    return { valid: true, warnings };
  }

  /**
   * 在指定目录应用修改
   */
  async applyModifications(workDir: string, plan: ModificationPlan): Promise<FileModification[]> {
    const results: FileModification[] = [];

    // 先校验
    const validation = this.validateModifications(plan);
    if (!validation.valid) {
      throw new Error(`Invalid modification plan: ${validation.errors.join(', ')}`);
    }

    for (const mod of plan.modifications) {
      const result = await this.applySingleModification(workDir, mod);
      results.push(result);
    }

    return results;
  }

  /**
   * 应用单个修改
   */
  private async applySingleModification(workDir: string, mod: FileModification): Promise<FileModification> {
    const fullPath = path.join(workDir, mod.path);

    switch (mod.type) {
      case 'create':
        return this.createFile(fullPath, mod);

      case 'edit':
        return this.editFile(fullPath, mod);

      case 'delete':
        return this.deleteFile(fullPath, mod);

      case 'rename':
        return this.renameFile(workDir, mod);

      default:
        throw new Error(`Unknown modification type: ${(mod as FileModification).type}`);
    }
  }

  /**
   * 创建文件
   */
  private async createFile(fullPath: string, mod: FileModification): Promise<FileModification> {
    // 确保目录存在
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    // 写入内容
    await fs.writeFile(fullPath, mod.content ?? '', 'utf-8');

    return {
      ...mod,
      originalContent: undefined, // 新建文件无原始内容
    };
  }

  /**
   * 编辑文件
   */
  private async editFile(fullPath: string, mod: FileModification): Promise<FileModification> {
    // 读取原始内容（如果未提供）
    let originalContent = mod.originalContent;
    if (!originalContent) {
      try {
        originalContent = await fs.readFile(fullPath, 'utf-8');
      } catch {
        throw new Error(`Cannot edit non-existent file: ${mod.path}`);
      }
    }

    // 写入新内容
    await fs.writeFile(fullPath, mod.content ?? '', 'utf-8');

    return {
      ...mod,
      originalContent, // 保存原始内容用于回滚
    };
  }

  /**
   * 删除文件
   */
  private async deleteFile(fullPath: string, mod: FileModification): Promise<FileModification> {
    // 读取原始内容（用于回滚）
    let originalContent = mod.originalContent;
    if (!originalContent) {
      try {
        originalContent = await fs.readFile(fullPath, 'utf-8');
      } catch {
        throw new Error(`Cannot delete non-existent file: ${mod.path}`);
      }
    }

    // 删除文件
    await fs.unlink(fullPath);

    return {
      ...mod,
      originalContent,
    };
  }

  /**
   * 重命名文件
   */
  private async renameFile(workDir: string, mod: FileModification): Promise<FileModification> {
    if (!mod.newPath) {
      throw new Error('Rename modification requires newPath');
    }

    const oldFullPath = path.join(workDir, mod.path);
    const newFullPath = path.join(workDir, mod.newPath);

    // 读取原始内容（如果未提供）
    let originalContent = mod.originalContent;
    if (!originalContent) {
      try {
        originalContent = await fs.readFile(oldFullPath, 'utf-8');
      } catch {
        throw new Error(`Cannot rename non-existent file: ${mod.path}`);
      }
    }

    // 确保新目录存在
    await fs.mkdir(path.dirname(newFullPath), { recursive: true });

    // 读取旧文件内容，写入新文件，然后删除旧文件
    const content = await fs.readFile(oldFullPath, 'utf-8');
    await fs.writeFile(newFullPath, content, 'utf-8');
    await fs.unlink(oldFullPath);

    return {
      ...mod,
      originalContent, // 保存原始内容用于回滚
    };
  }

  /**
   * 回滚修改
   */
  async revertModifications(workDir: string, modifications: FileModification[]): Promise<void> {
    // 逆序回滚（后进先出）
    for (const mod of [...modifications].reverse()) {
      await this.revertSingleModification(workDir, mod);
    }
  }

  /**
   * 回滚单个修改
   */
  private async revertSingleModification(workDir: string, mod: FileModification): Promise<void> {
    const fullPath = path.join(workDir, mod.path);

    switch (mod.type) {
      case 'create':
        // 创建的文件，直接删除
        try {
          await fs.unlink(fullPath);
        } catch {
          // 文件可能已被删除，忽略
        }
        break;

      case 'edit':
        // 恢复到原始内容
        if (mod.originalContent !== undefined) {
          await fs.writeFile(fullPath, mod.originalContent, 'utf-8');
        }
        break;

      case 'delete':
        // 恢复删除的文件
        if (mod.originalContent !== undefined) {
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, mod.originalContent, 'utf-8');
        }
        break;

      case 'rename':
        // 恢复旧路径
        if (mod.originalContent !== undefined && mod.newPath) {
          const newFullPath = path.join(workDir, mod.newPath);
          // 新文件内容写回旧路径
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, mod.originalContent, 'utf-8');
          // 删除新文件
          try {
            await fs.unlink(newFullPath);
          } catch {
            // 忽略
          }
        }
        break;
    }
  }

  /**
   * 生成当前修改的 diff
   */
  async generateDiff(workDir: string): Promise<string> {
    try {
      // 使用 git diff 生成差异
      const diff = execSync('git diff --no-color', {
        cwd: workDir,
        encoding: 'utf-8',
        timeout: 30000,
      });
      return diff;
    } catch (error) {
      // git diff 返回非0表示没有差异，这是正常的
      if (error instanceof Error && 'status' in error && (error as any).status === 0) {
        return '';
      }
      // 如果没有 git 仓库，返回空字符串
      if (error instanceof Error && error.message.includes('not a git repository')) {
        return '';
      }
      throw error;
    }
  }

  /**
   * 生成指定文件的 diff
   */
  async generateFileDiff(workDir: string, filePath: string): Promise<string> {
    try {
      const diff = execSync(`git diff --no-color -- "${filePath}"`, {
        cwd: workDir,
        encoding: 'utf-8',
        timeout: 30000,
      });
      return diff;
    } catch (error) {
      if (error instanceof Error && 'status' in error && (error as any).status === 0) {
        return '';
      }
      if (error instanceof Error && error.message.includes('not a git repository')) {
        return '';
      }
      throw error;
    }
  }

  /**
   * 匹配 glob 模式
   */
  private matchesGlob(filePath: string, pattern: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const regex = this.globToRegex(pattern);
    return regex.test(normalizedPath) || regex.test(filePath);
  }

  /**
   * 将 glob 模式转换为正则表达式
   */
  private globToRegex(glob: string): RegExp {
    let result = '';
    let i = 0;
    while (i < glob.length) {
      const ch = glob[i];
      if (ch === '*' && glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          result += '.*';
          i += 3;
        } else {
          result += '.*';
          i += 2;
        }
      } else if (ch === '*') {
        result += '[^/]*';
        i += 1;
      } else if (ch === '?') {
        result += '.';
        i += 1;
      } else if (ch === '.') {
        result += '\\.';
        i += 1;
      } else if (ch === '$') {
        result += '\\$';
        i += 1;
      } else {
        result += ch;
        i += 1;
      }
    }
    return new RegExp(result, 'i');
  }

  /**
   * 获取配置
   */
  getConfig(): Required<CodeModifierConfig> {
    return { ...this.config };
  }
}
