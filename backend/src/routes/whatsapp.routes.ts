import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import whatsappService from '../services/whatsappService';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'elisa-ia-secret-key';
const WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'elisa-ia-webhook-token';

// Middleware de autenticación
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

// Configurar WhatsApp Cloud API
router.post('/configure', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { accessToken, phoneNumberId } = req.body;
    
    if (!accessToken || !phoneNumberId) {
      return res.status(400).json({ 
        error: 'Se requiere accessToken y phoneNumberId' 
      });
    }

    console.log(`⚙️ Configurando WhatsApp para usuario ${userId}`);
    
    const result = await whatsappService.configure(userId, accessToken, phoneNumberId);
    
    if (result.success) {
      res.json({ 
        success: true,
        connected: true, 
        phoneNumber: result.phoneNumber,
        verifiedName: result.verifiedName,
        message: '¡WhatsApp conectado exitosamente!' 
      });
    } else {
      res.status(400).json({ 
        success: false,
        error: result.error || 'Error al configurar WhatsApp' 
      });
    }
    
  } catch (error: any) {
    console.error('Error configurando:', error);
    res.status(500).json({ error: 'Error al configurar WhatsApp' });
  }
});

// Verificar estado de conexión
router.get('/status', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const status = await whatsappService.getStatus(userId);
    res.json(status);
  } catch (error) {
    console.error('Error verificando estado:', error);
    res.status(500).json({ error: 'Error al verificar estado' });
  }
});

// Desconectar WhatsApp
router.post('/disconnect', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    await whatsappService.disconnect(userId);
    res.json({ message: 'WhatsApp desconectado exitosamente' });
  } catch (error) {
    console.error('Error desconectando:', error);
    res.status(500).json({ error: 'Error al desconectar' });
  }
});

// Enviar mensaje de prueba
router.post('/send', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { to, message } = req.body;

    if (!to || !message) {
      return res.status(400).json({ error: 'Se requiere número de destino y mensaje' });
    }

    const success = await whatsappService.sendMessage(userId, to, message);
    
    if (success) {
      res.json({ success: true, message: 'Mensaje enviado' });
    } else {
      res.status(400).json({ error: 'No se pudo enviar el mensaje' });
    }
  } catch (error) {
    console.error('Error enviando mensaje:', error);
    res.status(500).json({ error: 'Error al enviar mensaje' });
  }
});

// ============ WEBHOOK DE META ============

// Verificación del webhook (GET) - Meta envía esto para verificar
router.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('📥 Verificación de webhook:', { mode, token, challenge: challenge?.toString().substring(0, 20) });

  if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
    console.log('✅ Webhook verificado correctamente');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Verificación fallida');
    res.sendStatus(403);
  }
});

// Recibir mensajes (POST) - Meta envía mensajes aquí
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    console.log('📨 Webhook recibido');
    
    // Siempre responder 200 rápidamente a Meta
    res.sendStatus(200);
    
    // Procesar el mensaje de forma asíncrona
    await whatsappService.handleWebhook(req.body);
    
  } catch (error) {
    console.error('Error en webhook:', error);
    // Ya enviamos 200, no hacer nada más
  }
});

// ============ LEGACY - Compatibilidad con frontend actual ============

// Endpoint legacy para generar QR (ahora redirige a configure)
router.post('/generate-qr', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    
    // Verificar si ya está conectado
    const status = await whatsappService.getStatus(userId);
    
    if (status.connected) {
      return res.json({ 
        connected: true, 
        phoneNumber: status.phoneNumber,
        message: 'Ya estás conectado a WhatsApp' 
      });
    }

    // Si no está conectado, indicar que debe configurar
    res.json({ 
      connected: false,
      requiresSetup: true,
      message: 'Debes configurar WhatsApp Cloud API. Ve a Configuración > WhatsApp.'
    });
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al verificar estado' });
  }
});

export default router;
