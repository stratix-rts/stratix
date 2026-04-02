import { Router, Request, Response } from 'express';

import {
  StratixAgentConfig,
  TemplateConsumptionResponse,
  TemplateEditResponse
} from '../../../stratix-core/stratix-protocol';
import { StratixRequestHelper } from '../../../stratix-core/utils';
import { dataStoreService } from '../../dataStoreService';

const router = Router();
const requestHelper = StratixRequestHelper.getInstance();

/**
 * 转换模板为消费态响应
 * 只包含运行时需要的数据
 */
function toConsumptionResponse(template: StratixAgentConfig): TemplateConsumptionResponse {
  return {
    agentId: template.agentId,
    name: template.name,
    renderedPrompt: template.soul
      ? buildRenderedPrompt(template.soul)
      : '',
    recommendedSkills: template.skills?.map(s => s.skillId) || [],
  };
}

/**
 * 转换模板为编辑态响应
 * 包含所有可编辑字段
 */
function toEditResponse(template: StratixAgentConfig): TemplateEditResponse {
  return {
    ...template,
    renderedPrompt: template.soul
      ? buildRenderedPrompt(template.soul)
      : undefined,
  };
}

/**
 * 构建渲染后的提示词
 */
function buildRenderedPrompt(soul: NonNullable<StratixAgentConfig['soul']>): string {
  const parts: string[] = [];

  if (soul.identity) {
    parts.push(soul.identity);
  }

  if (soul.goals && soul.goals.length > 0) {
    parts.push('## 目标');
    parts.push(soul.goals.map(g => `- ${g}`).join('\n'));
  }

  if (soul.personality) {
    parts.push(`## 性格特点\n${soul.personality}`);
  }

  return parts.join('\n\n');
}

router.get('/list', async (req: Request, res: Response) => {
  try {
    const isEditMode = req.query.edit === 'true';
    const templateLibrary = dataStoreService.getTemplateLibrary();
    const templates = await templateLibrary.getAllTemplates();

    if (isEditMode) {
      res.json(requestHelper.success({
        preset: templates.preset.map(toEditResponse),
        custom: templates.custom.map(toEditResponse),
      }, 'Templates fetched (edit mode)'));
    } else {
      res.json(requestHelper.success({
        preset: templates.preset.map(toConsumptionResponse),
        custom: templates.custom.map(toConsumptionResponse),
      }, 'Templates fetched'));
    }
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.get('/preset', async (req: Request, res: Response) => {
  try {
    const isEditMode = req.query.edit === 'true';
    const templateLibrary = dataStoreService.getTemplateLibrary();
    const preset = templateLibrary.getPresetTemplates();

    if (isEditMode) {
      res.json(requestHelper.success(preset.map(toEditResponse), 'Preset templates fetched (edit mode)'));
    } else {
      res.json(requestHelper.success(preset.map(toConsumptionResponse), 'Preset templates fetched'));
    }
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.get('/custom', async (req: Request, res: Response) => {
  try {
    const isEditMode = req.query.edit === 'true';
    const templateLibrary = dataStoreService.getTemplateLibrary();
    const custom = await templateLibrary.getCustomTemplates();

    if (isEditMode) {
      res.json(requestHelper.success(custom.map(toEditResponse), 'Custom templates fetched (edit mode)'));
    } else {
      res.json(requestHelper.success(custom.map(toConsumptionResponse), 'Custom templates fetched'));
    }
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.get('/:agentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const agentId = String(req.params.agentId);
    const isEditMode = req.query.edit === 'true';
    const templateLibrary = dataStoreService.getTemplateLibrary();

    const preset = templateLibrary.getPresetTemplates().find(t => t.agentId === agentId);
    if (preset) {
      if (isEditMode) {
        res.json(requestHelper.success(toEditResponse(preset), 'Template fetched (edit mode)'));
      } else {
        res.json(requestHelper.success(toConsumptionResponse(preset), 'Template fetched'));
      }
      return;
    }

    const custom = await templateLibrary.getCustomTemplates();
    const customTemplate = custom.find(t => t.agentId === agentId);
    if (customTemplate) {
      if (isEditMode) {
        res.json(requestHelper.success(toEditResponse(customTemplate), 'Template fetched (edit mode)'));
      } else {
        res.json(requestHelper.success(toConsumptionResponse(customTemplate), 'Template fetched'));
      }
      return;
    }

    res.status(404).json(requestHelper.notFound('Template not found'));
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.post('/create', async (req: Request, res: Response) => {
  try {
    const templateLibrary = dataStoreService.getTemplateLibrary();
    const config: StratixAgentConfig = req.body;
    
    if (!config.agentId) {
      config.agentId = templateLibrary.generateId();
    }
    
    await templateLibrary.saveCustomTemplate(config);
    res.json(requestHelper.success(config, 'Template created'));
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.put('/:agentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const agentId = String(req.params.agentId);
    const templateLibrary = dataStoreService.getTemplateLibrary();
    
    const custom = await templateLibrary.getCustomTemplates();
    const existing = custom.find(t => t.agentId === agentId);
    
    if (!existing) {
      res.status(404).json(requestHelper.notFound('Template not found'));
      return;
    }

    const config: StratixAgentConfig = {
      ...req.body,
      agentId
    };
    
    await templateLibrary.saveCustomTemplate(config);
    res.json(requestHelper.success(config, 'Template updated'));
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.delete('/:agentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const agentId = String(req.params.agentId);
    const templateLibrary = dataStoreService.getTemplateLibrary();
    
    const deleted = await templateLibrary.deleteCustomTemplate(agentId);
    if (!deleted) {
      res.status(404).json(requestHelper.notFound('Template not found or is preset'));
      return;
    }
    
    res.json(requestHelper.success(null, 'Template deleted'));
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.post('/apply/:type', async (req: Request, res: Response): Promise<void> => {
  try {
    const type = req.params.type as 'writer' | 'dev' | 'analyst';
    const overrides = req.body;
    
    if (!['writer', 'dev', 'analyst'].includes(type)) {
      res.status(400).json(requestHelper.badRequest('Invalid template type. Use: writer, dev, analyst'));
      return;
    }

    const templateLibrary = dataStoreService.getTemplateLibrary();
    const config = templateLibrary.createFromTemplate(type, overrides?.name);
    
    if (!config) {
      res.status(404).json(requestHelper.notFound('Template not found'));
      return;
    }

    const result: StratixAgentConfig = {
      ...config,
      ...overrides,
      agentId: overrides?.agentId || config.agentId
    };

    res.json(requestHelper.success(result, 'Agent config created from template'));
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.post('/import', async (req: Request, res: Response) => {
  try {
    const { templates } = req.body;
    
    if (!Array.isArray(templates)) {
      res.status(400).json(requestHelper.badRequest('Invalid data format. Expected { templates: [] }'));
      return;
    }

    const templateLibrary = dataStoreService.getTemplateLibrary();
    let imported = 0;
    let skipped = 0;

    for (const template of templates) {
      try {
        const config: StratixAgentConfig = {
          ...template,
          agentId: template.agentId || templateLibrary.generateId()
        };
        await templateLibrary.saveCustomTemplate(config);
        imported++;
      } catch {
        skipped++;
      }
    }

    res.json(requestHelper.success({ imported, skipped }, 'Templates imported'));
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.post('/export', async (req: Request, res: Response) => {
  try {
    const { agentIds } = req.body;
    const templateLibrary = dataStoreService.getTemplateLibrary();
    const allTemplates = await templateLibrary.getAllTemplates();
    
    let exportTemplates: StratixAgentConfig[] = [];
    
    if (agentIds && Array.isArray(agentIds) && agentIds.length > 0) {
      const all = [...allTemplates.preset, ...allTemplates.custom];
      exportTemplates = all.filter(t => agentIds.includes(t.agentId));
    } else {
      exportTemplates = [...allTemplates.preset, ...allTemplates.custom];
    }

    const exportData = {
      version: '1.0.0',
      exportedAt: Date.now(),
      templates: exportTemplates
    };

    res.json(requestHelper.success(exportData, 'Templates exported'));
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

export default router;
