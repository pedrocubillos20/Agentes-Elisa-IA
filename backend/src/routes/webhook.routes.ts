import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { processWhatsAppMessage } from '../services/whatsapp.service';
import { processWompiWebhook, verifyWebhookSignature } from '../services/wompi.service';

const router = Router();
const prisma = new PrismaClient();

// ==========================================
// WEBHOOK DE WHATSAPP - VERIFICACIÓN
// ==========================================
router.get('/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    logger.info('Webhook de WhatsApp verificado');
    res.status(200).send(challenge);
  } else {
    logger.warn('Verificación de webhook fallida');
    res.sendStatus(403);
  }
});

// ==========================================
// WEBHOOK DE WHATSAPP - MENSAJES ENTRANTES
// ==========================================
router.post('/whatsapp', async (req, res) => {
  try {
    const body = req.body;

    // Log del webhook
    await prisma.webhookLog.create({
      data: {
        source: 'whatsapp',
        event: body?.entry?.[0]?.changes?.[0]?.field || 'unknown',
        payload: body,
      },
    });

    // Verificar que es un mensaje
    if (body.object === 'whatsapp_business_account') {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      if (value?.messages) {
        for (const message of value.messages) {
          // Procesar cada mensaje
          await processWhatsAppMessage({
            from: message.from,
            messageId: message.id,
            timestamp: message.timestamp,
            type: message.type,
            text: message.text?.body,
            phoneNumberId: value.metadata?.phone_number_id,
          });
        }
      }
    }

    // Siempre responder 200 a WhatsApp
    res.sendStatus(200);
  } catch (error) {
    logger.error('Error procesando webhook de WhatsApp:', error);
    res.sendStatus(200); // Aún así respondemos 200 para evitar reintentos
  }
});

// ==========================================
// WEBHOOK DE WOMPI
// ==========================================
router.post('/wompi', async (req, res) => {
  try {
    const event = req.body;

    // Log del webhook
    await prisma.webhookLog.create({
      data: {
        source: 'wompi',
        event: event?.event || 'unknown',
        payload: event,
        status: 'received',
      },
    });

    // Procesar el evento
    if (event.event === 'transaction.updated') {
      await processWompiWebhook(event);
    }

    res.json({ received: true });
  } catch (error: any) {
    logger.error('Error procesando webhook de Wompi:', error);
    
    // Actualizar log con error
    await prisma.webhookLog.updateMany({
      where: {
        source: 'wompi',
        status: 'received',
      },
      data: {
        status: 'error',
        error: error.message,
      },
    });

    // Aún así respondemos 200 para evitar reintentos innecesarios
    res.status(200).json({ received: true, error: error.message });
  }
});

export default router;
