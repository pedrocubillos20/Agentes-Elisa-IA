import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// Planes disponibles
const PLANS = {
  FREE: { name: 'Gratis', price: 0, assistants: 1 },
  EMPRENDEDORES: { name: 'Emprendedores', price: 29900, assistants: 1 },
  NEGOCIOS: { name: 'Negocios', price: 59900, assistants: 3 },
  BUSINESS: { name: 'Business', price: 99900, assistants: 5 },
  MARCA_BLANCA: { name: 'Marca Blanca', price: 299900, assistants: 999 },
};

// Obtener planes disponibles
router.get('/plans', (req, res) => {
  res.json(PLANS);
});

// Crear preferencia de pago (placeholder - integrar con pasarela real)
router.post('/create-preference', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { plan } = req.body;
    
    if (!plan || !PLANS[plan as keyof typeof PLANS]) {
      return res.status(400).json({ error: 'Plan inválido' });
    }
    
    const planData = PLANS[plan as keyof typeof PLANS];
    
    // Aquí iría la integración con Wompi, MercadoPago, etc.
    // Por ahora retornamos un placeholder
    
    res.json({ 
      preferenceId: `pref_${Date.now()}`,
      plan: plan,
      amount: planData.price,
      message: 'Preferencia creada (modo demo)'
    });
  } catch (error: any) {
    console.error('Error creando preferencia:', error);
    res.status(500).json({ error: 'Error al crear preferencia de pago' });
  }
});

// Webhook de pago
router.post('/webhook', async (req, res) => {
  try {
    console.log('💰 Webhook de pago recibido:', req.body);
    
    // Procesar el webhook de la pasarela de pago
    // Actualizar el plan del usuario según el pago
    
    res.json({ received: true });
  } catch (error) {
    console.error('Error en webhook de pago:', error);
    res.status(500).json({ error: 'Error procesando webhook' });
  }
});

// Actualizar plan manualmente (admin o después de pago confirmado)
router.put('/update-plan', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { plan } = req.body;
    
    const validPlans = ['FREE', 'EMPRENDEDORES', 'NEGOCIOS', 'BUSINESS', 'MARCA_BLANCA'];
    
    if (!validPlans.includes(plan)) {
      return res.status(400).json({ error: 'Plan inválido' });
    }
    
    const user = await prisma.user.update({
      where: { id: userId },
      data: { plan: plan as any }
    });
    
    console.log(`✅ Plan actualizado a ${plan} para usuario ${userId}`);
    
    res.json({ 
      message: 'Plan actualizado correctamente',
      plan: user.plan 
    });
  } catch (error: any) {
    console.error('Error actualizando plan:', error);
    res.status(500).json({ error: 'Error al actualizar plan' });
  }
});

// Obtener historial de pagos (placeholder)
router.get('/history', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // Aquí iría la consulta al historial de pagos
    res.json([]);
  } catch (error: any) {
    console.error('Error obteniendo historial:', error);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

export default router;
