import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState,
  WASocket
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

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'elisa-ia-encryption-key-2024';
const AUTH_DIR = process.env.AUTH_DIR || '/app/auth_sessions';

// Logger silencioso para Baileys
const logger = pino({ level: 'silent' }) as any;

// Desencriptar API Key
const decryptApiKey = (encrypted: string): string => {
  try {
    if (!encrypted) return '';
    const bytes = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (error) {
    console.error('❌ Error desencriptando API Key');
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
    console.log('📱 WhatsApp Service inicializado');
    
    // Crear directorio de sesiones
    try {
      if (!fs.existsSync(AUTH_DIR)) {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
      }
    } catch (error) {
      console.error('Error creando directorio de sesiones:', error);
    }
  }

  private getOrCreateSession(userId: string): WhatsAppSession {
    let session = this.sessions.get(userId);
    
    if (!session) {
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
    }
    
    return session;
  }

  async initializeClient(userId: string): Promise<string | null> {
    const session = this.getOrCreateSession(userId);
    
    if (session.connected && session.ready) {
      console.log(`✅ Usuario ${userId} ya conectado`);
      return null;
    }

    if (session.connecting) {
      // Esperar QR existente
      return new Promise((resolve) => {
        const checkQR = setInterval(() => {
          if (session.qrCode || session.connected) {
            clearInterval(checkQR);
            resolve(session.qrCode);
          }
        }, 1000);
        setTimeout(() => { clearInterval(checkQR); resolve(session.qrCode); }, 30000);
      });
    }

    session.connecting = true;
    session.qrCode = null;

    try {
      const authPath = path.join(AUTH_DIR, userId);
      
      if (!fs.existsSync(authPath)) {
        fs.mkdirSync(authPath, { recursive: true });
      }

      console.log(`🔧 Iniciando WhatsApp para ${userId}...`);

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

      // Manejar conexión
      socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          console.log(`📱 QR generado para ${userId}`);
          try {
            session.qrCode = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
          } catch (err) {
            session.qrCode = qr;
          }
          this.emit('qr', { userId, qr: session.qrCode });
        }

        if (connection === 'close') {
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          
          console.log(`📴 Desconectado ${userId}. Código: ${statusCode}`);
          
          session.connected = false;
          session.ready = false;
          session.connecting = false;
          session.socket = null;

          if (statusCode === DisconnectReason.loggedOut) {
            try { fs.rmSync(authPath, { recursive: true, force: true }); } catch (e) {}
          }

          // Actualizar BD
          try {
            await prisma.user.update({
              where: { id: userId },
              data: { whatsappConnected: false, whatsappPhone: null },
            });
          } catch (e) {}

          this.emit('disconnected', { userId });

          if (shouldReconnect) {
            console.log(`🔄 Reconectando ${userId} en 5s...`);
            setTimeout(() => this.initializeClient(userId), 5000);
          }
        }

        if (connection === 'open') {
          console.log(`✅ ${userId} conectado a WhatsApp`);
          session.connected = true;
          session.ready = true;
          session.connecting = false;
          session.qrCode = null;

          const phoneNumber = socket.user?.id?.split(':')[0] || socket.user?.id?.split('@')[0];
          session.phoneNumber = phoneNumber ? `+${phoneNumber}` : null;

          // Actualizar BD
          try {
            await prisma.user.update({
              where: { id: userId },
              data: { whatsappConnected: true, whatsappPhone: session.phoneNumber },
            });
          } catch (e) {}

          this.emit('ready', { userId });
        }
      });

      // Guardar credenciales
      socket.ev.on('creds.update', saveCreds);

      // Manejar mensajes
      socket.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;

        for (const msg of m.messages) {
          // Ignorar mensajes propios y de grupos
          if (msg.key.fromMe) continue;
          if (msg.key.remoteJid?.endsWith('@g.us')) continue;
          if (msg.key.remoteJid?.includes('@broadcast')) continue;

          const messageContent = 
            msg.message?.conversation || 
            msg.message?.extendedTextMessage?.text || '';

          if (!messageContent.trim()) continue;

          console.log(`📨 Mensaje de ${msg.key.remoteJid}: ${messageContent.substring(0, 50)}...`);
          
          await this.handleIncomingMessage(userId, msg.key.remoteJid!, messageContent, socket);
        }
      });

      // Esperar QR o conexión
      return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(session.qrCode), 30000);
        const check = setInterval(() => {
          if (session.qrCode || session.connected) {
            clearInterval(check);
            clearTimeout(timeout);
            resolve(session.qrCode);
          }
        }, 500);
      });

    } catch (error) {
      console.error(`❌ Error iniciando WhatsApp para ${userId}:`, error);
      session.connecting = false;
      throw error;
    }
  }

  private async handleIncomingMessage(userId: string, remoteJid: string, messageContent: string, socket: WASocket) {
    try {
      // Obtener usuario con asistente y negocio
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          assistants: { where: { isActive: true }, take: 1 },
          business: { include: { products: { where: { isActive: true } }, faqs: true } }
        },
      });

      if (!user) {
        console.log('❌ Usuario no encontrado');
        return;
      }

      if (user.assistants.length === 0) {
        await this.sendMessage(socket, remoteJid, '⚠️ El asistente no está configurado. Configura tu chatbot en la plataforma.');
        return;
      }

      const assistant = user.assistants[0];

      if (!assistant.contextJson) {
        await this.sendMessage(socket, remoteJid, '⚠️ El asistente no tiene instrucciones. Configúralo en la plataforma.');
        return;
      }

      if (!user.openaiApiKey) {
        await this.sendMessage(socket, remoteJid, '⚠️ Falta configurar la API Key de OpenAI en la plataforma.');
        return;
      }

      const clientPhone = remoteJid.replace(/@.*$/, '');

      // Buscar o crear conversación
      let conversation = await prisma.conversation.findFirst({
        where: { assistantId: assistant.id, clientPhone, status: 'ACTIVE' },
        include: { messages: { orderBy: { createdAt: 'asc' }, take: 20 } },
      });

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: { assistantId: assistant.id, clientPhone, channel: 'WHATSAPP', status: 'ACTIVE' },
          include: { messages: true },
        });
      }

      // Guardar mensaje del usuario
      await prisma.message.create({
        data: { conversationId: conversation.id, role: 'USER', content: messageContent },
      });

      // Generar respuesta IA
      console.log('🧠 Generando respuesta...');
      const reply = await this.generateAIResponse(user, assistant, conversation, messageContent);

      // Guardar respuesta
      await prisma.message.create({
        data: { conversationId: conversation.id, role: 'ASSISTANT', content: reply },
      });

      // Actualizar conversación
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { messageCount: { increment: 2 }, lastMessageAt: new Date() },
      });

      // Enviar respuesta
      console.log('📤 Enviando respuesta...');
      await this.sendMessage(socket, remoteJid, reply);
      console.log('✅ Respuesta enviada');

    } catch (error) {
      console.error('❌ Error procesando mensaje:', error);
      try {
        await this.sendMessage(socket, remoteJid, 'Lo siento, hubo un error. Intenta de nuevo en un momento.');
      } catch (e) {}
    }
  }

  private async sendMessage(socket: WASocket, jid: string, text: string): Promise<boolean> {
    try {
      await socket.sendMessage(jid, { text });
      return true;
    } catch (error) {
      console.error('Error enviando mensaje:', error);
      return false;
    }
  }

  private async generateAIResponse(user: any, assistant: any, conversation: any, userMessage: string): Promise<string> {
    try {
      const apiKey = decryptApiKey(user.openaiApiKey);
      
      if (!apiKey) {
        return '⚠️ Error con la API Key. Verifica tu configuración.';
      }

      const openai = new OpenAI({ apiKey });

      // Construir contexto
      let context = '';
      
      // Parsear contexto del asistente
      try {
        const ctx = JSON.parse(assistant.contextJson);
        context = this.formatContext(ctx);
      } catch (e) {
        context = assistant.contextJson;
      }

      // Agregar info del negocio
      if (user.business) {
        context += `\n\n=== INFORMACIÓN DEL NEGOCIO ===`;
        context += `\nNombre: ${user.business.name}`;
        if (user.business.description) context += `\nDescripción: ${user.business.description}`;
        if (user.business.phone) context += `\nTeléfono: ${user.business.phone}`;
        if (user.business.email) context += `\nEmail: ${user.business.email}`;
        if (user.business.address) context += `\nDirección: ${user.business.address}`;
        if (user.business.hours) context += `\nHorarios: ${user.business.hours}`;
        if (user.business.website) context += `\nWeb: ${user.business.website}`;
        
        // Productos
        if (user.business.products?.length > 0) {
          context += `\n\n=== PRODUCTOS/SERVICIOS ===`;
          user.business.products.forEach((p: any, i: number) => {
            context += `\n${i + 1}. ${p.name}`;
            if (p.price) context += ` - $${p.price}`;
            if (p.description) context += ` - ${p.description}`;
          });
        }
        
        // FAQs
        if (user.business.faqs?.length > 0) {
          context += `\n\n=== PREGUNTAS FRECUENTES ===`;
          user.business.faqs.forEach((f: any) => {
            context += `\nP: ${f.question}\nR: ${f.answer}\n`;
          });
        }
      }

      // Historial de mensajes
      const history = (conversation.messages || []).map((m: any) => ({
        role: m.role.toLowerCase() === 'user' ? 'user' as const : 'assistant' as const,
        content: m.content,
      }));

      const systemPrompt = `Eres ${assistant.name}, un asistente virtual de WhatsApp amigable y profesional.

${context}

INSTRUCCIONES:
- Responde SIEMPRE en español
- Sé amigable, profesional y conciso
- Usa emojis ocasionalmente 😊
- No inventes información
- Mantén respuestas cortas (máximo 2-3 párrafos)
- Si no sabes algo, ofrece contacto directo con el negocio`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          ...history.slice(-10),
          { role: 'user', content: userMessage },
        ],
        max_tokens: 500,
        temperature: 0.7,
      });

      return completion.choices[0]?.message?.content || 'No pude generar una respuesta. Intenta de nuevo.';
      
    } catch (error: any) {
      console.error('❌ Error OpenAI:', error?.message);
      
      if (error?.code === 'invalid_api_key' || error?.status === 401) {
        return '⚠️ La API Key de OpenAI no es válida. Verifica tu configuración.';
      }
      if (error?.code === 'insufficient_quota' || error?.status === 429) {
        return '⚠️ Sin créditos en OpenAI. Recarga tu cuenta en platform.openai.com';
      }
      
      return 'Lo siento, hubo un error. Intenta de nuevo.';
    }
  }

  private formatContext(ctx: any): string {
    let text = '';
    
    const info = ctx.negocio || ctx.bot || ctx.business || ctx.info || {};
    if (info.nombre || info.name) text += `Nombre: ${info.nombre || info.name}\n`;
    if (info.descripcion || info.description) text += `Descripción: ${info.descripcion || info.description}\n`;
    if (info.objetivo || info.goal) text += `Objetivo: ${info.objetivo || info.goal}\n`;
    
    const products = ctx.productos || ctx.products || [];
    if (products.length > 0) {
      text += '\nProductos/Servicios:';
      products.forEach((p: any) => {
        text += `\n- ${p.nombre || p.name}`;
        if (p.precio || p.price) text += ` ($${p.precio || p.price})`;
        if (p.descripcion || p.description) text += `: ${p.descripcion || p.description}`;
      });
    }
    
    const faqs = ctx.preguntas_frecuentes || ctx.faqs || ctx.faq || [];
    if (faqs.length > 0) {
      text += '\n\nFAQs:';
      faqs.forEach((f: any) => {
        const q = f.pregunta || f.question || f.q;
        const a = f.respuesta || f.answer || f.a;
        if (q && a) text += `\nP: ${q}\nR: ${a}`;
      });
    }
    
    const instructions = ctx.instrucciones || ctx.instructions || ctx.reglas || ctx.rules;
    if (instructions) {
      text += '\n\nInstrucciones especiales:';
      if (Array.isArray(instructions)) {
        instructions.forEach((i: string) => text += `\n- ${i}`);
      } else {
        text += `\n${instructions}`;
      }
    }
    
    return text;
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
    console.log(`🔌 Desconectando ${userId}...`);
    
    const session = this.sessions.get(userId);
    
    if (session?.socket) {
      try { await session.socket.logout(); } catch (e) {}
    }
    
    this.sessions.delete(userId);

    // Eliminar archivos de sesión
    try {
      const authPath = path.join(AUTH_DIR, userId);
      if (fs.existsSync(authPath)) {
        fs.rmSync(authPath, { recursive: true, force: true });
      }
    } catch (e) {}

    // Actualizar BD
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { whatsappConnected: false, whatsappPhone: null },
      });
    } catch (e) {}
    
    console.log(`✅ ${userId} desconectado`);
  }

  async sendMessagePublic(userId: string, to: string, message: string): Promise<boolean> {
    const session = this.sessions.get(userId);
    
    if (!session?.socket || !session.connected) {
      return false;
    }
    
    const jid = to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`;
    return this.sendMessage(session.socket, jid, message);
  }
}

export const whatsappService = new WhatsAppService();
export default whatsappService;
