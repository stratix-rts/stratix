import { Page, APIRequestContext } from '@playwright/test';

export interface Zone {
  id: string;
  projectId?: string;
  title: string;
  prompt: string;
  status?: string;
  members?: string[];
  files?: ZoneFile[];
  tasks?: ZoneTask[];
}

export interface ZoneFile {
  id: string;
  name: string;
  sourceType: 'local' | 'url';
  source: string;
  fileType?: string;
}

export interface ZoneTask {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'done';
  assignee?: string;
}

export class ZoneApiHelper {
  private baseUrl: string;
  private request: APIRequestContext;

  constructor(private page: Page) {
    this.baseUrl = 'http://127.0.0.1:7524'; // Gateway port
    this.request = page.request;
  }

  // ========== 项目准备 ==========

  /**
   * 确保存在测试项目
   */
  async ensureProject(name: string = '测试项目'): Promise<string> {
    const response = await this.request.get(`${this.baseUrl}/api/projects`);
    const data = await response.json();

    if (data.projects && data.projects.length > 0) {
      return data.projects[0].id; // API 返回 id 不是 projectId
    }

    // 创建新项目
    const createResponse = await this.request.post(`${this.baseUrl}/api/projects`, {
      data: { name, path: `/tmp/${name}` }
    });
    const createData = await createResponse.json();
    return createData.project?.id;
  }

  // ========== Zone CRUD ==========

  async createZone(projectId: string, title: string, prompt: string): Promise<Zone> {
    const response = await this.request.post(`${this.baseUrl}/api/zones`, {
      data: { projectId, title, prompt }
    });
    const data = await response.json();
    if (!response.ok()) {
      throw new Error(`Failed to create zone: ${JSON.stringify(data)}`);
    }
    return data.zone;
  }

  async getZone(zoneId: string): Promise<Zone> {
    const response = await this.request.get(`${this.baseUrl}/api/zones/${zoneId}`);
    const data = await response.json();
    return data.zone;
  }

  async getZonesByProject(projectId: string): Promise<Zone[]> {
    const response = await this.request.get(`${this.baseUrl}/api/zones`, {
      params: { projectId }
    });
    const data = await response.json();
    return data.zones || [];
  }

  async updateZone(zoneId: string, updates: Partial<Zone>): Promise<Zone> {
    const response = await this.request.put(`${this.baseUrl}/api/zones/${zoneId}`, {
      data: updates
    });
    const data = await response.json();
    return data.zone;
  }

  async deleteZone(zoneId: string): Promise<void> {
    await this.request.delete(`${this.baseUrl}/api/zones/${zoneId}`);
  }

  async restoreZone(zoneId: string): Promise<void> {
    await this.request.post(`${this.baseUrl}/api/zones/${zoneId}/restore`);
  }

  async permanentDeleteZone(zoneId: string): Promise<void> {
    await this.request.delete(`${this.baseUrl}/api/zones/${zoneId}/permanent`);
  }

  // ========== Zone 文件 ==========

  async addFile(zoneId: string, file: { name: string; sourceType: string; source: string }): Promise<ZoneFile> {
    const response = await this.request.post(`${this.baseUrl}/api/zones/${zoneId}/files`, {
      data: file
    });
    const data = await response.json();
    return data.file;
  }

  async removeFile(zoneId: string, fileId: string): Promise<void> {
    await this.request.delete(`${this.baseUrl}/api/zones/${zoneId}/files/${fileId}`);
  }

  // ========== Zone 任务 ==========

  async createTask(zoneId: string, title: string, agentId?: string): Promise<ZoneTask> {
    const response = await this.request.post(`${this.baseUrl}/api/zones/${zoneId}/tasks`, {
      data: { title, agentId }
    });
    const data = await response.json();
    return data.task;
  }

  async updateTask(zoneId: string, taskId: string, updates: Partial<ZoneTask>): Promise<ZoneTask> {
    const response = await this.request.put(`${this.baseUrl}/api/zones/${zoneId}/tasks/${taskId}`, {
      data: updates
    });
    const data = await response.json();
    return data.task;
  }

  async deleteTask(zoneId: string, taskId: string): Promise<void> {
    await this.request.delete(`${this.baseUrl}/api/zones/${zoneId}/tasks/${taskId}`);
  }

  async claimTask(zoneId: string, taskId: string, agentId: string): Promise<void> {
    await this.request.post(`${this.baseUrl}/api/zones/${zoneId}/tasks/${taskId}/claim`, {
      data: { agentId }
    });
  }

  // ========== Zone 成员 ==========

  async addMember(zoneId: string, agentId: string): Promise<void> {
    await this.request.post(`${this.baseUrl}/api/zones/${zoneId}/members/${agentId}`);
  }

  async removeMember(zoneId: string, agentId: string): Promise<void> {
    await this.request.delete(`${this.baseUrl}/api/zones/${zoneId}/members/${agentId}`);
  }

  // ========== 回收站 ==========

  async getTrash(projectId: string): Promise<Zone[]> {
    const response = await this.request.get(`${this.baseUrl}/api/zones/${projectId}/trash`);
    const data = await response.json();
    return data.zones || [];
  }

  async emptyTrash(projectId: string): Promise<void> {
    await this.request.delete(`${this.baseUrl}/api/zones/${projectId}/trash`);
  }

  // ========== 搜索 ==========

  async searchZones(keyword: string): Promise<Zone[]> {
    const response = await this.request.get(`${this.baseUrl}/api/zones/search`, {
      params: { keyword }
    });
    const data = await response.json();
    return data.zones || [];
  }
}
