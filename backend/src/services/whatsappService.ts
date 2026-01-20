import axios from 'axios';
import prisma from '../lib/prisma';
import OpenAI from 'openai';
import CryptoJS from 'crypto-js';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'clave-encriptacion-32-caracteres!';
const GRAPH_API_VERSION = 'v18.0';
const GRAPH_API_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// Desencriptar
const decryptApiKey = (encrypted: string): string => {
  try {
    const bytes = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (error) {
    return '';
  }
};

// Encriptar
const encryptApiKey = (text: string): string => {
  return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
};

class WhatsAppCloudService {
  
  constructor() {
    console.log('📱 WhatsApp Cloud API Service inicializado');
  }

  // Verificar credenciales con Meta
  async verifyCredentials(accessToken: string, phoneNumberId: string): Promise<{ 
    valid: boolean; 
    phoneNumber?: string; 
    verifiedName?: string;
    error?: string 
  }> {
    try {
      console.log(`🔍 Verificando credenciales...`);
      
      const response = await axios.get(
        `${GRAPH_API_URL}/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      console.log(`✅ Credenciales válidas:`, response.data);
      
      return {
        valid: true,
        phoneNumber: response.data.display_phone_number,
        verifiedName: response.data.verified_name,
      };
    } catch (error: any) {
      const errorData = error?.response?.data?.error;
      const errorMsg = errorData?.message || error?.message || 'Error desconocido';
      console.error('❌ Error verificando:', errorMsg);
      return { valid: false, error: errorMsg };
    }
  }

  // Configurar WhatsApp para un usuario
  async configure(userId: string, accessToken: string, phoneNumberId: string): Promise<{ 
    success: boolean; 
    phoneNumber?: string; 
    verifiedName?: string;
    error?: string 
  }> {
    try {
      console.log(`⚙️ Configurando WhatsApp Cloud API para ${userId}`);
      
      // Verificar credenciales
      const verification = await this.verifyCredentials(accessToken, phoneNumberId);
      
      if (!verification.valid) {
        return { success: false, error: verification.error };
      }

      // Guardar en base de datos
      await prisma.user.update({
        where: { id: userId },
        data: {
          whatsappConnected: true,
          whatsappPhone: verification.phoneNumber,
          whatsappAccessToken: encryptApiKey(accessToken),
          whatsappPhoneNumberId: phoneNumberId,
        },
      });

      console.log(`✅ WhatsApp configurado - Número: ${verification.phoneNumber}`);
      
      return { 
        success: true, 
        phoneNumber: verification.phoneNumber,
        verifiedName: verification.verifiedName,
      };
    } catch (error: any) {
      console.error('❌ Error configurando:', error?.message);
      return { success: false, error: error?.message };
    }
  }

  // Enviar mensaje de texto
  async sendMessage(userId: string, to: string, text: string): Promise<boolean> {
    try {
      const user = await prisma.user.findUnique({ 
        where: { id: userId },
        select: { whatsappAccessToken: true, whatsappPhoneNumberId: true }
      });
      
      if (!user?.whatsappAccessToken || !user?.whatsappPhoneNumberId) {
        console.log('❌ WhatsApp no configurado');
        return false;
      }

      const accessToken = decryptApiKey(user.whatsappAccessToken);
      const phoneNumberId = user.whatsappPhoneNumberId;

      // Formatear número
      const formattedNumber = to.replace(/[^0-9]/g, '');

      await axios.post(
        `${GRAPH_API_URL}/${phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: formattedNumber,
          type: 'text',
          text: { body: text },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log(`✅ Mensaje enviado a ${formattedNumber}`);
      return true;
    } catch (error: any) {
      console.error('❌ Error enviando:', error?.response?.data || error?.message);
      return false;
    }
  }

  // Procesar webhook de Meta
  async handleWebhook(payload: any): Promise<void> {
    try {
      const entry = payload.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      
      if (!value?.messages?.[0]) {
        return;
      }

      const message = value.messages[0];
      const contact = value.contacts?.[0];
      const metadata = value.metadata;

      const from = message.from;
      const phoneNumberId = metadata?.phone_number_id;
      const messageText = message.text?.body || '';
      const messageType = message.type;

      console.log(`📨 Mensaje de ${from}: ${messageText.substring(0, 50)}...`);

      if (messageType !== 'text' || !messageText.trim()) {
        return;
      }

      // Buscar usuario
      const user = await prisma.user.findFirst({
        where: { whatsappPhoneNumberId: phoneNumberId },
        include: {
          assistants: { where: { isActive: true }, take: 1 },
        },
      });

      if (!user) {
        console.log(`❌ Usuario no encontrado para: ${phoneNumberId}`);
        return;
      }

      if (user.assistants.length === 0) {
        console.log('❌ Sin asistente activo');
        return;
      }

      const assistant = user.assistants[0];

      if (!assistant.contextJson) {
        await this.sendMessage(user.id, from, '⚠️ El asistente no está configurado.');
        return;
      }

      if (!user.openaiApiKey) {
        await this.sendMessage(user.id, from, '⚠️ Falta configurar la API de OpenAI.');
        return;
      }

      // Obtener o crear conversación
      let conversation = await prisma.conversation.findFirst({
        where: {
          assistantId: assistant.id,
          clientPhone: from,
          status: 'ACTIVE',
        },
        include: { messages: { orderBy: { createdAt: 'asc' }, take: 20 } },
      });

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            assistantId: assistant.id,
            clientPhone: from,
            clientName: contact?.profile?.name || null,
            channel: 'WHATSAPP',
            status: 'ACTIVE',
          },
          include: { messages: true },
        });
      }

      // Guardar mensaje
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'USER',
          content: messageText,
        },
      });

      console.log('🧠 Generando respuesta...');
      
      const reply = await this.generateAIResponse(user, assistant, conversation, messageText);

      // Guardar respuesta
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'ASSISTANT',
          content: reply,
        },
      });

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          messageCount: { increment: 2 },
          lastMessageAt: new Date(),
        },
      });

      await this.sendMessage(user.id, from, reply);
      console.log(`✅ Respuesta enviada`);

    } catch (error: any) {
      console.error('❌ Error webhook:', error?.message);
    }
  }

  // Generar respuesta con OpenAI
  private async generateAIResponse(user: any, assistant: any, conversation: any, userMessage: string): Promise<string> {
    try {
      const apiKey = decryptApiKey(user.openaiApiKey);
      if (!apiKey) return 'Error de configuración.';

      const openai = new OpenAI({ apiKey });

      let context = '';
      try {
        const data = JSON.parse(assistant.contextJson);
        context = this.formatContext(data);
      } catch (e) {
        context = assistant.contextJson;
      }

      const history = (conversation.messages || []).map((m: any) => ({
        role: m.role.toLowerCase() as 'user' | 'assistant',
        content: m.content,
      }));

      const tones: Record<string, string> = {
        'PROFESSIONAL': 'profesional y formal',
        'FRIENDLY': 'amigable y cercano',
        'CASUAL': 'casual y relajado',
      };

      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { 
            role: 'system', 
            content: `Eres ${assistant.name}, asistente de WhatsApp. Tono: ${tones[assistant.tone] || 'profesional'}.

${context}

Reglas: Responde en español, sé conciso, usa emojis 😊` 
          },
          ...history.slice(-10),
          { role: 'user', content: userMessage },
        ],
        max_tokens: 500,
        temperature: 0.7,
      });

      return completion.choices[0]?.message?.content || 'No pude procesar tu mensaje.';
      
    } catch (error: any) {
      if (error?.status === 401) return 'API Key de OpenAI inválida.';
      if (error?.code === 'insufficient_quota') return 'Sin créditos en OpenAI.';
      return 'Error procesando mensaje.';
    }
  }

  private formatContext(data: any): string {
    let text = '';
    
    const info = data.negocio || data.bot || data.business;
    if (info) {
      text += `\nNegocio: ${info.nombre || info.name}`;
      if (info.descripcion) text += `\nDescripción: ${info.descripcion}`;
      if (info.horario) text += `\nHorario: ${info.horario}`;
    }
    
    const products = data.productos || data.products;
    if (products?.length) {
      text += '\n\nProductos:';
      products.forEach((p: any, i: number) => {
        text += `\n${i+1}. ${p.nombre || p.name}`;
        if (p.precio || p.price) text += ` - $${p.precio || p.price}`;
      });
    }
    
    const faqs = data.preguntas_frecuentes || data.faqs;
    if (faqs?.length) {
      text += '\n\nFAQs:';
      faqs.forEach((f: any) => {
        text += `\nP: ${f.pregunta}\nR: ${f.respuesta}`;
      });
    }
    
    return text;
  }

  // Estado
  async getStatus(userId: string): Promise<{ connected: boolean; phoneNumber: string | null }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { whatsappConnected: true, whatsappPhone: true },
    });
    return {
      connected: user?.whatsappConnected || false,
      phoneNumber: user?.whatsappPhone || null,
    };
  }

  // Desconectar
  async disconnect(userId: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: {
        whatsappConnected: false,
        whatsappPhone: null,
        whatsappAccessToken: null,
        whatsappPhoneNumberId: null,
      },
    });
    console.log(`📴 WhatsApp desconectado`);
  }
}

export const whatsappService = new WhatsAppCloudService();
export default whatsappService;
