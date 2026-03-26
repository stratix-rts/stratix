import { ChatMessage, SoulConfig, SkillDefinition } from '../types';

/**
 * 内置工具使用指南
 * 当 LLM 需要使用工具时，应该如何调用和使用
 */
const BUILTIN_TOOLS_GUIDE = `
## 工具使用指南

当您需要完成复杂任务时，可以使用以下工具：

### 文件操作
- **file_read**: 读取文件内容，如 \`file_read({ path: "/absolute/path/to/file.txt" })\`
- **file_write**: 写入内容到文件，如 \`file_write({ path: "/tmp/output.txt", content: "Hello" })\`
- **file_list**: 列出目录内容，如 \`file_list({ path: "/home/user/projects" })\`
- **file_delete**: 删除文件，如 \`file_delete({ path: "/tmp/temp.txt", recursive: false })\`

### 命令执行
- **bash**: 执行 Shell 命令，如 \`bash({ command: "ls -la", timeout: 30, cwd: "/home/user" })\`
  - 支持任意 shell 命令（git, npm, python 等）
  - timeout 单位为秒，最大 120
  - cwd 为可选工作目录

### API 调用
- **api_call**: 发送 HTTP 请求，如 \`api_call({ url: "https://api.example.com/data", method: "GET", headers: { "Authorization": "Bearer token" } })\`
- **web_search**: 使用 DuckDuckGo 搜索，如 \`web_search({ query: "今天的天气", num_results: 5 })\`
- **file_download**: 下载文件，如 \`file_download({ url: "https://example.com/file.zip", path: "/tmp/file.zip" })\`

### 代码执行
- **code_execute**: 在沙箱中执行代码，如 \`code_execute({ code: "Math.sqrt(16)", language: "javascript" })\`
- **calculator**: 数学计算，如 \`calculator({ expression: "2 + 2" })\` 或 \`calculator({ operation: "sqrt", a: 16 })\`

### Zone 操作
- **zone_list**: 列出所有可用 Zone
- **zone_info**: 获取 Zone 详情，如 \`zone_info({ zoneId: "zone-123" })\`
- **zone_move_to**: 移动到指定 Zone，如 \`zone_move_to({ zoneId: "zone-123", reason: "需要处理相关任务" })\`
- **zone_leave**: 离开当前 Zone

### 工具调用规则
1. **按需调用**: 只在需要时调用工具，不要过度使用
2. **提供完整参数**: 确保所有必需参数都已提供
3. **检查结果**: 工具执行后，检查结果并决定下一步
4. **错误处理**: 如果工具执行失败，尝试理解错误并重试或换一种方式
5. **安全优先**: 不要执行危险命令（如 rm -rf /）
`;

/**
 * 危险命令黑名单
 */
const DANGEROUS_COMMANDS_GUIDE = `
### 安全限制

以下命令被禁止执行：
- \`rm -rf /\` 或任何递归删除系统目录的命令
- \`dd\` 直接磁盘操作
- \`mkfs\` 创建文件系统
- \`fork bomb\` 叉形炸弹
- \`wget/curl ... | sh\` 下载并执行
- 访问 \`/etc/passwd\`, \`/etc/shadow\` 等系统敏感文件
- 任何试图获取 root 权限的命令

路径限制：
- 只允许绝对路径（以 \`/\` 开头）
- 不允许路径遍历（\`../\`）
- 工作目录默认限制在 \`process.cwd()\` 和 \`/tmp\`
`;

export class PromptBuilder {
  buildSystemPrompt(
    soul: SoulConfig,
    memoryContext: string,
    skills: SkillDefinition[],
    rules: string[]
  ): ChatMessage[] {
    const parts: string[] = [];

    if (soul.identity) {
      parts.push(`# 身份\n${soul.identity}`);
    }

    if (soul.personality) {
      parts.push(`# 性格\n${soul.personality}`);
    }

    if (soul.goals && soul.goals.length > 0) {
      parts.push(`# 目标\n${soul.goals.map((g, i) => `${i + 1}. ${g}`).join('\n')}`);
    }

    if (soul.constraints && soul.constraints.length > 0) {
      parts.push(`# 约束\n${soul.constraints.map((c, i) => `${i + 1}. ${c}`).join('\n')}`);
    }

    if (soul.speakingStyle) {
      parts.push(`# 说话风格\n${soul.speakingStyle}`);
    }

    if (memoryContext) {
      parts.push(`# 上下文\n${memoryContext}`);
    }

    if (skills.length > 0) {
      // 添加内置工具使用指南
      parts.push(BUILTIN_TOOLS_GUIDE);

      // 添加简要的技能列表
      const skillList = skills.map(s =>
        `- **${s.name}**: ${s.description}`
      ).join('\n');
      parts.push(`# 可用技能\n${skillList}`);

      // 添加安全限制
      parts.push(DANGEROUS_COMMANDS_GUIDE);
    }

    if (rules.length > 0) {
      parts.push(`# 规则\n${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`);
    }

    return [{
      role: 'system',
      content: parts.join('\n\n')
    }];
  }

  buildSkillPrompt(skill: SkillDefinition, params: Record<string, any>): string {
    let prompt = skill.description;

    if (skill.parameters.length > 0) {
      prompt += '\n\n**参数:**\n';
      for (const param of skill.parameters) {
        const value = params[param.name] ?? param.default ?? '(未提供)';
        prompt += `- ${param.name}: ${value}\n`;
      }
    }

    if (skill.prompt) {
      prompt += `\n\n**执行指引:**\n${skill.prompt}`;
    }

    return prompt;
  }
}
