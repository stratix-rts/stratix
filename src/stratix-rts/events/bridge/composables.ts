import { ref, onUnmounted, onMounted, type Ref } from 'vue';

import { RTSEventBus, rtsEventBus } from '../core/RTSEventBus';
import type {
  RTSEventName,
  RTSEventData,
  GameToVueEvents,
  VueToGameEvents,
  RequestResponseMap,
} from '../types/RTSEventTypes';

type GameToVueEventName = keyof GameToVueEvents;
type VueToGameEventName = keyof VueToGameEvents;

export interface UseSubscriptionOptions<T> {
  immediate?: boolean;
  equalityFn?: (prev: T, next: T) => boolean;
}

export interface UseSubscriptionReturn<T> {
  data: Ref<T | null>;
  isLoading: Ref<boolean>;
  error: Ref<Error | null>;
  unsubscribe: () => void;
}

export function useRTSSubscription<K extends GameToVueEventName>(
  event: K,
  options?: UseSubscriptionOptions<RTSEventData<K>>
): UseSubscriptionReturn<RTSEventData<K>> {
  const data = ref<RTSEventData<K> | null>(null) as Ref<RTSEventData<K> | null>;
  const isLoading = ref(false);
  const error = ref<Error | null>(null);
  
  let unsubscribe: (() => void) | null = null;
  const equalityFn = options?.equalityFn ?? ((prev, next) => prev === next);

  const handler = (eventData: RTSEventData<K>) => {
    if (!equalityFn(data.value as RTSEventData<K>, eventData)) {
      data.value = eventData;
    }
    isLoading.value = false;
    error.value = null;
  };

  onMounted(() => {
    isLoading.value = true;
    unsubscribe = rtsEventBus.on(event, handler);
  });

  onUnmounted(() => {
    if (unsubscribe) {
    unsubscribe();
        unsubscribe = null;
    }
  });

  return {
    data,
    isLoading,
    error,
    unsubscribe: () => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    },
  };
}

export function useRTSMultipleSubscriptions<K extends GameToVueEventName>(
  events: K[]
): {
  data: Ref<Partial<Record<K, unknown>>>;
  unsubscribe: () => void;
} {
  const data = ref<Partial<Record<K, unknown>>>({}) as Ref<Partial<Record<K, unknown>>>;
  const unsubscribers: (() => void)[] = [];

  onMounted(() => {
    events.forEach((event) => {
      const unsub = rtsEventBus.on(event, (eventData) => {
        data.value = { ...data.value, [event]: eventData };
      });
      unsubscribers.push(unsub);
    });
  });

  onUnmounted(() => {
    unsubscribers.forEach((unsub) => unsub());
  });

  return {
    data,
    unsubscribe: () => {
      unsubscribers.forEach((unsub) => unsub());
    },
  };
}

export interface UseRequestReturn<T> {
  data: Ref<T | null>;
  isLoading: Ref<boolean>;
  error: Ref<Error | null>;
  execute: () => Promise<T | null>;
}

export function useRTSRequest<K extends keyof RequestResponseMap>(
  event: K,
  requestData: RequestResponseMap[K]['request']
): UseRequestReturn<RequestResponseMap[K]['response']> {
  const data = ref<RequestResponseMap[K]['response'] | null>(null);
  const isLoading = ref(false);
  const error = ref<Error | null>(null);

  const execute = async () => {
    isLoading.value = true;
    error.value = null;

    try {
      const result = await rtsEventBus.request(event, requestData);
      data.value = result ?? null;
      return result ?? null;
    } catch (e) {
      error.value = e as Error;
      return null;
    } finally {
      isLoading.value = false;
    }
  };

  return {
    data,
    isLoading,
    error,
    execute,
  };
}

export function useRTSConnectionState() {
  const isConnected = ref(false);
  const gameReady = ref(false);

  let unsub1: (() => void) | null = null;

  onMounted(() => {
    unsub1 = rtsEventBus.on('game:vue:game_ready', () => {
      gameReady.value = true;
      isConnected.value = true;
    });
  });

  onUnmounted(() => {
    if (unsub1) {
      unsub1();
      unsub1 = null;
    }
  });

  return {
    isConnected,
    gameReady,
  };
}
