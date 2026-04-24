/**
 * 📐 ZOD SCHEMAS — Validación centralizada
 * 
 * CORRECCIÓN: Centraliza la validación de todos los inputs de la API.
 * Sin esto, cualquier campo puede ser null/undefined/XSS sin detección.
 * 
 * Uso en rutas:
 *   import { validateBody } from '../middleware/validate.middleware';
 *   import { LoginSchema } from '../lib/schemas';
 *   router.post('/login', validateBody(LoginSchema), handler);
 */

import { z } from 'zod';

// ===== PRIMITIVOS =====
export const EmailSchema = z.string().trim().email('Email inválido').toLowerCase();
export const PasswordSchema = z.string().min(8, 'Mínimo 8 caracteres').max(128, 'Máximo 128 caracteres');
export const PhoneSchema = z.string().regex(/^[0-9+\-\s()]{7,20}$/, 'Teléfono inválido');
export const CuidSchema = z.string().cuid('ID inválido');
export const UrlSchema = z.string().url('URL inválida');

// ===== AUTH =====
export const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, 'Contraseña requerida').max(128),
});

export const RegisterSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  name: z.string().trim().min(1, 'Nombre requerido').max(100),
  phone: PhoneSchema.optional(),
});

export const ForgotPasswordSchema = z.object({
  email: EmailSchema,
});

export const ResetPasswordSchema = z.object({
  email: EmailSchema,
  code: z.string().length(6, 'Código de 6 dígitos').regex(/^\d+$/, 'Solo números'),
  newPassword: PasswordSchema,
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Contraseña actual requerida'),
  newPassword: PasswordSchema,
});

// ===== ASISTENTES =====
export const AssistantCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  context: z.string().max(50000).optional(),
  personality: z.string().max(10000).optional(),
  businessInfo: z.string().max(20000).optional(),
  instructions: z.string().max(50000).optional(),
  model: z.enum(['gpt-4-turbo-preview', 'gpt-4', 'gpt-3.5-turbo', 'gpt-4o', 'gpt-4o-mini']).default('gpt-4-turbo-preview'),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().min(100).max(4000).default(500),
  voiceEnabled: z.boolean().default(false),
  autoLearn: z.boolean().default(true),
});

export const AssistantUpdateSchema = AssistantCreateSchema.partial();

// ===== CONVERSACIONES =====
export const SendMessageSchema = z.object({
  conversationId: CuidSchema,
  text: z.string().min(1).max(10000),
  mediaUrl: UrlSchema.optional(),
  mediaType: z.enum(['image', 'video', 'audio', 'document', 'sticker']).optional(),
});

// ===== CLIENTES =====
export const ClientCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: PhoneSchema.optional(),
  email: EmailSchema.optional(),
  notes: z.string().max(5000).optional(),
  stage: z.string().max(50).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

export const ClientUpdateSchema = ClientCreateSchema.partial();

// ===== CITAS =====
export const AppointmentCreateSchema = z.object({
  clientId: CuidSchema.optional(),
  title: z.string().trim().min(1).max(200),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  notes: z.string().max(5000).optional(),
  resourceId: CuidSchema.optional(),
});

// ===== PRODUCTOS =====
export const ProductCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  price: z.number().min(0).optional(),
  sku: z.string().max(100).optional(),
  category: z.string().max(100).optional(),
  stock: z.number().int().min(0).optional(),
  imageUrl: UrlSchema.optional(),
});

// ===== EQUIPO =====
export const InviteTeamSchema = z.object({
  email: EmailSchema,
  name: z.string().trim().min(1).max(100),
  role: z.enum(['admin', 'manager', 'agent', 'support', 'viewer']).default('agent'),
});

// ===== MENSAJES PROGRAMADOS =====
export const ScheduledMessageSchema = z.object({
  recipientPhone: PhoneSchema,
  text: z.string().min(1).max(10000),
  scheduledAt: z.string().datetime(),
  whatsappLineId: CuidSchema.optional(),
  mediaUrl: UrlSchema.optional(),
});

// ===== PAGOS =====
export const PaymentCreateSchema = z.object({
  plan: z.enum(['starter', 'business', 'extra_line', 'extra_storage', 'implementation']),
  paymentMethod: z.string().max(50).optional(),
});

// ===== TIPOS INFERIDOS =====
export type LoginInput = z.infer<typeof LoginSchema>;
export type RegisterInput = z.infer<typeof RegisterSchema>;
export type AssistantCreateInput = z.infer<typeof AssistantCreateSchema>;
export type AssistantUpdateInput = z.infer<typeof AssistantUpdateSchema>;
export type SendMessageInput = z.infer<typeof SendMessageSchema>;
export type ClientCreateInput = z.infer<typeof ClientCreateSchema>;
export type AppointmentCreateInput = z.infer<typeof AppointmentCreateSchema>;
