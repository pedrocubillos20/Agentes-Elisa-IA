import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState,
  WASocket,
  proto,
  downloadMediaMessage
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

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'clave-encriptacion-32-caracteres!';
const AUTH_DIR = process.env.AUTH_DIR || '/app/auth_sessions';

// Logger silencioso para Baileys - usar any para evitar errores de tipos
const logger = pino({ level: 'silent' }) as any;

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
    
    // Crear directorio de autenticación si no existe
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }
  }

  // Crear o obtener sesión para un usuario
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

  // Inicializar conexión de WhatsApp
  async initializeClient(userId: string): Promise<string | null> {
    const session = await this.getOrCreateSession(userId);
    
    // Si ya está conectado, no hacer nada
    if (session.connected && session.ready) {
      console.log(`✅ Usuario ${userId} ya está conectado`);
      return null;
    }

    // Si está conectando, esperar
    if (session.connecting) {
      console.log(`⏳ Usuario ${userId} ya está conectando, esperando QR...`);
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

    try {
      const authPath = path.join(AUTH_DIR, userId);
      
      // Asegurar que el directorio existe
      if (!fs.existsSync(authPath)) {
        fs.mkdirSync(authPath, { recursive: true });
      }

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
      });

      session.socket = socket;

      // Evento: Actualización de conexión
      socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          console.log(`📱 QR generado para usuario ${userId}`);
          try {
            // Convertir QR a base64 para mostrar en frontend
            session.qrCode = await QRCode.toDataURL(qr);
            this.emit('qr', { userId, qr: session.qrCode });
          } catch (err) {
            console.error('Error generando QR:', err);
            session.qrCode = qr; // Usar el string original como fallback
          }
        }

        if (connection === 'close') {
          const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
          
          console.log(`📴 Conexión cerrada para ${userId}. Reconectar: ${shouldReconnect}`);
          
          session.connected = false;
          session.ready = false;
          session.connecting = false;

          if ((lastDisconnect?.error as Boom)?.output?.statusCode === DisconnectReason.loggedOut) {
            // Eliminar sesión guardada
            try {
              fs.rmSync(authPath, { recursive: true, force: true });
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

          if (shouldReconnect) {
            console.log(`🔄 Reintentando conexión para ${userId}...`);
            setTimeout(() => this.initializeClient(userId), 5000);
          }
        }

        if (connection === 'open') {
          console.log(`✅ Usuario ${userId} conectado a WhatsApp`);
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
          } catch (e) {
            console.error('Error actualizando BD:', e);
          }

          this.emit('ready', { userId });
        }
      });

      // Guardar credenciales cuando cambien
      socket.ev.on('creds.update', saveCreds);

      // Evento: Mensajes recibidos
      socket.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;

        for (const msg of m.messages) {
          // Ignorar mensajes propios
          if (msg.key.fromMe) continue;
          
          // Ignorar mensajes de grupos
          if (msg.key.remoteJid?.endsWith('@g.us')) continue;

          // Obtener contenido del mensaje
          const messageContent = msg.message?.conversation || 
                                msg.message?.extendedTextMessage?.text ||
                                '';

          if (!messageContent.trim()) continue;

          console.log(`📨 Mensaje recibido de ${msg.key.remoteJid}: ${messageContent.substring(0, 50)}...`);

          await this.handleIncomingMessage(userId, msg.key.remoteJid!, messageContent, socket);
        }
      });

      // Esperar a que se genere el QR o se conecte
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
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

    } catch (error) {
      console.error(`❌ Error inicializando WhatsApp para ${userId}:`, error);
      session.connecting = false;
      throw error;
    }
  }

  // Manejar mensajes entrantes
  private async handleIncomingMessage(
    userId: string, 
    remoteJid: string, 
    messageContent: string,
    socket: WASocket
  ) {
    try {
      console.log(`📨 Procesando mensaje de ${remoteJid}: ${messageContent}`);

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
        console.log('❌ No hay asistente activo');
        return;
      }

      const assistant = user.assistants[0];
      console.log(`🤖 Usando asistente: ${assistant.name}`);

      // Verificar contexto
      if (!assistant.contextJson) {
        console.log('❌ Sin contexto configurado');
        await this.sendMessage(socket, remoteJid, '⚠️ El asistente aún no está configurado. Por favor contacta al administrador.');
        return;
      }

      // Verificar API Key
      if (!user.openaiApiKey) {
        console.log('❌ Sin API Key');
        await this.sendMessage(socket, remoteJid, '⚠️ El chatbot no está configurado correctamente. Por favor contacta al administrador.');
        return;
      }

      // Extraer número de teléfono (sin @s.whatsapp.net o @lid)
      const clientPhone = remoteJid.replace(/@.*$/, '');

      // Obtener o crear conversación
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
          content: messageContent,
        },
      });

      console.log('🧠 Generando respuesta con IA...');
      
      // Generar respuesta
      const reply = await this.generateAIResponse(user, assistant, conversation, messageContent);

      console.log(`💬 Respuesta: ${reply.substring(0, 100)}...`);

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
      console.log('📤 Enviando respuesta...');
      const sent = await this.sendMessage(socket, remoteJid, reply);
      
      if (sent) {
        console.log(`✅ Respuesta enviada a ${remoteJid}`);
      } else {
        console.log(`❌ No se pudo enviar respuesta`);
      }

    } catch (error: any) {
      console.error('❌ Error procesando mensaje:', error?.message || error);
      
      try {
        await this.sendMessage(socket, remoteJid, 'Lo siento, hubo un error. Por favor intenta de nuevo.');
      } catch (e) {
        console.error('Error enviando mensaje de error:', e);
      }
    }
  }

  // Enviar mensaje
  private async sendMessage(socket: WASocket, jid: string, text: string): Promise<boolean> {
    try {
      console.log(`📱 Enviando mensaje a: ${jid}`);
      
      await socket.sendMessage(jid, { text });
      
      return true;
    } catch (error: any) {
      console.error('❌ Error enviando mensaje:', error?.message || error);
      return false;
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
        return 'Lo siento, hay un problema con la configuración.';
      }

      const openai = new OpenAI({ apiKey: userApiKey });

      // Construir contexto
      let businessContext = '';
      if (assistant.contextJson) {
        try {
          const contextData = JSON.parse(assistant.contextJson);
          businessContext = this.formatContextForAI(contextData);
        } catch (e) {
          businessContext = assistant.contextJson;
        }
      }

      // Historial de mensajes
      const messageHistory = (conversation.messages || []).map((m: any) => ({
        role: m.role.toLowerCase() as 'user' | 'assistant',
        content: m.content,
      }));

      // System prompt
      const systemPrompt = this.buildSystemPrompt(assistant, businessContext);

      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messageHistory.slice(-10),
          { role: 'user', content: userMessage },
        ],
        max_tokens: 500,
        temperature: 0.7,
      });

      return completion.choices[0]?.message?.content || 'Lo siento, no pude procesar tu mensaje.';
      
    } catch (error: any) {
      console.error('❌ Error OpenAI:', error?.message);
      
      if (error?.status === 401 || error?.code === 'invalid_api_key') {
        return 'Error: La API Key de OpenAI no es válida.';
      }
      if (error?.code === 'insufficient_quota') {
        return 'Tu cuenta de OpenAI no tiene créditos suficientes.';
      }
      
      return 'Lo siento, hubo un error procesando tu mensaje.';
    }
  }

  // Formatear contexto para IA
  private formatContextForAI(contextData: any): string {
    let formatted = '\n=== INFORMACIÓN DEL NEGOCIO/BOT ===\n';
    
    const businessInfo = contextData.negocio || contextData.bot || contextData.business;
    
    if (businessInfo) {
      const n = businessInfo;
      formatted += `\nNombre: ${n.nombre || n.name || 'No especificado'}`;
      if (n.empresa) formatted += `\nEmpresa: ${n.empresa}`;
      if (n.descripcion || n.description) formatted += `\nDescripción: ${n.descripcion || n.description}`;
      if (n.horario) formatted += `\nHorario: ${n.horario}`;
      if (n.direccion) formatted += `\nDirección: ${n.direccion}`;
      if (n.telefono) formatted += `\nTeléfono: ${n.telefono}`;
      if (n.whatsapp) formatted += `\nWhatsApp: ${n.whatsapp}`;
      if (n.objetivo) formatted += `\nObjetivo: ${n.objetivo}`;
      
      if (n.personalidad) {
        const p = n.personalidad;
        formatted += '\n\n=== PERSONALIDAD ===';
        if (p.tipo) formatted += `\nTipo: ${p.tipo}`;
        if (p.tono) formatted += `\nTono: ${p.tono}`;
        if (p.orientacion) formatted += `\nOrientación: ${p.orientacion}`;
      }
    }
    
    const products = contextData.productos || contextData.products || contextData.catalogo;
    if (products && Array.isArray(products) && products.length > 0) {
      formatted += '\n\n=== PRODUCTOS/CATÁLOGO ===\n';
      products.forEach((p: any, i: number) => {
        const name = p.nombre || p.name || 'Producto';
        const price = p.precio || p.price;
        formatted += `\n${i + 1}. ${name}`;
        if (price) formatted += ` - $${typeof price === 'number' ? price.toLocaleString('es-CO') : price}`;
        if (p.descripcion) formatted += `\n   ${p.descripcion}`;
        if (p.tallas) formatted += `\n   Tallas: ${Array.isArray(p.tallas) ? p.tallas.join(', ') : p.tallas}`;
      });
    }
    
    const faqs = contextData.preguntas_frecuentes || contextData.faqs;
    if (faqs && Array.isArray(faqs)) {
      formatted += '\n\n=== PREGUNTAS FRECUENTES ===\n';
      faqs.forEach((faq: any) => {
        if (faq.pregunta && faq.respuesta) {
          formatted += `\nP: ${faq.pregunta}\nR: ${faq.respuesta}\n`;
        }
      });
    }

    // Agregar campos adicionales
    Object.keys(contextData).forEach(key => {
      if (!['negocio', 'bot', 'business', 'productos', 'products', 'catalogo', 'preguntas_frecuentes', 'faqs'].includes(key)) {
        formatted += `\n\n=== ${key.toUpperCase()} ===\n`;
        const value = contextData[key];
        formatted += typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      }
    });
    
    return formatted;
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

REGLAS:
- Responde siempre en español
- Sé conciso (máximo 2-3 párrafos cortos)
- No inventes información
- Usa emojis ocasionalmente 😊
- Si no sabes algo, ofrece contactar al equipo`;
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
    if (session?.socket) {
      try {
        await session.socket.logout();
      } catch (e) {
        console.error('Error desconectando:', e);
      }
      session.socket = null;
      session.connected = false;
      session.ready = false;
    }
    this.sessions.delete(userId);

    // Eliminar archivos de sesión
    try {
      const authPath = path.join(AUTH_DIR, userId);
      if (fs.existsSync(authPath)) {
        fs.rmSync(authPath, { recursive: true, force: true });
      }
    } catch (e) {
      console.error('Error eliminando sesión:', e);
    }

    // Actualizar BD
    try {
      await prisma.user.update({
        where: { id: userId },
        data: {
          whatsappConnected: false,
          whatsappPhone: null,
        },
      });
    } catch (e) {
      console.error('Error actualizando BD:', e);
    }
  }

  // Enviar mensaje público
  async sendMessagePublic(userId: string, to: string, message: string): Promise<boolean> {
    const session = this.sessions.get(userId);
    if (!session?.socket || !session.connected) {
      return false;
    }

    // Formatear número
    const jid = to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`;
    
    return this.sendMessage(session.socket, jid, message);
  }
}

// Singleton
export const whatsappService = new WhatsAppService();
export default whatsappService;
