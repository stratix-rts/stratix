/**
 * usePanelState.test.ts — 测试面板状态 composable
 */
import { usePanelState } from '../usePanelState';

// Mock the store module  
jest.mock('../../../../stores/systemzone', () => ({
  useSystemZoneStore: jest.fn(),
}));

const { useSystemZoneStore } = require('../../../../stores/systemzone');

describe('usePanelState', () => {
  let mockStore: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStore = {
      panelLoading: { status: false, insights: false, proposals: false },
      panelError: { status: null, insights: null, proposals: null },
      retryPanel: jest.fn().mockResolvedValue(undefined),
    };
    (useSystemZoneStore as jest.Mock).mockReturnValue(mockStore);
  });

  it('returns expected properties', () => {
    const dataRef = { value: [] };
    const result = usePanelState('status', dataRef as any);
    expect(result).toHaveProperty('isLoading');
    expect(result).toHaveProperty('panelError');
    expect(result).toHaveProperty('isEmpty');
    expect(result).toHaveProperty('retry');
  });

  it('isEmpty returns true for empty array', () => {
    const result = usePanelState('status', { value: [] } as any);
    expect(result.isEmpty.value).toBe(true);
  });

  it('isEmpty returns false for non-empty array', () => {
    const result = usePanelState('status', { value: ['item'] } as any);
    expect(result.isEmpty.value).toBe(false);
  });

  it('isEmpty returns true for null', () => {
    const result = usePanelState('status', { value: null } as any);
    expect(result.isEmpty.value).toBe(true);
  });

  it('isEmpty returns true for undefined', () => {
    const result = usePanelState('status', { value: undefined } as any);
    expect(result.isEmpty.value).toBe(true);
  });

  it('retry calls store.retryPanel', async () => {
    const result = usePanelState('insights', { value: [] } as any);
    await result.retry();
    expect(mockStore.retryPanel).toHaveBeenCalledWith('insights');
  });
});
