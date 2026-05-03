import fs from 'fs';
import path from 'path';

import { Router, Request, Response } from 'express';
import { ensureDirSync } from 'fs-extra';

import { StratixRequestHelper } from '../../../stratix-core/utils';

const router = Router();
const requestHelper = StratixRequestHelper.getInstance();

const TEXTURES_DIR = path.join(process.cwd(), 'stratix-data', 'textures');
const MAX_TEXTURE_SIZE = 10 * 1024 * 1024; // 10MB

ensureDirSync(TEXTURES_DIR);

function sanitizeFilename(filename: string): string {
  // Remove path traversal attempts and invalid characters
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '_');
}

function isPathSafe(targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  const resolvedDir = path.resolve(TEXTURES_DIR);
  return resolved.startsWith(resolvedDir + path.sep) || resolved === resolvedDir;
}

router.post('/upload', async (req: Request, res: Response) => {
  try {
    const { characterId, imageData, filename } = req.body;

    if (!characterId || !imageData) {
      res.status(400).json(requestHelper.badRequest('characterId and imageData are required'));
      return;
    }

    if (typeof imageData !== 'string' || imageData.length > MAX_TEXTURE_SIZE * 2) {
      res.status(400).json(requestHelper.badRequest('Invalid or oversized image data'));
      return;
    }

    const matches = imageData.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
    if (!matches) {
      res.status(400).json(requestHelper.badRequest('Invalid image data format'));
      return;
    }

    const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
    const textureFilename = sanitizeFilename(filename || `${characterId}.${ext}`);
    const texturePath = path.join(TEXTURES_DIR, textureFilename);

    if (!isPathSafe(texturePath)) {
      res.status(400).json(requestHelper.badRequest('Invalid filename'));
      return;
    }

    const buffer = Buffer.from(matches[2], 'base64');
    if (buffer.length > MAX_TEXTURE_SIZE) {
      res.status(400).json(requestHelper.badRequest(`Texture exceeds maximum size of ${MAX_TEXTURE_SIZE} bytes`));
      return;
    }

    await fs.promises.writeFile(texturePath, buffer);

    const stats = await fs.promises.stat(texturePath);

    res.json(requestHelper.success({
      filePath: textureFilename,
      url: `/textures/${textureFilename}`,
      size: stats.size,
      generatedAt: Date.now()
    }, 'Texture uploaded'));
  } catch (error) {
    console.error('Texture upload error:', error);
    res.status(500).json(requestHelper.serverError('Failed to upload texture'));
  }
});

router.get('/check/:filename', async (req: Request, res: Response) => {
  try {
    const filename = sanitizeFilename(Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename);
    const texturePath = path.join(TEXTURES_DIR, filename);

    if (!isPathSafe(texturePath)) {
      res.status(400).json(requestHelper.badRequest('Invalid filename'));
      return;
    }

    try {
      const stats = await fs.promises.stat(texturePath);
      res.json(requestHelper.success({
        exists: true,
        url: `/textures/${filename}`,
        size: stats.size,
        generatedAt: stats.mtimeMs
      }, 'Texture exists'));
    } catch {
      res.json(requestHelper.success({
        exists: false,
        url: null
      }, 'Texture not found'));
    }
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Failed to check texture'));
  }
});

router.delete('/:filename', async (req: Request, res: Response) => {
  try {
    const filename = sanitizeFilename(Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename);
    const texturePath = path.join(TEXTURES_DIR, filename);

    if (!isPathSafe(texturePath)) {
      res.status(400).json(requestHelper.badRequest('Invalid filename'));
      return;
    }

    try {
      await fs.promises.unlink(texturePath);
      res.json(requestHelper.success(null, 'Texture deleted'));
    } catch {
      res.status(404).json(requestHelper.notFound('Texture not found'));
    }
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Failed to delete texture'));
  }
});

export default router;
