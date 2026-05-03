import { exec, ExecException, ExecOptions } from 'child_process';

import { SkillDefinition, SkillExecutor, ExecutionContext } from '../../types';
import { SafetyValidator } from '../SafetyValidator';

/**
 * Bash 命令执行器
 * 支持执行 shell 命令，带安全验证
 */
export class BashSkillExecutor implements SkillExecutor {
  async execute(
    skill: SkillDefinition,
    params: Record<string, any>,
    context: ExecutionContext
  ): Promise<any> {
    const { command, timeout = 30, cwd } = params;
    const progress = context.progressCallback;

    // 验证命令安全性
    const validation = SafetyValidator.validateBashCommand(command, context);
    if (!validation.valid) {
      throw new Error(`Command blocked: ${validation.reason}`);
    }

    progress?.({ skillId: skill.skillId, stage: 'processing', message: 'Executing command...' });

    // 执行命令
    return new Promise((resolve, reject) => {
      const options: { timeout: number; maxBuffer: number; cwd?: string } = {
        timeout: Math.min((timeout as number), 120) * 1000,
        maxBuffer: 10 * 1024 * 1024
      };
      if (cwd) options.cwd = cwd;

      exec(command, options, (error, stdout, stderr) => {
        if (error) {
          progress?.({ skillId: skill.skillId, stage: 'failed' });
          reject(new Error(`Command failed: ${error.message}\nStderr: ${stderr}`));
          return;
        }
        progress?.({ skillId: skill.skillId, stage: 'completed' });
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          success: true,
          preview: { type: 'text', content: stdout.trim().slice(0, 500) }
        });
      });
    });
  }
}
