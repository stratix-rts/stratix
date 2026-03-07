import { SelectionManager, SelectionManagerImpl, SelectionMode } from '@/stratix-rts/managers/SelectionManager';
import { rtsEventBus } from '@/stratix-rts/events/core/RTSEventBus';

describe('SelectionManager', () => {
  let manager: SelectionManager;

  beforeEach(() => {
    manager = new SelectionManagerImpl();
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('Agent Selection', () => {
    it('should select agent with replace mode', () => {
      manager.selectAgent('agent-1');
      expect(manager.getSelectedAgents().has('agent-1')).toBe(true);
      expect(manager.getSelectedAgents().size).toBe(1);
    });

    it('should select multiple agents with add mode', () => {
      manager.selectAgent('agent-1', SelectionMode.Add);
      manager.selectAgent('agent-2', SelectionMode.Add);

      const selected = manager.getSelectedAgents();
      expect(selected.has('agent-1')).toBe(true);
      expect(selected.has('agent-2')).toBe(true);
      expect(selected.size).toBe(2);
    });

    it('should deselect agent', () => {
      manager.selectAgent('agent-1');
      manager.deselectAgent('agent-1');

      expect(manager.getSelectedAgents().has('agent-1')).toBe(false);
      expect(manager.getSelectedAgents().size).toBe(0);
    });

    it('should toggle agent selection', () => {
      manager.selectAgent('agent-1', SelectionMode.Toggle);
      expect(manager.getSelectedAgents().has('agent-1')).toBe(true);

      manager.selectAgent('agent-1', SelectionMode.Toggle);
      expect(manager.getSelectedAgents().has('agent-1')).toBe(false);
    });

    it('should clear agent selection', () => {
      manager.selectAgent('agent-1', SelectionMode.Add);
      manager.selectAgent('agent-2', SelectionMode.Add);
      manager.clearAgentSelection();

      expect(manager.getSelectedAgents().size).toBe(0);
    });
  });

  describe('Zone Selection', () => {
    it('should select zone with replace mode', () => {
      manager.selectZone('zone-1');
      expect(manager.getSelectedZones().has('zone-1')).toBe(true);
      expect(manager.getSelectedZones().size).toBe(1);
    });

    it('should select multiple zones with add mode', () => {
      manager.selectZone('zone-1', SelectionMode.Add);
      manager.selectZone('zone-2', SelectionMode.Add);

      const selected = manager.getSelectedZones();
      expect(selected.has('zone-1')).toBe(true);
      expect(selected.has('zone-2')).toBe(true);
      expect(selected.size).toBe(2);
    });

    it('should deselect zone', () => {
      manager.selectZone('zone-1');
      manager.deselectZone('zone-1');

      expect(manager.getSelectedZones().has('zone-1')).toBe(false);
      expect(manager.getSelectedZones().size).toBe(0);
    });

    it('should clear zone selection', () => {
      manager.selectZone('zone-1', SelectionMode.Add);
      manager.selectZone('zone-2', SelectionMode.Add);
      manager.clearZoneSelection();

      expect(manager.getSelectedZones().size).toBe(0);
    });
  });

  describe('Mixed Selection', () => {
    it('should manage both agents and zones independently', () => {
      manager.selectAgent('agent-1');
      manager.selectZone('zone-1');

      expect(manager.getSelectedAgents().has('agent-1')).toBe(true);
      expect(manager.getSelectedZones().has('zone-1')).toBe(true);
    });

    it('should clear all selections', () => {
      manager.selectAgent('agent-1');
      manager.selectAgent('agent-2');
      manager.selectZone('zone-1');
      manager.selectZone('zone-2');

      manager.clearAll();

      expect(manager.getSelectedAgents().size).toBe(0);
      expect(manager.getSelectedZones().size).toBe(0);
    });
  });

  describe('Preview', () => {
    it('should set preview', () => {
      const previewSet = new Set(['agent-1', 'agent-2']);
      manager.setPreview(previewSet);

      const preview = manager.getPreview();
      expect(preview.has('agent-1')).toBe(true);
      expect(preview.has('agent-2')).toBe(true);
      expect(preview.size).toBe(2);
    });

    it('should clear preview', () => {
      const previewSet = new Set(['agent-1']);
      manager.setPreview(previewSet);
      manager.clearPreview();

      expect(manager.getPreview().size).toBe(0);
    });

    it('should not affect main selection', () => {
      manager.selectAgent('agent-1');
      const previewSet = new Set(['agent-2']);
      manager.setPreview(previewSet);

      expect(manager.getSelectedAgents().has('agent-1')).toBe(true);
      expect(manager.getPreview().has('agent-2')).toBe(true);
    });
  });

  describe('Events', () => {
    it('should emit selection change event', (done) => {
      manager.onSelectionChange.subscribe((event) => {
        expect(event.type).toBe('agent');
        expect(event.added).toContain('agent-1');
        done();
      });

      manager.selectAgent('agent-1');
    });

    it('should emit UI update event', () => {
      const eventSpy = jest.fn();
      rtsEventBus.on('scene:ui:update_selection' as any, eventSpy);

      manager.selectAgent('agent-1');

      expect(eventSpy).toHaveBeenCalledWith({
        selectedAgentIds: ['agent-1'],
        selectedZoneIds: [],
      });

      rtsEventBus.off('scene:ui:update_selection' as any, eventSpy);
    });
  });

  describe('Destroy', () => {
    it('should clean up resources', () => {
      manager.selectAgent('agent-1');
      manager.selectZone('zone-1');
      manager.setPreview(new Set(['agent-2']));

      manager.destroy();

      expect(manager.getSelectedAgents().size).toBe(0);
      expect(manager.getSelectedZones().size).toBe(0);
      expect(manager.getPreview().size).toBe(0);
    });
  });
});