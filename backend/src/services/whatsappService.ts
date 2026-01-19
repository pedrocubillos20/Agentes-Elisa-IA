import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState,
  WASocket,
  proto
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as QRCode from 'qrcode';
import pino from 'pino';
import prisma from '../lib/prisma';
import OpenAI from 'openai';
import CryptoJS from 'crypto-js';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'elisa-ia-clave-encriptacion-2024';
const AUTH_DIR = process.env.AUTH_DIR || '/app/auth_sessions';

const logger = pino({ level: 'silent' });

const decryptApiKey = (encrypted: string): string => {
  try {
    if (!encrypted) return '';
    const bytes = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    return decrypted;
  } catch (error) {
    console.error('❌ Error desencriptando API Key:', error);
    return '';
  }
};

interface WhatsAppSession {
  socket: WASocket | null;
  qrCode: string | null;
  connected: boolean;
  phoneNumber: string | null;
  userId: string;
  ready: boolean;
  connecting: boolean;
}

class WhatsAppService extends EventEmitter {
  private sessions: Map<string, WhatsAppSession> = new Map();
  
  constructor() {
    super();
    console.log('📱 WhatsApp Service inicializado (Baileys)');
    
    // Crear directorio de sesiones si no existe
    try {
      if (!fs.existsSync(AUTH_DIR)) {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
        console.log(`📁 Directorio de sesiones creado: ${AUTH_DIR}`);
      }
    } catch (error) {
      console.error('❌ Error creando directorio de sesiones:', error);
    }
  }

  async getOrCreateSession(userId: string): Promise<WhatsAppSession> {
    let session = this.sessions.get(userId);
    
    if (session) {
      return session;
    }

    session = {
      socket: null,
      qrCode: null,
      connected: false,
      phoneNumber: null,
      userId,
      ready: false,
      connecting: false,
    };

    this.sessions.set(userId, session);
    return session;
  }

  async initializeClient(userId: string): Promise<string | null> {
    const session = await this.getOrCreateSession(userId);
    
    if (session.connected && session.ready) {
      console.log(`✅ Usuario ${userId} ya está conectado`);
      return null;
    }

    if (session.connecting) {
      console.log(`⏳ Usuario ${userId} ya está conectando...`);
      return new Promise((resolve) => {
        const checkQR = setInterval(() => {
          if (session.qrCode || session.connected) {
            clearInterval(checkQR);
            resolve(session.qrCode);
          }
        }, 1000);
        
        setTimeout(() => {
          clearInterval(checkQR);
          resolve(session.qrCode);
        }, 30000);
      });
    }

    session.connecting = true;
    session.qrCode = null;

    try {
      const authPath = path.join(AUTH_DIR, userId);
      
      if (!fs.existsSync(authPath)) {
        fs.mkdirSync(authPath, { recursive: true });
      }

      console.log(`🔧 Iniciando conexión WhatsApp para ${userId}...`);

      const { state, saveCreds } = await useMultiFileAuthState(authPath);

      const socket = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger,
        browser: ['Elisa IA', 'Chrome', '120.0.0'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        markOnlineOnConnect: true,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
      });

      session.socket = socket;

      // Manejar actualizaciones de conexión
      socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          console.log(`📱 QR generado para usuario ${userId}`);
          try {
            session.qrCode = await QRCode.toDataURL(qr, {
              width: 300,
              margin: 2,
            });
            this.emit('qr', { userId, qr: session.qrCode });
          } catch (err) {
            console.error('Error generando QR DataURL:', err);
            session.qrCode = qr;
          }
        }

        if (connection === 'close') {
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          
          console.log(`📴 Conexión cerrada para ${userId}. Código: ${statusCode}. Reconectar: ${shouldReconnect}`);
          
          session.connected = false;
          session.ready = false;
          session.connecting = false;
          session.socket = null;

          // Si fue logout, eliminar sesión
          if (statusCode === DisconnectReason.loggedOut) {
            try {
              fs.rmSync(authPath, { recursive: true, force: true });
              console.log(`🗑️ Sesión eliminada para ${userId}`);
            } catch (e) {
              console.error('Error eliminando sesión:', e);
            }
          }

          // Actualizar BD
          try {
            await prisma.user.update({
              where: { id: userId },
              data: { whatsappConnected: false, whatsappPhone: null },
            });
          } catch (e) {
            console.error('Error actualizando BD:', e);
          }

          this.emit('disconnected', { userId });

          // Reconectar automáticamente si no fue logout
          if (shouldReconnect) {
            console.log(`🔄 Reintentando conexión para ${userId} en 5 segundos...`);
            setTimeout(() => this.initializeClient(userId), 5000);
          }
        }

        if (connection === 'open') {
          console.log(`✅ Usuario ${userId} conectado a WhatsApp!`);
          session.connected = true;
          session.ready = true;
          session.connecting = false;
          session.qrCode = null;

          // Obtener número de teléfono
          const phoneNumber = socket.user?.id?.split(':')[0] || socket.user?.id?.split('@')[0];
          session.phoneNumber = phoneNumber ? `+${phoneNumber}` : null;

          console.log(`📱 Número conectado: ${session.phoneNumber}`);

          // Actualizar BD
          try {
            await prisma.user.update({
              where: { id: userId },
              data: {
                whatsappConnected: true,
                whatsappPhone: session.phoneNumber,
              },
            });
            console.log(`💾 BD actualizada para ${userId}`);
          } catch (e) {
            console.error('Error actualizando BD:', e);
          }

          this.emit('ready', { userId });
        }
      });

      // Guardar credenciales
      socket.ev.on('creds.update', saveCreds);

      // Manejar mensajes entrantes
      socket.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;

        for (const msg of m.messages) {
          // Ignorar mensajes propios
          if (msg.key.fromMe) continue;
          
          // Ignorar mensajes de grupos
          if (msg.key.remoteJid?.endsWith('@g.us')) continue;
          
          // Ignorar mensajes de broadcast
          if (msg.key.remoteJid?.includes('@broadcast')) continue;

          // Obtener contenido del mensaje
          const messageContent = 
            msg.message?.conversation || 
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption ||
            '';

          if (!messageContent.trim()) {
            console.log(`📨 Mensaje sin texto de ${msg.key.remoteJid} (posiblemente media)`);
            continue;
          }

          console.log(`📨 Mensaje recibido de ${msg.key.remoteJid}: "${messageContent.substring(0, 50)}${messageContent.length > 50 ? '...' : ''}"`);

          // Procesar mensaje
          await this.handleIncomingMessage(userId, msg.key.remoteJid!, messageContent, socket);
        }
      });

      // Esperar QR o conexión
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          console.log(`⏰ Timeout esperando QR para ${userId}`);
          resolve(session.qrCode);
        }, 30000);

        const checkInterval = setInterval(() => {
          if (session.qrCode || session.connected) {
            clearInterval(checkInterval);
            clearTimeout(timeout);
            resolve(session.qrCode);
          }
        }, 500);
      });

    } catch (error: any) {
      console.error(`❌ Error inicializando WhatsApp para ${userId}:`, error?.message || error);
      session.connecting = false;
      throw error;
    }
  }

  private async handleIncomingMessage(
    userId: string, 
    remoteJid: string, 
    messageContent: string,
    socket: WASocket
  ) {
    try {
      console.log(`🔄 Procesando mensaje de ${remoteJid} para usuario ${userId}`);

      // Obtener usuario con asistente activo
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          assistants: {
            where: { isActive: true },
            take: 1,
          },
          business: {
            include: {
              products: true,
              faqs: true,
            }
          }
        },
      });

      if (!user) {
        console.log('❌ Usuario no encontrado en BD');
        return;
      }

      if (user.assistants.length === 0) {
        console.log('❌ No hay asistente activo para este usuario');
        await this.sendMessage(socket, remoteJid, '⚠️ El asistente no está configurado. Por favor configura tu chatbot primero.');
        return;
      }

      const assistant = user.assistants[0];
      console.log(`🤖 Usando asistente: ${assistant.name}`);

      // Verificar contexto
      if (!assistant.contextJson) {
        console.log('❌ Asistente sin contexto configurado');
        await this.sendMessage(socket, remoteJid, '⚠️ El asistente aún no tiene instrucciones configuradas.');
        return;
      }

      // Verificar API Key
      if (!user.openaiApiKey) {
        console.log('❌ Usuario sin API Key de OpenAI');
        await this.sendMessage(socket, remoteJid, '⚠️ Falta configurar la API Key de OpenAI en la plataforma.');
        return;
      }

      const clientPhone = remoteJid.replace(/@.*$/, '');

      // Buscar o crear conversación
      let conversation = await prisma.conversation.findFirst({
        where: {
          assistantId: assistant.id,
          clientPhone: clientPhone,
          status: 'ACTIVE',
        },
        include: { 
          messages: { 
            orderBy: { createdAt: 'asc' }, 
            take: 20 
          } 
        },
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
          content: messageContent,
        },
      });

      console.log('🧠 Generando respuesta con IA...');
      
      // Generar respuesta
      const reply = await this.generateAIResponse(user, assistant, conversation, messageContent);

      console.log(`💬 Respuesta generada: "${reply.substring(0, 100)}${reply.length > 100 ? '...' : ''}"`);

      // Guardar respuesta
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
      console.log('📤 Enviando respuesta a WhatsApp...');
      const sent = await this.sendMessage(socket, remoteJid, reply);
      
      if (sent) {
        console.log(`✅ Respuesta enviada exitosamente a ${remoteJid}`);
      } else {
        console.log(`❌ No se pudo enviar la respuesta a ${remoteJid}`);
      }

    } catch (error: any) {
      console.error('❌ Error procesando mensaje:', error?.message || error);
      
      try {
        await this.sendMessage(socket, remoteJid, 'Lo siento, hubo un error procesando tu mensaje. Por favor intenta de nuevo.');
      } catch (e) {
        console.error('Error enviando mensaje de error:', e);
      }
    }
  }

  private async sendMessage(socket: WASocket, jid: string, text: string): Promise<boolean> {
    try {
      if (!socket) {
        console.error('❌ Socket no disponible');
        return false;
      }
      
      console.log(`📱 Enviando mensaje a: ${jid}`);
      
      await socket.sendMessage(jid, { text });
      
      return true;
    } catch (error: any) {
      console.error('❌ Error enviando mensaje:', error?.message || error);
      return false;
    }
  }

  private async generateAIResponse(
    user: any,
    assistant: any,
    conversation: any,
    userMessage: string
  ): Promise<string> {
    try {
      // Desencriptar API Key
      const userApiKey = decryptApiKey(user.openaiApiKey);
      
      if (!userApiKey) {
        console.error('❌ No se pudo desencriptar la API Key');
        return 'Lo siento, hay un problema con la configuración. Por favor verifica tu API Key.';
      }

      console.log('🔑 API Key desencriptada correctamente');

      const openai = new OpenAI({ apiKey: userApiKey });

      // Construir contexto del negocio
      let businessContext = '';
      if (assistant.contextJson) {
        try {
          const contextData = JSON.parse(assistant.contextJson);
          businessContext = this.formatContextForAI(contextData);
        } catch (e) {
          console.log('⚠️ Usando contexto como texto plano');
          businessContext = assistant.contextJson;
        }
      }

      // Agregar información del negocio si existe
      if (user.business) {
        businessContext += '\n\n=== INFORMACIÓN ADICIONAL DEL NEGOCIO ===\n';
        if (user.business.name) businessContext += `Nombre: ${user.business.name}\n`;
        if (user.business.description) businessContext += `Descripción: ${user.business.description}\n`;
        if (user.business.phone) businessContext += `Teléfono: ${user.business.phone}\n`;
        if (user.business.email) businessContext += `Email: ${user.business.email}\n`;
        if (user.business.address) businessContext += `Dirección: ${user.business.address}\n`;
        if (user.business.hours) businessContext += `Horarios: ${user.business.hours}\n`;
        
        // Agregar productos
        if (user.business.products?.length > 0) {
          businessContext += '\n=== PRODUCTOS/SERVICIOS ===\n';
          user.business.products.forEach((p: any, i: number) => {
            businessContext += `${i + 1}. ${p.name}`;
            if (p.price) businessContext += ` - $${p.price}`;
            if (p.description) businessContext += ` - ${p.description}`;
            businessContext += '\n';
          });
        }
        
        // Agregar FAQs
        if (user.business.faqs?.length > 0) {
          businessContext += '\n=== PREGUNTAS FRECUENTES ===\n';
          user.business.faqs.forEach((f: any) => {
            businessContext += `P: ${f.question}\nR: ${f.answer}\n\n`;
          });
        }
      }

      // Construir historial de mensajes
      const messageHistory = (conversation.messages || []).map((m: any) => ({
        role: m.role.toLowerCase() === 'user' ? 'user' : 'assistant' as 'user' | 'assistant',
        content: m.content,
      }));

      // System prompt
      const systemPrompt = `Eres ${assistant.name}, un asistente virtual de WhatsApp profesional y amigable.

${businessContext}

INSTRUCCIONES IMPORTANTES:
- Responde SIEMPRE en español
- Sé amigable, profesional y conciso
- No inventes información que no esté en tu contexto
- Si no sabes algo, ofrece alternativas o pide que contacten directamente
- Usa emojis ocasionalmente para hacer la conversación más amigable 😊
- Mantén respuestas cortas y directas (máximo 2-3 párrafos)
- Si te preguntan por precios o disponibilidad, usa la información proporcionada
- Puedes hacer preguntas para entender mejor las necesidades del cliente`;

      console.log('🚀 Enviando solicitud a OpenAI...');

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
        return 'Lo siento, no pude generar una respuesta. Por favor intenta de nuevo.';
      }

      console.log('✅ Respuesta de OpenAI recibida');
      return response;
      
    } catch (error: any) {
      console.error('❌ Error OpenAI:', error?.message || error);
      
      // Manejar errores específicos de OpenAI
      if (error?.code === 'invalid_api_key' || error?.status === 401) {
        return '⚠️ Error: La API Key de OpenAI no es válida. Por favor verifica tu configuración en la plataforma.';
      }
      if (error?.code === 'insufficient_quota' || error?.status === 429) {
        return '⚠️ Tu cuenta de OpenAI no tiene créditos suficientes. Por favor recarga tu cuenta en platform.openai.com';
      }
      if (error?.code === 'rate_limit_exceeded') {
        return 'Estamos recibiendo muchas solicitudes. Por favor espera un momento e intenta de nuevo.';
      }
      
      return 'Lo siento, hubo un error al procesar tu mensaje. Por favor intenta de nuevo en unos segundos.';
    }
  }

  private formatContextForAI(contextData: any): string {
    let formatted = '\n=== INFORMACIÓN Y CONTEXTO ===\n';
    
    // Información del bot/negocio
    const info = contextData.negocio || contextData.bot || contextData.business || contextData.info || {};
    
    if (info.nombre || info.name) formatted += `Nombre: ${info.nombre || info.name}\n`;
    if (info.empresa || info.company) formatted += `Empresa: ${info.empresa || info.company}\n`;
    if (info.descripcion || info.description) formatted += `Descripción: ${info.descripcion || info.description}\n`;
    if (info.objetivo || info.goal) formatted += `Objetivo: ${info.objetivo || info.goal}\n`;
    if (info.industria || info.industry) formatted += `Industria: ${info.industria || info.industry}\n`;
    
    // Personalidad
    if (info.personalidad || info.personality) {
      const personality = info.personalidad || info.personality;
      if (typeof personality === 'string') {
        formatted += `Personalidad: ${personality}\n`;
      } else {
        if (personality.tipo || personality.type) formatted += `Tipo: ${personality.tipo || personality.type}\n`;
        if (personality.tono || personality.tone) formatted += `Tono: ${personality.tono || personality.tone}\n`;
      }
    }
    
    // Productos
    const products = contextData.productos || contextData.products || [];
    if (products.length > 0) {
      formatted += '\n=== PRODUCTOS/SERVICIOS ===\n';
      products.forEach((p: any, i: number) => {
        formatted += `${i + 1}. ${p.nombre || p.name}`;
        if (p.precio || p.price) formatted += ` - $${p.precio || p.price}`;
        if (p.descripcion || p.description) formatted += ` - ${p.descripcion || p.description}`;
        formatted += '\n';
      });
    }
    
    // Servicios
    const services = contextData.servicios || contextData.services || [];
    if (services.length > 0) {
      formatted += '\n=== SERVICIOS ===\n';
      services.forEach((s: any, i: number) => {
        if (typeof s === 'string') {
          formatted += `${i + 1}. ${s}\n`;
        } else {
          formatted += `${i + 1}. ${s.nombre || s.name}`;
          if (s.precio || s.price) formatted += ` - $${s.precio || s.price}`;
          if (s.descripcion || s.description) formatted += ` - ${s.descripcion || s.description}`;
          formatted += '\n';
        }
      });
    }
    
    // FAQs
    const faqs = contextData.preguntas_frecuentes || contextData.faqs || contextData.faq || [];
    if (faqs.length > 0) {
      formatted += '\n=== PREGUNTAS FRECUENTES ===\n';
      faqs.forEach((f: any) => {
        const question = f.pregunta || f.question || f.q;
        const answer = f.respuesta || f.answer || f.a;
        if (question && answer) {
          formatted += `P: ${question}\nR: ${answer}\n\n`;
        }
      });
    }
    
    // Instrucciones adicionales
    const instructions = contextData.instrucciones || contextData.instructions || contextData.reglas || contextData.rules;
    if (instructions) {
      formatted += '\n=== INSTRUCCIONES ESPECIALES ===\n';
      if (Array.isArray(instructions)) {
        instructions.forEach((inst: string) => formatted += `- ${inst}\n`);
      } else {
        formatted += instructions + '\n';
      }
    }
    
    return formatted;
  }

  getSessionStatus(userId: string) {
    const session = this.sessions.get(userId);
    return {
      connected: session?.connected || false,
      phoneNumber: session?.phoneNumber || null,
      qrCode: session?.qrCode || null,
      ready: session?.ready || false,
    };
  }

  async disconnectSession(userId: string): Promise<void> {
    console.log(`🔌 Desconectando sesión de ${userId}...`);
    
    const session = this.sessions.get(userId);
    if (session?.socket) {
      try {
        await session.socket.logout();
        console.log(`✅ Logout exitoso para ${userId}`);
      } catch (e) {
        console.error('Error en logout:', e);
      }
    }
    
    this.sessions.delete(userId);

    // Eliminar archivos de sesión
    try {
      const authPath = path.join(AUTH_DIR, userId);
      if (fs.existsSync(authPath)) {
        fs.rmSync(authPath, { recursive: true, force: true });
        console.log(`🗑️ Archivos de sesión eliminados para ${userId}`);
      }
    } catch (e) {
      console.error('Error eliminando archivos:', e);
    }

    // Actualizar BD
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { whatsappConnected: false, whatsappPhone: null },
      });
      console.log(`💾 BD actualizada para ${userId}`);
    } catch (e) {
      console.error('Error actualizando BD:', e);
    }
  }

  async sendMessagePublic(userId: string, to: string, message: string): Promise<boolean> {
    const session = this.sessions.get(userId);
    
    if (!session?.socket || !session.connected) {
      console.error('❌ No hay sesión activa para enviar mensaje');
      return false;
    }
    
    // Formatear JID
    const jid = to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`;
    
    return this.sendMessage(session.socket, jid, message);
  }
}

export const whatsappService = new WhatsAppService();
export default whatsappService;
