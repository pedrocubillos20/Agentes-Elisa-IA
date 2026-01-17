import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const router = Router();
const prisma = new PrismaClient();

// Mapeo de planes
const PLAN_MAPPING: Record<string, { plan: string; planType: string }> = {
  'STARTER_MONTHLY': { plan: 'STARTER', planType: 'MONTHLY' },
  'PRO_MONTHLY': { plan: 'PRO', planType: 'MONTHLY' },
  'BUSINESS_MONTHLY': { plan: 'BUSINESS', planType: 'MONTHLY' },
  'STARTER_LIFETIME': { plan: 'STARTER', planType: 'LIFETIME' },
  'PRO_LIFETIME': { plan: 'PRO', planType: 'LIFETIME' },
  'AGENCY_LIFETIME': { plan: 'AGENCY', planType: 'LIFETIME' },
};

// Verificar firma de Wompi
const verifyWompiSignature = (payload: any, signature: string): boolean => {
  const eventSecret = process.env.WOMPI_EVENT_SECRET;
  if (!eventSecret) {
    console.warn('⚠️ WOMPI_EVENT_SECRET no configurado');
    return false;
  }

  const properties = payload.data?.transaction || {};
  const stringToSign = `${properties.id}${properties.status}${properties.reference}${eventSecret}`;
  const expectedSignature = crypto.createHash('sha256').update(stringToSign).digest('hex');
  
  return signature === expectedSignature;
};

// Webhook de Wompi
router.post('/wompi', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-event-checksum'] as string;
    const event = req.body;

    console.log('📥 Webhook Wompi recibido:', JSON.stringify(event, null, 2));

    // Registrar el webhook
    await prisma.webhookLog.create({
      data: {
        source: 'wompi',
        event: event.event || 'unknown',
        payload: event,
        status: 'received',
      }
    });

    // Verificar firma (opcional en sandbox)
    if (process.env.NODE_ENV === 'production') {
      if (!verifyWompiSignature(event, signature)) {
        console.error('❌ Firma de webhook inválida');
        return res.status(401).json({ error: 'Firma inválida' });
      }
    }

    // Procesar evento de transacción
    if (event.event === 'transaction.updated') {
      const transaction = event.data?.transaction;
      
      if (!transaction) {
        return res.status(400).json({ error: 'Datos de transacción faltantes' });
      }

      const { reference, status, id: wompiId, payment_method_type } = transaction;

      console.log(`💳 Transacción ${reference}: ${status}`);

      // Buscar el pago en nuestra base de datos
      const payment = await prisma.payment.findUnique({
        where: { reference }
      });

      if (!payment) {
        console.error(`❌ Pago no encontrado: ${reference}`);
        return res.status(404).json({ error: 'Pago no encontrado' });
      }

      // Actualizar estado del pago
      await prisma.payment.update({
        where: { reference },
        data: {
          status,
          wompiId,
          paymentMethod: payment_method_type,
        }
      });

      // Si el pago fue aprobado, actualizar el plan del usuario
      if (status === 'APPROVED') {
        const planInfo = PLAN_MAPPING[payment.plan] || PLAN_MAPPING['STARTER_MONTHLY'];
        
        await prisma.user.update({
          where: { id: payment.userId },
          data: {
            plan: planInfo.plan as any,
            planType: planInfo.planType as any,
            subscriptionStatus: 'ACTIVE',
            subscriptionId: wompiId,
          }
        });

        console.log(`✅ Plan actualizado para usuario ${payment.userId}: ${planInfo.plan} (${planInfo.planType})`);

        // Actualizar log del webhook
        await prisma.webhookLog.updateMany({
          where: { 
            payload: { path: ['data', 'transaction', 'reference'], equals: reference }
          },
          data: { status: 'processed' }
        });
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Error procesando webhook Wompi:', error);
    
    // Registrar error
    await prisma.webhookLog.create({
      data: {
        source: 'wompi',
        event: 'error',
        payload: req.body,
        status: 'error',
        error: error instanceof Error ? error.message : 'Error desconocido',
      }
    });

    res.status(500).json({ error: 'Error procesando webhook' });
  }
});

// Webhook de prueba (para verificar que funciona)
router.post('/test', async (req: Request, res: Response) => {
  console.log('🧪 Webhook de prueba recibido:', req.body);
  
  await prisma.webhookLog.create({
    data: {
      source: 'test',
      event: 'test',
      payload: req.body,
      status: 'received',
    }
  });

  res.json({ received: true, timestamp: new Date().toISOString() });
});

// Obtener logs de webhooks (para debugging)
router.get('/logs', async (req: Request, res: Response) => {
  try {
    const logs = await prisma.webhookLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({ logs });
  } catch (error) {
    console.error('Error obteniendo logs:', error);
    res.status(500).json({ error: 'Error al obtener logs' });
  }
});

export default router;
