/**
 * DOM 弹窗点击穿透防护管理器
 * 
 * 原理：在 DOM 弹窗容器上阻止事件冒泡，防止事件到达 Phaser Canvas
 * 这样 Phaser 场景就收不到点击事件，自然就不会有穿透问题
 * 
 * 注意：不拦截点击弹窗外部的区域，那些点击会正常到达 Phaser
 */

interface ProtectedElement {
  element: HTMLElement;
}

class DOMOverlayManager {
  private protectedElements: Map<string, ProtectedElement> = new Map();
  private idCounter = 0;

  /**
   * 保护一个 DOM 元素，阻止其内部点击事件冒泡到 Phaser Canvas
   * @param element 需要保护的 DOM 元素
   * @returns elementId 用于后续移除
   */
  protectElement(element: HTMLElement): string {
    const id = `protected-${++this.idCounter}`;
    
    // 阻止事件冒泡到 document（从而不会到达 Phaser Canvas）
    const stopPropagation = (e: Event) => {
      e.stopPropagation();
    };
    
    // 保存引用以便后续移除
    (element as any)._stopPropagationHandler = stopPropagation;
    
    // 关键事件都阻止冒泡
    element.addEventListener('click', stopPropagation);
    element.addEventListener('mousedown', stopPropagation);
    element.addEventListener('mouseup', stopPropagation);
    element.addEventListener('touchstart', stopPropagation);
    element.addEventListener('touchend', stopPropagation);
    
    this.protectedElements.set(id, { element });
    
    return id;
  }

  /**
   * 移除保护
   * @param elementId protectElement 返回的 ID
   */
  unprotectElement(elementId: string): void {
    const entry = this.protectedElements.get(elementId);
    if (!entry) return;
    
    const { element } = entry;
    const stopPropagation = (element as any)._stopPropagationHandler;
    
    if (stopPropagation) {
      element.removeEventListener('click', stopPropagation);
      element.removeEventListener('mousedown', stopPropagation);
      element.removeEventListener('mouseup', stopPropagation);
      element.removeEventListener('touchstart', stopPropagation);
      element.removeEventListener('touchend', stopPropagation);
    }
    
    delete (element as any)._stopPropagationHandler;
    this.protectedElements.delete(elementId);
  }

  /**
   * 移除所有保护
   */
  unprotectAll(): void {
    const ids = Array.from(this.protectedElements.keys());
    ids.forEach(id => this.unprotectElement(id));
  }
}

export const domOverlayManager = new DOMOverlayManager();
export default domOverlayManager;
