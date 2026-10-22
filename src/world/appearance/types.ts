/**
 * 文件职责：LPC 合成栈的**类型层** —— 部位元数据、部位选择、合成入参与产出。
 *   来源：git 历史 a9498ae~1:src/stratix-character-creator/types/index.ts（只取合成栈需要的部分）。
 *   任务：.long-run-agent/tasks/task_027.md。
 * 输入/输出：无（纯类型）。
 * 禁止事项：
 *   1. 引入运行时依赖 —— 本文件只声明形状，编译后零 JS；
 *   2. 把渲染细节（画布、Phaser）写进类型 —— 合成栈是"精灵"层，不是"场景"层；
 *   3. 复述 core 的外观模型 —— core 的 CharacterAppearance（category→variant 字典）是**数据面**，
 *      本文件的 PartSelection（itemId + variant）是**渲染面**的展开，两者不是一回事，各留一份。
 *
 * ★ 与 core 的边界：
 *   core/types.ts 的 CharacterAppearance = { bodyType, parts: Record<category, variant> }（薄）；
 *   本文件的 PartMetadata = 单个部位的完整素材元数据（图层路径、动画、版权署名……）（厚）。
 *   core 不该知道厚的部分，渲染侧不该把厚的部分塞回状态里。
 */

import type { BodyType, PartCategory } from './constants';

/** 一个部位的选定结果：哪个素材（itemId）+ 哪个变体（variant，如肤色「light」）。 */
export interface PartSelection {
  /** 素材条目 id（item-metadata.json 的键，如 'body' / 'hair' / 'hat'）。 */
  readonly itemId: string;
  /** 变体名（素材文件名的一部分，如 'light' / 'blue' / 'male'）。 */
  readonly variant: string;
}

/**
 * 单个部位的图层描述。
 * 每个体型一个相对路径（末尾带 '/'），合成器按 `{basePath}{animation}/{variant}.png` 拼图。
 */
export interface PartLayer {
  /** 绘制层级（小 = 在下）。缺省时回落到部位的类别 z 序。 */
  readonly zPos?: number;
  readonly male?: string;
  readonly female?: string;
  readonly teen?: string;
  readonly muscular?: string;
  readonly pregnant?: string;
  readonly child?: string;
  /** 自定义动画目录（LPC 里少数素材带 custom_animation）。 */
  readonly custom_animation?: string;
  /** 是否为遮罩层。 */
  readonly is_mask?: boolean;
}

/** 版权署名信息（LPC 素材要求署名，故合成结果要带出来）。 */
export interface CreditInfo {
  readonly file?: string;
  readonly notes?: string;
  readonly authors: readonly string[];
  readonly licenses: readonly string[];
  readonly urls?: readonly string[];
}

/**
 * 单个部位的素材元数据（对应 item-metadata.json 里的一项）。
 * 字段与素材 JSON 一一对应（多出来的都是 optional，素材没有就不给）。
 */
export interface PartMetadata {
  readonly itemId: string;
  readonly name: string;
  readonly priority?: number | null;
  /** 素材侧的类别名（如 'clothes' / 'hair' / 'boots'），与代码侧的 PartCategory 通过别名表互认。 */
  readonly typeName: string;
  /** 适用体型（素材事实：如某些装备没有 teen 体型）。 */
  readonly required: readonly string[];
  /** 素材支持的动画名（可能是别名，见 constants.ANIM_ALIASES）。 */
  readonly animations: readonly string[];
  readonly variants: readonly string[];
  readonly layers: Readonly<Record<string, PartLayer>>;
  readonly credits: readonly CreditInfo[];
  readonly tags?: readonly string[];
  readonly requiredTags?: readonly string[];
  readonly excludedTags?: readonly string[];
  readonly path?: readonly string[];
  readonly replaceInPath?: Readonly<Record<string, string>>;
  readonly previewRow?: number;
  readonly previewColumn?: number;
  readonly previewXOffset?: number;
  readonly previewYOffset?: number;
  readonly matchBodyColor?: boolean;
}

/** 合成计划里的一项（"哪个素材的哪一帧要画在哪"）—— 合成器内部与调试用。 */
export interface PartInfo {
  readonly itemId: string;
  readonly variant: string;
  /** 最终拼出的图片路径（空串表示素材缺失、该层被跳过）。 */
  readonly spritePath: string;
  readonly zPos: number;
  readonly layerNum: number;
  readonly animation: string;
  /** 该动画在精灵表中的行偏移（像素）。 */
  readonly yPos: number;
}

/** 合成入参。 */
export interface ComposeOptions {
  /** 体型（决定每个部位用哪套图层路径）。 */
  readonly bodyType: BodyType;
  /** 要合成的动画（缺省 = 全部动画）。 */
  readonly animations?: readonly string[];
  /** 合成目标画布（缺省 = 由注入的画布工厂新建一张）。 */
  readonly targetCanvas?: HTMLCanvasElement;
}

/** 合成产出。 */
export interface ComposeResult {
  /** 合成后的精灵表画布（832×3456）。 */
  readonly canvas: HTMLCanvasElement;
  /** 实际参与绘制的层（按 z 序排好，可用于调试与署名汇总）。 */
  readonly parts: readonly PartInfo[];
  /** 参与部位的版权署名（去重后）。 */
  readonly credits: readonly CreditInfo[];
}

/** 部位类别的展示配置（UI 侧用；合成栈本身不关心文案）。 */
export interface PartCategoryConfig {
  readonly category: PartCategory;
  readonly name: string;
  readonly nameEn: string;
  readonly icon: string;
  readonly zPos: number;
  readonly required?: boolean;
}
