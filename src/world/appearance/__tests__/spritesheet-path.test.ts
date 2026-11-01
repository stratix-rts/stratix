/**
 * 单测：素材基址解析（src/world/appearance/spritesheet-path.ts）。
 *
 * 这段是"素材不挪动"方案的落点：LPC 素材（1.3G）原地放在 assets/spritesheets/，
 * 由 vite publicDir 提供静态服务；dev / http 部署 / electron 正式包（file://）三种场景
 * 必须都能算出正确的素材根。
 *
 * 隔离方式：纯函数（传字符串进、字符串出），不碰 DOM。
 */

import { ENTRY_PATH_DEPTH, NEW_ENTRY_HTML } from '../../../app/entry-paths';
import {
  DEFAULT_ENTRY_DEPTH,
  spritesheetBaseUrl,
  spritesheetImageUrl,
  spritesheetRelativeBase,
} from '../spritesheet-path';

describe('素材基址：相对规则覆盖三种部署形态', () => {
  test('dev server（vite publicDir 挂在站点根）', () => {
    expect(
      spritesheetBaseUrl('http://127.0.0.1:7523/src/app/main/index.html', ENTRY_PATH_DEPTH)
    ).toBe('http://127.0.0.1:7523/spritesheets');
  });

  test('http 部署（入口与素材同在站点根下）', () => {
    expect(spritesheetBaseUrl('https://example.com/src/app/main/index.html', ENTRY_PATH_DEPTH)).toBe(
      'https://example.com/spritesheets'
    );
  });

  test('electron 正式包（file:// 加载 dist/frontend 下的入口页）', () => {
    expect(
      spritesheetBaseUrl(
        'file:///Applications/Stratix.app/Contents/Resources/app/dist/frontend/src/app/main/index.html',
        ENTRY_PATH_DEPTH
      )
    ).toBe(
      'file:///Applications/Stratix.app/Contents/Resources/app/dist/frontend/spritesheets'
    );
  });

  test('相对片段按入口深度逐级上跳', () => {
    expect(spritesheetRelativeBase(3)).toBe('../../../spritesheets');
    expect(spritesheetRelativeBase(0)).toBe('spritesheets');
  });

  test('拼单张素材图：基址 + 相对路径（基址末尾斜杠不重复）', () => {
    expect(
      spritesheetImageUrl('http://127.0.0.1:7523/spritesheets/', 'body/bodies/male/walk/light.png')
    ).toBe('http://127.0.0.1:7523/spritesheets/body/bodies/male/walk/light.png');
  });
});

describe('素材基址：入口深度的事实源', () => {
  test('默认深度与入口路径一致（入口挪位置时不会算错基址）', () => {
    // NEW_ENTRY_HTML = 'src/app/main/index.html' → 目录层数 = 3
    expect(ENTRY_PATH_DEPTH).toBe(DEFAULT_ENTRY_DEPTH);
    expect(ENTRY_PATH_DEPTH).toBe(NEW_ENTRY_HTML.split('/').length - 1);
  });
});
