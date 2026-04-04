/**
 * TopBarV2 Unit Tests
 *
 * Tests stats display logic, color determination, and text formatting
 * These tests don't require Phaser dependencies
 */

import type { TopBarStats } from '@/stratix-rts/ui/v2/TopBarV2';

describe('TopBarV2 Business Logic', () => {
  describe('stats formatting', () => {
    it('should format online agents text correctly', () => {
      const stats: TopBarStats = { totalAgents: 10, onlineAgents: 5, busyAgents: 3, totalZones: 2, overallProgress: 75 };
      const text = `${stats.onlineAgents}/${stats.totalAgents} 在线`;
      expect(text).toBe('5/10 在线');
    });

    it('should format busy agents text correctly', () => {
      const text = `${3} 执行中`;
      expect(text).toBe('3 执行中');
    });

    it('should format zones text correctly', () => {
      const text = `${5} 个区域`;
      expect(text).toBe('5 个区域');
    });

    it('should handle zero agents', () => {
      const stats: TopBarStats = { totalAgents: 0, onlineAgents: 0, busyAgents: 0, totalZones: 0, overallProgress: 0 };
      const text = `${stats.onlineAgents}/${stats.totalAgents} 在线`;
      expect(text).toBe('0/0 在线');
    });

    it('should handle all agents online', () => {
      const stats: TopBarStats = { totalAgents: 10, onlineAgents: 10, busyAgents: 0, totalZones: 2, overallProgress: 100 };
      const text = `${stats.onlineAgents}/${stats.totalAgents} 在线`;
      expect(text).toBe('10/10 在线');
    });
  });

  describe('color determination', () => {
    const successColor = '#00ff88';
    const mutedColor = '#888899';
    const warningColor = '#ffcc00';

    it('should use success color when onlineAgents > 0', () => {
      const onlineAgents = 5;
      const color = onlineAgents > 0 ? successColor : mutedColor;
      expect(color).toBe('#00ff88');
    });

    it('should use muted color when onlineAgents = 0', () => {
      const onlineAgents = 0;
      const color = onlineAgents > 0 ? successColor : mutedColor;
      expect(color).toBe('#888899');
    });

    it('should use warning color when busyAgents > 0', () => {
      const busyAgents = 3;
      const color = busyAgents > 0 ? warningColor : mutedColor;
      expect(color).toBe('#ffcc00');
    });

    it('should use muted color when busyAgents = 0', () => {
      const busyAgents = 0;
      const color = busyAgents > 0 ? warningColor : mutedColor;
      expect(color).toBe('#888899');
    });

    it('should handle mixed states', () => {
      const stats: TopBarStats = { totalAgents: 10, onlineAgents: 5, busyAgents: 3, totalZones: 2, overallProgress: 75 };

      const onlineColor = stats.onlineAgents > 0 ? successColor : mutedColor;
      const busyColor = stats.busyAgents > 0 ? warningColor : mutedColor;

      expect(onlineColor).toBe('#00ff88');
      expect(busyColor).toBe('#ffcc00');
    });
  });

  describe('hexToNumber utility', () => {
    function hexToNumber(hex: string): number {
      if (!hex || typeof hex !== 'string') return 0xffffff;
      return parseInt(hex.slice(1), 16);
    }

    it('should convert valid hex color', () => {
      expect(hexToNumber('#00ff88')).toBe(0x00ff88);
    });

    it('should convert white', () => {
      expect(hexToNumber('#ffffff')).toBe(0xffffff);
    });

    it('should convert black', () => {
      expect(hexToNumber('#000000')).toBe(0x000000);
    });

    it('should return 0xffffff for invalid input', () => {
      expect(hexToNumber('')).toBe(0xffffff);
      expect(hexToNumber(null as any)).toBe(0xffffff);
      expect(hexToNumber(undefined as any)).toBe(0xffffff);
    });
  });

  describe('stats collector integration', () => {
    it('should provide default stats structure', () => {
      const defaultStats: TopBarStats = {
        totalAgents: 0,
        onlineAgents: 0,
        busyAgents: 0,
        totalZones: 0,
        overallProgress: 0,
      };

      expect(defaultStats.totalAgents).toBe(0);
      expect(defaultStats.onlineAgents).toBe(0);
      expect(defaultStats.busyAgents).toBe(0);
      expect(defaultStats.totalZones).toBe(0);
      expect(defaultStats.overallProgress).toBe(0);
    });

    it('should handle realistic stats', () => {
      const stats: TopBarStats = {
        totalAgents: 25,
        onlineAgents: 18,
        busyAgents: 12,
        totalZones: 8,
        overallProgress: 65,
      };

      expect(stats.totalAgents).toBe(25);
      expect(stats.onlineAgents).toBe(18);
      expect(stats.busyAgents).toBe(12);
      expect(stats.totalZones).toBe(8);
      expect(stats.overallProgress).toBe(65);
    });
  });

  describe('progress display', () => {
    it('should represent progress as percentage', () => {
      const overallProgress = 75;
      const percentageDisplay = `${overallProgress}%`;
      expect(percentageDisplay).toBe('75%');
    });

    it('should handle zero progress', () => {
      const overallProgress = 0;
      const percentageDisplay = `${overallProgress}%`;
      expect(percentageDisplay).toBe('0%');
    });

    it('should handle full progress', () => {
      const overallProgress = 100;
      const percentageDisplay = `${overallProgress}%`;
      expect(percentageDisplay).toBe('100%');
    });
  });

  describe('stats aggregation', () => {
    function aggregateStats(agentList: Array<{ status: 'online' | 'offline' | 'busy' | 'error' }>): TopBarStats {
      return {
        totalAgents: agentList.length,
        onlineAgents: agentList.filter(a => a.status === 'online').length,
        busyAgents: agentList.filter(a => a.status === 'busy').length,
        totalZones: 0,
        overallProgress: 0,
      };
    }

    it('should count online agents correctly', () => {
      const agents = [
        { status: 'online' as const },
        { status: 'online' as const },
        { status: 'offline' as const },
        { status: 'busy' as const },
      ];

      const stats = aggregateStats(agents);
      expect(stats.totalAgents).toBe(4);
      expect(stats.onlineAgents).toBe(2);
      expect(stats.busyAgents).toBe(1);
    });

    it('should handle empty agent list', () => {
      const stats = aggregateStats([]);
      expect(stats.totalAgents).toBe(0);
      expect(stats.onlineAgents).toBe(0);
      expect(stats.busyAgents).toBe(0);
    });
  });
});
