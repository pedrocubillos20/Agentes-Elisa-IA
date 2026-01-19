import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'elisa-ia-secret-key';

const uploadDir = '/app/uploads/pdfs';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

const authenticate = async (req: Request, res: Response, next: Function) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    (req as any).userId = decoded.userId;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Token inválido' });
  }
};

router.post('/request', authenticate, upload.single('pdf'), async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { assistantId, notes } = req.body;
    const pdfPath = req.file?.path;
    
    const request = await prisma.configRequest.create({
      data: {
        userId,
        assistantId,
        pdfPath,
        notes,
        status: 'PENDING'
      }
    });
    
    res.json(request);
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

router.get('/my-requests', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    
    const requests = await prisma.configRequest.findMany({
      where: { userId },
      include: { assistant: { select: { name: true } } },
      orderBy: { createdAt: 'desc' }
    });
    
    res.json(requests);
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

router.get('/admin/requests', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user?.email !== 'admin@elisa-ia.com') {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    const requests = await prisma.configRequest.findMany({
      include: {
        user: { select: { email: true, name: true } },
        assistant: { select: { name: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    res.json(requests);
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

router.put('/admin/requests/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, adminNotes, contextJson } = req.body;
    
    const request = await prisma.configRequest.update({
      where: { id },
      data: { status, adminNotes }
    });
    
    if (contextJson && request.assistantId) {
      await prisma.assistant.update({
        where: { id: request.assistantId },
        data: { contextJson }
      });
    }
    
    res.json(request);
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

export default router;
