import { access, appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises';
import * as path from 'path';

import { SkillDefinition, SkillExecutor, ExecutionContext } from '../../types';
import { SafetyValidator } from '../SafetyValidator';

export class FileSystemSkillExecutor implements SkillExecutor {
  async execute(
    skill: SkillDefinition,
    params: Record<string, any>,
    context: ExecutionContext
  ): Promise<any> {
    const basePath = context.variables?.basePath || process.cwd();
    const filePath = path.isAbsolute(params.path)
      ? params.path
      : path.join(basePath, params.path);

    // 验证文件路径安全性
    const validation = SafetyValidator.validateFilePath(filePath, context);
    if (!validation.valid) {
      throw new Error(`File path validation failed: ${validation.reason}`);
    }

    const progress = context.progressCallback;

    switch (skill.skillId) {
      case 'file_read': {
        progress?.({ skillId: skill.skillId, stage: 'processing', message: 'Reading file...' });
        if (!(await this.pathExists(filePath))) {
          throw new Error(`File not found: ${filePath}`);
        }
        const content = await readFile(filePath, params.encoding || 'utf-8');
        const preview = content.length > 1000
          ? { type: 'text' as const, content: content.slice(0, 1000) + '...[truncated]' }
          : { type: 'text' as const, content };
        progress?.({ skillId: skill.skillId, stage: 'completed' });
        return { content, path: filePath, preview };
      }

      case 'file_write': {
        progress?.({ skillId: skill.skillId, stage: 'processing', message: 'Writing file...' });
        const dir = path.dirname(filePath);
        if (!(await this.pathExists(dir))) {
          await mkdir(dir, { recursive: true });
        }
        await writeFile(filePath, params.content, params.encoding || 'utf-8');
        progress?.({ skillId: skill.skillId, stage: 'completed' });
        return { success: true, path: filePath };
      }

      case 'file_append': {
        progress?.({ skillId: skill.skillId, stage: 'processing', message: 'Appending to file...' });
        await appendFile(filePath, params.content, params.encoding || 'utf-8');
        progress?.({ skillId: skill.skillId, stage: 'completed' });
        return { success: true, path: filePath };
      }

      case 'file_list': {
        progress?.({ skillId: skill.skillId, stage: 'processing', message: 'Listing directory...' });
        if (!(await this.pathExists(filePath))) {
          throw new Error(`Directory not found: ${filePath}`);
        }
        const files = await readdir(filePath);
        progress?.({ skillId: skill.skillId, stage: 'completed' });
        return { files, path: filePath, preview: { type: 'table', content: `${files.length} items` } };
      }

      case 'file_delete': {
        progress?.({ skillId: skill.skillId, stage: 'processing', message: 'Deleting...' });
        const sandboxRoot = context.variables?.sandboxRoot;
        if (sandboxRoot) {
          const normalizedSandbox = sandboxRoot.replace(/\/+$/, '');
          const normalizedFilePath = filePath.replace(/\/+/g, '/');
          if (normalizedFilePath === normalizedSandbox) {
            throw new Error(`Cannot delete sandbox root: ${filePath}`);
          }
          const parentDir = path.dirname(normalizedSandbox);
          if (normalizedFilePath === parentDir) {
            throw new Error(`Cannot delete parent of sandbox root: ${filePath}`);
          }
          if (params.recursive) {
            console.warn(`[SafetyAudit] Recursive delete: ${filePath} by agent ${context.agentId}`);
          }
        }
        await rm(filePath, { recursive: params.recursive || false });
        progress?.({ skillId: skill.skillId, stage: 'completed' });
        return { success: true, path: filePath };
      }

      case 'file_info': {
        if (!(await this.pathExists(filePath))) {
          throw new Error(`File not found: ${filePath}`);
        }
        const info = await stat(filePath);
        return {
          size: info.size,
          created: info.birthtime,
          modified: info.mtime,
          isDirectory: info.isDirectory(),
          isFile: info.isFile(),
          path: filePath,
          preview: { type: 'json', content: JSON.stringify({ size: info.size, type: info.isDirectory() ? 'directory' : 'file' }) }
        };
      }

      case 'file_mkdir': {
        progress?.({ skillId: skill.skillId, stage: 'processing', message: 'Creating directory...' });
        await mkdir(filePath, { recursive: params.recursive !== false });
        progress?.({ skillId: skill.skillId, stage: 'completed' });
        return { success: true, path: filePath };
      }

      case 'file_rename': {
        progress?.({ skillId: skill.skillId, stage: 'processing', message: 'Renaming...' });
        const oldPath = path.isAbsolute(params.oldPath)
          ? params.oldPath
          : path.join(basePath, params.oldPath);
        const newPath = path.isAbsolute(params.newPath)
          ? params.newPath
          : path.join(basePath, params.newPath);

        const oldValidation = SafetyValidator.validateFilePath(oldPath, context);
        if (!oldValidation.valid) {
          throw new Error(`File path validation failed: ${oldValidation.reason}`);
        }
        const newValidation = SafetyValidator.validateFilePath(newPath, context);
        if (!newValidation.valid) {
          throw new Error(`File path validation failed: ${newValidation.reason}`);
        }

        await rename(oldPath, newPath);
        progress?.({ skillId: skill.skillId, stage: 'completed' });
        return { success: true, oldPath, newPath };
      }

      default:
        throw new Error(`Unknown file operation: ${skill.skillId}`);
    }
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
