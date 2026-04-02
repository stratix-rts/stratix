import fs from 'fs';
import path from 'path';

import { Router, Request, Response } from 'express';
import { ensureDirSync } from 'fs-extra';

import { StratixRequestHelper } from '../../../stratix-core/utils';

const router = Router();
const requestHelper = StratixRequestHelper.getInstance();

const TEXTURES_DIR = path.join(process.cwd(), 'stratix-data', 'textures');

ensureDirSync(TEXTURES_DIR);

router.post('/upload', async (req: Request, res: Response) => {
  try {
    const { characterId, imageData, filename } = req.body;
    
    if (!characterId || !imageData) {
      res.json(requestHelper.badRequest('characterId and imageData are required'));
      return;
    }
    
    const matches = imageData.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
    if (!matches) {
      res.json(requestHelper.badRequest('Invalid image data format'));
      return;
    }
    
    const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
    const textureFilename = filename || `${characterId}.${ext}`;
    const texturePath = path.join(TEXTURES_DIR, textureFilename);
    
    const buffer = Buffer.from(matches[2], 'base64');
    fs.writeFileSync(texturePath, buffer);
    
    const stats = fs.statSync(texturePath);
    
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
    const filename = req.params.filename as string;
    const texturePath = path.join(TEXTURES_DIR, filename);
    
    if (fs.existsSync(texturePath)) {
      const stats = fs.statSync(texturePath);
      res.json(requestHelper.success({
        exists: true,
        url: `/textures/${filename}`,
        size: stats.size,
        generatedAt: stats.mtimeMs
      }, 'Texture exists'));
    } else {
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
    const filename = req.params.filename as string;
    const texturePath = path.join(TEXTURES_DIR, filename);
    
    if (fs.existsSync(texturePath)) {
      fs.unlinkSync(texturePath);
      res.json(requestHelper.success(null, 'Texture deleted'));
    } else {
      res.json(requestHelper.notFound('Texture not found'));
    }
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Failed to delete texture'));
  }
});

export default router;
