import { inject, provide, type InjectionKey, type Ref, ref, computed, readonly, unref, toRef } from 'vue';

export type SizeVariant = 'sm' | 'md' | 'lg' | 'xl' | 'fullscreen';

export interface SizeContext {
  size: Ref<SizeVariant>;
  iconSize: Readonly<Ref<number>>;
}

export const SIZE_CONTEXT_KEY: InjectionKey<SizeContext> = Symbol('SizeContext');

export const SIZE_TO_ICON_SIZE: Record<SizeVariant, number> = {
  sm: 14,
  md: 16,
  lg: 16,
  xl: 18,
  fullscreen: 18,
};

export function provideSizeContext(size: Ref<SizeVariant> | SizeVariant): SizeContext {
  const sizeRef = typeof size === 'string' ? ref(size) : size;
  const iconSize = computed(() => SIZE_TO_ICON_SIZE[sizeRef.value]);
  
  const context: SizeContext = {
    size: sizeRef,
    iconSize: readonly(iconSize),
  };
  
  provide(SIZE_CONTEXT_KEY, context);
  
  return context;
}

export function useSizeContext(defaultSize: SizeVariant = 'md'): SizeContext {
  const injected = inject(SIZE_CONTEXT_KEY, null);
  
  if (injected) {
    return injected;
  }
  
  const sizeRef = ref<SizeVariant>(defaultSize);
  const iconSize = computed(() => SIZE_TO_ICON_SIZE[sizeRef.value]);
  
  return {
    size: sizeRef,
    iconSize: readonly(iconSize),
  };
}

export function useIconSize(explicitSize?: number | Ref<number | undefined>, defaultSize: SizeVariant = 'md'): Ref<number> {
  const context = useSizeContext(defaultSize);
  
  return computed(() => {
    const size = unref(explicitSize);
    if (size !== undefined) {
      return size;
    }
    return context.iconSize.value;
  });
}
