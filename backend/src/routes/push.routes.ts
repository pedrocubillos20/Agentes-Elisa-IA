import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { getOwnerId } from '../lib/helpers';
import { AuthRequest } from '../middleware/auth.middleware';

// ====================================================
// 🔔 PUSH NOTIFICATIONS — Web Push API
// 
// Permite notificaciones push reales al celular/desktop
// incluso cuando la plataforma está cerrada.
//
// Requiere:
// 1. npm install web-push
// 2. Variables de entorno: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL
// 3. Generar claves: npx web-push generate-vapid-keys
// ====================================================

let webpush: any = null;
let pushConfigured = false;

try {
  webpush = require('web-push');
  
  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidEmail = process.env.VAPID_EMAIL || 'mailto:soporte@bizonne.com';
  
  if (vapidPublic && vapidPrivate) {
    webpush.setVapidDetails(vapidEmail, vapidPublic, vapidPrivate);
    pushConfigured = true;
    console.log('🔔 Push Notifications: Configuradas ✅');
  } else {
    console.log('⚠️ Push Notifications: VAPID keys no configuradas. Ejecuta: npx web-push generate-vapid-keys');
  }
} catch (e: any) {
  console.log('⚠️ Push Notifications: web-push no instalado. Ejecuta: npm install web-push');
}

const router = Router();

// ====================================================
// 📋 GET /api/push/vapid-key — Devuelve la clave pública VAPID
// El frontend la necesita para suscribirse
// ====================================================
router.get('/vapid-key', (req: Request, res: Response) => {
  const key = process.env.VAPID_PUBLIC_KEY || '';
  res.json({ key, configured: pushConfigured });
});

// ====================================================
// 📩 POST /api/push/subscribe — Guardar suscripción push
// ====================================================
router.post('/subscribe', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    const { subscription } = req.body;
    if (!subscription?.endpoint) {
      res.status(400).json({ error: 'Suscripción inválida' });
      return;
    }

    // Upsert: si ya existe el endpoint, actualizar. Si no, crear.
    const existing = await prisma.pushSubscription.findFirst({
      where: { userId: ownerId, endpoint: subscription.endpoint }
    });

    if (existing) {
      await prisma.pushSubscription.update({
        where: { id: existing.id },
        data: { 
          keys: subscription.keys,
          updatedAt: new Date()
        }
      });
    } else {
      await prisma.pushSubscription.create({
        data: {
          userId: ownerId,
          endpoint: subscription.endpoint,
          keys: subscription.keys,
          userAgent: (req.headers['user-agent'] || '').substring(0, 200)
        }
      });
    }

    console.log(`🔔 Push: Suscripción guardada para usuario ${ownerId}`);
    res.json({ success: true });
  } catch (e: any) {
    console.error('❌ Push subscribe error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ====================================================
// 🗑️ POST /api/push/unsubscribe — Eliminar suscripción
// ====================================================
router.post('/unsubscribe', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    const { endpoint } = req.body;
    if (!endpoint) { res.status(400).json({ error: 'endpoint requerido' }); return; }

    await prisma.pushSubscription.deleteMany({
      where: { userId: ownerId, endpoint }
    });

    console.log(`🔔 Push: Suscripción eliminada para usuario ${ownerId}`);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ====================================================
// 🚀 SEND PUSH — Función exportable para usar desde otros módulos
// 
// Uso:
//   import { sendPushToUser } from './push.routes';
//   await sendPushToUser(userId, { title: '🛒 Nuevo Pedido', body: 'Pedro - Buzo Colombia' });
// ====================================================
export async function sendPushToUser(
  userId: string, 
  payload: { title: string; body: string; icon?: string; url?: string; tag?: string; }
): Promise<number> {
  if (!webpush || !pushConfigured) return 0;

  try {
    // Get all subscriptions for this user
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId }
    });

    if (subscriptions.length === 0) return 0;

    const pushPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || '/bizonne.png',
      badge: '/bizonne.png',
      url: payload.url || '/conversaciones',
      tag: payload.tag || 'bizonne-notification',
      timestamp: Date.now(),
      // Vibrate pattern: [vibrate, pause, vibrate]
      vibrate: [200, 100, 200],
      // Auto-close after 10 seconds
      requireInteraction: true,
      actions: [
        { action: 'open', title: '📱 Abrir' },
        { action: 'dismiss', title: '✕ Cerrar' }
      ]
    });

    let sent = 0;
    const expiredEndpoints: string[] = [];

    // Send to all devices concurrently
    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys as any },
            pushPayload,
            { TTL: 60 * 60 } // 1 hour TTL
          );
          sent++;
        } catch (err: any) {
          // 410 Gone or 404 = subscription expired, remove it
          if (err.statusCode === 410 || err.statusCode === 404) {
            expiredEndpoints.push(sub.endpoint);
          } else {
            console.error(`⚠️ Push send error (${err.statusCode}):`, err.message?.substring(0, 100));
          }
        }
      })
    );

    // Clean up expired subscriptions
    if (expiredEndpoints.length > 0) {
      await prisma.pushSubscription.deleteMany({
        where: { endpoint: { in: expiredEndpoints } }
      });
      console.log(`🧹 Push: Limpiadas ${expiredEndpoints.length} suscripciones expiradas`);
    }

    if (sent > 0) {
      console.log(`🔔 Push enviado a ${sent}/${subscriptions.length} dispositivos del usuario ${userId}`);
    }

    return sent;
  } catch (e: any) {
    console.error('❌ Push send error:', e.message);
    return 0;
  }
}

// ====================================================
// 🧪 POST /api/push/test — Enviar notificación de prueba
// ====================================================
router.post('/test', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'No autorizado' }); return; }
    const ownerId = await getOwnerId(userId);

    const sent = await sendPushToUser(ownerId, {
      title: '🔔 Prueba de Notificación',
      body: '¡Las notificaciones push están funcionando! 🎉',
      url: '/dashboard'
    });

    res.json({ success: true, sent, message: sent > 0 ? 'Notificación enviada' : 'No hay dispositivos suscritos' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
