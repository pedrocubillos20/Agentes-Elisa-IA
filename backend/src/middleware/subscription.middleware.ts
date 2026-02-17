import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from './auth.middleware';
import { subscriptionCache } from '../lib/cache';

/**
 * 🔒 SUBSCRIPTION MIDDLEWARE — Uses unified LRU cache
 * 
 * ANTES: Local Map sin límite → memory leak potential
 * AHORA: LRU cache (500 entries max, 60s TTL, auto-cleanup)
 */

export const subscriptionMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { next(); return; }

    // ⚡ Cache hit
    const cached = subscriptionCache.get(userId);
    if (cached) {
      if (cached.isExpired) {
        res.status(403).json({ 
          error: 'subscription_expired',
          message: 'Tu suscripción ha expirado. Renueva tu plan para continuar.',
          blocked: true
        });
        return;
      }
      if (cached.hasImplementation) {
        const isConfigRoute = req.path.startsWith('/api/assistants') || req.originalUrl?.includes('/api/assistants')
          || req.path.startsWith('/api/integrations') || req.originalUrl?.includes('/api/integrations');
        if (isConfigRoute && req.method !== 'GET') {
          res.status(403).json({ error: 'implementation_locked', message: 'Configurada por implementación.', locked: true });
          return;
        }
      }
      next();
      return;
    }

    // Cache miss — DB queries (once per 60s per user)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, plan: true, trialEndsAt: true, parentUserId: true }
    });
    if (!user) { next(); return; }

    const ownerId = user.parentUserId || user.id;
    let isExpired = false;

    if (user.parentUserId) {
      const parent = await prisma.user.findUnique({
        where: { id: user.parentUserId },
        select: { plan: true, trialEndsAt: true }
      });
      if (parent) isExpired = await checkExpired(parent.plan, parent.trialEndsAt, user.parentUserId);
    } else {
      isExpired = await checkExpired(user.plan, user.trialEndsAt, user.id);
    }

    const hasImplementation = !!(await prisma.payment.findFirst({
      where: { userId: ownerId, plan: 'implementation', status: 'approved' }
    }));

    // ⚡ Store in unified cache
    subscriptionCache.set(userId, { isExpired, hasImplementation });

    if (isExpired) {
      res.status(403).json({ error: 'subscription_expired', message: 'Tu suscripción ha expirado.', blocked: true });
      return;
    }

    if (hasImplementation) {
      const isConfigRoute = req.path.startsWith('/api/assistants') || req.originalUrl?.includes('/api/assistants')
        || req.path.startsWith('/api/integrations') || req.originalUrl?.includes('/api/integrations');
      if (isConfigRoute && req.method !== 'GET') {
        res.status(403).json({ error: 'implementation_locked', message: 'Configurada por implementación.', locked: true });
        return;
      }
    }

    next();
  } catch (error) {
    console.error('⚠️ subscriptionMiddleware error:', error);
    next();
  }
};

export const invalidateSubscriptionCache = (userId: string) => {
  subscriptionCache.delete(userId);
};

async function checkExpired(plan: string, trialEndsAt: Date | null, userId: string): Promise<boolean> {
  if (plan === 'trial') {
    if (!trialEndsAt) return false;
    return trialEndsAt.getTime() < Date.now();
  }
  const subscription = await prisma.subscription.findUnique({ where: { userId } });
  if (!subscription) return true;
  if (subscription.status === 'cancelled' || subscription.status === 'expired') return true;
  if (subscription.currentPeriodEnd.getTime() < Date.now()) return true;
  return false;
}
