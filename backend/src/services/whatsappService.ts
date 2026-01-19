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

const logger = pino({ level: 'silent' });

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
    
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
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
          console.log(`📱 QR generado para usuario ${userId}`);
          try {
            session.qrCode = await QRCode.toDataURL(qr);
            this.emit('qr', { userId, qr: session.qrCode });
          } catch (err) {
            console.error('Error generando QR:', err);
            session.qrCode = qr;
          }
        }

        if (connection === 'close') {
          const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
          
          console.log(`📴 Conexión cerrada para ${userId}. Reconectar: ${shouldReconnect}`);
          
          session.connected = false;
          session.ready = false;
          session.connecting = false;

          if ((lastDisconnect?.error as Boom)?.output?.statusCode === DisconnectReason.loggedOut) {
            try {
              fs.rmSync(authPath, { recursive: true, force: true });
            } catch (e) {
              console.error('Error eliminando sesión:', e);
            }
          }

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

          const phoneNumber = socket.user?.id?.split(':')[0] || socket.user?.id?.split('@')[0];
          session.phoneNumber = phoneNumber ? `+${phoneNumber}` : null;

          console.log(`📱 Número conectado: ${session.phoneNumber}`);

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

      socket.ev.on('creds.update', saveCreds);

      socket.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;

        for (const msg of m.messages) {
          if (msg.key.fromMe) continue;
          if (msg.key.remoteJid?.endsWith('@g.us')) continue;

          const messageContent = msg.message?.conversation || 
                                msg.message?.extendedTextMessage?.text ||
                                '';

          if (!messageContent.trim()) continue;

          console.log(`📨 Mensaje recibido de ${msg.key.remoteJid}: ${messageContent.substring(0, 50)}...`);

          await this.handleIncomingMessage(userId, msg.key.remoteJid!, messageContent, socket);
        }
      });

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

  private async handleIncomingMessage(
    userId: string, 
    remoteJid: string, 
    messageContent: string,
    socket: WASocket
  ) {
    try {
      console.log(`📨 Procesando mensaje de ${remoteJid}`);

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

      if (!assistant.contextJson) {
        console.log('❌ Sin contexto configurado');
        await this.sendMessage(socket, remoteJid, '⚠️ El asistente aún no está configurado.');
        return;
      }

      if (!user.openaiApiKey) {
        console.log('❌ Sin API Key');
        await this.sendMessage(socket, remoteJid, '⚠️ Falta configurar la API Key de OpenAI.');
        return;
      }

      const clientPhone = remoteJid.replace(/@.*$/, '');

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

      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'USER',
          content: messageContent,
        },
      });

      console.log('🧠 Generando respuesta con IA...');
      
      const reply = await this.generateAIResponse(user, assistant, conversation, messageContent);

      console.log(`💬 Respuesta: ${reply.substring(0, 100)}...`);

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

      console.log('📤 Enviando respuesta...');
      const sent = await this.sendMessage(socket, remoteJid, reply);
      
      if (sent) {
        console.log(`✅ Respuesta enviada`);
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

  private async generateAIResponse(
    user: any,
    assistant: any,
    conversation: any,
    userMessage: string
  ): Promise<string> {
    try {
      const userApiKey = decryptApiKey(user.openaiApiKey);
      
      if (!userApiKey) {
        return 'Lo siento, hay un problema con la configuración.';
      }

      const openai = new OpenAI({ apiKey: userApiKey });

      let businessContext = '';
      if (assistant.contextJson) {
        try {
          const contextData = JSON.parse(assistant.contextJson);
          businessContext = this.formatContextForAI(contextData);
        } catch (e) {
          businessContext = assistant.contextJson;
        }
      }

      const messageHistory = (conversation.messages || []).map((m: any) => ({
        role: m.role.toLowerCase() as 'user' | 'assistant',
        content: m.content,
      }));

      const systemPrompt = `Eres ${assistant.name}, un asistente virtual de WhatsApp.
Sé amigable y profesional.

${businessContext}

REGLAS:
- Responde siempre en español
- Sé conciso
- No inventes información
- Usa emojis ocasionalmente 😊`;

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
      
      if (error?.code === 'invalid_api_key') {
        return 'Error: La API Key de OpenAI no es válida.';
      }
      if (error?.code === 'insufficient_quota') {
        return 'Tu cuenta de OpenAI no tiene créditos.';
      }
      
      return 'Lo siento, hubo un error.';
    }
  }

  private formatContextForAI(contextData: any): string {
    let formatted = '\n=== INFORMACIÓN DEL NEGOCIO ===\n';
    
    const info = contextData.negocio || contextData.bot || contextData.business || {};
    
    if (info.nombre) formatted += `Nombre: ${info.nombre}\n`;
    if (info.empresa) formatted += `Empresa: ${info.empresa}\n`;
    if (info.descripcion) formatted += `Descripción: ${info.descripcion}\n`;
    if (info.objetivo) formatted += `Objetivo: ${info.objetivo}\n`;
    
    if (info.personalidad) {
      if (info.personalidad.tipo) formatted += `Personalidad: ${info.personalidad.tipo}\n`;
      if (info.personalidad.tono) formatted += `Tono: ${info.personalidad.tono}\n`;
    }
    
    const products = contextData.productos || contextData.products || [];
    if (products.length > 0) {
      formatted += '\n=== PRODUCTOS ===\n';
      products.forEach((p: any, i: number) => {
        formatted += `${i + 1}. ${p.nombre || p.name}`;
        if (p.precio || p.price) formatted += ` - $${p.precio || p.price}`;
        if (p.descripcion) formatted += ` - ${p.descripcion}`;
        formatted += '\n';
      });
    }
    
    const faqs = contextData.preguntas_frecuentes || contextData.faqs || [];
    if (faqs.length > 0) {
      formatted += '\n=== PREGUNTAS FRECUENTES ===\n';
      faqs.forEach((f: any) => {
        if (f.pregunta && f.respuesta) {
          formatted += `P: ${f.pregunta}\nR: ${f.respuesta}\n\n`;
        }
      });
    }
    
    return formatted;
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
      try {
        await session.socket.logout();
      } catch (e) {
        console.error('Error desconectando:', e);
      }
    }
    this.sessions.delete(userId);

    try {
      const authPath = path.join(AUTH_DIR, userId);
      if (fs.existsSync(authPath)) {
        fs.rmSync(authPath, { recursive: true, force: true });
      }
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
