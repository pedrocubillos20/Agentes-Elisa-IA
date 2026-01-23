import axios from 'axios';
import prisma from '../lib/prisma';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;

if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
  console.error('⚠️ EVOLUTION_API_URL y EVOLUTION_API_KEY deben estar configuradas en variables de entorno');
}

class EvolutionService {
  private apiUrl: string;
  private apiKey: string;

  constructor() {
    this.apiUrl = EVOLUTION_API_URL || '';
    this.apiKey = EVOLUTION_API_KEY || '';
    if (this.apiUrl && this.apiKey) {
      console.log(`🔧 Evolution Service inicializado: ${this.apiUrl}`);
    } else {
      console.log('⚠️ Evolution Service: Variables de entorno no configuradas');
    }
  }

  private getHeaders() {
    if (!this.apiKey) {
      throw new Error('EVOLUTION_API_KEY no está configurada');
    }
    return {
      'Content-Type': 'application/json',
      'apikey': this.apiKey
    };
  }

  // ============================================
  // CREAR INSTANCIA - v1.8.0 Compatible
  // ============================================
  async createInstance(userId: string): Promise<{ 
    success: boolean; 
    instanceName?: string;
    qrcode?: string; 
    error?: string 
  }> {
    try {
      const instanceName = `elisa_${userId.substring(0, 8)}_${Date.now()}`;
      
      console.log(`🔧 Creando instancia: ${instanceName}`);
      
      const response = await axios.post(
        `${this.apiUrl}/instance/create`,
        {
          instanceName: instanceName,
          qrcode: true,
          integration: "WHATSAPP-BAILEYS",
          reject_call: true,
          msg_call: "No puedo atender llamadas en este momento.",
          groups_ignore: true,
          always_online: true,
          read_messages: true,
          read_status: false
        },
        { 
          headers: this.getHeaders(),
          timeout: 30000
        }
      );

      console.log('📋 Respuesta crear instancia:', JSON.stringify(response.data).substring(0, 500));

      const qrcode = response.data?.qrcode?.base64 || 
                     response.data?.base64 ||
                     response.data?.data?.qrcode?.base64 ||
                     response.data?.data?.base64;

      await prisma.user.update({
        where: { id: userId },
        data: {
          evolutionInstanceName: instanceName,
          whatsappStatus: 'waiting_qr',
          whatsappQrCode: qrcode || null,
          whatsappConnected: false
        }
      });

      return {
        success: true,
        instanceName: instanceName,
        qrcode: qrcode
      };
    } catch (error: any) {
      console.error('❌ Error creando instancia:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.response?.data?.error || error.message
      };
    }
  }

  // ============================================
  // VERIFICAR ESTADO DE CONEXIÓN
  // ============================================
  async checkConnectionStatus(instanceName: string): Promise<{ 
    connected: boolean; 
    state?: string; 
    phone?: string;
    instanceNotFound?: boolean;
    error?: string 
  }> {
    try {
      const response = await axios.get(
        `${this.apiUrl}/instance/connectionState/${instanceName}`,
        { 
          headers: this.getHeaders(),
          timeout: 10000
        }
      );

      console.log('📋 Estado conexión:', JSON.stringify(response.data).substring(0, 300));

      const state = response.data?.instance?.state || 
                   response.data?.state || 
                   response.data?.data?.state;
      
      const owner = response.data?.instance?.owner || 
                   response.data?.owner ||
                   response.data?.data?.owner;

      const phone = owner?.replace('@s.whatsapp.net', '').replace(/\D/g, '');
      const connected = state === 'open' || state === 'connected';

      if (connected && phone) {
        const user = await prisma.user.findFirst({
          where: { evolutionInstanceName: instanceName }
        });
        
        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              whatsappConnected: true,
              whatsappStatus: 'connected',
              whatsappPhone: phone,
              whatsappQrCode: null
            }
          });
        }
      }

      return {
        connected: connected,
        state: state,
        phone: phone
      };
    } catch (error: any) {
      if (error.response?.status === 404) {
        const user = await prisma.user.findFirst({
          where: { evolutionInstanceName: instanceName }
        });
        
        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              evolutionInstanceName: null,
              whatsappConnected: false,
              whatsappStatus: 'disconnected',
              whatsappQrCode: null,
              whatsappPhone: null
            }
          });
        }
        
        return {
          connected: false,
          state: 'not_found',
          instanceNotFound: true,
          error: 'Instance not found'
        };
      }
      
      console.error('❌ Error verificando estado:', error.message);
      return {
        connected: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  // ============================================
  // OBTENER QR CODE
  // ============================================
  async getQRCode(instanceName: string): Promise<{ 
    success: boolean; 
    qrcode?: string; 
    instanceNotFound?: boolean;
    error?: string 
  }> {
    try {
      const response = await axios.get(
        `${this.apiUrl}/instance/connect/${instanceName}`,
        { 
          headers: this.getHeaders(),
          timeout: 15000
        }
      );

      console.log('📋 Respuesta QR:', JSON.stringify(response.data).substring(0, 300));

      const qrcode = response.data?.qrcode?.base64 || 
                     response.data?.base64 || 
                     response.data?.code ||
                     response.data?.data?.qrcode?.base64;

      if (qrcode) {
        const user = await prisma.user.findFirst({
          where: { evolutionInstanceName: instanceName }
        });
        
        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: { whatsappQrCode: qrcode }
          });
        }
      }

      return {
        success: !!qrcode,
        qrcode: qrcode
      };
    } catch (error: any) {
      if (error.response?.status === 404) {
        return {
          success: false,
          instanceNotFound: true,
          error: 'Instance not found'
        };
      }
      console.error('❌ Error obteniendo QR:', error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  // ============================================
  // OBTENER NÚMERO REAL DE UN CONTACTO/LID
  // Busca en múltiples fuentes de Evolution API
  // ============================================
  async getRealPhoneNumber(instanceName: string, jid: string): Promise<string | null> {
    console.log(`\n🔍 ========== BUSCANDO NÚMERO REAL ==========`);
    console.log(`📋 JID recibido: ${jid}`);
    
    // Si ya es un número normal, extraerlo
    if (jid.includes('@s.whatsapp.net')) {
      const number = jid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
      console.log(`✅ Es número normal: ${number}`);
      return number;
    }
    
    // Si no es un LID, extraer el número directamente
    if (!jid.includes('@lid')) {
      const number = jid.split('@')[0].replace(/\D/g, '');
      if (number.length >= 10 && number.length <= 15) {
        console.log(`✅ Número extraído: ${number}`);
        return number;
      }
    }
    
    console.log('🔍 Es un LID, buscando número real...');
    
    // MÉTODO 1: Buscar en fetchInstances (tiene info del owner conectado)
    try {
      const instanceResponse = await axios.get(
        `${this.apiUrl}/instance/fetchInstances`,
        { 
          headers: this.getHeaders(),
          timeout: 10000
        }
      );
      
      const instances = instanceResponse.data || [];
      for (const inst of instances) {
        if (inst.instanceName === instanceName || inst.instance?.instanceName === instanceName) {
          const owner = inst.owner || inst.instance?.owner;
          if (owner && owner.includes('@s.whatsapp.net')) {
            // Este es el número del dueño de la instancia, no del contacto
            console.log(`📋 Owner de instancia: ${owner}`);
          }
        }
      }
    } catch (e: any) {
      console.log(`⚠️ Error fetchInstances: ${e.message}`);
    }
    
    // MÉTODO 2: Buscar perfil del contacto
    try {
      const profileResponse = await axios.post(
        `${this.apiUrl}/chat/fetchProfile/${instanceName}`,
        { number: jid },
        { 
          headers: this.getHeaders(),
          timeout: 10000
        }
      );
      
      console.log('📋 Perfil encontrado:', JSON.stringify(profileResponse.data).substring(0, 500));
      
      const profile = profileResponse.data;
      const possibleNumbers = [
        profile.wid?.user,
        profile.id?.user,
        profile.jid,
        profile.number,
        profile.phone,
        profile.wid?._serialized?.replace('@s.whatsapp.net', ''),
      ];
      
      for (const num of possibleNumbers) {
        if (num) {
          const clean = String(num).replace(/\D/g, '');
          if (clean.length >= 10 && clean.length <= 15) {
            console.log(`✅ Número encontrado en perfil: ${clean}`);
            return clean;
          }
        }
      }
    } catch (e: any) {
      console.log(`⚠️ Error fetchProfile: ${e.message}`);
    }
    
    // MÉTODO 3: Buscar en chats recientes
    try {
      const chatsResponse = await axios.get(
        `${this.apiUrl}/chat/findChats/${instanceName}`,
        { 
          headers: this.getHeaders(),
          timeout: 10000
        }
      );
      
      const chats = chatsResponse.data || [];
      for (const chat of chats) {
        // Buscar si algún chat tiene este LID asociado
        const chatJid = chat.id || chat.jid || chat.remoteJid;
        if (chatJid === jid || chat.lid === jid) {
          const possibleNumber = chat.id?.replace('@s.whatsapp.net', '') ||
                                chat.number ||
                                chat.phone;
          if (possibleNumber) {
            const clean = String(possibleNumber).replace(/\D/g, '');
            if (clean.length >= 10 && clean.length <= 15) {
              console.log(`✅ Número encontrado en chats: ${clean}`);
              return clean;
            }
          }
        }
      }
    } catch (e: any) {
      console.log(`⚠️ Error findChats: ${e.message}`);
    }
    
    // MÉTODO 4: Buscar en contactos
    try {
      const contactsResponse = await axios.get(
        `${this.apiUrl}/chat/findContacts/${instanceName}`,
        { 
          headers: this.getHeaders(),
          timeout: 10000
        }
      );
      
      const contacts = contactsResponse.data || [];
      for (const contact of contacts) {
        const contactJid = contact.id || contact.jid;
        if (contactJid === jid || contact.lid === jid) {
          const possibleNumber = contact.id?.replace('@s.whatsapp.net', '') ||
                                contact.number ||
                                contact.phone;
          if (possibleNumber) {
            const clean = String(possibleNumber).replace(/\D/g, '');
            if (clean.length >= 10 && clean.length <= 15) {
              console.log(`✅ Número encontrado en contactos: ${clean}`);
              return clean;
            }
          }
        }
      }
    } catch (e: any) {
      console.log(`⚠️ Error findContacts: ${e.message}`);
    }
    
    console.log(`❌ No se encontró número real para: ${jid}`);
    return null;
  }

  // ============================================
  // ENVIAR MENSAJE DE TEXTO
  // Maneja tanto números normales como LIDs
  // ============================================
  async sendTextMessage(instanceName: string, to: string, text: string): Promise<{ 
    success: boolean; 
    messageId?: string; 
    error?: string 
  }> {
    console.log(`\n📤 ========== ENVIANDO MENSAJE ==========`);
    console.log(`📤 Instancia: ${instanceName}`);
    console.log(`📤 Destinatario original: "${to}"`);
    console.log(`📝 Texto: ${text.substring(0, 100)}...`);
    
    // Ignorar grupos
    if (to.includes('@g.us')) {
      console.log('⚠️ Grupos no soportados');
      return { success: false, error: 'Groups not supported' };
    }
    
    // Limpiar el número
    let numberToSend = to.replace('@s.whatsapp.net', '').replace('@lid', '').replace(/\D/g, '');
    
    console.log(`📤 Número limpio para enviar: "${numberToSend}"`);
    
    // Intentar enviar con el número
    try {
      const payload = {
        number: numberToSend,
        options: {
          delay: 1200,
          presence: "composing",
          linkPreview: false
        },
        textMessage: {
          text: text
        }
      };
      
      console.log(`🔄 Enviando a: ${this.apiUrl}/message/sendText/${instanceName}`);
      console.log(`🔄 Payload:`, JSON.stringify(payload));
      
      const response = await axios.post(
        `${this.apiUrl}/message/sendText/${instanceName}`,
        payload,
        { 
          headers: this.getHeaders(),
          timeout: 30000
        }
      );
      
      console.log('✅ Respuesta envío:', JSON.stringify(response.data).substring(0, 300));
      
      const messageId = response.data?.key?.id || 
                       response.data?.messageId ||
                       response.data?.data?.key?.id;
      
      return {
        success: true,
        messageId: messageId
      };
      
    } catch (error: any) {
      console.error('❌ Error enviando mensaje:', {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      
      // Si el error es "exists: false", el número no está en WhatsApp
      const errorData = error.response?.data;
      if (errorData?.response?.[0]?.exists === false) {
        console.log('⚠️ El número no existe en WhatsApp');
      }
      
      return {
        success: false,
        error: JSON.stringify(error.response?.data || error.message)
      };
    }
  }

  // ============================================
  // CONFIGURAR WEBHOOK
  // ============================================
  async setWebhook(instanceName: string, webhookUrl: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`🔗 Configurando webhook: ${webhookUrl}`);
      
      const response = await axios.post(
        `${this.apiUrl}/webhook/set/${instanceName}`,
        {
          webhook: {
            enabled: true,
            url: webhookUrl,
            webhookByEvents: false,
            webhookBase64: false,
            events: [
              'MESSAGES_UPSERT',
              'MESSAGES_UPDATE',
              'CONNECTION_UPDATE',
              'QRCODE_UPDATED',
              'CONTACTS_UPSERT',
              'CONTACTS_UPDATE',
              'CHATS_UPSERT',
              'CHATS_UPDATE'
            ]
          }
        },
        { 
          headers: this.getHeaders(),
          timeout: 10000
        }
      );
      
      console.log('✅ Webhook configurado:', JSON.stringify(response.data).substring(0, 200));
      return { success: true };
    } catch (error: any) {
      console.error('❌ Error configurando webhook:', error.response?.data || error.message);
      return { 
        success: false, 
        error: error.response?.data?.message || error.message 
      };
    }
  }

  // ============================================
  // DESCONECTAR INSTANCIA
  // ============================================
  async disconnectInstance(instanceName: string): Promise<{ success: boolean; error?: string }> {
    try {
      await axios.delete(
        `${this.apiUrl}/instance/logout/${instanceName}`, 
        { 
          headers: this.getHeaders(),
          timeout: 10000
        }
      );
      
      const user = await prisma.user.findFirst({ 
        where: { evolutionInstanceName: instanceName } 
      });
      
      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: { 
            whatsappConnected: false, 
            whatsappStatus: 'disconnected', 
            whatsappQrCode: null 
          }
        });
      }
      
      console.log(`✅ Instancia ${instanceName} desconectada`);
      return { success: true };
    } catch (error: any) {
      console.error('❌ Error desconectando:', error.message);
      return { 
        success: false, 
        error: error.response?.data?.message || error.message 
      };
    }
  }

  // ============================================
  // ELIMINAR INSTANCIA
  // ============================================
  async deleteInstance(instanceName: string): Promise<{ success: boolean; error?: string }> {
    try {
      await axios.delete(
        `${this.apiUrl}/instance/delete/${instanceName}`, 
        { 
          headers: this.getHeaders(),
          timeout: 10000
        }
      );
      
      const user = await prisma.user.findFirst({ 
        where: { evolutionInstanceName: instanceName } 
      });
      
      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: { 
            evolutionInstanceName: null, 
            whatsappConnected: false, 
            whatsappStatus: 'disconnected', 
            whatsappQrCode: null, 
            whatsappPhone: null 
          }
        });
      }
      
      console.log(`✅ Instancia ${instanceName} eliminada`);
      return { success: true };
    } catch (error: any) {
      if (error.response?.status === 404) {
        const user = await prisma.user.findFirst({ 
          where: { evolutionInstanceName: instanceName } 
        });
        
        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: { 
              evolutionInstanceName: null, 
              whatsappConnected: false, 
              whatsappStatus: 'disconnected', 
              whatsappQrCode: null, 
              whatsappPhone: null 
            }
          });
        }
        return { success: true };
      }
      
      console.error('❌ Error eliminando instancia:', error.message);
      return { 
        success: false, 
        error: error.response?.data?.message || error.message 
      };
    }
  }

  // ============================================
  // OBTENER INFORMACIÓN DE LA INSTANCIA
  // ============================================
  async getInstanceInfo(instanceName: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.apiUrl}/instance/fetchInstances`,
        { 
          headers: this.getHeaders(),
          params: { instanceName },
          timeout: 10000
        }
      );
      return response.data;
    } catch (error: any) {
      console.error('❌ Error obteniendo info:', error.message);
      return null;
    }
  }
}

export const evolutionService = new EvolutionService();
export default evolutionService;
