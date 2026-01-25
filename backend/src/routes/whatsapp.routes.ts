import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { baileysService } from '../services/baileysService';
import { authMiddleware } from './auth.routes';

const router = Router();

/**
 * ============================================
 * WHATSAPP ROUTES - BAILEYS DIRECTO
 * ============================================
 * 
 * Sin Evolution API
 * Conexión directa a WhatsApp via Baileys
 * ✅ Soporta LID nativamente
 * 
 * ============================================
 */

// ============================================
// GET /status
// ============================================
router.get('/status', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    
    const status = await baileysService.checkConnectionStatus(user.id);
    
    // Obtener datos actualizados del usuario
    const currentUser = await prisma.user.findUnique({ where: { id: user.id } });
    
    res.json({
      connected: status.connected,
      status: currentUser?.whatsappStatus || 'disconnected',
      phone: status.phone || currentUser?.whatsappPhone,
      qrCode: currentUser?.whatsappQrCode
    });
  } catch (error: any) {
    console.error('❌ Error obteniendo estado:', error);
    res.status(500).json({ error: 'Error al obtener estado' });
  }
});

// ============================================
// POST /connect
// ============================================
router.post('/connect', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    
    // Verificar si ya está conectado
    const status = await baileysService.checkConnectionStatus(user.id);
    
    if (status.connected) {
      return res.json({
        success: true,
        connected: true,
        status: 'connected',
        phone: status.phone
      });
    }
    
    // Crear/reconectar
    const result = await baileysService.createConnection(user.id);
    
    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }
    
    res.json({
      success: true,
      connected: result.connected || false,
      status: result.connected ? 'connected' : 'waiting_qr',
      qrCode: result.qrCode
    });
  } catch (error: any) {
    console.error('❌ Error conectando:', error);
    res.status(500).json({ error: 'Error al conectar WhatsApp' });
  }
});

// ============================================
// GET /qr
// ============================================
router.get('/qr', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    
    // Verificar si ya está conectado
    const status = await baileysService.checkConnectionStatus(user.id);
    
    if (status.connected) {
      return res.json({
        connected: true,
        status: 'connected',
        phone: status.phone,
        qrCode: null
      });
    }
    
    // Obtener/generar QR
    const result = await baileysService.getQRCode(user.id);
    
    // También obtener de la DB por si acaso
    const currentUser = await prisma.user.findUnique({ where: { id: user.id } });
    
    res.json({
      connected: false,
      status: 'waiting_qr',
      qrCode: result.qrCode || currentUser?.whatsappQrCode
    });
  } catch (error: any) {
    console.error('❌ Error obteniendo QR:', error);
    res.status(500).json({ error: 'Error al obtener QR' });
  }
});

// ============================================
// POST /disconnect
// ============================================
router.post('/disconnect', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    
    await baileysService.disconnect(user.id);
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ Error desconectando:', error);
    res.status(500).json({ error: 'Error al desconectar' });
  }
});

// ============================================
// DELETE /instance
// ============================================
router.delete('/instance', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    
    await baileysService.deleteInstance(user.id);
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ Error eliminando:', error);
    res.status(500).json({ error: 'Error al eliminar instancia' });
  }
});

// ============================================
// POST /send
// ============================================
router.post('/send', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { to, message } = req.body;
    
    if (!to || !message) {
      return res.status(400).json({ error: 'Faltan datos (to, message)' });
    }
    
    // Verificar conexión
    const status = await baileysService.checkConnectionStatus(user.id);
    
    if (!status.connected) {
      return res.status(400).json({ error: 'WhatsApp no conectado' });
    }
    
    const result = await baileysService.sendTextMessage(user.id, to, message);
    
    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }
    
    res.json({ success: true, messageId: result.messageId });
  } catch (error: any) {
    console.error('❌ Error enviando:', error);
    res.status(500).json({ error: 'Error al enviar mensaje' });
  }
});

// ============================================
// POST /webhook - NO NECESARIO CON BAILEYS
// ============================================
// Baileys usa eventos internos, no webhooks externos
// Este endpoint solo existe para compatibilidad
router.post('/webhook', async (req: Request, res: Response) => {
  // Con Baileys no necesitamos webhook externo
  // Los mensajes se procesan internamente en baileysService
  res.json({ received: true, note: 'Baileys usa eventos internos' });
});

// ============================================
// GET /webhook - Health check
// ============================================
router.get('/webhook', (req: Request, res: Response) => {
  res.send('✅ WhatsApp Baileys Service activo');
});

export default router;
