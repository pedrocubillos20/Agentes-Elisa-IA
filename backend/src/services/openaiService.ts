import OpenAI from 'openai';
import CryptoJS from 'crypto-js';
import prisma from '../lib/prisma';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'elisa-ia-secret-key-2024';

class OpenAIService {
  // Desencriptar API Key
  decryptApiKey(encryptedKey: string): string {
    try {
      const bytes = CryptoJS.AES.decrypt(encryptedKey, ENCRYPTION_KEY);
      return bytes.toString(CryptoJS.enc.Utf8);
    } catch (error) {
      console.error('Error desencriptando API Key');
      return '';
    }
  }

  // Encriptar API Key
  encryptApiKey(apiKey: string): string {
    return CryptoJS.AES.encrypt(apiKey, ENCRYPTION_KEY).toString();
  }

  // Obtener cliente OpenAI para un usuario
  async getClientForUser(userId: string): Promise<OpenAI | null> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user?.apiKeyEncrypted) {
        console.log('❌ Usuario no tiene API Key configurada');
        return null;
      }

      const apiKey = this.decryptApiKey(user.apiKeyEncrypted);
      if (!apiKey) {
        console.log('❌ No se pudo desencriptar API Key');
        return null;
      }

      return new OpenAI({ apiKey });
    } catch (error) {
      console.error('Error obteniendo cliente OpenAI:', error);
      return null;
    }
  }

  // Generar respuesta con contexto
  async generateResponse(
    userId: string,
    userMessage: string,
    conversationHistory: { role: string; content: string }[] = []
  ): Promise<{ success: boolean; response?: string; error?: string }> {
    try {
      const openai = await this.getClientForUser(userId);
      if (!openai) {
        return {
          success: false,
          error: 'API Key de OpenAI no configurada'
        };
      }

      // Obtener asistente activo
      const assistant = await prisma.assistant.findFirst({
        where: {
          userId,
          isActive: true
        }
      });

      // Construir contexto del sistema
      let systemPrompt = 'Eres un asistente virtual amigable y profesional.';
      
      if (assistant) {
        const parts = [];
        
        if (assistant.personality) {
          parts.push(`Personalidad: ${assistant.personality}`);
        }
        if (assistant.context) {
          parts.push(`Contexto: ${assistant.context}`);
        }
        if (assistant.businessInfo) {
          parts.push(`Información del negocio: ${assistant.businessInfo}`);
        }
        if (assistant.instructions) {
          parts.push(`Instrucciones: ${assistant.instructions}`);
        }
        
        if (parts.length > 0) {
          systemPrompt = parts.join('\n\n');
        }
      }

      // Obtener FAQs del usuario
      const faqs = await prisma.fAQ.findMany({
        where: {
          userId,
          isActive: true
        }
      });

      if (faqs.length > 0) {
        const faqContext = faqs.map(f => `P: ${f.question}\nR: ${f.answer}`).join('\n\n');
        systemPrompt += `\n\nPreguntas frecuentes:\n${faqContext}`;
      }

      // Obtener productos del usuario
      const products = await prisma.product.findMany({
        where: {
          userId,
          isActive: true
        }
      });

      if (products.length > 0) {
        const productContext = products.map(p => 
          `- ${p.name}${p.price ? ` ($${p.price})` : ''}${p.description ? `: ${p.description}` : ''}`
        ).join('\n');
        systemPrompt += `\n\nProductos/Servicios disponibles:\n${productContext}`;
      }

      // Construir mensajes
      const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        { role: 'system', content: systemPrompt }
      ];

      // Agregar historial de conversación (últimos 10 mensajes)
      const recentHistory = conversationHistory.slice(-10);
      for (const msg of recentHistory) {
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content
        });
      }

      // Agregar mensaje actual
      messages.push({ role: 'user', content: userMessage });

      console.log('🤖 Generando respuesta con OpenAI...');

      const completion = await openai.chat.completions.create({
        model: assistant?.model || 'gpt-3.5-turbo',
        messages,
        temperature: assistant?.temperature || 0.7,
        max_tokens: assistant?.maxTokens || 500
      });

      const response = completion.choices[0]?.message?.content || 'Lo siento, no pude generar una respuesta.';

      console.log('✅ Respuesta generada:', response.substring(0, 100) + '...');

      return {
        success: true,
        response
      };
    } catch (error: any) {
      console.error('❌ Error generando respuesta:', error.message);
      
      if (error.code === 'insufficient_quota') {
        return {
          success: false,
          error: 'Tu cuenta de OpenAI no tiene créditos suficientes'
        };
      }
      
      if (error.code === 'invalid_api_key') {
        return {
          success: false,
          error: 'API Key de OpenAI inválida'
        };
      }

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Verificar API Key
  async verifyApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const openai = new OpenAI({ apiKey });
      
      await openai.models.list();
      
      return { valid: true };
    } catch (error: any) {
      console.error('❌ API Key inválida:', error.message);
      return {
        valid: false,
        error: error.code === 'invalid_api_key' ? 'API Key inválida' : error.message
      };
    }
  }
}

export const openaiService = new OpenAIService();
export default openaiService;
