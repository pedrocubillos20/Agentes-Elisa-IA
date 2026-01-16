import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

// ==========================================
// CONFIGURACIÓN DE WOMPI
// ==========================================
const WOMPI_CONFIG = {
  publicKey: process.env.WOMPI_PUBLIC_KEY || '',
  privateKey: process.env.WOMPI_PRIVATE_KEY || '',
  eventsKey: process.env.WOMPI_EVENT_SECRET || '',
  integrityKey: process.env.WOMPI_INTEGRITY_KEY || '',
  environment: process.env.WOMPI_ENVIRONMENT || 'test',
  get apiUrl() {
    return this.environment === 'production' 
      ? 'https://production.wompi.co/v1'
      : 'https://sandbox.wompi.co/v1';
  }
};

// URLs de Wompi
// Sandbox: https://sandbox.wompi.co/v1
// Producción: https://production.wompi.co/v1

// ==========================================
// INTERFACES
// ==========================================
interface WompiTransaction {
  id: string;
  amount_in_cents: number;
  reference: string;
  customer_email: string;
  currency: string;
  payment_method_type: string;
  status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'VOIDED' | 'ERROR';
  status_message?: string;
  created_at: string;
  finalized_at?: string;
}

interface CreatePaymentLinkParams {
  amountInCents: number;
  currency?: string;
  reference: string;
  customerEmail: string;
  customerName: string;
  description: string;
  redirectUrl: string;
  expiresAt?: string;
}

interface WompiWebhookEvent {
  event: string;
  data: {
    transaction: WompiTransaction;
  };
  environment: 'test' | 'prod';
  signature: {
    properties: string[];
    checksum: string;
  };
  timestamp: number;
  sent_at: string;
}

// ==========================================
// PRECIOS DE PLANES (EN PESOS COLOMBIANOS)
// ==========================================
export const PLAN_PRICES = {
  // Planes Mensuales
  STARTER_MONTHLY: {
    amountCOP: 180000, // ~$45 USD
    name: 'Plan Mensual Starter',
    description: '1 asistente de IA, soporte básico',
  },
  PRO_MONTHLY: {
    amountCOP: 360000, // ~$90 USD
    name: 'Plan Mensual Pro',
    description: '3 asistentes de IA, soporte prioritario',
  },
  BUSINESS_MONTHLY: {
    amountCOP: 720000, // ~$180 USD
    name: 'Plan Mensual Business',
    description: 'Asistentes ilimitados, soporte 24/7',
  },
  // Planes Vitalicios
  STARTER_LIFETIME: {
    amountCOP: 720000, // ~$180 USD
    name: 'Plan Vitalicio Starter',
    description: '1 asistente de IA, acceso permanente',
  },
  PRO_LIFETIME: {
    amountCOP: 1440000, // ~$360 USD
    name: 'Plan Vitalicio Pro',
    description: '5 asistentes de IA, plantillas premium',
  },
  AGENCY_LIFETIME: {
    amountCOP: 2520000, // ~$630 USD
    name: 'Plan Vitalicio Agency',
    description: 'Asistentes ilimitados, marca blanca',
  },
};

// ==========================================
// GENERAR FIRMA DE INTEGRIDAD
// ==========================================
export const generateIntegritySignature = (
  reference: string,
  amountInCents: number,
  currency: string = 'COP'
): string => {
  const concatenated = `${reference}${amountInCents}${currency}${WOMPI_CONFIG.integrityKey}`;
  return crypto.createHash('sha256').update(concatenated).digest('hex');
};

// ==========================================
// VERIFICAR FIRMA DE WEBHOOK
// ==========================================
export const verifyWebhookSignature = (event: WompiWebhookEvent): boolean => {
  try {
    const { signature, data, timestamp } = event;
    const transaction = data.transaction;

    // Construir string según las propiedades indicadas
    let concatenated = '';
    for (const prop of signature.properties) {
      const value = prop.split('.').reduce((obj: any, key) => obj?.[key], { transaction, timestamp });
      concatenated += value;
    }
    concatenated += WOMPI_CONFIG.eventsKey;

    const calculatedChecksum = crypto.createHash('sha256').update(concatenated).digest('hex');
    
    return calculatedChecksum === signature.checksum;
  } catch (error) {
    logger.error('Error verificando firma de Wompi:', error);
    return false;
  }
};

// ==========================================
// CREAR LINK DE PAGO
// ==========================================
export const createPaymentLink = async (params: CreatePaymentLinkParams): Promise<any> => {
  try {
    const {
      amountInCents,
      currency = 'COP',
      reference,
      customerEmail,
      customerName,
      description,
      redirectUrl,
      expiresAt,
    } = params;

    // Generar firma de integridad
    const integritySignature = generateIntegritySignature(reference, amountInCents, currency);

    const response = await fetch(`${WOMPI_CONFIG.apiUrl}/payment_links`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WOMPI_CONFIG.privateKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: description,
        description,
        single_use: true,
        collect_shipping: false,
        currency,
        amount_in_cents: amountInCents,
        redirect_url: redirectUrl,
        expires_at: expiresAt,
        customer_data: {
          email: customerEmail,
          full_name: customerName,
        },
        // Metadata para identificar el pago
        sku: reference,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      logger.error('Error creando link de pago Wompi:', data);
      throw new Error(data.error?.message || 'Error creando link de pago');
    }

    logger.info(`Link de pago creado: ${data.data.id}`);

    return {
      paymentLinkId: data.data.id,
      paymentUrl: `https://checkout.wompi.co/l/${data.data.id}`,
      reference,
      integritySignature,
    };
  } catch (error) {
    logger.error('Error en createPaymentLink:', error);
    throw error;
  }
};

// ==========================================
// CREAR TRANSACCIÓN DIRECTA (CON TOKENIZACIÓN)
// ==========================================
export const createTransaction = async (params: {
  amountInCents: number;
  currency?: string;
  reference: string;
  customerEmail: string;
  paymentMethodToken: string; // Token de tarjeta tokenizada
  installments?: number;
}): Promise<any> => {
  try {
    const {
      amountInCents,
      currency = 'COP',
      reference,
      customerEmail,
      paymentMethodToken,
      installments = 1,
    } = params;

    const response = await fetch(`${WOMPI_CONFIG.apiUrl}/transactions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WOMPI_CONFIG.privateKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount_in_cents: amountInCents,
        currency,
        customer_email: customerEmail,
        payment_method: {
          type: 'CARD',
          token: paymentMethodToken,
          installments,
        },
        reference,
        customer_data: {
          phone_number: '',
          full_name: '',
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      logger.error('Error creando transacción Wompi:', data);
      throw new Error(data.error?.message || 'Error procesando pago');
    }

    return data.data;
  } catch (error) {
    logger.error('Error en createTransaction:', error);
    throw error;
  }
};

// ==========================================
// OBTENER ESTADO DE TRANSACCIÓN
// ==========================================
export const getTransaction = async (transactionId: string): Promise<WompiTransaction> => {
  try {
    const response = await fetch(`${WOMPI_CONFIG.apiUrl}/transactions/${transactionId}`, {
      headers: {
        'Authorization': `Bearer ${WOMPI_CONFIG.privateKey}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Error obteniendo transacción');
    }

    return data.data;
  } catch (error) {
    logger.error('Error en getTransaction:', error);
    throw error;
  }
};

// ==========================================
// PROCESAR WEBHOOK DE WOMPI
// ==========================================
export const processWompiWebhook = async (event: WompiWebhookEvent): Promise<void> => {
  try {
    // Verificar firma
    if (!verifyWebhookSignature(event)) {
      logger.warn('Firma de webhook inválida');
      throw new Error('Invalid webhook signature');
    }

    const transaction = event.data.transaction;
    logger.info(`Webhook Wompi recibido: ${event.event} - ${transaction.id} - ${transaction.status}`);

    // Solo procesar transacciones aprobadas
    if (transaction.status !== 'APPROVED') {
      logger.info(`Transacción ${transaction.id} no aprobada: ${transaction.status}`);
      return;
    }

    // Extraer información de la referencia
    // Formato esperado: "ELISA-{userId}-{plan}-{timestamp}"
    const referenceParts = transaction.reference.split('-');
    if (referenceParts.length < 3 || referenceParts[0] !== 'ELISA') {
      logger.warn(`Referencia no reconocida: ${transaction.reference}`);
      return;
    }

    const userId = referenceParts[1];
    const planKey = referenceParts[2];

    // Determinar el plan
    const planInfo = PLAN_PRICES[planKey as keyof typeof PLAN_PRICES];
    if (!planInfo) {
      logger.warn(`Plan no reconocido: ${planKey}`);
      return;
    }

    // Actualizar usuario
    const planType = planKey.includes('LIFETIME') ? 'LIFETIME' : 'MONTHLY';
    const plan = planKey.replace('_MONTHLY', '').replace('_LIFETIME', '');

    await prisma.user.update({
      where: { id: userId },
      data: {
        plan: plan as any,
        planType: planType as any,
        subscriptionStatus: 'ACTIVE',
      },
    });

    // Registrar el pago
    await prisma.webhookLog.create({
      data: {
        source: 'wompi',
        event: event.event,
        payload: event as any,
        status: 'processed',
      },
    });

    logger.info(`Usuario ${userId} actualizado a plan ${plan} (${planType})`);
  } catch (error) {
    logger.error('Error procesando webhook de Wompi:', error);
    throw error;
  }
};

// ==========================================
// GENERAR REFERENCIA ÚNICA
// ==========================================
export const generatePaymentReference = (userId: string, plan: string): string => {
  const timestamp = Date.now();
  return `ELISA-${userId}-${plan}-${timestamp}`;
};

// ==========================================
// OBTENER URL DEL WIDGET DE CHECKOUT
// ==========================================
export const getCheckoutWidgetConfig = (params: {
  amountInCents: number;
  reference: string;
  publicKey?: string;
  currency?: string;
  redirectUrl: string;
}) => {
  const {
    amountInCents,
    reference,
    publicKey = WOMPI_CONFIG.publicKey,
    currency = 'COP',
    redirectUrl,
  } = params;

  const signature = generateIntegritySignature(reference, amountInCents, currency);

  return {
    publicKey,
    currency,
    amountInCents,
    reference,
    signature,
    redirectUrl,
  };
};
