import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';

const router = Router();
const prisma = new PrismaClient();

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

    // Buscar asistente por API key
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
      return res.status(404).json({ error: 'Asistente no encontrado' });
    }

    if (!assistant.isActive) {
      return res.status(403).json({ error: 'Asistente inactivo' });
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
        data: {
          assistantId: assistant.id,
          channel: 'WEB',
          status: 'ACTIVE',
        },
        include: { messages: true }
      });
    }

    // Guardar mensaje del usuario
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'USER',
        content: message,
      }
    });

    // Construir contexto del negocio
    const businessContext = buildBusinessContext(assistant.business);
    
    // Construir historial de mensajes
    const messageHistory = conversation.messages.map(m => ({
      role: m.role.toLowerCase() as 'user' | 'assistant',
      content: m.content
    }));

    // Generar respuesta con OpenAI
    const startTime = Date.now();
    let reply: string;
    let tokensUsed = 0;

    try {
      const openaiApiKey = assistant.user.openaiApiKey || process.env.OPENAI_API_KEY;
      
      if (!openaiApiKey) {
        reply = generateFallbackResponse(message, assistant.business);
      } else {
        const openai = new OpenAI({ apiKey: openaiApiKey });
        
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
      }
    } catch (aiError) {
      console.error('Error con OpenAI:', aiError);
      reply = generateFallbackResponse(message, assistant.business);
    }

    const responseTime = Date.now() - startTime;

    // Guardar respuesta del asistente
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
      data: {
        messageCount: { increment: 2 },
        lastMessageAt: new Date(),
      }
    });

    res.json({
      reply,
      conversationId: conversation.id,
    });
  } catch (error) {
    console.error('Error en chat:', error);
    res.status(500).json({ error: 'Error al procesar mensaje' });
  }
});

// Construir contexto del negocio
function buildBusinessContext(business: any): string {
  let context = `Negocio: ${business.name}\n`;
  
  if (business.industry) context += `Industria: ${business.industry}\n`;
  if (business.description) context += `Descripción: ${business.description}\n`;
  if (business.contactEmail) context += `Email: ${business.contactEmail}\n`;
  if (business.contactPhone) context += `Teléfono: ${business.contactPhone}\n`;
  if (business.address) context += `Dirección: ${business.address}\n`;
  if (business.businessHours) context += `Horario: ${business.businessHours}\n`;

  if (business.products && business.products.length > 0) {
    context += '\nProductos/Servicios:\n';
    business.products.forEach((p: any) => {
      context += `- ${p.name}`;
      if (p.price) context += ` ($${p.price})`;
      if (p.description) context += `: ${p.description}`;
      context += '\n';
    });
  }

  if (business.faqs && business.faqs.length > 0) {
    context += '\nPreguntas Frecuentes:\n';
    business.faqs.forEach((f: any) => {
      context += `P: ${f.question}\nR: ${f.answer}\n\n`;
    });
  }

  return context;
}

// Construir prompt del sistema
function buildSystemPrompt(assistant: any, businessContext: string): string {
  const toneInstructions: Record<string, string> = {
    'PROFESSIONAL': 'Mantén un tono profesional y formal. Sé cortés y preciso.',
    'FRIENDLY': 'Sé amigable y cercano. Usa un tono cálido y accesible.',
    'CASUAL': 'Sé casual y relajado. Puedes usar expresiones coloquiales.',
  };

  return `Eres ${assistant.name}, un asistente virtual de atención al cliente.

${toneInstructions[assistant.tone] || toneInstructions['PROFESSIONAL']}

INFORMACIÓN DEL NEGOCIO:
${businessContext}

INSTRUCCIONES:
- Responde siempre en español
- Sé conciso pero informativo
- Si no conoces la respuesta, ofrece contactar al equipo humano
- No inventes información que no esté en el contexto
- Si preguntan por precios o productos, usa la información proporcionada
- Mantén las respuestas breves (máximo 2-3 párrafos)`;
}

// Respuesta de fallback cuando no hay API de OpenAI
function generateFallbackResponse(message: string, business: any): string {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('precio') || lowerMessage.includes('costo') || lowerMessage.includes('valor')) {
    if (business.products && business.products.length > 0) {
      const productList = business.products
        .map((p: any) => `• ${p.name}${p.price ? ` - $${p.price}` : ''}`)
        .join('\n');
      return `¡Claro! Estos son nuestros productos y precios:\n\n${productList}\n\n¿Te interesa alguno en particular?`;
    }
    return 'Para información sobre precios, por favor contáctanos directamente.';
  }

  if (lowerMessage.includes('horario') || lowerMessage.includes('hora') || lowerMessage.includes('abierto')) {
    if (business.businessHours) {
      return `Nuestro horario de atención es: ${business.businessHours}`;
    }
    return 'Para conocer nuestros horarios, por favor contáctanos.';
  }

  if (lowerMessage.includes('contacto') || lowerMessage.includes('teléfono') || lowerMessage.includes('email')) {
    let response = 'Puedes contactarnos a través de:\n';
    if (business.contactPhone) response += `📞 ${business.contactPhone}\n`;
    if (business.contactEmail) response += `✉️ ${business.contactEmail}\n`;
    if (business.address) response += `📍 ${business.address}`;
    return response || 'Para información de contacto, visita nuestra página web.';
  }

  if (lowerMessage.includes('hola') || lowerMessage.includes('buenas') || lowerMessage.includes('hi')) {
    return `¡Hola! 👋 Bienvenido a ${business.name}. ¿En qué puedo ayudarte hoy?`;
  }

  return `Gracias por tu mensaje. Un miembro de nuestro equipo en ${business.name} te responderá pronto. ¿Hay algo específico en lo que pueda ayudarte mientras tanto?`;
}

export default router;
