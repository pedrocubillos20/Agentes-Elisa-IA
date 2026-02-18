// ====================================================
// 🗄️ STORAGE SERVICE — Cloudflare R2 (S3-compatible)
// Maneja upload, delete, y tracking de storage por usuario
// ====================================================

import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import prisma from './prisma';

// ===== CONFIG =====
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY || '';
const R2_SECRET_KEY = process.env.R2_SECRET_KEY || '';
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'bizonne-media';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || ''; // URL público del bucket

// Fallback: almacenamiento local en VPS si no hay R2 configurado
const USE_LOCAL = !R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY;
const LOCAL_MEDIA_DIR = process.env.LOCAL_MEDIA_DIR || '/home/claude/media';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';

import fs from 'fs';
import path from 'path';

// ===== S3 CLIENT (R2) =====
let s3: S3Client | null = null;
if (!USE_LOCAL) {
  s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY,
      secretAccessKey: R2_SECRET_KEY,
    },
  });
  console.log('☁️ Storage: Cloudflare R2 configurado');
} else {
  // Crear directorio local si no existe
  try {
    if (!fs.existsSync(LOCAL_MEDIA_DIR)) {
      fs.mkdirSync(LOCAL_MEDIA_DIR, { recursive: true });
    }
    console.log(`📁 Storage: Modo LOCAL (${LOCAL_MEDIA_DIR})`);
  } catch (e) {
    console.error('⚠️ No se pudo crear directorio de media local:', e);
  }
}

// ===== UPLOAD =====
export const uploadFile = async (
  userId: string,
  fileName: string,
  buffer: Buffer,
  contentType: string,
  category: string = 'assistant' // assistant, scheduled, chat
): Promise<{ url: string; key: string; size: number }> => {
  const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `${userId}/${category}/${Date.now()}-${sanitized}`;
  const size = buffer.length;

  if (!USE_LOCAL && s3) {
    // ☁️ Upload a R2
    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000', // 1 year cache (media no cambia)
    }));

    const url = R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/${key}` : `https://${R2_BUCKET}.${R2_ACCOUNT_ID}.r2.dev/${key}`;
    return { url, key, size };
  } else {
    // 📁 Guardar local
    const dir = path.join(LOCAL_MEDIA_DIR, userId, category);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    const filePath = path.join(dir, `${Date.now()}-${sanitized}`);
    fs.writeFileSync(filePath, buffer);

    const url = `${BACKEND_URL}/media/${userId}/${category}/${path.basename(filePath)}`;
    return { url, key: filePath, size };
  }
};

// ===== DELETE =====
export const deleteFile = async (key: string): Promise<void> => {
  try {
    if (!USE_LOCAL && s3) {
      await s3.send(new DeleteObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
      }));
    } else {
      // Local delete
      if (fs.existsSync(key)) fs.unlinkSync(key);
    }
  } catch (e: any) {
    console.error(`⚠️ Error eliminando archivo ${key}:`, e.message);
  }
};

// ===== STORAGE TRACKING =====

// Obtener storage usado por un usuario (desde DB)
export const getUserStorageUsed = async (userId: string): Promise<number> => {
  const result = await prisma.mediaFile.aggregate({
    where: { userId },
    _sum: { fileSize: true }
  });
  return result._sum.fileSize || 0;
};

// Obtener límite de storage del usuario
export const getUserStorageLimit = async (userId: string): Promise<number> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { storageLimit: true, extraStorage: true }
  });
  return (user?.storageLimit || 262144000) + (user?.extraStorage || 0); // 250MB default + extras
};

// Verificar si el usuario puede subir X bytes
export const canUpload = async (userId: string, fileSize: number): Promise<{ allowed: boolean; used: number; limit: number; available: number }> => {
  const [used, limit] = await Promise.all([
    getUserStorageUsed(userId),
    getUserStorageLimit(userId)
  ]);
  const available = limit - used;
  return {
    allowed: fileSize <= available,
    used,
    limit,
    available
  };
};

// Registrar un archivo subido
export const trackUpload = async (
  userId: string,
  url: string,
  key: string,
  fileName: string,
  fileSize: number,
  mimeType: string,
  category: string
): Promise<void> => {
  await prisma.mediaFile.create({
    data: { userId, url, key, fileName, fileSize, mimeType, category }
  });
  
  // Actualizar cache de storage usado en el usuario
  await prisma.user.update({
    where: { id: userId },
    data: { storageUsed: { increment: fileSize } }
  });
};

// Eliminar un archivo y actualizar tracking
export const removeFile = async (userId: string, key: string): Promise<void> => {
  const file = await prisma.mediaFile.findFirst({ where: { userId, key } });
  if (!file) return;

  await deleteFile(key);
  await prisma.mediaFile.delete({ where: { id: file.id } });
  
  await prisma.user.update({
    where: { id: userId },
    data: { storageUsed: { decrement: file.fileSize } }
  });
};

// Obtener resumen de storage
export const getStorageSummary = async (userId: string) => {
  const [used, limit, files] = await Promise.all([
    getUserStorageUsed(userId),
    getUserStorageLimit(userId),
    prisma.mediaFile.groupBy({
      by: ['category'],
      where: { userId },
      _sum: { fileSize: true },
      _count: true
    })
  ]);

  return {
    used,
    limit,
    available: limit - used,
    usedMB: (used / (1024 * 1024)).toFixed(1),
    limitMB: (limit / (1024 * 1024)).toFixed(0),
    percent: limit > 0 ? Math.round((used / limit) * 100) : 0,
    byCategory: files.map(f => ({
      category: f.category,
      count: f._count,
      size: f._sum.fileSize || 0,
      sizeMB: ((f._sum.fileSize || 0) / (1024 * 1024)).toFixed(1)
    }))
  };
};

export const isLocalStorage = USE_LOCAL;
