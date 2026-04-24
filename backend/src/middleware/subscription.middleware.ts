import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from './auth.middleware';
import { subscriptionCache } from '../lib/cache';
import logger from '../lib/logger';

export const subscriptionMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as AuthRequest).user?.id;
    if (!userId) { next(); return; }

    const isImpersonating = !!(req as AuthRequest).user?.impersonatedBy;

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
      if (cached.hasImplementation && !isImpersonating) {
        const isConfigRoute = req.path.startsWith('/api/assistants') || req.originalUrl?.includes('/api/assistants');
        if (isConfigRoute && req.method !== 'GET') {
          res.status(403).json({ error: 'implementation_locked', message: 'Configurada por implementación.', locked: true });
          return;
        }
      }
      next();
      return;
    }

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

    subscriptionCache.set(userId, { isExpired, hasImplementation });

    if (isExpired) {
      res.status(403).json({ error: 'subscription_expired', message: 'Tu suscripción ha expirado.', blocked: true });
      return;
    }

    if (hasImplementation && !isImpersonating) {
      const isConfigRoute = req.path.startsWith('/api/assistants') || req.originalUrl?.includes('/api/assistants');
      if (isConfigRoute && req.method !== 'GET') {
        res.status(403).json({ error: 'implementation_locked', message: 'Configurada por implementación.', locked: true });
        return;
      }
    }

    next();
  } catch (error: any) {
    logger.error('subscriptionMiddleware error', { error: error.message });
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
