import { SkillDefinition } from '../types';

/**
 * 内置通用技能定义
 *
 * 这些技能会在 Agent 初始化时自动注册到 SkillRegistry
 * 支持结构化 Tool Use 模式
 */

/**
 * 文件操作类技能（使用 Node.js fs）
 */
export const FILE_SKILLS: SkillDefinition[] = [
  {
    skillId: 'file_read',
    name: 'file_read',
    description: 'Read the contents of a file from the local filesystem. Use this when you need to see what is inside a file.',
    parameters: [
      {
        name: 'path',
        type: 'string',
        required: true,
        description: 'Absolute path to the file to read'
      },
      {
        name: 'encoding',
        type: 'string',
        required: false,
        default: 'utf-8',
        description: 'File encoding (utf-8, ascii, etc.)'
      }
    ],
    executor: 'fs'
  },
  {
    skillId: 'file_write',
    name: 'file_write',
    description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does. Use with caution as it can overwrite existing content.',
    parameters: [
      {
        name: 'path',
        type: 'string',
        required: true,
        description: 'Absolute path to the file to write'
      },
      {
        name: 'content',
        type: 'string',
        required: true,
        description: 'Content to write to the file'
      },
      {
        name: 'encoding',
        type: 'string',
        required: false,
        default: 'utf-8',
        description: 'File encoding (utf-8, ascii, etc.)'
      }
    ],
    executor: 'fs'
  },
  {
    skillId: 'file_list',
    name: 'file_list',
    description: 'List files and directories in a given path. Returns the names of files and folders in the specified directory.',
    parameters: [
      {
        name: 'path',
        type: 'string',
        required: true,
        description: 'Absolute path to the directory to list'
      }
    ],
    executor: 'fs'
  },
  {
    skillId: 'file_delete',
    name: 'file_delete',
    description: 'Delete a file or directory. This action is irreversible. Use with extreme caution.',
    parameters: [
      {
        name: 'path',
        type: 'string',
        required: true,
        description: 'Absolute path to the file or directory to delete'
      },
      {
        name: 'recursive',
        type: 'boolean',
        required: false,
        default: false,
        description: 'Delete directories recursively (for directories with contents)'
      }
    ],
    executor: 'fs'
  }
];

/**
 * 命令执行类技能（使用 child_process）
 */
export const COMMAND_SKILLS: SkillDefinition[] = [
  {
    skillId: 'bash',
    name: 'bash',
    description: 'Execute a bash or shell command. Use for running scripts, system operations, git commands, npm scripts, or any command-line operations.',
    parameters: [
      {
        name: 'command',
        type: 'string',
        required: true,
        description: 'The shell command to execute'
      },
      {
        name: 'timeout',
        type: 'number',
        required: false,
        default: 30,
        description: 'Timeout in seconds (max 120)'
      },
      {
        name: 'cwd',
        type: 'string',
        required: false,
        description: 'Working directory for the command'
      }
    ],
    executor: 'bash'
  }
];

/**
 * API 调用类技能（使用 fetch）
 */
export const API_SKILLS: SkillDefinition[] = [
  {
    skillId: 'api_call',
    name: 'api_call',
    description: 'Make an HTTP API request to an external service. Use this to interact with REST APIs, fetch data from web services, or send data to external systems.',
    parameters: [
      {
        name: 'url',
        type: 'string',
        required: true,
        description: 'The API endpoint URL'
      },
      {
        name: 'method',
        type: 'string',
        required: false,
        default: 'GET',
        description: 'HTTP method (GET, POST, PUT, DELETE, PATCH)'
      },
      {
        name: 'headers',
        type: 'object',
        required: false,
        description: 'HTTP headers as key-value pairs (e.g., {"Authorization": "Bearer token"})'
      },
      {
        name: 'body',
        type: 'object',
        required: false,
        description: 'Request body (for POST/PUT/PATCH requests)'
      }
    ],
    executor: 'http'
  }
];

/**
 * 计算器类技能（已有，保留）
 */
export const CALCULATOR_SKILLS: SkillDefinition[] = [
  {
    skillId: 'calculator',
    name: 'calculator',
    description: 'Perform mathematical calculations. Use this when you need to compute a result from numbers.',
    parameters: [
      {
        name: 'operation',
        type: 'string',
        required: false,
        description: 'Operation: add, subtract, multiply, divide, pow, sqrt, abs, round, floor, ceil'
      },
      {
        name: 'expression',
        type: 'string',
        required: false,
        description: 'Mathematical expression (alternative to specifying operation, e.g., "2 + 2" or "sqrt(16)")'
      },
      {
        name: 'a',
        type: 'number',
        required: false,
        description: 'First operand (for binary operations)'
      },
      {
        name: 'b',
        type: 'number',
        required: false,
        description: 'Second operand (for binary operations like add, subtract, multiply, divide, pow)'
      }
    ],
    executor: 'builtin'
  }
];

/**
 * 所有内置技能汇总
 */
export const BUILTIN_SKILLS: SkillDefinition[] = [
  ...FILE_SKILLS,
  ...COMMAND_SKILLS,
  ...API_SKILLS,
  ...CALCULATOR_SKILLS
];

/**
 * 技能分类索引（用于快速查找）
 */
export const SKILLS_BY_CATEGORY = {
  file: ['file_read', 'file_write', 'file_list', 'file_delete'],
  command: ['bash'],
  api: ['api_call'],
  calculator: ['calculator']
};
