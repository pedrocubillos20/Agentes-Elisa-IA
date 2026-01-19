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

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'clave-encriptacion-32-caracteres!';
const AUTH_DIR = process.env.AUTH_DIR || '/app/auth_sessions';

// Logger silencioso
const logger = pino({ level: 'silent' }) as any;

const decryptApiKey = (encrypted: string): string => {
  try {
    const bytes = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (error) {
    return '';
  }
};

interface WhatsAppSession {
  socket: WASocket | null;
  qrCode: string | null;
  connected: boolean;
  phoneNumber: string | null;
  userId: string;
  connecting: boolean;
}

class WhatsAppService extends EventEmitter {
  private sessions: Map<string, WhatsAppSession> = new Map();
  
  constructor() {
    super();
    console.log('📱 WhatsApp Service inicializado');
    
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }
  }

  private cleanSession(userId: string): void {
    const authPath = path.join(AUTH_DIR, userId);
    try {
      if (fs.existsSync(authPath)) {
        fs.rmSync(authPath, { recursive: true, force: true });
      }
    } catch (e) {}
  }

  async initializeClient(userId: string): Promise<string | null> {
    console.log(`\n🚀 Iniciando WhatsApp para ${userId}`);
    
    // Cerrar sesión existente
    const existing = this.sessions.get(userId);
    if (existing?.socket) {
      try { existing.socket.end(undefined); } catch (e) {}
    }
    
    // Limpiar todo
    this.sessions.delete(userId);
    this.cleanSession(userId);
    
    // Nueva sesión
    const session: WhatsAppSession = {
      socket: null,
      qrCode: null,
      connected: false,
      phoneNumber: null,
      userId,
      connecting: true,
    };
    this.sessions.set(userId, session);

    const authPath = path.join(AUTH_DIR, userId);
    fs.mkdirSync(authPath, { recursive: true });

    try {
      const { state, saveCreds } = await useMultiFileAuthState(authPath);
      console.log(`✅ Auth state cargado`);

      // Configuración MÍNIMA para máxima compatibilidad
      const socket = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
      });

      session.socket = socket;
      console.log(`✅ Socket creado, esperando QR...`);

      return new Promise((resolve) => {
        let resolved = false;

        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            session.connecting = false;
            console.log(`⏰ Timeout - QR actual: ${session.qrCode ? 'SÍ' : 'NO'}`);
            resolve(session.qrCode);
          }
        }, 90000);

        socket.ev.on('connection.update', async (update) => {
          const { connection, lastDisconnect, qr } = update;
          
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          console.log(`📡 Update: conn=${connection || '-'}, qr=${qr ? 'SÍ' : 'NO'}, code=${statusCode || '-'}`);

          if (qr) {
            console.log(`\n🎉 ¡QR RECIBIDO!`);
            try {
              session.qrCode = await QRCode.toDataURL(qr);
              console.log(`✅ QR convertido a imagen`);
              
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                resolve(session.qrCode);
              }
            } catch (err) {
              console.error('Error QR:', err);
              session.qrCode = qr;
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                resolve(qr);
              }
            }
          }

          if (connection === 'close') {
            console.log(`📴 Conexión cerrada`);
            session.connected = false;
            session.connecting = false;
            
            try {
              await prisma.user.update({
                where: { id: userId },
                data: { whatsappConnected: false, whatsappPhone: null },
              });
            } catch (e) {}

            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve(session.qrCode);
            }
          }

          if (connection === 'open') {
            console.log(`\n✅ ¡CONECTADO!`);
            session.connected = true;
            session.connecting = false;
            session.qrCode = null;

            const phoneNumber = socket.user?.id?.split(':')[0] || socket.user?.id?.split('@')[0];
            session.phoneNumber = phoneNumber ? `+${phoneNumber}` : null;
            console.log(`📱 Número: ${session.phoneNumber}`);

            try {
              await prisma.user.update({
                where: { id: userId },
                data: { whatsappConnected: true, whatsappPhone: session.phoneNumber },
              });
            } catch (e) {}

            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve(null);
            }
          }
        });

        socket.ev.on('creds.update', saveCreds);

        socket.ev.on('messages.upsert', async (m) => {
          if (m.type !== 'notify') return;

          for (const msg of m.messages) {
            if (msg.key.fromMe) continue;
            if (msg.key.remoteJid?.endsWith('@g.us')) continue;

            const content = msg.message?.conversation || 
                           msg.message?.extendedTextMessage?.text || '';

            if (!content.trim()) continue;

            console.log(`📨 Mensaje: ${content.substring(0, 50)}...`);
            await this.handleMessage(userId, msg.key.remoteJid!, content, socket);
          }
        });
      });

    } catch (error: any) {
      console.error(`❌ Error:`, error?.message || error);
      session.connecting = false;
      this.cleanSession(userId);
      this.sessions.delete(userId);
      throw error;
    }
  }

  private async handleMessage(userId: string, jid: string, content: string, socket: WASocket) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { assistants: { where: { isActive: true }, take: 1 } },
      });

      if (!user || user.assistants.length === 0) return;

      const assistant = user.assistants[0];
      if (!assistant.contextJson || !user.openaiApiKey) {
        await socket.sendMessage(jid, { text: '⚠️ Chatbot no configurado.' });
        return;
      }

      const clientPhone = jid.replace(/@.*$/, '');

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
        data: { conversationId: conversation.id, role: 'USER', content },
      });

      const reply = await this.generateResponse(user, assistant, conversation, content);

      await prisma.message.create({
        data: { conversationId: conversation.id, role: 'ASSISTANT', content: reply },
      });

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { messageCount: { increment: 2 }, lastMessageAt: new Date() },
      });

      await socket.sendMessage(jid, { text: reply });
      console.log(`✅ Respuesta enviada`);

    } catch (error: any) {
      console.error('Error:', error?.message);
      try {
        await socket.sendMessage(jid, { text: 'Lo siento, hubo un error.' });
      } catch (e) {}
    }
  }

  private async generateResponse(user: any, assistant: any, conversation: any, message: string): Promise<string> {
    try {
      const apiKey = decryptApiKey(user.openaiApiKey);
      if (!apiKey) return 'Error de configuración.';

      const openai = new OpenAI({ apiKey });

      let context = '';
      try {
        const data = JSON.parse(assistant.contextJson);
        context = JSON.stringify(data, null, 2);
      } catch (e) {
        context = assistant.contextJson;
      }

      const history = (conversation.messages || []).map((m: any) => ({
        role: m.role.toLowerCase() as 'user' | 'assistant',
        content: m.content,
      }));

      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { 
            role: 'system', 
            content: `Eres ${assistant.name}, asistente de WhatsApp. Contexto:\n${context}\n\nReglas: Responde en español, sé conciso, usa emojis ocasionalmente.` 
          },
          ...history.slice(-10),
          { role: 'user', content: message },
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

  getSessionStatus(userId: string) {
    const s = this.sessions.get(userId);
    return {
      connected: s?.connected || false,
      phoneNumber: s?.phoneNumber || null,
      qrCode: s?.qrCode || null,
    };
  }

  async disconnectSession(userId: string): Promise<void> {
    const s = this.sessions.get(userId);
    if (s?.socket) {
      try { await s.socket.logout(); } catch (e) {}
      try { s.socket.end(undefined); } catch (e) {}
    }
    this.cleanSession(userId);
    this.sessions.delete(userId);
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { whatsappConnected: false, whatsappPhone: null },
      });
    } catch (e) {}
  }

  async sendMessagePublic(userId: string, to: string, message: string): Promise<boolean> {
    const s = this.sessions.get(userId);
    if (!s?.socket || !s.connected) return false;
    const jid = to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`;
    try {
      await s.socket.sendMessage(jid, { text: message });
      return true;
    } catch (e) {
      return false;
    }
  }
}

export const whatsappService = new WhatsAppService();
export default whatsappService;
