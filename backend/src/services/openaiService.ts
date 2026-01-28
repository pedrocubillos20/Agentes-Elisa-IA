import OpenAI from 'openai';
import prisma from '../lib/prisma';

class OpenAIService {
  constructor() {
    console.log('✅ Servicio OpenAI inicializado');
  }

  async generateResponse(
    userId: string, 
    message: string, 
    history: Array<{ role: string; content: string }>
  ): Promise<{ success: boolean; response?: string; error?: string }> {
    try {
      // Obtener usuario con su API Key
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        return { success: false, error: 'Usuario no encontrado' };
      }

      // Obtener API Key del usuario (campo apiKeyEncrypted)
      const userApiKey = user.apiKeyEncrypted;
      
      if (!userApiKey) {
        console.log('⚠️ Usuario sin API Key configurada');
        return { 
          success: true, 
          response: '⚠️ No tienes configurada tu API Key de OpenAI. Por favor, ve a Configuración y agrega tu API Key para activar el asistente.' 
        };
      }

      // Obtener asistente activo del usuario
      const assistant = await prisma.assistant.findFirst({
        where: { userId, isActive: true }
      });

      if (!assistant) {
        console.log('⚠️ No hay asistente activo');
        return { 
          success: true, 
          response: '¡Hola! Gracias por escribirnos. En este momento no tenemos un asistente configurado. Por favor, intenta más tarde.' 
        };
      }

      // Crear cliente OpenAI con la API Key del usuario
      const openai = new OpenAI({ apiKey: userApiKey });

      // Construir el prompt del sistema
      let systemPrompt = `Eres un asistente virtual llamado "${assistant.name}".`;
      
      if (assistant.context) {
        systemPrompt += `\n\nContexto e instrucciones:\n${assistant.context}`;
      }
      
      if (assistant.personality) {
        systemPrompt += `\n\nPersonalidad:\n${assistant.personality}`;
      }
      
      if (assistant.businessInfo) {
        systemPrompt += `\n\nInformación del negocio:\n${assistant.businessInfo}`;
      }
      
      if (assistant.instructions) {
        systemPrompt += `\n\nInstrucciones adicionales:\n${assistant.instructions}`;
      }

      // Construir mensajes para OpenAI
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: systemPrompt }
      ];

      // Agregar historial de conversación
      for (const msg of history) {
        if (msg.role === 'user') {
          messages.push({ role: 'user', content: msg.content });
        } else if (msg.role === 'assistant') {
          messages.push({ role: 'assistant', content: msg.content });
        }
      }

      // Agregar mensaje actual
      messages.push({ role: 'user', content: message });

      console.log(`🤖 Generando respuesta con modelo: ${assistant.model}`);

      // Llamar a OpenAI
      const completion = await openai.chat.completions.create({
        model: assistant.model || 'gpt-3.5-turbo',
        messages: messages,
        temperature: assistant.temperature || 0.7,
        max_tokens: assistant.maxTokens || 500
      });

      const response = completion.choices[0]?.message?.content;

      if (!response) {
        return { success: false, error: 'No se recibió respuesta de OpenAI' };
      }

      return { success: true, response };
    } catch (error: any) {
      console.error('❌ Error en OpenAI:', error.message);
      
      // Manejar errores específicos de OpenAI
      if (error.message?.includes('API key')) {
        return { success: false, error: 'API Key inválida. Por favor, verifica tu configuración.' };
      }
      if (error.message?.includes('quota') || error.message?.includes('billing')) {
        return { success: false, error: 'Sin créditos en OpenAI. Por favor, recarga tu cuenta.' };
      }
      
      return { success: false, error: error.message };
    }
  }
}

export const openaiService = new OpenAIService();
