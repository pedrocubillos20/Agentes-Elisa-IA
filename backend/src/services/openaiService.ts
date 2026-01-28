import OpenAI from 'openai';
import prisma from '../lib/prisma';

class OpenAIService {
  private openai: OpenAI | null = null;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
      console.log('✅ Servicio OpenAI inicializado');
    } else {
      console.log('⚠️ OPENAI_API_KEY no configurada');
    }
  }

  async generateResponse(
    userId: string, 
    message: string, 
    history: Array<{ role: string; content: string }>
  ): Promise<{ success: boolean; response?: string; error?: string }> {
    try {
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

      // Obtener configuración del usuario
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      const openaiApiKey = user?.openaiApiKey || process.env.OPENAI_API_KEY;
      
      if (!openaiApiKey) {
        return { success: false, error: 'No hay API Key de OpenAI configurada' };
      }

      const openai = new OpenAI({ apiKey: openaiApiKey });

      // Construir el prompt del sistema
      let systemPrompt = `Eres un asistente virtual llamado "${assistant.name}".`;
      
      if (assistant.context) {
        systemPrompt += `\n\nContexto e instrucciones:\n${assistant.context}`;
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

      // Llamar a OpenAI
      const completion = await openai.chat.completions.create({
        model: assistant.model || 'gpt-4-turbo-preview',
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
      return { success: false, error: error.message };
    }
  }
}

export const openaiService = new OpenAIService();
