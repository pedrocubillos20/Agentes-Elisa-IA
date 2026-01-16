import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { decryptApiKey } from '../utils/encryption';
import { generateAssistantResponse } from './openai.service';

const prisma = new PrismaClient();

interface WhatsAppMessage {
  from: string;
  messageId: string;
  timestamp: string;
  type: string;
  text?: string;
  phoneNumberId: string;
}

// ==========================================
// PROCESAR MENSAJE DE WHATSAPP
// ==========================================
export const processWhatsAppMessage = async (message: WhatsAppMessage) => {
  try {
    const { from, messageId, text, phoneNumberId } = message;

    if (!text) {
      logger.info(`Mensaje no de texto recibido de ${from}`);
      return;
    }

    logger.info(`Mensaje recibido de ${from}: ${text}`);

    // Buscar asistente vinculado a este número de WhatsApp
    // Por ahora buscamos el primer asistente activo del negocio con ese WhatsApp
    const assistant = await prisma.assistant.findFirst({
      where: {
        isActive: true,
        business: {
          whatsapp: { contains: phoneNumberId },
        },
      },
      include: {
        business: true,
        user: true,
      },
    });

    if (!assistant) {
      logger.warn(`No se encontró asistente para el número: ${phoneNumberId}`);
      return;
    }

    // Verificar que el usuario tiene API Key
    if (!assistant.user.openaiApiKey) {
      logger.warn(`Usuario ${assistant.userId} no tiene API Key configurada`);
      return;
    }

    // Buscar o crear conversación
    let conversation = await prisma.conversation.findFirst({
      where: {
        assistantId: assistant.id,
        clientPhone: from,
        status: 'ACTIVE',
      },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 20, // Últimos 20 mensajes para contexto
        },
      },
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          assistantId: assistant.id,
          clientId: from,
          clientPhone: from,
          channel: 'WHATSAPP',
        },
        include: {
          messages: true,
        },
      });
    }

    // Guardar mensaje del usuario
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'USER',
        content: text,
        whatsappMsgId: messageId,
      },
    });

    // Preparar historial de conversación
    const conversationHistory = conversation.messages.map(m => ({
      role: m.role.toLowerCase() as 'user' | 'assistant',
      content: m.content,
    }));

    // Generar respuesta con OpenAI
    const apiKey = decryptApiKey(assistant.user.openaiApiKey);
    const startTime = Date.now();

    const { response, tokensUsed } = await generateAssistantResponse(
      apiKey,
      assistant.systemPrompt,
      conversationHistory,
      text
    );

    const responseTime = Date.now() - startTime;

    // Guardar respuesta del asistente
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content: response,
        tokensUsed,
        responseTime,
      },
    });

    // Actualizar contadores de conversación
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        messageCount: { increment: 2 },
        lastMessageAt: new Date(),
      },
    });

    // Enviar respuesta por WhatsApp
    await sendWhatsAppMessage(phoneNumberId, from, response);

    logger.info(`Respuesta enviada a ${from}`);
  } catch (error) {
    logger.error('Error procesando mensaje de WhatsApp:', error);
  }
};

// ==========================================
// ENVIAR MENSAJE DE WHATSAPP
// ==========================================
export const sendWhatsAppMessage = async (
  phoneNumberId: string,
  to: string,
  message: string
) => {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: message },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Error enviando mensaje: ${JSON.stringify(error)}`);
    }

    return await response.json();
  } catch (error) {
    logger.error('Error enviando mensaje de WhatsApp:', error);
    throw error;
  }
};

// ==========================================
// ENVIAR MENSAJE DE PLANTILLA (PARA INICIAR CONVERSACIONES)
// ==========================================
export const sendWhatsAppTemplate = async (
  phoneNumberId: string,
  to: string,
  templateName: string,
  languageCode: string = 'es'
) => {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: templateName,
            language: { code: languageCode },
          },
        }),
      }
    );

    return await response.json();
  } catch (error) {
    logger.error('Error enviando plantilla de WhatsApp:', error);
    throw error;
  }
};
