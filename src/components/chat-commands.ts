export interface ChatCommand {
  id: string;
  label: string;
  description: string;
  prefix: string;
  action?: (params?: string) => void | Promise<void>;
}

export const CHAT_COMMANDS: readonly ChatCommand[] = [
  {
    id: 'help',
    label: '帮助',
    description: '显示所有可用命令',
    prefix: '/'
  },
  {
    id: 'clear',
    label: '清屏',
    description: '清空当前聊天记录',
    prefix: '/'
  },
  {
    id: 'channels',
    label: '频道',
    description: '查看或切换频道',
    prefix: '/'
  },
  {
    id: 'who',
    label: '在线',
    description: '查看当前在线的 Agent',
    prefix: '/'
  },
  {
    id: 'roll',
    label: '随机',
    description: '随机选择一个在线 Agent',
    prefix: '/'
  }
];

export function filterCommands(query: string): ChatCommand[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [...CHAT_COMMANDS];
  return CHAT_COMMANDS.filter(cmd =>
    cmd.label.toLowerCase().includes(trimmed) ||
    cmd.id.toLowerCase().includes(trimmed)
  );
}
