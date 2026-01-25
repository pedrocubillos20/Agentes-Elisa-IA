import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState,
  WASocket,
  proto,
  AnyMessageContent
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as fs from 'fs';
import * as path from 'path';
import pino from 'pino';
import prisma from '../lib/prisma';
import { openaiService } from './openaiService';

/**
 * ============================================
 * BAILEYS SERVICE - CONEXIÓN DIRECTA WHATSAPP
 * ============================================
 * 
 * VENTAJAS sobre Evolution API:
 * ✅ Soporta envío a @lid nativamente
 * ✅ Control total del socket
 * ✅ Sin dependencia de API externa
 * ✅ Más estable para SaaS
 * 
 * ============================================
 */

// Almacén de conexiones activas por usuario
const connections = new Map<string, WASocket>();
const qrCodes = new Map<string, string>();

// Directorio base para auth
const AUTH_DIR = process.env.BAILEYS_AUTH_DIR || './baileys_auth';

// Logger silencioso para producción
const logger = pino({ level: 'silent' });

class BaileysService {
  
  constructor() {
    // Crear directorio de auth si no existe
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }
    console.log('🔧 Baileys Service inicializado');
  }

  // ============================================
  // OBTENER DIRECTORIO DE AUTH POR USUARIO
  // ============================================
  private getAuthDir(userId: string): string {
    const dir = path.join(AUTH_DIR, userId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  // ============================================
  // CREAR/CONECTAR INSTANCIA
  // ============================================
  async createConnection(userId: string): Promise<{
    success: boolean;
    qrCode?: string;
    connected?: boolean;
    error?: string;
  }> {
    try {
      console.log(`🔌 Creando conexión Baileys para usuario: ${userId}`);
      
      // Si ya existe conexión activa, retornar estado
      if (connections.has(userId)) {
        const sock = connections.get(userId)!;
        const isConnected = sock.user !== undefined;
        
        if (isConnected) {
          return { success: true, connected: true };
        }
        
        // Si hay QR pendiente
        const qr = qrCodes.get(userId);
        if (qr) {
          return { success: true, connected: false, qrCode: qr };
        }
      }

      const authDir = this.getAuthDir(userId);
      const { state, saveCreds } = await useMultiFileAuthState(authDir);

      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger,
        browser: ['Elisa IA', 'Chrome', '120.0.0'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
      });

      // Guardar conexión
      connections.set(userId, sock);

      // ============================================
      // EVENTO: ACTUALIZACIÓN DE CONEXIÓN
      // ============================================
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // QR Code recibido
        if (qr) {
          console.log(`📱 QR generado para usuario: ${userId}`);
          qrCodes.set(userId, qr);
          
          // Actualizar en DB
          await prisma.user.update({
            where: { id: userId },
            data: { 
              whatsappQrCode: qr,
              whatsappStatus: 'waiting_qr',
              whatsappConnected: false
            }
          });
        }

        // Conexión establecida
        if (connection === 'open') {
          console.log(`✅ Conexión establecida para usuario: ${userId}`);
          qrCodes.delete(userId);
          
          const phone = sock.user?.id?.split(':')[0] || sock.user?.id?.split('@')[0];
          
          await prisma.user.update({
            where: { id: userId },
            data: {
              whatsappConnected: true,
              whatsappStatus: 'connected',
              whatsappPhone: phone,
              whatsappQrCode: null
            }
          });
        }

        // Conexión cerrada
        if (connection === 'close') {
          const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
          
          console.log(`❌ Conexión cerrada para ${userId}. Reconectar: ${shouldReconnect}`);
          
          if (shouldReconnect) {
            // Reconectar automáticamente
            setTimeout(() => this.createConnection(userId), 5000);
          } else {
            // Logout - limpiar todo
            connections.delete(userId);
            qrCodes.delete(userId);
            
            // Limpiar archivos de auth
            const authDir = this.getAuthDir(userId);
            if (fs.existsSync(authDir)) {
              fs.rmSync(authDir, { recursive: true });
            }
            
            await prisma.user.update({
              where: { id: userId },
              data: {
                whatsappConnected: false,
                whatsappStatus: 'disconnected',
                whatsappPhone: null,
                whatsappQrCode: null
              }
            });
          }
        }
      });

      // ============================================
      // EVENTO: CREDENCIALES ACTUALIZADAS
      // ============================================
      sock.ev.on('creds.update', saveCreds);

      // ============================================
      // EVENTO: MENSAJES RECIBIDOS
      // ============================================
      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
          // Ignorar mensajes propios
          if (msg.key.fromMe) continue;
          
          const jid = msg.key.remoteJid;
          if (!jid) continue;
          
          // Ignorar grupos
          if (jid.endsWith('@g.us')) continue;

          // ============================================
          // 🔥 AQUÍ ESTÁ LA MAGIA: JID PUEDE SER @lid
          // Y BAILEYS LO MANEJA NATIVAMENTE
          // ============================================
          const isLid = jid.includes('@lid');
          const chatType = isLid ? 'LID' : 'REAL';
          
          console.log('\n╔══════════════════════════════════════════════════════════════╗');
          console.log('║              MENSAJE RECIBIDO (Baileys)                       ║');
          console.log('╚══════════════════════════════════════════════════════════════╝');
          console.log(`📋 JID: ${jid}`);
          console.log(`📱 Tipo: ${chatType}`);
          
          const pushName = msg.pushName || '';
          console.log(`👤 Nombre: ${pushName}`);

          // Extraer contenido del mensaje
          const messageContent = msg.message?.conversation ||
                                msg.message?.extendedTextMessage?.text ||
                                '';
          
          if (!messageContent) continue;

          console.log(`📨 Mensaje: ${messageContent}`);

          // Procesar mensaje
          await this.processIncomingMessage(userId, jid, pushName, messageContent, sock);
        }
      });

      // Esperar un poco para ver si hay QR o conexión
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Retornar estado actual
      const qr = qrCodes.get(userId);
      const isConnected = sock.user !== undefined;

      return {
        success: true,
        connected: isConnected,
        qrCode: qr
      };

    } catch (error: any) {
      console.error('❌ Error creando conexión Baileys:', error);
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // PROCESAR MENSAJE ENTRANTE
  // ============================================
  private async processIncomingMessage(
    userId: string,
    jid: string,
    pushName: string,
    messageContent: string,
    sock: WASocket
  ) {
    try {
      // Buscar usuario
      const user = await prisma.user.findUnique({ where: { id: userId } });
      
      if (!user) {
        console.log('❌ Usuario no encontrado');
        return;
      }

      if (!user.apiKeyConnected) {
        console.log('⚠️ Usuario sin API Key configurada');
        return;
      }

      // Usar JID como ID de conversación (funciona con LID)
      const recipientId = jid;

      // Gestión de conversación
      let conversation = await prisma.conversation.findFirst({
        where: { userId: user.id, recipientId }
      });

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            userId: user.id,
            recipientId,
            recipientName: pushName || jid,
            lastMessage: messageContent,
            lastMessageAt: new Date()
          }
        });
        console.log(`📝 Nueva conversación: ${conversation.id}`);
      } else {
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            lastMessage: messageContent,
            lastMessageAt: new Date(),
            recipientName: pushName || conversation.recipientName
          }
        });
      }

      // Guardar mensaje
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          userId: user.id,
          role: 'user',
          content: messageContent,
          fromMe: false
        }
      });

      // Historial
      const recentMessages = await prisma.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { timestamp: 'asc' },
        take: 20
      });

      const history = recentMessages.map(m => ({ role: m.role, content: m.content }));

      // Generar respuesta con IA
      console.log('🤖 Generando respuesta con IA...');
      const aiResponse = await openaiService.generateResponse(user.id, messageContent, history.slice(0, -1));

      if (aiResponse.success && aiResponse.response) {
        console.log(`✅ Respuesta: ${aiResponse.response.substring(0, 80)}...`);

        // ============================================
        // 🔥 ENVIAR RESPUESTA - FUNCIONA CON LID
        // ============================================
        console.log(`📤 Enviando a JID: ${jid}`);
        
        await sock.sendMessage(jid, { text: aiResponse.response });

        // Guardar respuesta
        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            userId: user.id,
            role: 'assistant',
            content: aiResponse.response,
            fromMe: true
          }
        });

        console.log('✅ ¡MENSAJE ENVIADO! (Baileys)');
      }

    } catch (error: any) {
      console.error('❌ Error procesando mensaje:', error);
    }
  }

  // ============================================
  // VERIFICAR ESTADO DE CONEXIÓN
  // ============================================
  async checkConnectionStatus(userId: string): Promise<{
    connected: boolean;
    phone?: string;
  }> {
    const sock = connections.get(userId);
    
    if (!sock) {
      return { connected: false };
    }

    const isConnected = sock.user !== undefined;
    const phone = sock.user?.id?.split(':')[0] || sock.user?.id?.split('@')[0];

    return {
      connected: isConnected,
      phone: phone || undefined
    };
  }

  // ============================================
  // OBTENER QR CODE
  // ============================================
  async getQRCode(userId: string): Promise<{
    success: boolean;
    qrCode?: string;
  }> {
    // Si no hay conexión, crear una
    if (!connections.has(userId)) {
      const result = await this.createConnection(userId);
      return {
        success: result.success,
        qrCode: result.qrCode
      };
    }

    const qr = qrCodes.get(userId);
    return {
      success: !!qr,
      qrCode: qr
    };
  }

  // ============================================
  // ENVIAR MENSAJE DE TEXTO
  // ============================================
  async sendTextMessage(userId: string, to: string, text: string): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
  }> {
    try {
      const sock = connections.get(userId);
      
      if (!sock) {
        return { success: false, error: 'No hay conexión activa' };
      }

      // Formatear JID si es necesario
      let jid = to;
      if (!jid.includes('@')) {
        jid = `${to}@s.whatsapp.net`;
      }

      console.log(`📤 Enviando mensaje a: ${jid}`);
      
      const result = await sock.sendMessage(jid, { text });
      
      return {
        success: true,
        messageId: result?.key?.id
      };

    } catch (error: any) {
      console.error('❌ Error enviando mensaje:', error);
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // DESCONECTAR
  // ============================================
  async disconnect(userId: string): Promise<{ success: boolean }> {
    try {
      const sock = connections.get(userId);
      
      if (sock) {
        await sock.logout();
        connections.delete(userId);
      }
      
      qrCodes.delete(userId);

      await prisma.user.update({
        where: { id: userId },
        data: {
          whatsappConnected: false,
          whatsappStatus: 'disconnected',
          whatsappQrCode: null
        }
      });

      return { success: true };
    } catch (error: any) {
      console.error('❌ Error desconectando:', error);
      return { success: false };
    }
  }

  // ============================================
  // ELIMINAR INSTANCIA
  // ============================================
  async deleteInstance(userId: string): Promise<{ success: boolean }> {
    try {
      await this.disconnect(userId);

      // Eliminar archivos de auth
      const authDir = this.getAuthDir(userId);
      if (fs.existsSync(authDir)) {
        fs.rmSync(authDir, { recursive: true });
      }

      await prisma.user.update({
        where: { id: userId },
        data: {
          whatsappConnected: false,
          whatsappStatus: 'disconnected',
          whatsappPhone: null,
          whatsappQrCode: null
        }
      });

      return { success: true };
    } catch (error: any) {
      console.error('❌ Error eliminando instancia:', error);
      return { success: false };
    }
  }
}

export const baileysService = new BaileysService();
export default baileysService;
