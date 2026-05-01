/** HUD 布局常量 - 集中管理，消除 magic number */
export const HUD_LAYOUT = {
  /** TopBar */
  topBar: {
    height: 40,
    sectionStartX: 20,
    sectionSpacing: 120,
    helpButtonWidth: 32,
    helpButtonHeight: 24,
    helpButtonOffset: 150,
    gridStep: 20,
    perfWidgetOffset: 50,
  },
  /** Minimap */
  minimap: {
    width: 200,
    height: 120,
    padding: 8,
    yOffset: 20, // from bottom
    xOffset: 20, // from right
  },
  /** CommandPanel */
  commandPanel: {
    height: 180,
    yOffset: 20, // from bottom
    tabWidth: 80,
    tabHeight: 32,
    tabSpacing: 4,
    tabPaddingX: 12,
    contentPadding: 12,
    actionButtonWidth: 70,
    actionButtonHeight: 28,
    actionButtonSpacing: 8,
    slideInOffset: 40,
  },
  /** 计算 Minimap 右边距宽度 = minimap.width + minimap.xOffset */
  get minimapRightMargin() {
    return this.minimap.width + this.minimap.xOffset;
  },
  /** 计算 Minimap 底边距高度 = minimap.height + minimap.yOffset */
  get minimapBottomMargin() {
    return this.minimap.height + this.minimap.yOffset;
  },
  /** 计算 CommandPanel 底边距高度 = commandPanel.height + commandPanel.yOffset */
  get commandPanelBottomMargin() {
    return this.commandPanel.height + this.commandPanel.yOffset;
  },
} as const;
