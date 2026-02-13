import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from './auth.middleware';

/**
 * 🔒 MIDDLEWARE DE SUSCRIPCIÓN
 * Bloquea el acceso a TODAS las herramientas cuando:
 * - El trial de 7 días expiró
 * - La suscripción venció y no renovó
 * 
 * Permite acceso a:
 * - /api/auth/* (login, register, me)
 * - /api/subscription/* (para que pueda pagar)
 * - Webhooks (no pasan por este middleware)
 */
export const subscriptionMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { next(); return; }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, plan: true, trialEndsAt: true, parentUserId: true }
    });

    if (!user) { next(); return; }

    // Sub-usuarios heredan el plan del padre
    const ownerId = user.parentUserId || user.id;
    let isExpired = false;

    if (user.parentUserId) {
      // Verificar plan del padre
      const parent = await prisma.user.findUnique({
        where: { id: user.parentUserId },
        select: { plan: true, trialEndsAt: true }
      });
      if (parent) {
        isExpired = await checkExpired(parent.plan, parent.trialEndsAt, user.parentUserId);
      }
    } else {
      isExpired = await checkExpired(user.plan, user.trialEndsAt, user.id);
    }

    if (isExpired) {
      res.status(403).json({ 
        error: 'subscription_expired',
        message: 'Tu suscripción ha expirado. Renueva tu plan para continuar usando la plataforma.',
        blocked: true
      });
      return;
    }

    // 🔒 Si el usuario compró addon de implementación: bloquear modificaciones a configuración
    // Solo el equipo implementador puede modificar (el usuario puede ver/GET)
    const hasImplementation = await prisma.payment.findFirst({
      where: { userId: user.parentUserId || user.id, plan: 'implementation', status: 'approved' }
    });
    
    if (hasImplementation) {
      const isConfigRoute = req.path.startsWith('/api/assistants') || req.originalUrl?.includes('/api/assistants')
        || req.path.startsWith('/api/integrations') || req.originalUrl?.includes('/api/integrations');
      
      // Allow GET requests (viewing is ok), block POST/PUT/DELETE (modifications)
      if (isConfigRoute && req.method !== 'GET') {
        res.status(403).json({
          error: 'implementation_locked',
          message: 'Esta función es configurada por el equipo de implementación. Contacta soporte para cambios.',
          locked: true
        });
        return;
      }
    }

    next();
  } catch (error) {
    // En caso de error, permitir acceso (no bloquear por error del sistema)
    console.error('⚠️ Error en subscriptionMiddleware:', error);
    next();
  }
};

async function checkExpired(plan: string, trialEndsAt: Date | null, userId: string): Promise<boolean> {
  if (plan === 'trial') {
    if (!trialEndsAt) return false;
    return trialEndsAt.getTime() < Date.now();
  }
  
  // Plan de pago — verificar suscripción activa
  const subscription = await prisma.subscription.findUnique({ 
    where: { userId } 
  });
  
  if (!subscription) return true; // Tiene plan pero no suscripción = expirado
  if (subscription.status === 'cancelled' || subscription.status === 'expired') return true;
  if (subscription.currentPeriodEnd.getTime() < Date.now()) return true;
  
  return false;
}
