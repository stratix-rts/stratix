import { existsSync } from 'fs';
import { writeFile, mkdir } from 'fs/promises';

import { AgentConfig, SoulConfig, MemoryLayers, Session } from '../types';

export interface ExportOptions {
  includeMemory?: boolean;
  includeSessions?: boolean;
  includeSkills?: boolean;
  minify?: boolean;
  format?: 'json' | 'zip';
}

export interface ExportResult {
  success: boolean;
  filePath?: string;
  size?: number;
  error?: string;
}

export class AgentExporter {
  private exportPath: string;

  constructor(exportPath: string = './exports') {
    this.exportPath = exportPath;
  }

  async export(
    agentId: string,
    config: AgentConfig,
    soul: SoulConfig,
    memory?: MemoryLayers,
    sessions?: Session[],
    options: ExportOptions = {}
  ): Promise<ExportResult> {
    const { includeMemory = true, includeSessions = true, minify = false } = options;

    try {
      if (!existsSync(this.exportPath)) {
        await mkdir(this.exportPath, { recursive: true });
      }

      const data: any = {
        agentId,
        exportedAt: new Date().toISOString(),
        version: '1.0',
        config,
        soul,
      };

      if (includeMemory && memory) {
        data.memory = memory;
      }

      if (includeSessions && sessions) {
        data.sessions = sessions;
      }

      const fileName = `${agentId}_${Date.now()}.json`;
      const filePath = `${this.exportPath}/${fileName}`;

      const json = minify ? JSON.stringify(data) : JSON.stringify(data, null, 2);
      await writeFile(filePath, json, 'utf-8');

      return {
        success: true,
        filePath,
        size: json.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Export failed',
      };
    }
  }

  async import(filePath: string): Promise<{
    success: boolean;
    data?: {
      agentId: string;
      config: AgentConfig;
      soul: SoulConfig;
      memory?: MemoryLayers;
      sessions?: Session[];
    };
    error?: string;
  }> {
    try {
      const { readFile } = await import('fs/promises');
      const content = await readFile(filePath, 'utf-8');
      const data = JSON.parse(content);

      return {
        success: true,
        data,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Import failed',
      };
    }
  }
}
