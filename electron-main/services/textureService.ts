/**
 * Electron 主进程 - 纹理服务
 * 
 * 处理纹理文件的上传、检查和删除
 */

import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { ensureDirSync } from 'fs-extra';

let TEXTURES_DIR: string;

/**
 * 注册纹理服务处理器
 */
export function registerTextureHandlers(dataDir: string) {
  TEXTURES_DIR = path.join(dataDir, 'textures');
  ensureDirSync(TEXTURES_DIR);

  /**
   * 上传纹理
   */
  ipcMain.handle('texture:upload', async (event, { characterId, imageData, filename }) => {
    try {
      const matches = imageData.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
      if (!matches) {
        return { success: false, error: 'Invalid image data format' };
      }

      const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
      const textureFilename = filename || `${characterId}.${ext}`;
      const texturePath = path.join(TEXTURES_DIR, textureFilename);

      const buffer = Buffer.from(matches[2], 'base64');
      fs.writeFileSync(texturePath, buffer);

      const stats = fs.statSync(texturePath);

      console.log(`[TextureService] Uploaded: ${textureFilename} (${stats.size} bytes)`);

      return {
        success: true,
        data: {
          filePath: textureFilename,
          width: 832,
          height: 3456,
          animations: ['walk', 'idle', 'run'],
          generatedAt: stats.mtimeMs
        }
      };
    } catch (error: any) {
      console.error('[TextureService] Upload failed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 检查纹理
   */
  ipcMain.handle('texture:check', async (event, filePath: string) => {
    try {
      const texturePath = path.join(TEXTURES_DIR, filePath);

      if (fs.existsSync(texturePath)) {
        const stats = fs.statSync(texturePath);
        return {
          exists: true,
          url: `/textures/${filePath}`,
          size: stats.size,
          generatedAt: stats.mtimeMs
        };
      }

      return { exists: false, url: null };
    } catch (error) {
      console.error('[TextureService] Check failed:', error);
      return { exists: false, url: null };
    }
  });

  /**
   * 删除纹理
   */
  ipcMain.handle('texture:delete', async (event, filePath: string) => {
    try {
      const texturePath = path.join(TEXTURES_DIR, filePath);

      if (fs.existsSync(texturePath)) {
        fs.unlinkSync(texturePath);
        console.log(`[TextureService] Deleted: ${filePath}`);
      }

      return { success: true };
    } catch (error: any) {
      console.error('[TextureService] Delete failed:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[TextureService] Handlers registered');
  console.log('[TextureService] Textures directory:', TEXTURES_DIR);
}
