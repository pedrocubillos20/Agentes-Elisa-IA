import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';
import CryptoJS from 'crypto-js';

const router = Router();
const prisma = new PrismaClient();
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'clave-encriptacion-32-caracteres!';

// Desencriptar API Key
const decryptApiKey = (encrypted: string): string => {
  const bytes = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
};

// Ruta pública de chat (usada por el widget)
router.post('/', async (req: Request, res: Response) => {
  try {
    const apiKey = req.headers['x-api-key'] as string;
    const { message, conversationId } = req.body;

    if (!apiKey) {
      return res.status(401).json({ error: 'API Key requerida' });
    }

    if (!message) {
      return res.status(400).json({ error: 'Mensaje requerido' });
    }

    // Buscar asistente
    const assistant = await prisma.assistant.findUnique({
      where: { publicApiKey: apiKey },
      include: {
        business: {
          include: {
            products: { where: { isActive: true } },
            faqs: { orderBy: { order: 'asc' } },
          }
        },
        user: true,
      }
    });

    if (!assistant) {
      return res.status(404).json({ error: 'Chatbot no encontrado' });
    }

    if (!assistant.isActive) {
      return res.status(403).json({ error: 'Chatbot inactivo' });
    }

    // Verificar que el usuario tenga API Key de OpenAI
    if (!assistant.user.openaiApiKey) {
      return res.status(403).json({ 
        error: 'El propietario del chatbot no ha configurado su API Key de OpenAI' 
      });
    }

    // Obtener o crear conversación
    let conversation;
    if (conversationId) {
      conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, assistantId: assistant.id },
        include: { messages: { orderBy: { createdAt: 'asc' }, take: 20 } }
      });
    }

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { assistantId: assistant.id, channel: 'WEB', status: 'ACTIVE' },
        include: { messages: true }
      });
    }

    // Guardar mensaje del usuario
    await prisma.message.create({
      data: { conversationId: conversation.id, role: 'USER', content: message }
    });

    // Construir contexto
    const businessContext = buildBusinessContext(assistant.business);
    const messageHistory = conversation.messages.map(m => ({
      role: m.role.toLowerCase() as 'user' | 'assistant',
      content: m.content
    }));

    // Generar respuesta con OpenAI
    const startTime = Date.now();
    let reply: string;
    let tokensUsed = 0;

    try {
      const userApiKey = decryptApiKey(assistant.user.openaiApiKey);
      const openai = new OpenAI({ apiKey: userApiKey });

      const systemPrompt = assistant.systemPrompt || buildSystemPrompt(assistant, businessContext);

      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messageHistory,
          { role: 'user', content: message }
        ],
        max_tokens: 500,
        temperature: 0.7,
      });

      reply = completion.choices[0]?.message?.content || 'Lo siento, no pude procesar tu mensaje.';
      tokensUsed = completion.usage?.total_tokens || 0;
    } catch (aiError: any) {
      console.error('Error OpenAI:', aiError?.message);
      reply = generateFallbackResponse(message, assistant.business);
    }

    const responseTime = Date.now() - startTime;

    // Guardar respuesta
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content: reply,
        tokensUsed,
        responseTime,
      }
    });

    // Actualizar conversación
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { messageCount: { increment: 2 }, lastMessageAt: new Date() }
    });

    res.json({ reply, conversationId: conversation.id });
  } catch (error) {
    console.error('Error chat:', error);
    res.status(500).json({ error: 'Error al procesar mensaje' });
  }
});

function buildBusinessContext(business: any): string {
  let ctx = `Negocio: ${business.name}\n`;
  if (business.industry) ctx += `Industria: ${business.industry}\n`;
  if (business.description) ctx += `Descripción: ${business.description}\n`;
  if (business.contactEmail) ctx += `Email: ${business.contactEmail}\n`;
  if (business.contactPhone) ctx += `Teléfono: ${business.contactPhone}\n`;
  if (business.businessHours) ctx += `Horario: ${business.businessHours}\n`;

  if (business.products?.length > 0) {
    ctx += '\nProductos:\n';
    business.products.forEach((p: any) => {
      ctx += `- ${p.name}${p.price ? ` ($${p.price})` : ''}${p.description ? `: ${p.description}` : ''}\n`;
    });
  }

  if (business.faqs?.length > 0) {
    ctx += '\nPreguntas Frecuentes:\n';
    business.faqs.forEach((f: any) => {
      ctx += `P: ${f.question}\nR: ${f.answer}\n\n`;
    });
  }

  return ctx;
}

function buildSystemPrompt(assistant: any, businessContext: string): string {
  const tones: Record<string, string> = {
    'PROFESSIONAL': 'Mantén un tono profesional y formal.',
    'FRIENDLY': 'Sé amigable y cercano.',
    'CASUAL': 'Sé casual y relajado.',
  };

  return `Eres ${assistant.name}, un asistente virtual de atención al cliente.
${tones[assistant.tone] || tones['PROFESSIONAL']}

INFORMACIÓN DEL NEGOCIO:
${businessContext}

INSTRUCCIONES:
- Responde siempre en español
- Sé conciso pero informativo
- Si no conoces la respuesta, ofrece contactar al equipo
- No inventes información
- Mantén respuestas breves (máximo 2-3 párrafos)`;
}

function generateFallbackResponse(message: string, business: any): string {
  const lower = message.toLowerCase();

  if (lower.includes('precio') || lower.includes('costo')) {
    if (business.products?.length > 0) {
      const list = business.products.map((p: any) => `• ${p.name}${p.price ? ` - $${p.price}` : ''}`).join('\n');
      return `Nuestros productos:\n\n${list}\n\n¿Te interesa alguno?`;
    }
    return 'Para precios, contáctanos directamente.';
  }

  if (lower.includes('horario')) {
    return business.businessHours ? `Horario: ${business.businessHours}` : 'Contáctanos para horarios.';
  }

  if (lower.includes('hola') || lower.includes('buenas')) {
    return `¡Hola! 👋 Bienvenido a ${business.name}. ¿En qué puedo ayudarte?`;
  }

  return `Gracias por tu mensaje. Un miembro de ${business.name} te responderá pronto.`;
}

export default router;
