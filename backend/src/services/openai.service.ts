import OpenAI from 'openai';
import { logger } from '../utils/logger';

// ==========================================
// VALIDAR API KEY DE OPENAI
// ==========================================
export const validateOpenAIKey = async (apiKey: string): Promise<boolean> => {
  try {
    const openai = new OpenAI({ apiKey });
    
    // Hacer una solicitud simple para verificar la key
    await openai.models.list();
    return true;
  } catch (error: any) {
    logger.warn(`API Key inválida: ${error.message}`);
    return false;
  }
};

// ==========================================
// OBTENER CRÉDITOS DISPONIBLES
// ==========================================
export const getOpenAICredits = async (apiKey: string): Promise<any> => {
  try {
    // Nota: OpenAI no tiene una API directa para verificar créditos
    // Esto es un placeholder - en producción podrías usar la API de billing
    // o simplemente informar al usuario que gestione sus créditos en OpenAI
    
    return {
      message: 'Gestiona tus créditos directamente en platform.openai.com',
      status: 'connected',
    };
  } catch (error: any) {
    logger.error(`Error verificando créditos: ${error.message}`);
    throw error;
  }
};

// ==========================================
// GENERAR RESPUESTA DEL ASISTENTE
// ==========================================
export const generateAssistantResponse = async (
  apiKey: string,
  systemPrompt: string,
  conversationHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  userMessage: string
): Promise<{ response: string; tokensUsed: number }> => {
  try {
    const openai = new OpenAI({ apiKey });

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      { role: 'user', content: userMessage },
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Modelo económico por defecto
      messages,
      max_tokens: 1000,
      temperature: 0.7,
    });

    const response = completion.choices[0]?.message?.content || 'Lo siento, no pude generar una respuesta.';
    const tokensUsed = completion.usage?.total_tokens || 0;

    return { response, tokensUsed };
  } catch (error: any) {
    logger.error(`Error generando respuesta: ${error.message}`);
    throw new Error('Error al procesar tu mensaje. Por favor intenta de nuevo.');
  }
};

// ==========================================
// GENERAR SYSTEM PROMPT DESDE INFO DEL NEGOCIO
// ==========================================
export const generateSystemPrompt = (config: {
  assistantName: string;
  businessName: string;
  industry: string;
  description: string;
  products: Array<{ name: string; price?: number; description?: string }>;
  faqs: Array<{ question: string; answer: string }>;
  tone: string;
  customInstructions?: string;
  businessHours?: string;
}): string => {
  const {
    assistantName,
    businessName,
    industry,
    description,
    products,
    faqs,
    tone,
    customInstructions,
    businessHours,
  } = config;

  const toneDescriptions: Record<string, string> = {
    FRIENDLY: 'amigable, cercano y casual. Usa emojis ocasionalmente para hacer la conversación más cálida.',
    PROFESSIONAL: 'profesional pero accesible. Mantén un tono formal sin ser frío.',
    TECHNICAL: 'técnico y preciso. Proporciona información detallada y exacta.',
    SALES: 'orientado a ventas, persuasivo pero no agresivo. Busca oportunidades para cerrar.',
  };

  let prompt = `Eres ${assistantName}, el asistente virtual de ${businessName}.

## SOBRE EL NEGOCIO
- Industria: ${industry}
- Descripción: ${description}
${businessHours ? `- Horario de atención: ${businessHours}` : ''}

## TU PERSONALIDAD
Debes ser ${toneDescriptions[tone] || toneDescriptions.FRIENDLY}

## PRODUCTOS/SERVICIOS DISPONIBLES
${products.map(p => `- ${p.name}${p.price ? ` - $${p.price}` : ''}${p.description ? `: ${p.description}` : ''}`).join('\n')}

## PREGUNTAS FRECUENTES
${faqs.map(f => `P: ${f.question}\nR: ${f.answer}`).join('\n\n')}

## INSTRUCCIONES IMPORTANTES
1. Responde SOLO sobre temas relacionados con ${businessName}.
2. Si no conoces la respuesta, sugiere contactar al equipo humano.
3. No inventes información sobre productos o precios.
4. Sé breve y directo, pero siempre amable.
5. Si el cliente muestra interés de compra, intenta capturar su información de contacto.
`;

  if (customInstructions) {
    prompt += `\n## INSTRUCCIONES ESPECIALES DEL NEGOCIO\n${customInstructions}\n`;
  }

  prompt += `
## LIMITACIONES
- No puedes procesar pagos directamente.
- No puedes acceder a información personal del cliente que no te hayan dado.
- No puedes hacer promesas que el negocio no pueda cumplir.
`;

  return prompt;
};
