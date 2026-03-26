/**
 * SharedSkillStore - 共享技能库管理器
 * 管理所有 Agent 共享的已安装技能
 */

import { SKILLHUB_SKILLS, type SkillHubSkill, type SkillCategory } from '../config/skillHubConfig';

export interface InstalledSkill {
  skillId: string;
  installedAt: number;
  installedBy: string; // agentId or 'user'
}

export interface LearnedSkill {
  skillId: string;
  name: string;
  installedAt: number;
  learnedFrom?: string;
  level: number;
  experience: number;
}

const STORAGE_KEY_INSTALLED = 'stratix_installed_skills';
const STORAGE_KEY_LEARNED = 'stratix_learned_skills';

export class SharedSkillStore {
  private static instance: SharedSkillStore;

  private installedSkills: Map<string, InstalledSkill> = new Map();
  private learnedSkills: Map<string, LearnedSkill> = new Map();

  private constructor() {
    this.loadFromStorage();
  }

  static getInstance(): SharedSkillStore {
    if (!SharedSkillStore.instance) {
      SharedSkillStore.instance = new SharedSkillStore();
    }
    return SharedSkillStore.instance;
  }

  private loadFromStorage(): void {
    try {
      const installedJson = localStorage.getItem(STORAGE_KEY_INSTALLED);
      if (installedJson) {
        const installed: InstalledSkill[] = JSON.parse(installedJson);
        installed.forEach(s => this.installedSkills.set(s.skillId, s));
      }

      const learnedJson = localStorage.getItem(STORAGE_KEY_LEARNED);
      if (learnedJson) {
        const learned: LearnedSkill[] = JSON.parse(learnedJson);
        learned.forEach(s => this.learnedSkills.set(s.skillId, s));
      }
    } catch (e) {
      console.warn('Failed to load skills from storage:', e);
    }
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY_INSTALLED,
        JSON.stringify(Array.from(this.installedSkills.values()))
      );
      localStorage.setItem(
        STORAGE_KEY_LEARNED,
        JSON.stringify(Array.from(this.learnedSkills.values()))
      );
    } catch (e) {
      console.warn('Failed to save skills to storage:', e);
    }
  }

  // 获取所有可用的 SkillHub 技能
  getAvailableSkills(): SkillHubSkill[] {
    return SKILLHUB_SKILLS;
  }

  // 按分类获取技能
  getSkillsByCategory(category: SkillCategory): SkillHubSkill[] {
    return SKILLHUB_SKILLS.filter(s => s.category === category);
  }

  // 搜索技能
  searchSkills(query: string): SkillHubSkill[] {
    const q = query.toLowerCase().trim();
    if (!q) return SKILLHUB_SKILLS;

    return SKILLHUB_SKILLS.filter(skill => {
      const nameMatch = skill.name.toLowerCase().includes(q);
      const descMatch = skill.description.toLowerCase().includes(q);
      const keywordMatch = skill.keywords?.some(k => k.toLowerCase().includes(q));
      return nameMatch || descMatch || keywordMatch;
    });
  }

  // 获取已安装的技能
  getInstalledSkills(): InstalledSkill[] {
    return Array.from(this.installedSkills.values());
  }

  // 获取已安装技能的完整信息
  getInstalledSkillsWithDetails(): (InstalledSkill & SkillHubSkill)[] {
    return this.getInstalledSkills()
      .map(installed => {
        const skillInfo = SKILLHUB_SKILLS.find(s => s.skillId === installed.skillId);
        if (skillInfo) {
          return { ...installed, ...skillInfo };
        }
        return null;
      })
      .filter((s): s is InstalledSkill & SkillHubSkill => s !== null);
  }

  // 获取已学习的技能
  getLearnedSkills(): LearnedSkill[] {
    return Array.from(this.learnedSkills.values());
  }

  // 获取已学习技能的完整信息
  getLearnedSkillsWithDetails(): (LearnedSkill & SkillHubSkill)[] {
    return this.getLearnedSkills()
      .map(learned => {
        const skillInfo = SKILLHUB_SKILLS.find(s => s.skillId === learned.skillId);
        if (skillInfo) {
          return { ...learned, ...skillInfo };
        }
        return null;
      })
      .filter((s): s is LearnedSkill & SkillHubSkill => s !== null);
  }

  // 检查技能是否已安装
  isInstalled(skillId: string): boolean {
    return this.installedSkills.has(skillId);
  }

  // 安装技能
  installSkill(skillId: string, installedBy: string = 'user'): boolean {
    const skill = SKILLHUB_SKILLS.find(s => s.skillId === skillId);
    if (!skill) return false;
    if (this.isInstalled(skillId)) return true;

    this.installedSkills.set(skillId, {
      skillId,
      installedAt: Date.now(),
      installedBy,
    });
    this.saveToStorage();
    return true;
  }

  // 卸载技能
  uninstallSkill(skillId: string): boolean {
    if (!this.isInstalled(skillId)) return false;

    this.installedSkills.delete(skillId);
    this.saveToStorage();
    return true;
  }

  // 学习技能（Agent 工作后获得）
  learnSkill(skillId: string, learnedFrom?: string): boolean {
    const skill = SKILLHUB_SKILLS.find(s => s.skillId === skillId);
    if (!skill) return false;

    const existing = this.learnedSkills.get(skillId);
    if (existing) {
      existing.experience += 10;
      existing.level = Math.min(5, Math.floor(existing.experience / 100) + 1);
      this.saveToStorage();
      return true;
    }

    this.learnedSkills.set(skillId, {
      skillId,
      name: skill.name,
      installedAt: Date.now(),
      learnedFrom,
      level: 1,
      experience: 0,
    });
    this.saveToStorage();
    return true;
  }

  // 添加经验值
  addExperience(skillId: string, exp: number): void {
    const skill = this.learnedSkills.get(skillId);
    if (skill) {
      skill.experience += exp;
      skill.level = Math.min(5, Math.floor(skill.experience / 100) + 1);
      this.saveToStorage();
    }
  }

  // 获取技能信息
  getSkillInfo(skillId: string): SkillHubSkill | undefined {
    return SKILLHUB_SKILLS.find(s => s.skillId === skillId);
  }

  // 批量安装技能
  installSkills(skillIds: string[], installedBy: string = 'user'): number {
    let count = 0;
    for (const id of skillIds) {
      if (this.installSkill(id, installedBy)) count++;
    }
    return count;
  }

  // 获取统计信息
  getStats(): { installed: number; learned: number; available: number } {
    return {
      installed: this.installedSkills.size,
      learned: this.learnedSkills.size,
      available: SKILLHUB_SKILLS.length,
    };
  }

  // 清除所有已安装技能（测试用）
  clearInstalled(): void {
    this.installedSkills.clear();
    this.saveToStorage();
  }

  // 清除所有已学习技能（测试用）
  clearLearned(): void {
    this.learnedSkills.clear();
    this.saveToStorage();
  }
}

export const sharedSkillStore = SharedSkillStore.getInstance();
