/**
 * 测试替身：假 fetch / 假画布 / 假图片。
 *
 * why 需要它们：world/appearance 是**零 DOM** 模块（画布与图片对象由 app 层注入），
 * 于是单测里也必须自己造 —— 既不依赖 jsdom（jest 是 node 环境），也不去 mock 被测模块本身
 * （把被测行为一起 mock 掉就等于没测）。
 */

/** 假 fetch 的返回值类型（与 part-registry 的 FetchResponseLike 对齐）。 */
export interface FakeResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** 假 fetch：记录调用过的 URL，按脚本返回响应。 */
export function createFakeFetch(
  handler: (url: string) => FakeResponse | Promise<FakeResponse>
): { fetch: (url: string) => Promise<FakeResponse>; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (url: string) => {
      calls.push(url);
      return handler(url);
    },
  };
}

/** 恒定返回同一份 JSON 的假 fetch。 */
export function createJsonFetch(
  payload: unknown,
  init: { ok?: boolean; status?: number } = {}
): { fetch: (url: string) => Promise<FakeResponse>; calls: string[] } {
  return createFakeFetch(() => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => payload,
  }));
}

/** 假画布：记录 drawImage / clearRect 调用，够合成器用。 */
export interface FakeCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly drawImage: jest.Mock;
  readonly clearRect: jest.Mock;
}

/** 造一张假画布。 */
export function createFakeCanvas(): FakeCanvas {
  const drawImage = jest.fn();
  const clearRect = jest.fn();
  const ctx = {
    drawImage,
    clearRect,
    imageSmoothingEnabled: true,
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: jest.fn(() => ctx),
    toDataURL: jest.fn(() => 'data:image/png;base64,STUB'),
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, drawImage, clearRect };
}

/** 假图片：设 src 后异步触发 onload（fail = true 时触发 onerror）。 */
export function createFakeImage(
  options: { fail?: boolean; onSrc?: (src: string) => void } = {}
): HTMLImageElement {
  let currentSrc = '';
  const img = {
    onload: null as (() => void) | null,
    onerror: null as (() => void) | null,
  };

  Object.defineProperty(img, 'src', {
    get() {
      return currentSrc;
    },
    set(value: string) {
      currentSrc = value;
      options.onSrc?.(value);
      setTimeout(() => {
        if (options.fail) {
          img.onerror?.();
        } else {
          img.onload?.();
        }
      }, 0);
    },
  });

  return img as unknown as HTMLImageElement;
}

/**
 * 造一批假图片的工厂：记录**被请求过的 src**（加载时才有值）。
 */
export function createFakeImageFactory(options: { fail?: boolean } = {}): {
  createImage: () => HTMLImageElement;
  requested: string[];
} {
  const requested: string[] = [];
  return {
    requested,
    createImage: () => createFakeImage({ fail: options.fail, onSrc: (src) => requested.push(src) }),
  };
}
