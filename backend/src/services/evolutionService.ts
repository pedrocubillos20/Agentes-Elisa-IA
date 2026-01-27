import axios from 'axios';
import prisma from '../lib/prisma';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://31.97.142.127:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || 'ElisaIA_Evolution_Key_2026_SecretKey';

/**
 * ============================================
 * EVOLUTION SERVICE - v1.8.0
 * FIX LID: Convertir @lid → @s.whatsapp.net
 * ============================================
 */

class EvolutionService {
  private apiUrl: string;
  private apiKey: string;

  constructor() {
    this.apiUrl = EVOLUTION_API_URL;
    this.apiKey = EVOLUTION_API_KEY;
    console.log(`🔧 Evolution Service v1.8.0 (LID→WhatsApp) inicializado: ${this.apiUrl}`);
  }

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'apikey': this.apiKey
    };
  }

  /**
   * ✅ CONVERTIR JID PARA ENVÍO
   * @lid → @s.whatsapp.net
   */
  private convertJidForSending(jid: string): string {
    // Extraer solo los dígitos
    const number = jid
      .replace('@lid', '')
      .replace('@s.whatsapp.net', '')
      .replace('@c.us', '')
      .replace(/\D/g, '');
    
    // Siempre enviar con @s.whatsapp.net
    return `${number}@s.whatsapp.net`;
  }

  async createInstance(userId: string): Promise<{ 
    success: boolean; 
    instanceName?: string;
    qrcode?: string; 
    error?: string 
  }> {
    try {
      const instanceName = `elisa_${userId.substring(0, 8)}_${Date.now()}`;
      
      console.log(`🔧 [v1.8.0] Creando instancia: ${instanceName}`);
      
      const response = await axios.post(
        `${this.apiUrl}/instance/create`,
        {
          instanceName: instanceName,
          qrcode: true,
          integration: "WHATSAPP-BAILEYS"
        },
        { headers: this.getHeaders(), timeout: 30000 }
      );

      console.log('📋 Respuesta crear instancia:', JSON.stringify(response.data).substring(0, 500));

      const qrcode = response.data?.qrcode?.base64 || 
                     response.data?.base64 ||
                     response.data?.qr || null;

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

  async checkConnectionStatus(instanceName: string): Promise<{ 
    connected: boolean; 
    state?: string; 
    phone?: string;
    instanceNotFound?: boolean;
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
        return { connected: false, state: 'not_found', instanceNotFound: true };
      }
      return { connected: false };
    }
  }

  async getQRCode(instanceName: string): Promise<{ 
    success: boolean; 
    qrcode?: string; 
    instanceNotFound?: boolean;
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
      return { success: false };
    }
  }

  /**
   * ============================================
   * SEND TEXT MESSAGE - v1.8.0
   * ============================================
   * 
   * ✅ Convierte @lid → @s.whatsapp.net
   * ✅ Envía con sendText normal
   */
  async sendTextMessage(
    instanceName: string, 
    remoteJid: string, 
    text: string
  ): Promise<{ 
    success: boolean; 
    messageId?: string; 
    error?: string 
  }> {
    console.log(`\n📤 ========== ENVIANDO MENSAJE (v1.8.0) ==========`);
    console.log(`📤 Instancia: ${instanceName}`);
    console.log(`📤 JID Original: "${remoteJid}"`);
    
    // Ignorar grupos
    if (remoteJid.includes('@g.us')) {
      console.log('⚠️ Grupos no soportados');
      return { success: false, error: 'Groups not supported' };
    }
    
    // ✅ CONVERTIR @lid → @s.whatsapp.net
    const numberToSend = this.convertJidForSending(remoteJid);
    
    console.log(`📤 JID Convertido: "${numberToSend}"`);
    console.log(`📝 Texto: ${text.substring(0, 100)}...`);
    
    try {
      const payload = {
        number: numberToSend,
        textMessage: { text }
      };
      
      const url = `${this.apiUrl}/message/sendText/${instanceName}`;
      
      console.log(`📦 Payload:`, JSON.stringify(payload, null, 2));
      console.log(`🔗 URL: ${url}`);
      
      const response = await axios.post(url, payload, { 
        headers: this.getHeaders(), 
        timeout: 30000 
      });
      
      console.log('✅ Respuesta envío:', JSON.stringify(response.data).substring(0, 300));
      return { success: true, messageId: response.data?.key?.id };
      
    } catch (error: any) {
      const errorData = error.response?.data;
      const errorStatus = error.response?.status;
      
      console.error(`❌ Error enviando mensaje (HTTP ${errorStatus}):`, JSON.stringify(errorData, null, 2));
      
      return { success: false, error: JSON.stringify(errorData || error.message) };
    }
  }

  async setWebhook(instanceName: string, webhookUrl: string): Promise<{ success: boolean }> {
    try {
      console.log(`🔗 [v1.8.0] Configurando webhook: ${webhookUrl}`);
      
      await axios.post(
        `${this.apiUrl}/webhook/set/${instanceName}`,
        {
          url: webhookUrl,
          enabled: true,
          events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED']
        },
        { headers: this.getHeaders(), timeout: 10000 }
      );
      
      console.log('✅ Webhook configurado');
      return { success: true };
    } catch (error: any) {
      console.error('❌ Error webhook:', error.message);
      return { success: false };
    }
  }

  async disconnectInstance(instanceName: string): Promise<{ success: boolean }> {
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
    } catch (error) {
      return { success: false };
    }
  }

  async deleteInstance(instanceName: string): Promise<{ success: boolean }> {
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
    } catch (error) {
      return { success: true };
    }
  }
}

export const evolutionService = new EvolutionService();
export default evolutionService;
