import axios from 'axios';
import prisma from '../lib/prisma';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://31.97.142.127:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || 'ElisaIA_Evolution_Key_2026_SecretKey';

/**
 * ============================================
 * EVOLUTION SERVICE - ARQUITECTURA TYPEBOT
 * ============================================
 * 
 * CONCEPTO CLAVE:
 * - NO intentamos convertir LID a número
 * - Usamos chatId como identificador único
 * - WhatsApp PERMITE responder a LID
 * - Solo NO permite INICIAR conversación con LID
 * 
 * ============================================
 */

class EvolutionService {
  private apiUrl: string;
  private apiKey: string;

  constructor() {
    this.apiUrl = EVOLUTION_API_URL;
    this.apiKey = EVOLUTION_API_KEY;
    console.log(`🔧 Evolution Service (Typebot Style) inicializado: ${this.apiUrl}`);
  }

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'apikey': this.apiKey
    };
  }

  // ============================================
  // CREAR INSTANCIA
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
          integration: "WHATSAPP-BAILEYS"
        },
        { 
          headers: this.getHeaders(),
          timeout: 30000
        }
      );

      const qrcode = response.data?.qrcode?.base64 || 
                     response.data?.base64 ||
                     response.data?.qr ||
                     null;

      await prisma.user.update({
        where: { id: userId },
        data: {
          evolutionInstanceName: instanceName,
          whatsappStatus: 'waiting_qr',
          whatsappQrCode: qrcode,
          whatsappConnected: false
        }
      });

      return { success: true, instanceName, qrcode };
    } catch (error: any) {
      console.error('❌ Error creando instancia:', error.response?.data || error.message);
      return { success: false, error: error.response?.data?.message || error.message };
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
        { headers: this.getHeaders(), timeout: 10000 }
      );

      const state = response.data?.instance?.state || response.data?.state || 'disconnected';
      const owner = response.data?.instance?.owner || response.data?.owner;
      const phone = owner ? owner.replace('@s.whatsapp.net', '').replace(/\D/g, '') : null;
      const connected = state === 'open' || state === 'connected';

      if (connected && phone) {
        const user = await prisma.user.findFirst({ where: { evolutionInstanceName: instanceName } });
        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: { whatsappConnected: true, whatsappStatus: 'connected', whatsappPhone: phone, whatsappQrCode: null }
          });
        }
      }

      return { connected, state, phone: phone || undefined };
    } catch (error: any) {
      if (error.response?.status === 404) {
        const user = await prisma.user.findFirst({ where: { evolutionInstanceName: instanceName } });
        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: { evolutionInstanceName: null, whatsappConnected: false, whatsappStatus: 'disconnected', whatsappQrCode: null, whatsappPhone: null }
          });
        }
        return { connected: false, state: 'not_found', instanceNotFound: true };
      }
      return { connected: false, error: error.message };
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
        { headers: this.getHeaders(), timeout: 15000 }
      );

      const qrcode = response.data?.qrcode?.base64 || response.data?.base64 || response.data?.qr || null;

      if (qrcode) {
        const user = await prisma.user.findFirst({ where: { evolutionInstanceName: instanceName } });
        if (user) {
          await prisma.user.update({ where: { id: user.id }, data: { whatsappQrCode: qrcode } });
        }
      }

      return { success: !!qrcode, qrcode: qrcode || undefined };
    } catch (error: any) {
      if (error.response?.status === 404) {
        return { success: false, instanceNotFound: true };
      }
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // ENVIAR MENSAJE - ESTILO TYPEBOT
  // ============================================
  /**
   * CLAVE: Enviamos al chatId EXACTO que recibimos
   * - Si es @lid → enviamos a @lid
   * - Si es @c.us → enviamos a @c.us
   * - Si es @s.whatsapp.net → enviamos a ese
   * 
   * WhatsApp PERMITE responder a LID
   */
  async sendTextMessage(instanceName: string, chatId: string, text: string): Promise<{ 
    success: boolean; 
    messageId?: string; 
    error?: string 
  }> {
    console.log(`\n📤 ========== ENVIANDO MENSAJE (Typebot Style) ==========`);
    console.log(`📤 Instancia: ${instanceName}`);
    console.log(`📤 ChatId: "${chatId}"`);
    console.log(`📝 Texto: ${text.substring(0, 100)}...`);
    
    // Ignorar grupos
    if (chatId.includes('@g.us')) {
      console.log('⚠️ Grupos no soportados');
      return { success: false, error: 'Groups not supported' };
    }
    
    // Extraer número/id limpio (sin el sufijo)
    const cleanId = chatId
      .replace('@s.whatsapp.net', '')
      .replace('@c.us', '')
      .replace('@lid', '');
    
    console.log(`📱 ID limpio: ${cleanId}`);
    
    try {
      // Intentar enviar con el número limpio
      const payload = {
        number: cleanId,
        options: {
          delay: 1200,
          presence: "composing"
        },
        textMessage: {
          text: text
        }
      };
      
      const response = await axios.post(
        `${this.apiUrl}/message/sendText/${instanceName}`,
        payload,
        { headers: this.getHeaders(), timeout: 30000 }
      );
      
      console.log('✅ Mensaje enviado:', JSON.stringify(response.data).substring(0, 200));
      
      return {
        success: true,
        messageId: response.data?.key?.id || response.data?.messageId
      };
      
    } catch (error: any) {
      console.error('❌ Error primer intento:', error.response?.data?.message || error.message);
      
      // Si falla, intentar con formato completo @s.whatsapp.net
      try {
        console.log('🔄 Reintentando con @s.whatsapp.net...');
        
        const retryPayload = {
          number: `${cleanId}@s.whatsapp.net`,
          options: { delay: 1200, presence: "composing" },
          textMessage: { text }
        };
        
        const retryResponse = await axios.post(
          `${this.apiUrl}/message/sendText/${instanceName}`,
          retryPayload,
          { headers: this.getHeaders(), timeout: 30000 }
        );
        
        console.log('✅ Reintento exitoso');
        return { success: true, messageId: retryResponse.data?.key?.id };
        
      } catch (retryError: any) {
        console.error('❌ Reintento fallido:', retryError.response?.data?.message || retryError.message);
        return { success: false, error: retryError.response?.data?.message || retryError.message };
      }
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
          url: webhookUrl,
          enabled: true,
          events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED']
        },
        { headers: this.getHeaders(), timeout: 10000 }
      );
      
      console.log('✅ Webhook configurado');
      return { success: true };
    } catch (error: any) {
      console.error('❌ Error configurando webhook:', error.response?.data || error.message);
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // DESCONECTAR INSTANCIA
  // ============================================
  async disconnectInstance(instanceName: string): Promise<{ success: boolean; error?: string }> {
    try {
      await axios.delete(
        `${this.apiUrl}/instance/logout/${instanceName}`,
        { headers: this.getHeaders(), timeout: 10000 }
      );
      
      const user = await prisma.user.findFirst({ where: { evolutionInstanceName: instanceName } });
      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: { whatsappConnected: false, whatsappStatus: 'disconnected', whatsappQrCode: null }
        });
      }
      
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // ELIMINAR INSTANCIA
  // ============================================
  async deleteInstance(instanceName: string): Promise<{ success: boolean; error?: string }> {
    try {
      await axios.delete(
        `${this.apiUrl}/instance/delete/${instanceName}`,
        { headers: this.getHeaders(), timeout: 10000 }
      );
      
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
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // OBTENER INFO DE INSTANCIA
  // ============================================
  async getInstanceInfo(instanceName: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.apiUrl}/instance/fetchInstances`,
        { headers: this.getHeaders(), params: { instanceName }, timeout: 10000 }
      );
      return response.data;
    } catch (error: any) {
      return null;
    }
  }
}

export const evolutionService = new EvolutionService();
export default evolutionService;
