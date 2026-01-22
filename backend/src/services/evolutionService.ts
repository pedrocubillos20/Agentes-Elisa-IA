import axios from 'axios';
import prisma from '../lib/prisma';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://31.97.142.127:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';

class EvolutionService {
  private apiUrl: string;
  private apiKey: string;

  constructor() {
    this.apiUrl = EVOLUTION_API_URL;
    this.apiKey = EVOLUTION_API_KEY;
  }

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'apikey': this.apiKey
    };
  }

  // Crear nueva instancia
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
          integration: "WHATSAPP-BAILEYS"
        },
        { headers: this.getHeaders() }
      );

      const qrcode = response.data?.qrcode?.base64 || response.data?.base64;

      await prisma.user.update({
        where: { id: userId },
        data: {
          evolutionInstanceName: instanceName,
          whatsappStatus: 'waiting_qr',
          whatsappQrCode: qrcode
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
        error: error.response?.data?.message || error.message
      };
    }
  }

  // Verificar estado de conexión
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
        { headers: this.getHeaders() }
      );

      const state = response.data?.instance?.state || response.data?.state;
      const phone = response.data?.instance?.owner || response.data?.owner;

      return {
        connected: state === 'open',
        state: state,
        phone: phone?.replace('@s.whatsapp.net', '').replace(/\D/g, '')
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
      
      return {
        connected: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  // Obtener QR code
  async getQRCode(instanceName: string): Promise<{ 
    success: boolean; 
    qrcode?: string; 
    instanceNotFound?: boolean;
    error?: string 
  }> {
    try {
      const response = await axios.get(
        `${this.apiUrl}/instance/connect/${instanceName}`,
        { headers: this.getHeaders() }
      );

      const qrcode = response.data?.qrcode?.base64 || 
                     response.data?.base64 || 
                     response.data?.code;

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
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  // ============================================
  // BUSCAR NÚMERO REAL DE UN CONTACTO LID
  // ============================================
  async findRealPhoneNumber(instanceName: string, lidJid: string): Promise<string | null> {
    console.log(`\n🔍 ========== BUSCANDO NÚMERO REAL ==========`);
    console.log(`🔍 LID JID: ${lidJid}`);
    
    try {
      // Método 1: Buscar en contactos por LID
      console.log(`🔍 Método 1: Buscando en contactos...`);
      try {
        const contactsResponse = await axios.get(
          `${this.apiUrl}/chat/findContacts/${instanceName}`,
          { 
            headers: this.getHeaders(),
            params: { where: { id: lidJid } }
          }
        );
        
        console.log(`🔍 Contactos encontrados:`, JSON.stringify(contactsResponse.data).substring(0, 500));
        
        if (contactsResponse.data && contactsResponse.data.length > 0) {
          const contact = contactsResponse.data[0];
          // Buscar número en diferentes campos
          const possibleNumber = contact.id?.replace('@s.whatsapp.net', '') ||
                                contact.number ||
                                contact.jid?.replace('@s.whatsapp.net', '') ||
                                contact.phone;
          
          if (possibleNumber && !possibleNumber.includes('@lid') && possibleNumber.length >= 10) {
            console.log(`✅ Número real encontrado en contactos: ${possibleNumber}`);
            return possibleNumber.replace(/\D/g, '');
          }
        }
      } catch (e: any) {
        console.log(`⚠️ Método 1 falló:`, e.message);
      }

      // Método 2: Buscar en chats
      console.log(`🔍 Método 2: Buscando en chats...`);
      try {
        const chatsResponse = await axios.get(
          `${this.apiUrl}/chat/findChats/${instanceName}`,
          { headers: this.getHeaders() }
        );
        
        const chats = chatsResponse.data || [];
        for (const chat of chats) {
          if (chat.id === lidJid || chat.remoteJid === lidJid) {
            console.log(`🔍 Chat encontrado:`, JSON.stringify(chat).substring(0, 300));
            
            const possibleNumber = chat.number || 
                                  chat.phone ||
                                  chat.contact?.number ||
                                  chat.contact?.phone;
            
            if (possibleNumber && possibleNumber.length >= 10) {
              console.log(`✅ Número real encontrado en chats: ${possibleNumber}`);
              return possibleNumber.replace(/\D/g, '');
            }
          }
        }
      } catch (e: any) {
        console.log(`⚠️ Método 2 falló:`, e.message);
      }

      // Método 3: Obtener perfil del contacto
      console.log(`🔍 Método 3: Obteniendo perfil...`);
      try {
        const lidNumber = lidJid.replace('@lid', '');
        const profileResponse = await axios.post(
          `${this.apiUrl}/chat/fetchProfile/${instanceName}`,
          { number: lidNumber },
          { headers: this.getHeaders() }
        );
        
        console.log(`🔍 Perfil:`, JSON.stringify(profileResponse.data).substring(0, 300));
        
        const profile = profileResponse.data;
        const possibleNumber = profile?.number || profile?.wid?.user || profile?.jid?.replace('@s.whatsapp.net', '');
        
        if (possibleNumber && !possibleNumber.includes('lid') && possibleNumber.length >= 10) {
          console.log(`✅ Número real encontrado en perfil: ${possibleNumber}`);
          return possibleNumber.replace(/\D/g, '');
        }
      } catch (e: any) {
        console.log(`⚠️ Método 3 falló:`, e.message);
      }

      console.log(`❌ No se pudo encontrar el número real`);
      return null;
      
    } catch (error: any) {
      console.error('❌ Error buscando número real:', error.message);
      return null;
    }
  }

  // ============================================
  // ENVIAR MENSAJE
  // ============================================
  async sendTextMessage(instanceName: string, to: string, text: string): Promise<{ 
    success: boolean; 
    messageId?: string; 
    error?: string 
  }> {
    console.log(`\n📤 ========== ENVIANDO MENSAJE ==========`);
    console.log(`📤 Destinatario: "${to}"`);
    console.log(`📝 Texto: ${text.substring(0, 80)}...`);
    
    const isLid = to.includes('@lid');
    const isGroup = to.includes('@g.us');
    
    if (isGroup) {
      return { success: false, error: 'Groups not supported' };
    }
    
    let numberToSend: string;
    
    if (isLid) {
      // Intentar obtener número real
      const realNumber = await this.findRealPhoneNumber(instanceName, to);
      
      if (realNumber) {
        numberToSend = realNumber;
        console.log(`📱 Usando número REAL encontrado: ${numberToSend}`);
      } else {
        // Si no encontramos el número real, usar el LID sin el @lid
        numberToSend = to.split('@')[0];
        console.log(`⚠️ No se encontró número real, usando LID: ${numberToSend}`);
      }
    } else if (to.includes('@')) {
      numberToSend = to.split('@')[0].replace(/\D/g, '');
    } else {
      numberToSend = to.replace(/\D/g, '');
    }
    
    console.log(`📤 Número final: "${numberToSend}"`);
    
    // Enviar mensaje
    try {
      const payload = {
        number: numberToSend,
        options: { delay: 1200, presence: "composing" },
        textMessage: { text }
      };
      
      console.log(`🔄 Payload:`, JSON.stringify(payload).substring(0, 300));
      
      const response = await axios.post(
        `${this.apiUrl}/message/sendText/${instanceName}`,
        payload,
        { headers: this.getHeaders() }
      );
      
      console.log('✅ Mensaje enviado:', JSON.stringify(response.data).substring(0, 200));
      
      return {
        success: true,
        messageId: response.data?.key?.id || response.data?.messageId
      };
      
    } catch (error: any) {
      console.error('❌ Error enviando:', error.response?.data || error.message);
      return {
        success: false,
        error: JSON.stringify(error.response?.data || error.message)
      };
    }
  }

  // Configurar webhook
  async setWebhook(instanceName: string, webhookUrl: string): Promise<{ success: boolean; error?: string }> {
    try {
      await axios.post(
        `${this.apiUrl}/webhook/set/${instanceName}`,
        {
          enabled: true,
          url: webhookUrl,
          webhookByEvents: false,
          events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED', 'SEND_MESSAGE']
        },
        { headers: this.getHeaders() }
      );
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.response?.data?.message || error.message };
    }
  }

  // Desconectar
  async disconnectInstance(instanceName: string): Promise<{ success: boolean; error?: string }> {
    try {
      await axios.delete(`${this.apiUrl}/instance/logout/${instanceName}`, { headers: this.getHeaders() });
      
      const user = await prisma.user.findFirst({ where: { evolutionInstanceName: instanceName } });
      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: { whatsappConnected: false, whatsappStatus: 'disconnected', whatsappQrCode: null }
        });
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.response?.data?.message || error.message };
    }
  }

  // Eliminar instancia
  async deleteInstance(instanceName: string): Promise<{ success: boolean; error?: string }> {
    try {
      await axios.delete(`${this.apiUrl}/instance/delete/${instanceName}`, { headers: this.getHeaders() });
      
      const user = await prisma.user.findFirst({ where: { evolutionInstanceName: instanceName } });
      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: { evolutionInstanceName: null, whatsappConnected: false, whatsappStatus: 'disconnected', whatsappQrCode: null, whatsappPhone: null }
        });
      }
      return { success: true };
    } catch (error: any) {
      if (error.response?.status === 404) {
        const user = await prisma.user.findFirst({ where: { evolutionInstanceName: instanceName } });
        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: { evolutionInstanceName: null, whatsappConnected: false, whatsappStatus: 'disconnected', whatsappQrCode: null, whatsappPhone: null }
          });
        }
        return { success: true };
      }
      return { success: false, error: error.response?.data?.message || error.message };
    }
  }
}

export const evolutionService = new EvolutionService();
export default evolutionService;
