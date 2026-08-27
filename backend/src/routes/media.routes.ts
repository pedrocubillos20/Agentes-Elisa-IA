// ====================================================
// 📤 MEDIA ROUTES — Upload, delete, storage info
// Recibe archivos binarios (multipart), comprime, sube a R2
// ====================================================

import { Router, Request, Response } from 'express';
import multer from 'multer';
import prisma from '../lib/prisma';
import { getOwnerId } from '../lib/helpers';
import { AuthRequest } from '../middleware/auth.middleware';
import { uploadFile, removeFile, getStorageSummary, canUpload, isLocalStorage } from '../lib/storage';
import { smartCompress, getCompressionCapabilities } from '../lib/compress';
import path from 'path';
import fs from 'fs';

const router = Router();

// ===== MULTER CONFIG =====
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB max por archivo
    files: 10, // Max 10 archivos a la vez (catálogos)
  },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp',
      'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4', 'audio/webm', 'audio/aac', 'audio/m4a',
      // 📄 Documentos / PDFs
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    if (allowed.includes(file.mimetype) || file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/') || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de archivo no soportado: ${file.mimetype}`));
    }
  }
});

// ====================================================
// 📤 POST /api/media/upload — Subir archivo(s)
// Acepta: multipart/form-data con campo "file" o "files"
// Retorna: array de { url, key, fileName, fileSize, mimeType, saved }
// ====================================================
router.post('/upload', upload.array('files', 10), async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No se recibieron archivos' });
      return;
    }

    const category = (req.body.category as string) || 'assistant';
    const results: any[] = [];
    let totalSaved = 0;

    for (const file of files) {
      // 1. Verificar espacio disponible
      const check = await canUpload(ownerId, file.size);
      if (!check.allowed) {
        res.status(413).json({
          error: `Sin espacio. Usado: ${(check.used / (1024*1024)).toFixed(1)}MB / ${(check.limit / (1024*1024)).toFixed(0)}MB. Archivo: ${(file.size / (1024*1024)).toFixed(1)}MB`,
          storage: {
            used: check.used,
            limit: check.limit,
            available: check.available,
            fileTooLarge: true
          }
        });
        return;
      }

      // 2. Comprimir
      const { buffer: compressed, mimeType: finalMime, saved } = await smartCompress(
        file.buffer,
        file.mimetype,
        file.originalname
      );
      totalSaved += saved;

      // 3. Subir a storage (R2 o local)
      const { url, key, size } = await uploadFile(
        ownerId,
        file.originalname,
        compressed,
        finalMime,
        category
      );

      // 4. Registrar en DB
      await prisma.mediaFile.create({
        data: {
          userId: ownerId,
          url,
          key,
          fileName: file.originalname,
          fileSize: size,
          mimeType: finalMime,
          category
        }
      });

      // 5. Actualizar storage usado
      await prisma.user.update({
        where: { id: ownerId },
        data: { storageUsed: { increment: size } }
      });

      results.push({
        url,
        key,
        fileName: file.originalname,
        fileSize: size,
        originalSize: file.size,
        mimeType: finalMime,
        saved,
        savedPercent: file.size > 0 ? Math.round((saved / file.size) * 100) : 0
      });
    }

    const totalOriginal = files.reduce((s, f) => s + f.size, 0);
    const totalFinal = results.reduce((s, r) => s + r.fileSize, 0);

    console.log(`📤 Upload: ${files.length} archivos, ${(totalOriginal/1024).toFixed(0)}KB → ${(totalFinal/1024).toFixed(0)}KB (${totalSaved > 0 ? Math.round((totalSaved/totalOriginal)*100) : 0}% ahorrado)`);

    res.json({
      success: true,
      files: results,
      totalSaved,
      totalSavedMB: (totalSaved / (1024 * 1024)).toFixed(2)
    });

  } catch (error: any) {
    console.error('❌ Error en upload:', error.message);
    if (error.message?.includes('Tipo de archivo')) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Error al subir archivo' });
    }
  }
});

// ====================================================
// 🗑️ DELETE /api/media/:key — Eliminar archivo
// ====================================================
router.delete('/:fileId', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    const file = await prisma.mediaFile.findFirst({
      where: { id: req.params.fileId, userId: ownerId }
    });

    if (!file) {
      res.status(404).json({ error: 'Archivo no encontrado' });
      return;
    }

    // Eliminar del storage
    await removeFile(ownerId, file.key);

    res.json({ success: true, freedBytes: file.fileSize });

  } catch (error: any) {
    console.error('❌ Error eliminando:', error.message);
    res.status(500).json({ error: 'Error al eliminar archivo' });
  }
});

// ====================================================
// 📊 GET /api/media/storage — Resumen de storage
// ====================================================
router.get('/storage', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    const summary = await getStorageSummary(ownerId);
    const capabilities = getCompressionCapabilities();

    res.json({
      ...summary,
      compression: capabilities,
      storageType: isLocalStorage ? 'local' : 'cloudflare-r2'
    });

  } catch (error: any) {
    console.error('❌ Error storage info:', error.message);
    res.status(500).json({ error: 'Error al obtener info de storage' });
  }
});

// ====================================================
// 📋 GET /api/media/files — Listar archivos del usuario
// ====================================================
router.get('/files', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    const { category } = req.query;
    const where: any = { userId: ownerId };
    if (category) where.category = category;

    const files = await prisma.mediaFile.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    res.json({ files });

  } catch (error: any) {
    res.status(500).json({ error: 'Error al listar archivos' });
  }
});

// ====================================================
// 🔄 POST /api/media/migrate — Migrar base64 existente a storage
// (Ejecutar una vez para migrar datos legacy)
// ====================================================
router.post('/migrate', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    // Buscar asistentes con media base64
    const assistants = await prisma.assistant.findMany({
      where: { userId: ownerId },
      select: { id: true, mediaItems: true }
    });

    let migrated = 0;
    let totalSaved = 0;
    let errors = 0;

    for (const ast of assistants) {
      const mediaItems = ast.mediaItems as any[];
      if (!Array.isArray(mediaItems) || mediaItems.length === 0) continue;

      let modified = false;
      const newItems = [];

      for (const item of mediaItems) {
        // Catálogo: migrar cada imagen interna
        if (item.type === 'catalog' && Array.isArray(item.images)) {
          const newImages = [];
          for (const img of item.images) {
            if (img.url && img.url.startsWith('data:')) {
              try {
                const { buffer, mimeType } = base64ToBuffer(img.url);
                const compressed = await smartCompress(buffer, mimeType, img.name || 'image');
                const uploaded = await uploadFile(ownerId, img.name || 'catalog-image.jpg', compressed.buffer, compressed.mimeType, 'assistant');
                
                await prisma.mediaFile.create({
                  data: { userId: ownerId, url: uploaded.url, key: uploaded.key, fileName: img.name || 'image', fileSize: uploaded.size, mimeType: compressed.mimeType, category: 'assistant' }
                });
                
                totalSaved += (buffer.length - uploaded.size);
                newImages.push({ ...img, url: uploaded.url, size: uploaded.size });
                migrated++;
                modified = true;
              } catch (e: any) {
                console.error(`⚠️ Error migrando imagen de catálogo:`, e.message);
                newImages.push(img); // Mantener original si falla
                errors++;
              }
            } else {
              newImages.push(img);
            }
          }
          newItems.push({ ...item, images: newImages });

        } else if (item.url && item.url.startsWith('data:')) {
          // Archivo individual con base64
          try {
            const { buffer, mimeType } = base64ToBuffer(item.url);
            const compressed = await smartCompress(buffer, mimeType, item.name || 'media');
            const uploaded = await uploadFile(ownerId, item.name || 'media-file', compressed.buffer, compressed.mimeType, 'assistant');

            await prisma.mediaFile.create({
              data: { userId: ownerId, url: uploaded.url, key: uploaded.key, fileName: item.name || 'media', fileSize: uploaded.size, mimeType: compressed.mimeType, category: 'assistant' }
            });

            totalSaved += (buffer.length - uploaded.size);
            newItems.push({ ...item, url: uploaded.url, size: uploaded.size });
            migrated++;
            modified = true;
          } catch (e: any) {
            console.error(`⚠️ Error migrando ${item.name}:`, e.message);
            newItems.push(item);
            errors++;
          }
        } else {
          newItems.push(item);
        }
      }

      // Actualizar asistente si se modificaron items
      if (modified) {
        await prisma.assistant.update({
          where: { id: ast.id },
          data: { mediaItems: newItems }
        });
      }
    }

    // Recalcular storage usado
    const totalUsed = await prisma.mediaFile.aggregate({
      where: { userId: ownerId },
      _sum: { fileSize: true }
    });
    await prisma.user.update({
      where: { id: ownerId },
      data: { storageUsed: totalUsed._sum.fileSize || 0 }
    });

    res.json({
      success: true,
      migrated,
      errors,
      totalSavedMB: (totalSaved / (1024 * 1024)).toFixed(2),
      message: `${migrated} archivos migrados, ${(totalSaved/(1024*1024)).toFixed(1)}MB ahorrado${errors > 0 ? `, ${errors} errores` : ''}`
    });

  } catch (error: any) {
    console.error('❌ Error migración:', error.message);
    res.status(500).json({ error: 'Error en migración' });
  }
});

// ===== HELPER: Base64 to Buffer =====
function base64ToBuffer(dataUrl: string): { buffer: Buffer; mimeType: string } {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/s);
  if (!match) throw new Error('Invalid base64 data URL');
  return {
    buffer: Buffer.from(match[2], 'base64'),
    mimeType: match[1]
  };
}

export default router;
// deploy Wed Aug 26 20:56:15 HPS 2026
