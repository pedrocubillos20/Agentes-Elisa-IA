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

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'elisa-ia-clave-encriptacion-2024';
const AUTH_DIR = process.env.AUTH_DIR || '/app/auth_sessions';

// Logger silencioso para Baileys - usar any para evitar errores de tipos
const logger = pino({ level: 'silent' }) as any;

const decryptApiKey = (encrypted: string): string => {
  try {
    if (!encrypted) return '';
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
    console.log('📱 WhatsApp Service inicializado');
    
    try {
      if (!fs.existsSync(AUTH_DIR)) {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
      }
    } catch (error) {
      console.error('Error creando directorio:', error);
    }
  }

  async getOrCreateSession(userId: string): Promise<WhatsAppSession> {
    let session = this.sessions.get(userId);
    
    if (session) return session;

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
      return null;
    }

    if (session.connecting) {
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

      socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          console.log(`📱 QR generado para ${userId}`);
          try {
            session.qrCode = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
            this.emit('qr', { userId, qr: session.qrCode });
          } catch (err) {
            session.qrCode = qr;
          }
        }

        if (connection === 'close') {
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          
          console.log(`📴 Conexión cerrada para ${userId}. Reconectar: ${shouldReconnect}`);
          
          session.connected = false;
          session.ready = false;
          session.connecting = false;
          session.socket = null;

          if (statusCode === DisconnectReason.loggedOut) {
            try { fs.rmSync(authPath, { recursive: true, force: true }); } catch (e) {}
          }

          try {
            await prisma.user.update({
              where: { id: userId },
              data: { whatsappConnected: false, whatsappPhone: null },
            });
          } catch (e) {}

          this.emit('disconnected', { userId });

          if (shouldReconnect) {
            setTimeout(() => this.initializeClient(userId), 5000);
          }
        }

        if (connection === 'open') {
          console.log(`✅ Usuario ${userId} conectado a WhatsApp`);
          session.connected = true;
          session.ready = true;
          session.connecting = false;
          session.qrCode = null;

          const phoneNumber = socket.user?.id?.split(':')[0] || socket.user?.id?.split('@')[0];
          session.phoneNumber = phoneNumber ? `+${phoneNumber}` : null;

          try {
            await prisma.user.update({
              where: { id: userId },
              data: { whatsappConnected: true, whatsappPhone: session.phoneNumber },
            });
          } catch (e) {}

          this.emit('ready', { userId });
        }
      });

      socket.ev.on('creds.update', saveCreds);

      socket.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;

        for (const msg of m.messages) {
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

      return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(session.qrCode), 30000);
        const checkInterval = setInterval(() => {
          if (session.qrCode || session.connected) {
            clearInterval(checkInterval);
            clearTimeout(timeout);
            resolve(session.qrCode);
          }
        }, 500);
      });

    } catch (error) {
      console.error(`Error inicializando WhatsApp para ${userId}:`, error);
      session.connecting = false;
      throw error;
    }
  }

  private async handleIncomingMessage(userId: string, remoteJid: string, messageContent: string, socket: WASocket) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          assistants: { where: { isActive: true }, take: 1 },
          business: { include: { products: true, faqs: true } }
        },
      });

      if (!user) return;
      if (user.assistants.length === 0) {
        await this.sendMessage(socket, remoteJid, '⚠️ El asistente no está configurado.');
        return;
      }

      const assistant = user.assistants[0];

      if (!assistant.contextJson) {
        await this.sendMessage(socket, remoteJid, '⚠️ El asistente no tiene instrucciones configuradas.');
        return;
      }

      if (!user.openaiApiKey) {
        await this.sendMessage(socket, remoteJid, '⚠️ Falta configurar la API Key de OpenAI.');
        return;
      }

      const clientPhone = remoteJid.replace(/@.*$/, '');

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

      await prisma.message.create({
        data: { conversationId: conversation.id, role: 'USER', content: messageContent },
      });

      const reply = await this.generateAIResponse(user, assistant, conversation, messageContent);

      await prisma.message.create({
        data: { conversationId: conversation.id, role: 'ASSISTANT', content: reply },
      });

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { messageCount: { increment: 2 }, lastMessageAt: new Date() },
      });

      await this.sendMessage(socket, remoteJid, reply);

    } catch (error) {
      console.error('Error procesando mensaje:', error);
      try {
        await this.sendMessage(socket, remoteJid, 'Lo siento, hubo un error. Intenta de nuevo.');
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
      const userApiKey = decryptApiKey(user.openaiApiKey);
      if (!userApiKey) return 'Error de configuración. Verifica tu API Key.';

      const openai = new OpenAI({ apiKey: userApiKey });

      let businessContext = '';
      try {
        const ctx = JSON.parse(assistant.contextJson);
        businessContext = this.formatContext(ctx);
      } catch (e) {
        businessContext = assistant.contextJson;
      }

      if (user.business) {
        businessContext += `\n\nNegocio: ${user.business.name || ''}`;
        if (user.business.description) businessContext += `\nDescripción: ${user.business.description}`;
        if (user.business.phone) businessContext += `\nTeléfono: ${user.business.phone}`;
        if (user.business.products?.length > 0) {
          businessContext += '\n\nProductos:';
          user.business.products.forEach((p: any) => {
            businessContext += `\n- ${p.name}${p.price ? ` ($${p.price})` : ''}`;
          });
        }
        if (user.business.faqs?.length > 0) {
          businessContext += '\n\nFAQs:';
          user.business.faqs.forEach((f: any) => {
            businessContext += `\nP: ${f.question}\nR: ${f.answer}`;
          });
        }
      }

      const history = (conversation.messages || []).map((m: any) => ({
        role: m.role.toLowerCase() === 'user' ? 'user' as const : 'assistant' as const,
        content: m.content,
      }));

      const systemPrompt = `Eres ${assistant.name}, asistente virtual de WhatsApp.
${businessContext}

Reglas:
- Responde en español
- Sé amigable y conciso
- No inventes información
- Usa emojis ocasionalmente 😊`;

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

      return completion.choices[0]?.message?.content || 'No pude generar una respuesta.';
      
    } catch (error: any) {
      console.error('Error OpenAI:', error?.message);
      if (error?.code === 'invalid_api_key') return '⚠️ API Key de OpenAI inválida.';
      if (error?.code === 'insufficient_quota') return '⚠️ Sin créditos en OpenAI.';
      return 'Error al procesar. Intenta de nuevo.';
    }
  }

  private formatContext(ctx: any): string {
    let text = '';
    const info = ctx.negocio || ctx.bot || ctx.business || {};
    if (info.nombre) text += `Nombre: ${info.nombre}\n`;
    if (info.descripcion) text += `Descripción: ${info.descripcion}\n`;
    
    const products = ctx.productos || ctx.products || [];
    if (products.length > 0) {
      text += '\nProductos:';
      products.forEach((p: any) => {
        text += `\n- ${p.nombre || p.name}${p.precio || p.price ? ` ($${p.precio || p.price})` : ''}`;
      });
    }
    
    const faqs = ctx.preguntas_frecuentes || ctx.faqs || [];
    if (faqs.length > 0) {
      text += '\n\nFAQs:';
      faqs.forEach((f: any) => {
        text += `\nP: ${f.pregunta || f.question}\nR: ${f.respuesta || f.answer}`;
      });
    }
    
    return text;
  }

  getSessionStatus(userId: string) {
    const session = this.sessions.get(userId);
    return {
      connected: session?.connected || false,
      phoneNumber: session?.phoneNumber || null,
      qrCode: session?.qrCode || null,
    };
  }

  async disconnectSession(userId: string): Promise<void> {
    const session = this.sessions.get(userId);
    if (session?.socket) {
      try { await session.socket.logout(); } catch (e) {}
    }
    this.sessions.delete(userId);

    try {
      const authPath = path.join(AUTH_DIR, userId);
      if (fs.existsSync(authPath)) fs.rmSync(authPath, { recursive: true, force: true });
    } catch (e) {}

    try {
      await prisma.user.update({
        where: { id: userId },
        data: { whatsappConnected: false, whatsappPhone: null },
      });
    } catch (e) {}
  }

  async sendMessagePublic(userId: string, to: string, message: string): Promise<boolean> {
    const session = this.sessions.get(userId);
    if (!session?.socket || !session.connected) return false;
    const jid = to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`;
    return this.sendMessage(session.socket, jid, message);
  }
}

export const whatsappService = new WhatsAppService();
export default whatsappService;
