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
 * 网络搜索类技能（使用 DuckDuckGo）
 */
export const SEARCH_SKILLS: SkillDefinition[] = [
  {
    skillId: 'web_search',
    name: 'web_search',
    description: 'Search the web using DuckDuckGo. Use this when you need to find current information, facts, or answers from the internet.',
    parameters: [
      {
        name: 'query',
        type: 'string',
        required: true,
        description: 'The search query string'
      },
      {
        name: 'num_results',
        type: 'number',
        required: false,
        default: 5,
        description: 'Number of results to return (default: 5)'
      }
    ],
    executor: 'http'
  }
];

/**
 * 代码执行类技能（沙箱执行）
 */
export const CODE_SKILLS: SkillDefinition[] = [
  {
    skillId: 'code_execute',
    name: 'code_execute',
    description: 'Execute code in a sandboxed environment. Use this when you need to run JavaScript or Python code to perform calculations, data processing, or generate output.',
    parameters: [
      {
        name: 'code',
        type: 'string',
        required: true,
        description: 'The code to execute'
      },
      {
        name: 'language',
        type: 'string',
        required: true,
        description: 'Programming language: javascript or python'
      }
    ],
    executor: 'code_sandbox'
  }
];

/**
 * 文件下载类技能
 */
export const DOWNLOAD_SKILLS: SkillDefinition[] = [
  {
    skillId: 'file_download',
    name: 'file_download',
    description: 'Download a file from a URL and save it to the local filesystem.',
    parameters: [
      {
        name: 'url',
        type: 'string',
        required: true,
        description: 'The URL to download from'
      },
      {
        name: 'path',
        type: 'string',
        required: true,
        description: 'Absolute path where the file will be saved'
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
 * Zone 操作类技能
 */
export const ZONE_SKILLS: SkillDefinition[] = [
  {
    skillId: 'zone_search',
    name: 'zone_search',
    description: 'Search for zones by keyword. Use this to find zones matching certain topics or keywords.',
    parameters: [
      {
        name: 'keyword',
        type: 'string',
        required: true,
        description: 'Keyword to search for in zone titles and prompts'
      },
      {
        name: 'limit',
        type: 'number',
        required: false,
        default: 20,
        description: 'Maximum number of results to return'
      }
    ],
    executor: 'zone'
  },
  {
    skillId: 'zone_move_to',
    name: 'zone_move_to',
    description: 'Move the agent into a specified Zone. Use this when you want to join a Zone to collaborate with other agents there or work on tasks related to that Zone\'s objectives. You should use this when the current task would be better accomplished in a different Zone.',
    parameters: [
      {
        name: 'zoneId',
        type: 'string',
        required: true,
        description: 'The ID of the Zone to move into'
      },
      {
        name: 'reason',
        type: 'string',
        required: false,
        description: 'Optional reason for moving to this Zone (for logging purposes)'
      }
    ],
    executor: 'zone'
  },
  {
    skillId: 'zone_leave',
    name: 'zone_leave',
    description: 'Leave the current Zone you are in. Use this when you want to exit the current Zone and become idle. Do this when you have completed your work in the Zone or need to move to a different one.',
    parameters: [
      {
        name: 'reason',
        type: 'string',
        required: false,
        description: 'Optional reason for leaving (for logging purposes)'
      }
    ],
    executor: 'zone'
  },
  {
    skillId: 'zone_list',
    name: 'zone_list',
    description: 'Get a list of all available Zones and their current status. Use this to find which Zone would be best for a given task, or to see what Zones are available for collaboration.',
    parameters: [],
    executor: 'zone'
  },
  {
    skillId: 'zone_info',
    name: 'zone_info',
    description: 'Get detailed information about a specific Zone including its O/KR (Objective/Key Results), members, and available files.',
    parameters: [
      {
        name: 'zoneId',
        type: 'string',
        required: true,
        description: 'The ID of the Zone to get information about'
      }
    ],
    executor: 'zone'
  }
];

/**
 * 所有内置技能汇总
 */
export const BUILTIN_SKILLS: SkillDefinition[] = [
  ...FILE_SKILLS,
  ...COMMAND_SKILLS,
  ...API_SKILLS,
  ...CALCULATOR_SKILLS,
  ...SEARCH_SKILLS,
  ...CODE_SKILLS,
  ...DOWNLOAD_SKILLS,
  ...ZONE_SKILLS
];

/**
 * 技能分类索引（用于快速查找）
 */
export const SKILLS_BY_CATEGORY = {
  file: ['file_read', 'file_write', 'file_list', 'file_delete'],
  command: ['bash'],
  api: ['api_call', 'web_search', 'file_download'],
  calculator: ['calculator'],
  code: ['code_execute'],
  zone: ['zone_move_to', 'zone_leave', 'zone_list', 'zone_info']
};
