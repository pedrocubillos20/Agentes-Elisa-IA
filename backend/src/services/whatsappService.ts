import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import { EventEmitter } from 'events';
import prisma from '../lib/prisma';
import OpenAI from 'openai';
import CryptoJS from 'crypto-js';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'clave-encriptacion-32-caracteres!';

// Desencriptar API Key
const decryptApiKey = (encrypted: string): string => {
  const bytes = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
};

interface WhatsAppSession {
  client: Client;
  qrCode: string | null;
  connected: boolean;
  phoneNumber: string | null;
  userId: string;
  ready: boolean;
}

class WhatsAppService extends EventEmitter {
  private sessions: Map<string, WhatsAppSession> = new Map();
  
  constructor() {
    super();
    console.log('📱 WhatsApp Service inicializado');
  }

  // Crear o obtener sesión para un usuario
  async getOrCreateSession(userId: string): Promise<WhatsAppSession> {
    let session = this.sessions.get(userId);
    
    if (session) {
      return session;
    }

    // Crear nuevo cliente de WhatsApp
    const client = new Client({
      authStrategy: new LocalAuth({ clientId: userId }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu'
        ],
      },
    });

    session = {
      client,
      qrCode: null,
      connected: false,
      phoneNumber: null,
      userId,
      ready: false,
    };

    this.sessions.set(userId, session);

    // Configurar eventos
    this.setupClientEvents(client, userId);

    return session;
  }

  // Configurar eventos del cliente
  private setupClientEvents(client: Client, userId: string) {
    // Evento: QR generado
    client.on('qr', (qr: string) => {
      console.log(`📱 QR generado para usuario ${userId}`);
      const session = this.sessions.get(userId);
      if (session) {
        session.qrCode = qr;
        session.connected = false;
      }
      this.emit('qr', { userId, qr });
    });

    // Evento: Autenticado
    client.on('authenticated', () => {
      console.log(`✅ Usuario ${userId} autenticado en WhatsApp`);
    });

    // Evento: Listo para usar
    client.on('ready', async () => {
      console.log(`🚀 WhatsApp listo para usuario ${userId}`);
      const session = this.sessions.get(userId);
      if (session) {
        session.connected = true;
        session.ready = true;
        session.qrCode = null;
        
        // Obtener información del número
        const info = client.info;
        session.phoneNumber = info?.wid?.user ? `+${info.wid.user}` : null;

        // Actualizar en base de datos
        try {
          await prisma.user.update({
            where: { id: userId },
            data: {
              whatsappConnected: true,
              whatsappPhone: session.phoneNumber,
            },
          });
        } catch (error) {
          console.error('Error actualizando usuario:', error);
        }
      }
      this.emit('ready', { userId });
    });

    // Evento: Mensaje recibido
    client.on('message', async (message: Message) => {
      await this.handleIncomingMessage(userId, message);
    });

    // Evento: Desconectado
    client.on('disconnected', async (reason: string) => {
      console.log(`📴 WhatsApp desconectado para ${userId}: ${reason}`);
      const session = this.sessions.get(userId);
      if (session) {
        session.connected = false;
        session.ready = false;
        session.qrCode = null;
      }

      // Actualizar en base de datos
      try {
        await prisma.user.update({
          where: { id: userId },
          data: {
            whatsappConnected: false,
            whatsappPhone: null,
          },
        });
      } catch (error) {
        console.error('Error actualizando usuario:', error);
      }

      this.emit('disconnected', { userId, reason });
    });

    // Evento: Error de autenticación
    client.on('auth_failure', (message: string) => {
      console.error(`❌ Error de autenticación para ${userId}:`, message);
      this.emit('auth_failure', { userId, message });
    });
  }

  // Manejar mensajes entrantes
  private async handleIncomingMessage(userId: string, message: Message) {
    try {
      // Ignorar mensajes propios y de grupos
      if (message.fromMe || message.from.includes('@g.us')) {
        return;
      }

      console.log(`📨 Mensaje recibido de ${message.from}: ${message.body}`);

      // Obtener usuario y su asistente activo
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          assistants: {
            where: { isActive: true },
            include: {
              business: {
                include: {
                  products: { where: { isActive: true } },
                  faqs: { orderBy: { order: 'asc' } },
                },
              },
            },
            take: 1,
          },
        },
      });

      if (!user || user.assistants.length === 0) {
        console.log('No hay asistente activo para responder');
        return;
      }

      const assistant = user.assistants[0];

      // Verificar que el usuario tenga API Key
      if (!user.openaiApiKey) {
        await message.reply('⚠️ El chatbot no está configurado correctamente. Por favor contacta al administrador.');
        return;
      }

      // Obtener o crear conversación
      const clientPhone = message.from.replace('@c.us', '');
      let conversation = await prisma.conversation.findFirst({
        where: {
          assistantId: assistant.id,
          clientPhone: clientPhone,
          status: 'ACTIVE',
        },
        include: { messages: { orderBy: { createdAt: 'asc' }, take: 20 } },
      });

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            assistantId: assistant.id,
            clientPhone: clientPhone,
            channel: 'WHATSAPP',
            status: 'ACTIVE',
          },
          include: { messages: true },
        });
      }

      // Guardar mensaje del usuario
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'USER',
          content: message.body,
        },
      });

      // Generar respuesta con OpenAI
      const reply = await this.generateAIResponse(user, assistant, conversation, message.body);

      // Guardar respuesta del asistente
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'ASSISTANT',
          content: reply,
        },
      });

      // Actualizar conversación
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          messageCount: { increment: 2 },
          lastMessageAt: new Date(),
        },
      });

      // Enviar respuesta
      await message.reply(reply);
      console.log(`📤 Respuesta enviada a ${message.from}`);

    } catch (error) {
      console.error('Error procesando mensaje:', error);
    }
  }

  // Generar respuesta con OpenAI
  private async generateAIResponse(
    user: any,
    assistant: any,
    conversation: any,
    userMessage: string
  ): Promise<string> {
    try {
      const userApiKey = decryptApiKey(user.openaiApiKey);
      const openai = new OpenAI({ apiKey: userApiKey });

      // Construir contexto del negocio
      const businessContext = this.buildBusinessContext(assistant.business, assistant.contextJson);

      // Construir historial de mensajes
      const messageHistory = conversation.messages.map((m: any) => ({
        role: m.role.toLowerCase() as 'user' | 'assistant',
        content: m.content,
      }));

      // System prompt
      const systemPrompt = assistant.systemPrompt || this.buildSystemPrompt(assistant, businessContext);

      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messageHistory,
          { role: 'user', content: userMessage },
        ],
        max_tokens: 500,
        temperature: 0.7,
      });

      return completion.choices[0]?.message?.content || 'Lo siento, no pude procesar tu mensaje.';
    } catch (error: any) {
      console.error('Error OpenAI:', error?.message);
      return 'Lo siento, hubo un error procesando tu mensaje. Por favor intenta de nuevo.';
    }
  }

  private buildBusinessContext(business: any, contextJson?: string): string {
    let ctx = '';
    
    if (contextJson) {
      try {
        const parsed = JSON.parse(contextJson);
        ctx += '=== INFORMACIÓN DEL NEGOCIO ===\n';
        ctx += JSON.stringify(parsed, null, 2);
        ctx += '\n\n';
      } catch {
        // Ignorar error de JSON
      }
    }
    
    if (business) {
      ctx += `Negocio: ${business.name}\n`;
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
    }

    return ctx;
  }

  private buildSystemPrompt(assistant: any, businessContext: string): string {
    const tones: Record<string, string> = {
      'PROFESSIONAL': 'Mantén un tono profesional y formal.',
      'FRIENDLY': 'Sé amigable y cercano.',
      'CASUAL': 'Sé casual y relajado.',
    };

    return `Eres ${assistant.name}, un asistente virtual de atención al cliente por WhatsApp.
${tones[assistant.tone] || tones['PROFESSIONAL']}

INFORMACIÓN DEL NEGOCIO:
${businessContext}

INSTRUCCIONES:
- Responde siempre en español
- Sé conciso pero informativo (mensajes cortos para WhatsApp)
- Si no conoces la respuesta, ofrece contactar al equipo
- No inventes información
- Usa emojis ocasionalmente para ser más amigable
- Mantén respuestas breves (máximo 2-3 párrafos)`;
  }

  // Inicializar cliente y generar QR
  async initializeClient(userId: string): Promise<string | null> {
    const session = await this.getOrCreateSession(userId);
    
    // Si ya está conectado, retornar null (no necesita QR)
    if (session.connected && session.ready) {
      return null;
    }

    // Inicializar cliente si no está inicializado
    if (!session.client.pupBrowser) {
      await session.client.initialize();
    }

    // Esperar a que se genere el QR (máximo 30 segundos)
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(session.qrCode);
      }, 30000);

      if (session.qrCode) {
        clearTimeout(timeout);
        resolve(session.qrCode);
        return;
      }

      const checkQR = setInterval(() => {
        if (session.qrCode) {
          clearInterval(checkQR);
          clearTimeout(timeout);
          resolve(session.qrCode);
        }
      }, 1000);
    });
  }

  // Obtener estado de la sesión
  getSessionStatus(userId: string): { connected: boolean; phoneNumber: string | null; qrCode: string | null } {
    const session = this.sessions.get(userId);
    return {
      connected: session?.connected || false,
      phoneNumber: session?.phoneNumber || null,
      qrCode: session?.qrCode || null,
    };
  }

  // Desconectar sesión
  async disconnectSession(userId: string): Promise<void> {
    const session = this.sessions.get(userId);
    if (session) {
      try {
        await session.client.logout();
        await session.client.destroy();
      } catch (error) {
        console.error('Error desconectando:', error);
      }
      this.sessions.delete(userId);

      // Actualizar en base de datos
      await prisma.user.update({
        where: { id: userId },
        data: {
          whatsappConnected: false,
          whatsappPhone: null,
        },
      });
    }
  }

  // Enviar mensaje
  async sendMessage(userId: string, to: string, message: string): Promise<boolean> {
    const session = this.sessions.get(userId);
    if (!session?.connected || !session.ready) {
      return false;
    }

    try {
      const chatId = to.includes('@c.us') ? to : `${to.replace(/\D/g, '')}@c.us`;
      await session.client.sendMessage(chatId, message);
      return true;
    } catch (error) {
      console.error('Error enviando mensaje:', error);
      return false;
    }
  }
}

// Singleton
export const whatsappService = new WhatsAppService();
export default whatsappService;
