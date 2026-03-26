import { ExecutionContext } from '../types';

/**
 * 安全验证器
 * 在执行危险操作前进行验证
 */
export class SafetyValidator {
  // 危险命令模式（正则表达式）
  private static DANGEROUS_PATTERNS = [
    { pattern: /^rm\s+-rf\s+/, reason: 'Recursive delete (rm -rf)' },
    { pattern: /^dd\s+/, reason: 'Direct disk operation (dd)' },
    { pattern: /\bmkfs\b/, reason: 'Filesystem creation (mkfs)' },
    { pattern: /\bfdisk\b/, reason: 'Disk partitioning (fdisk)' },
    { pattern: /^:?\(\)\s*\{ *:\|:& *\};:/, reason: 'Fork bomb' },
    { pattern: /\bshutdown\b/, reason: 'System shutdown' },
    { pattern: /\breboot\b/, reason: 'System reboot' },
    { pattern: /\binit\s+0\b/, reason: 'System halt (init 0)' },
    { pattern: /\bhalt\b/, reason: 'System halt' },
    { pattern: /\bpoweroff\b/, reason: 'System power off' },
    { pattern: /\bwget\s+.*\|\s*sh/, reason: 'Download and execute (wget | sh)' },
    { pattern: /\bcurl\s+.*\|\s*sh/, reason: 'Download and execute (curl | sh)' },
    { pattern: /\bnc\s+-e\b/, reason: 'Reverse shell (nc -e)' },
    { pattern: /\bkill\s+-9\s+-1/, reason: 'Kill all processes' },
    { pattern: /\bchmod\s+777\b/, reason: 'World-writable permissions (chmod 777)' },
    { pattern: /\bchmod\s+-R\s+777\b/, reason: 'Recursive world-writable permissions' },
    { pattern: /\/etc\/passwd/, reason: 'System file access (/etc/passwd)' },
    { pattern: /\/etc\/shadow/, reason: 'System file access (/etc/shadow)' },
    { pattern: /\.\.\//, reason: 'Path traversal (../)' },
  ];

  // 默认允许的协议
  private static ALLOWED_PROTOCOLS = ['http:', 'https:'];

  /**
   * 验证 bash 命令
   */
  static validateBashCommand(
    command: string,
    context?: ExecutionContext
  ): { valid: boolean; reason?: string } {
    if (!command || typeof command !== 'string') {
      return { valid: false, reason: 'Empty or invalid command' };
    }

    // 检查危险模式
    for (const { pattern, reason } of SafetyValidator.DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return { valid: false, reason: `Dangerous command pattern: ${reason}` };
      }
    }

    // 检查自定义黑名单
    if (context?.blockedCommands && context.blockedCommands.length > 0) {
      const lowerCommand = command.toLowerCase();
      for (const blocked of context.blockedCommands) {
        if (lowerCommand.includes(blocked.toLowerCase())) {
          return { valid: false, reason: `Command contains blocked pattern: ${blocked}` };
        }
      }
    }

    return { valid: true };
  }

  /**
   * 验证文件操作路径
   */
  static validateFilePath(
    filePath: string,
    context?: ExecutionContext
  ): { valid: boolean; reason?: string } {
    if (!filePath || typeof filePath !== 'string') {
      return { valid: false, reason: 'Empty or invalid path' };
    }

    // 规范化路径
    const normalizedPath = filePath.replace(/\/+/g, '/');

    // 检查是否是绝对路径（推荐）
    if (!normalizedPath.startsWith('/')) {
      return { valid: false, reason: 'Only absolute paths are allowed' };
    }

    // 检查路径遍历
    if (normalizedPath.includes('..')) {
      return { valid: false, reason: 'Path traversal not allowed' };
    }

    // 检查危险路径
    const dangerousPaths = [
      '/etc/passwd',
      '/etc/shadow',
      '/etc/sudoers',
      '/root/.ssh',
      '/home',
      '/var/spool/mail'
    ];
    for (const dangerous of dangerousPaths) {
      if (normalizedPath.startsWith(dangerous)) {
        return { valid: false, reason: `Access to system file not allowed: ${filePath}` };
      }
    }

    // 检查路径限制
    if (context?.allowedPaths && context.allowedPaths.length > 0) {
      if (!SafetyValidator.isPathAllowed(normalizedPath, context.allowedPaths)) {
        return { valid: false, reason: `Path not allowed: ${filePath}` };
      }
    }

    return { valid: true };
  }

  /**
   * 验证 URL
   */
  static validateUrl(
    url: string,
    context?: ExecutionContext
  ): { valid: boolean; reason?: string } {
    if (!url || typeof url !== 'string') {
      return { valid: false, reason: 'Empty or invalid URL' };
    }

    try {
      const parsed = new URL(url);

      // 检查协议
      if (!SafetyValidator.ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
        return { valid: false, reason: `Protocol not allowed: ${parsed.protocol}` };
      }

      // 检查域名限制
      if (context?.allowedDomains && context.allowedDomains.length > 0) {
        if (!context.allowedDomains.includes(parsed.hostname)) {
          return { valid: false, reason: `Domain not allowed: ${parsed.hostname}` };
        }
      }

      return { valid: true };
    } catch {
      return { valid: false, reason: 'Invalid URL format' };
    }
  }

  /**
   * 检查路径是否在允许列表中
   */
  private static isPathAllowed(path: string, allowedPaths: string[]): boolean {
    const normalizedPath = path.replace(/\/+/g, '/');
    for (const allowed of allowedPaths) {
      const normalizedAllowed = allowed.replace(/\/+/g, '/');
      if (
        normalizedPath.startsWith(normalizedAllowed + '/') ||
        normalizedPath === normalizedAllowed
      ) {
        return true;
      }
    }
    return false;
  }
}
