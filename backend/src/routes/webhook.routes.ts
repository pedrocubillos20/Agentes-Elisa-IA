import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import crypto from 'crypto';

const router = Router();

// Mapeo de planes
const PLAN_MAPPING: Record<string, { plan: string; planType: string }> = {
  'EMPRENDEDORES': { plan: 'EMPRENDEDORES', planType: 'MONTHLY' },
  'NEGOCIOS': { plan: 'NEGOCIOS', planType: 'MONTHLY' },
  'BUSINESS': { plan: 'BUSINESS', planType: 'LIFETIME' },
  'MARCA_BLANCA': { plan: 'MARCA_BLANCA', planType: 'LIFETIME' },
};

// Verificar firma de Wompi
const verifyWompiSignature = (event: any): boolean => {
  const eventSecret = process.env.WOMPI_EVENT_SECRET;
  if (!eventSecret) return true; // En desarrollo

  const { data, signature } = event;
  if (!signature?.checksum) return false;

  const properties = signature.properties || [];
  const values = properties.map((prop: string) => {
    const keys = prop.split('.');
    let value = data;
    for (const key of keys) {
      value = value?.[key];
    }
    return value;
  });

  const dataToSign = values.join('') + signature.timestamp + eventSecret;
  const expectedChecksum = crypto.createHash('sha256').update(dataToSign).digest('hex');

  return expectedChecksum === signature.checksum;
};

// Webhook de Wompi
router.post('/wompi', async (req: Request, res: Response) => {
  try {
    const event = req.body;
    console.log('📥 Webhook Wompi recibido:', event.event);

    // Registrar log
    await prisma.webhookLog.create({
      data: {
        source: 'wompi',
        event: event.event || 'unknown',
        payload: event,
        status: 'received',
      }
    });

    // Verificar firma en producción
    if (process.env.NODE_ENV === 'production' && !verifyWompiSignature(event)) {
      console.error('❌ Firma de Wompi inválida');
      return res.status(401).json({ error: 'Firma inválida' });
    }

    // Procesar evento
    if (event.event === 'transaction.updated') {
      const transaction = event.data?.transaction;
      if (!transaction) {
        return res.status(400).json({ error: 'Sin datos de transacción' });
      }

      const { reference, status, id: wompiId, payment_method_type } = transaction;

      // Actualizar pago
      const payment = await prisma.payment.findUnique({ where: { reference } });
      if (!payment) {
        console.log(`⚠️ Pago no encontrado: ${reference}`);
        return res.json({ received: true });
      }

      await prisma.payment.update({
        where: { reference },
        data: {
          status,
          wompiId,
          paymentMethod: payment_method_type,
        }
      });

      console.log(`💳 Pago ${reference} actualizado a ${status}`);

      // Si fue aprobado, actualizar plan del usuario
      if (status === 'APPROVED') {
        const planMapping = PLAN_MAPPING[payment.plan];
        if (planMapping) {
          await prisma.user.update({
            where: { id: payment.userId },
            data: {
              plan: planMapping.plan as any,
              planType: planMapping.planType as any,
              subscriptionStatus: 'ACTIVE',
            }
          });
          console.log(`✅ Usuario ${payment.userId} actualizado a plan ${payment.plan}`);
        }
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Error webhook Wompi:', error);
    res.status(500).json({ error: 'Error procesando webhook' });
  }
});

// Webhook de prueba
router.post('/test', (req: Request, res: Response) => {
  console.log('🧪 Webhook test:', req.body);
  res.json({ received: true, timestamp: new Date().toISOString() });
});

// Ver logs
router.get('/logs', async (req: Request, res: Response) => {
  try {
    const logs = await prisma.webhookLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener logs' });
  }
});

export default router;
