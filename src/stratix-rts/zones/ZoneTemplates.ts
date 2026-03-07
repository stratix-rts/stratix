import type { ZoneTemplate } from './ZoneTemplateManager';
import type { TaskZoneType } from './TaskZone';
import type { ZoneStatus } from './BaseZone';

export class ZoneTemplates {
  static readonly GRID_2X2: ZoneTemplate = {
    id: 'grid-2x2',
    name: 'Grid 2x2',
    description: 'A 2x2 grid layout for organizing multiple task zones in a compact arrangement',
    category: 'grid',
    positions: [
      { x: 0, y: 0, width: 150, height: 150, name: 'Zone 1', taskType: 'general' },
      { x: 160, y: 0, width: 150, height: 150, name: 'Zone 2', taskType: 'general' },
      { x: 0, y: 160, width: 150, height: 150, name: 'Zone 3', taskType: 'general' },
      { x: 160, y: 160, width: 150, height: 150, name: 'Zone 4', taskType: 'general' }
    ],
    metadata: {
      author: 'Stratix',
      version: '1.0',
      tags: ['grid', 'compact', 'multi-task'],
      createdAt: Date.now()
    }
  };

  static readonly GRID_3X3: ZoneTemplate = {
    id: 'grid-3x3',
    name: 'Grid 3x3',
    description: 'A 3x3 grid layout for organizing multiple task zones with better task separation',
    category: 'grid',
    positions: [
      { x: 0, y: 0, width: 120, height: 120, name: 'Zone 1', taskType: 'general' },
      { x: 130, y: 0, width: 120, height: 120, name: 'Zone 2', taskType: 'general' },
      { x: 260, y: 0, width: 120, height: 120, name: 'Zone 3', taskType: 'general' },
      { x: 0, y: 130, width: 120, height: 120, name: 'Zone 4', taskType: 'general' },
      { x: 130, y: 130, width: 120, height: 120, name: 'Zone 5', taskType: 'general' },
      { x: 260, y: 130, width: 120, height: 120, name: 'Zone 6', taskType: 'general' },
      { x: 0, y: 260, width: 120, height: 120, name: 'Zone 7', taskType: 'general' },
      { x: 130, y: 260, width: 120, height: 120, name: 'Zone 8', taskType: 'general' },
      { x: 260, y: 260, width: 120, height: 120, name: 'Zone 9', taskType: 'general' }
    ],
    metadata: {
      author: 'Stratix',
      version: '1.0',
      tags: ['grid', 'multi-task', 'organized'],
      createdAt: Date.now()
    }
  };

  static readonly HORIZONTAL_LINE: ZoneTemplate = {
    id: 'horizontal-line',
    name: 'Horizontal Line',
    description: 'A horizontal line layout for sequential task processing',
    category: 'linear',
    positions: [
      { x: 0, y: 0, width: 150, height: 120, name: 'Task 1', taskType: 'general' },
      { x: 160, y: 0, width: 150, height: 120, name: 'Task 2', taskType: 'general' },
      { x: 320, y: 0, width: 150, height: 120, name: 'Task 3', taskType: 'general' },
      { x: 480, y: 0, width: 150, height: 120, name: 'Task 4', taskType: 'general' }
    ],
    metadata: {
      author: 'Stratix',
      version: '1.0',
      tags: ['linear', 'horizontal', 'sequential'],
      createdAt: Date.now()
    }
  };

  static readonly VERTICAL_LINE: ZoneTemplate = {
    id: 'vertical-line',
    name: 'Vertical Line',
    description: 'A vertical line layout for sequential task processing',
    category: 'linear',
    positions: [
      { x: 0, y: 0, width: 120, height: 100, name: 'Task 1', taskType: 'general' },
      { x: 0, y: 110, width: 120, height: 100, name: 'Task 2', taskType: 'general' },
      { x: 0, y: 220, width: 120, height: 100, name: 'Task 3', taskType: 'general' },
      { x: 0, y: 330, width: 120, height: 100, name: 'Task 4', taskType: 'general' }
    ],
    metadata: {
      author: 'Stratix',
      version: '1.0',
      tags: ['linear', 'vertical', 'sequential'],
      createdAt: Date.now()
    }
  };

  static readonly CIRCULAR_SMALL: ZoneTemplate = {
    id: 'circular-small',
    name: 'Circular (4 zones)',
    description: 'A circular layout with 4 zones arranged around a center point',
    category: 'circular',
    positions: [
      { x: 100, y: 0, width: 120, height: 120, name: 'North', taskType: 'general' },
      { x: 200, y: 100, width: 120, height: 120, name: 'East', taskType: 'general' },
      { x: 100, y: 200, width: 120, height: 120, name: 'South', taskType: 'general' },
      { x: 0, y: 100, width: 120, height: 120, name: 'West', taskType: 'general' }
    ],
    metadata: {
      author: 'Stratix',
      version: '1.0',
      tags: ['circular', 'radial', 'centered'],
      createdAt: Date.now()
    }
  };

  static readonly CIRCULAR_LARGE: ZoneTemplate = {
    id: 'circular-large',
    name: 'Circular (8 zones)',
    description: 'A circular layout with 8 zones arranged around a center point',
    category: 'circular',
    positions: [
      { x: 150, y: 0, width: 100, height: 100, name: 'N', taskType: 'general' },
      { x: 212, y: 37, width: 100, height: 100, name: 'NE', taskType: 'general' },
      { x: 250, y: 100, width: 100, height: 100, name: 'E', taskType: 'general' },
      { x: 212, y: 162, width: 100, height: 100, name: 'SE', taskType: 'general' },
      { x: 150, y: 200, width: 100, height: 100, name: 'S', taskType: 'general' },
      { x: 87, y: 162, width: 100, height: 100, name: 'SW', taskType: 'general' },
      { x: 50, y: 100, width: 100, height: 100, name: 'W', taskType: 'general' },
      { x: 87, y: 37, width: 100, height: 100, name: 'NW', taskType: 'general' }
    ],
    metadata: {
      author: 'Stratix',
      version: '1.0',
      tags: ['circular', 'radial', 'multi-task'],
      createdAt: Date.now()
    }
  };

  static readonly CODE_REVIEW: ZoneTemplate = {
    id: 'code-review',
    name: 'Code Review Setup',
    description: 'Optimized layout for code review tasks with analysis zones',
    category: 'custom',
    positions: [
      { x: 0, y: 0, width: 200, height: 150, name: 'Code Analysis', taskType: 'code' },
      { x: 210, y: 0, width: 200, height: 150, name: 'Bug Detection', taskType: 'analysis' },
      { x: 0, y: 160, width: 200, height: 150, name: 'Documentation', taskType: 'writing' },
      { x: 210, y: 160, width: 200, height: 150, name: 'Summary', taskType: 'general' }
    ],
    metadata: {
      author: 'Stratix',
      version: '1.0',
      tags: ['code-review', 'analysis', 'workflow'],
      createdAt: Date.now()
    }
  };

  static readonly PARALLEL_PROCESSING: ZoneTemplate = {
    id: 'parallel-processing',
    name: 'Parallel Processing',
    description: 'Layout optimized for parallel task execution',
    category: 'custom',
    positions: [
      { x: 0, y: 0, width: 140, height: 140, name: 'Worker 1', taskType: 'code' },
      { x: 150, y: 0, width: 140, height: 140, name: 'Worker 2', taskType: 'code' },
      { x: 300, y: 0, width: 140, height: 140, name: 'Worker 3', taskType: 'code' },
      { x: 450, y: 0, width: 140, height: 140, name: 'Worker 4', taskType: 'code' },
      { x: 150, y: 200, width: 300, height: 100, name: 'Aggregator', taskType: 'analysis' }
    ],
    metadata: {
      author: 'Stratix',
      version: '1.0',
      tags: ['parallel', 'multi-task', 'aggregation'],
      createdAt: Date.now()
    }
  };

  static readonly DOCUMENTATION_WORKFLOW: ZoneTemplate = {
    id: 'documentation-workflow',
    name: 'Documentation Workflow',
    description: 'Sequential layout for documentation generation workflow',
    category: 'linear',
    positions: [
      { x: 0, y: 0, width: 150, height: 120, name: 'Code Scan', taskType: 'code' },
      { x: 160, y: 0, width: 150, height: 120, name: 'Analysis', taskType: 'analysis' },
      { x: 320, y: 0, width: 150, height: 120, name: 'Draft', taskType: 'writing' },
      { x: 480, y: 0, width: 150, height: 120, name: 'Review', taskType: 'general' },
      { x: 640, y: 0, width: 150, height: 120, name: 'Final', taskType: 'writing' }
    ],
    metadata: {
      author: 'Stratix',
      version: '1.0',
      tags: ['documentation', 'workflow', 'sequential'],
      createdAt: Date.now()
    }
  };

  static readonly T_SHAPE: ZoneTemplate = {
    id: 't-shape',
    name: 'T-Shape Layout',
    description: 'T-shaped layout for specialized workflow with supporting tasks',
    category: 'custom',
    positions: [
      { x: 0, y: 0, width: 120, height: 120, name: 'Primary', taskType: 'code' },
      { x: 130, y: 0, width: 120, height: 120, name: 'Support 1', taskType: 'analysis' },
      { x: 260, y: 0, width: 120, height: 120, name: 'Support 2', taskType: 'analysis' },
      { x: 130, y: 130, width: 120, height: 120, name: 'Foundation 1', taskType: 'general' },
      { x: 260, y: 130, width: 120, height: 120, name: 'Foundation 2', taskType: 'general' }
    ],
    metadata: {
      author: 'Stratix',
      version: '1.0',
      tags: ['t-shape', 'specialized', 'workflow'],
      createdAt: Date.now()
    }
  };

  static getAllBuiltInTemplates(): ZoneTemplate[] {
    return [
      ZoneTemplates.GRID_2X2,
      ZoneTemplates.GRID_3X3,
      ZoneTemplates.HORIZONTAL_LINE,
      ZoneTemplates.VERTICAL_LINE,
      ZoneTemplates.CIRCULAR_SMALL,
      ZoneTemplates.CIRCULAR_LARGE,
      ZoneTemplates.CODE_REVIEW,
      ZoneTemplates.PARALLEL_PROCESSING,
      ZoneTemplates.DOCUMENTATION_WORKFLOW,
      ZoneTemplates.T_SHAPE
    ];
  }

  static getTemplateById(id: string): ZoneTemplate | undefined {
    return ZoneTemplates.getAllBuiltInTemplates().find(t => t.id === id);
  }

  static getTemplatesByCategory(category: ZoneTemplate['category']): ZoneTemplate[] {
    return ZoneTemplates.getAllBuiltInTemplates().filter(t => t.category === category);
  }

  static searchTemplates(query: string): ZoneTemplate[] {
    const lowerQuery = query.toLowerCase();
    return ZoneTemplates.getAllBuiltInTemplates().filter(t =>
      t.name.toLowerCase().includes(lowerQuery) ||
      t.description.toLowerCase().includes(lowerQuery) ||
      t.metadata?.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }
}