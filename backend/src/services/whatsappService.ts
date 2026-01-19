import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import { EventEmitter } from 'events';
import prisma from '../lib/prisma';
import OpenAI from 'openai';
import CryptoJS from 'crypto-js';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'clave-encriptacion-32-caracteres!';

// Desencriptar API Key
const decryptApiKey = (encrypted: string): string => {
  try {
    const bytes = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (error) {
    console.error('Error desencriptando API Key:', error);
    return '';
  }
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
      console.log(`📨 Mensaje recibido de ${message.from}: ${message.body?.substring(0, 50)}...`);
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
        console.log('Mensaje ignorado (propio o de grupo)');
        return;
      }

      // Ignorar mensajes vacíos
      if (!message.body || message.body.trim() === '') {
        console.log('Mensaje ignorado (vacío)');
        return;
      }

      console.log(`📨 Procesando mensaje de ${message.from}: ${message.body}`);

      // Obtener la sesión para enviar mensajes
      const session = this.sessions.get(userId);
      if (!session || !session.connected || !session.ready) {
        console.log('❌ Sesión no disponible para responder');
        return;
      }

      // Obtener usuario y su asistente activo
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          assistants: {
            where: { isActive: true },
            take: 1,
          },
        },
      });

      if (!user) {
        console.log('❌ Usuario no encontrado');
        return;
      }

      if (user.assistants.length === 0) {
        console.log('❌ No hay asistente activo para responder');
        return;
      }

      const assistant = user.assistants[0];
      console.log(`🤖 Usando asistente: ${assistant.name}`);

      // Verificar que el asistente tenga contexto
      if (!assistant.contextJson) {
        console.log('❌ El asistente no tiene contexto configurado');
        try {
          await session.client.sendMessage(message.from, '⚠️ El asistente aún no está configurado. Por favor contacta al administrador.');
        } catch (e) {
          console.error('Error enviando mensaje de error:', e);
        }
        return;
      }

      // Verificar que el usuario tenga API Key
      if (!user.openaiApiKey) {
        console.log('❌ Usuario sin API Key de OpenAI');
        try {
          await session.client.sendMessage(message.from, '⚠️ El chatbot no está configurado correctamente. Por favor contacta al administrador.');
        } catch (e) {
          console.error('Error enviando mensaje de error:', e);
        }
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
        console.log('📝 Creando nueva conversación');
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

      console.log('🧠 Generando respuesta con IA...');
      
      // Generar respuesta con OpenAI
      const reply = await this.generateAIResponse(user, assistant, conversation, message.body);

      console.log(`💬 Respuesta generada: ${reply.substring(0, 100)}...`);

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

      // Enviar respuesta usando el cliente directamente
      console.log('📤 Enviando respuesta...');
      await session.client.sendMessage(message.from, reply);
      console.log(`✅ Respuesta enviada a ${message.from}`);

    } catch (error: any) {
      console.error('❌ Error procesando mensaje:', error?.message || error);
      console.error('Stack:', error?.stack);
      
      // Intentar enviar mensaje de error al usuario
      try {
        const session = this.sessions.get(userId);
        if (session && session.connected) {
          await session.client.sendMessage(message.from, 'Lo siento, hubo un error procesando tu mensaje. Por favor intenta de nuevo.');
        }
      } catch (replyError) {
        console.error('Error enviando mensaje de error:', replyError);
      }
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
      
      if (!userApiKey) {
        console.error('❌ No se pudo desencriptar la API Key');
        return 'Lo siento, hay un problema con la configuración. Por favor contacta al administrador.';
      }

      console.log('🔑 API Key desencriptada correctamente');
      
      const openai = new OpenAI({ apiKey: userApiKey });

      // Construir contexto del negocio desde el JSON
      let businessContext = '';
      if (assistant.contextJson) {
        try {
          const contextData = JSON.parse(assistant.contextJson);
          businessContext = this.formatContextForAI(contextData);
          console.log('📋 Contexto del negocio cargado');
        } catch (parseError) {
          console.error('Error parseando contextJson:', parseError);
          businessContext = assistant.contextJson; // Usar como texto plano si no es JSON válido
        }
      }

      // Agregar contexto del negocio desde la relación business si existe
      if (assistant.business) {
        businessContext += this.buildBusinessContext(assistant.business);
      }

      // Construir historial de mensajes
      const messageHistory = (conversation.messages || []).map((m: any) => ({
        role: m.role.toLowerCase() as 'user' | 'assistant',
        content: m.content,
      }));

      // System prompt
      const systemPrompt = this.buildSystemPrompt(assistant, businessContext);

      console.log('🚀 Llamando a OpenAI...');
      
      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messageHistory.slice(-10), // Últimos 10 mensajes para contexto
          { role: 'user', content: userMessage },
        ],
        max_tokens: 500,
        temperature: 0.7,
      });

      const response = completion.choices[0]?.message?.content;
      
      if (!response) {
        console.error('❌ OpenAI no devolvió respuesta');
        return 'Lo siento, no pude procesar tu mensaje. Por favor intenta de nuevo.';
      }

      console.log('✅ Respuesta de OpenAI recibida');
      return response;
      
    } catch (error: any) {
      console.error('❌ Error OpenAI:', error?.message || error);
      
      // Manejar errores específicos de OpenAI
      if (error?.status === 401) {
        return 'Error de configuración: La API Key de OpenAI no es válida.';
      }
      if (error?.status === 429) {
        return 'El servicio está temporalmente saturado. Por favor intenta en unos minutos.';
      }
      if (error?.status === 500) {
        return 'Hay un problema temporal con el servicio de IA. Por favor intenta más tarde.';
      }
      
      return 'Lo siento, hubo un error procesando tu mensaje. Por favor intenta de nuevo.';
    }
  }

  // Formatear el contexto JSON para que la IA lo entienda mejor
  private formatContextForAI(contextData: any): string {
    let formatted = '\n=== INFORMACIÓN DEL NEGOCIO ===\n';
    
    if (contextData.negocio) {
      const n = contextData.negocio;
      formatted += `\nNombre: ${n.nombre || 'No especificado'}`;
      if (n.descripcion) formatted += `\nDescripción: ${n.descripcion}`;
      if (n.horario) formatted += `\nHorario: ${n.horario}`;
      if (n.direccion) formatted += `\nDirección: ${n.direccion}`;
      if (n.telefono) formatted += `\nTeléfono: ${n.telefono}`;
      if (n.whatsapp) formatted += `\nWhatsApp: ${n.whatsapp}`;
      if (n.email) formatted += `\nEmail: ${n.email}`;
    }
    
    if (contextData.productos && contextData.productos.length > 0) {
      formatted += '\n\n=== PRODUCTOS/SERVICIOS ===\n';
      contextData.productos.forEach((p: any, i: number) => {
        formatted += `\n${i + 1}. ${p.nombre}`;
        if (p.precio) formatted += ` - Precio: $${p.precio.toLocaleString('es-CO')}`;
        if (p.descripcion) formatted += `\n   ${p.descripcion}`;
      });
    }
    
    if (contextData.servicios && contextData.servicios.length > 0) {
      formatted += '\n\n=== SERVICIOS ===\n';
      contextData.servicios.forEach((s: any) => {
        formatted += `\n- ${typeof s === 'string' ? s : s.nombre || s}`;
      });
    }
    
    if (contextData.preguntas_frecuentes && contextData.preguntas_frecuentes.length > 0) {
      formatted += '\n\n=== PREGUNTAS FRECUENTES ===\n';
      contextData.preguntas_frecuentes.forEach((faq: any) => {
        formatted += `\nP: ${faq.pregunta}`;
        formatted += `\nR: ${faq.respuesta}\n`;
      });
    }
    
    if (contextData.instrucciones) {
      formatted += `\n\n=== INSTRUCCIONES ESPECIALES ===\n${contextData.instrucciones}`;
    }

    // Agregar cualquier otro campo que exista
    const knownFields = ['negocio', 'productos', 'servicios', 'preguntas_frecuentes', 'instrucciones'];
    Object.keys(contextData).forEach(key => {
      if (!knownFields.includes(key)) {
        formatted += `\n\n=== ${key.toUpperCase()} ===\n`;
        formatted += typeof contextData[key] === 'string' 
          ? contextData[key] 
          : JSON.stringify(contextData[key], null, 2);
      }
    });
    
    return formatted;
  }

  private buildBusinessContext(business: any): string {
    let ctx = '';
    
    if (business) {
      if (business.name) ctx += `\nNegocio: ${business.name}`;
      if (business.industry) ctx += `\nIndustria: ${business.industry}`;
      if (business.description) ctx += `\nDescripción: ${business.description}`;
      if (business.contactEmail) ctx += `\nEmail: ${business.contactEmail}`;
      if (business.contactPhone) ctx += `\nTeléfono: ${business.contactPhone}`;
      if (business.businessHours) ctx += `\nHorario: ${business.businessHours}`;

      if (business.products?.length > 0) {
        ctx += '\n\nProductos adicionales:\n';
        business.products.forEach((p: any) => {
          ctx += `- ${p.name}${p.price ? ` ($${p.price})` : ''}${p.description ? `: ${p.description}` : ''}\n`;
        });
      }

      if (business.faqs?.length > 0) {
        ctx += '\nFAQs adicionales:\n';
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
      'FRIENDLY': 'Sé amigable, cercano y usa un tono cálido.',
      'CASUAL': 'Sé casual, relajado y usa un lenguaje informal.',
    };

    return `Eres ${assistant.name}, un asistente virtual de atención al cliente por WhatsApp.
${tones[assistant.tone] || tones['PROFESSIONAL']}

${businessContext}

REGLAS IMPORTANTES:
- Responde siempre en español
- Sé conciso pero informativo (los mensajes de WhatsApp deben ser cortos)
- Si no conoces la respuesta exacta, ofrece alternativas o contactar al equipo
- No inventes información que no esté en el contexto
- Usa emojis ocasionalmente para ser más amigable 😊
- Mantén respuestas breves (máximo 2-3 párrafos cortos)
- Si te preguntan algo fuera del contexto del negocio, indica amablemente que solo puedes ayudar con temas relacionados al negocio
- Siempre saluda de forma amigable si es el primer mensaje`;
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
