/**
 * 文件职责：**命令行命令注册表**（@since v3.6，task_113）—— 底栏命令行
 *   （`<strat-command-panel>` 的搜索框）里「命令名 → 命令」的唯一词表与解析器。
 *   纯逻辑：零 DOM、零 IO、零总线依赖（node 环境可直测）。
 *
 * why 独立成文件（不并进 command-catalog.ts）：
 *   command-catalog 是**按钮目录** —— 点一条 = 一条 HudCommand，可用性看当前 WorldState；
 *   本注册表是**命令行目录** —— 敲一串字 = 一次带参调用，可用性只看输入串本身。
 *   两者形态不同、判定口径不同，混在一处必然互相污染（按钮目录不该知道「参数」这回事，
 *   命令行也不该关心当前选中集 —— 那是按钮那侧的事）。
 *
 * why 收进注册表而不是散落在面板里：
 *   底栏命令行此前是**死的** —— 输入框只做模糊搜索、Enter 毫无反应（死功能报告第 2 条）。
 *   命令散写在面板分支里的话，"help 列哪些命令" 与 "实际能敲哪些命令" 必然对不上
 *   （列出来的敲不动 = 又一个假入口）。词表只有一份，两边都从它读。
 *
 * 输入：一行用户输入（纯文本）。
 * 输出：CliParseResult（命中的命令 + 参数 / 未命中）+ 可直接展示的帮助文案。
 *
 * 禁止事项：
 *   1. 触碰 DOM —— 渲染归 command-panel.ts；
 *   2. import core/bus —— 派发一律经注入的 adapter（铁律：HUD 只经 bus-adapter 说话）；
 *   3. 在这里**执行**命令 —— 本文件只认得命令，不执行（执行要 DOM 与总线，属面板的事）；
 *   4. 收录落不到契约面的命令 —— 每条命令都必须落到既有契约
 *      （theme.set / ui.navigate / mission.create / 回放控制器），
 *      落不到的命令不许进表（点不动 / 敲不响的假入口就是这么长出来的）。
 */

/** 命令行的命令 id（稳定标识；与 HudCommand.type 不同名是刻意的 —— 命令与契约变体不是一回事）。 */
export type CliCommandId = 'mission' | 'theme' | 'settings' | 'replay' | 'help';

export interface CliCommandSpec {
  readonly id: CliCommandId;
  /** 命令名（规范写法；大小写不敏感）。 */
  readonly name: string;
  /** 别名（同样能命中；中文别名是底栏那行提示词的老承诺，兑现它）。 */
  readonly aliases?: readonly string[];
  /** 用法串（help 列表与用法提示共用；`<>` 必填、`[]` 可选）。 */
  readonly usage: string;
  /** 一句话说明（help 列表用）。 */
  readonly summary: string;
  /** 参数必填（缺了只给用法提示，不执行）。 */
  readonly argRequired?: boolean;
  /** 参数取值白名单（给了就只认这几个；缺省 = 自由文本参数）。 */
  readonly allowedArgs?: readonly string[];
}

/**
 * 命令表本体。顺序即 help 列表的展示顺序。
 * why 只有这五条：每条都必须**当场看得见效果**，看得见效果才算接上；
 *   其余动作（选单位、确认任务…）仍走按钮 —— 那是按钮的活，不塞进命令行。
 */
export const CLI_COMMANDS: readonly CliCommandSpec[] = Object.freeze([
  {
    id: 'mission',
    name: 'mission',
    aliases: ['任务', '新建任务'],
    usage: 'mission <标题>',
    summary: '新建任务（打开对话框并预填标题）',
    argRequired: true,
  },
  {
    id: 'theme',
    name: 'theme',
    aliases: ['主题', '皮肤'],
    usage: 'theme [default|pixel]',
    summary: '切换皮肤（不带参数就在两套之间切）',
    allowedArgs: ['default', 'pixel'],
  },
  {
    id: 'settings',
    name: 'settings',
    aliases: ['设置'],
    usage: 'settings',
    summary: '打开设置页',
  },
  {
    id: 'replay',
    name: 'replay',
    aliases: ['回放'],
    usage: 'replay',
    summary: '回放今天（网关没连上会给出重试指引）',
  },
  {
    id: 'help',
    name: 'help',
    aliases: ['帮助', '?'],
    usage: 'help',
    summary: '列出全部可用命令',
  },
]);

/** 解析结果的五种形态。做成可判别的联合：调用方按 kind 分支时 spec 自动收窄（不用断言）。 */
export type CliParseResult =
  | {
      readonly kind: 'empty';
      readonly spec: null;
      readonly arg: '';
      readonly input: string;
      readonly suggestion: null;
    }
  | {
      readonly kind: 'matched';
      readonly spec: CliCommandSpec;
      /** 参数（已 trim；白名单参数的命令已小写归一）。 */
      readonly arg: string;
      readonly input: string;
      readonly suggestion: null;
    }
  | {
      readonly kind: 'missing-arg';
      readonly spec: CliCommandSpec;
      readonly arg: string;
      readonly input: string;
      readonly suggestion: null;
    }
  | {
      readonly kind: 'invalid-arg';
      readonly spec: CliCommandSpec;
      readonly arg: string;
      readonly input: string;
      readonly suggestion: null;
    }
  | {
      readonly kind: 'unknown';
      readonly spec: null;
      readonly arg: string;
      /** 输入原样（trim 后），用于回显「没有匹配的命令「xxx」」。 */
      readonly input: string;
      /** 近似候选命令名（null = 没有近似项）。 */
      readonly suggestion: string | null;
    };

/** 名字 → 目录项（规范名与别名都算；大小写不敏感）。 */
function findByName(name: string): CliCommandSpec | undefined {
  const key = name.toLowerCase();
  return CLI_COMMANDS.find(
    (c) => c.name.toLowerCase() === key || (c.aliases ?? []).some((a) => a.toLowerCase() === key)
  );
}

/**
 * 子序列模糊匹配（与 command-catalog 的搜索同一套口径：容忍缩写）。
 * why 自己抄一份而不 import command-catalog：那边是 private 的，
 *   而跨文件 import 一个纯函数只为几行字会让两个目录的耦合凭空长出来。
 */
function subsequenceMatch(haystack: string, needle: string): boolean {
  const text = haystack.toLowerCase();
  const pattern = needle.toLowerCase();
  let p = 0;
  for (let i = 0; i < text.length && p < pattern.length; i += 1) {
    if (text[i] === pattern[p]) p += 1;
  }
  return p === pattern.length;
}

/** 未命中时给个近似候选（"sett" → "settings"）；没有近似就 null（不硬凑）。 */
function suggestFor(name: string): string | null {
  const hit = CLI_COMMANDS.find((c) => subsequenceMatch(c.name, name));
  return hit ? hit.name : null;
}

/**
 * 解析一行命令行输入。
 *
 * 口径：
 *   - 第一个词是命令名（大小写不敏感，别名也算）；
 *   - 剩下的整段是参数（保留内部空格 —— 任务标题可能带空格）；
 *   - 参数必填而没给 → 'missing-arg'（调用方给用法提示，不执行）；
 *   - 参数不在白名单里 → 'invalid-arg'（调用方列出合法值）。
 */
export function parseCliInput(raw: string): CliParseResult {
  const input = raw.trim();
  if (input.length === 0) {
    return { kind: 'empty', spec: null, arg: '', input, suggestion: null };
  }

  const spaceAt = input.search(/\s/);
  const name = spaceAt === -1 ? input : input.slice(0, spaceAt);
  const rawArg = spaceAt === -1 ? '' : input.slice(spaceAt + 1).trim();

  const spec = findByName(name);
  if (!spec) {
    return { kind: 'unknown', spec: null, arg: rawArg, input, suggestion: suggestFor(name) };
  }

  const arg = spec.allowedArgs ? rawArg.toLowerCase() : rawArg;

  if (spec.argRequired === true && arg.length === 0) {
    return { kind: 'missing-arg', spec, arg, input, suggestion: null };
  }
  if (spec.allowedArgs && arg.length > 0 && !spec.allowedArgs.includes(arg)) {
    return { kind: 'invalid-arg', spec, arg, input, suggestion: null };
  }
  return { kind: 'matched', spec, arg, input, suggestion: null };
}

/** 命令名清单（紧凑一串，用于提示行）。 */
export function cliCommandNames(): string {
  return CLI_COMMANDS.map((c) => c.name).join(' · ');
}

/** 用法清单（一行，含参数写法）—— help 与「未匹配」引导共用同一份。 */
export function cliUsageList(): string {
  return CLI_COMMANDS.map((c) => c.usage).join(' · ');
}

/** help 的正文：一行用法 + 每条命令一句说明。 */
export function cliHelpText(): string {
  const lines = CLI_COMMANDS.map((c) => `${c.usage} —— ${c.summary}`);
  return [`可用命令：${cliUsageList()}`, ...lines].join('\n');
}

/**
 * 未匹配输入的回执：**先说没匹配上，再把能敲的命令全列出来**。
 * why 不是干巴巴一句「没有匹配的命令」：死功能报告里最刺眼的就是这句 ——
 *   用户照着提示词敲了一串，得到的只有一堵墙。给得出清单，才叫引导。
 */
export function cliUnknownText(input: string): string {
  const parsed = parseCliInput(input);
  const hint = parsed.suggestion ? `（是不是想输入「${parsed.suggestion}」？）` : '';
  return `没有匹配的命令「${parsed.input}」${hint}\n可用命令：${cliUsageList()}`;
}

/** 用法提示（参数缺失时）：用法串 + 一个能直接抄的例子。 */
export function cliUsageHint(spec: CliCommandSpec): string {
  const example = spec.id === 'mission' ? 'mission 整理战场' : spec.usage;
  return `用法：${spec.usage} —— 例如 ${example}`;
}
