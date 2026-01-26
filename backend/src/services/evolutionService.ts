import axios from 'axios';
import prisma from '../lib/prisma';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://31.97.142.127:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || 'ElisaIA_Evolution_Key_2026_SecretKey';

/**
 * ============================================
 * EVOLUTION SERVICE - v1.8.0 ESTABLE
 * CON SOPORTE PARA LID (Link ID)
 * ============================================
 */

class EvolutionService {
  private apiUrl: string;
  private apiKey: string;

  constructor() {
    this.apiUrl = EVOLUTION_API_URL;
    this.apiKey = EVOLUTION_API_KEY;
    console.log(`🔧 Evolution Service v1.8.0 + LID Support inicializado: ${this.apiUrl}`);
  }

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'apikey': this.apiKey
    };
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

      console.log('📋 [v1.8.0] Estado conexión:', JSON.stringify(response.data).substring(0, 300));

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

      console.log('📋 [v1.8.0] Respuesta QR:', JSON.stringify(response.data).substring(0, 300));

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
   * SEND TEXT MESSAGE - CON SOPORTE LID
   * ============================================
   * 
   * Evolution API v1.8.0 acepta:
   * - Número limpio: "573001234567"
   * - remoteJid completo: "573001234567@s.whatsapp.net"
   * - LID completo: "266575869378587@lid"
   */
  async sendTextMessage(instanceName: string, to: string, text: string): Promise<{ 
    success: boolean; 
    messageId?: string; 
    error?: string 
  }> {
    console.log(`\n📤 ========== ENVIANDO MENSAJE (v1.8.0 + LID) ==========`);
    console.log(`📤 Instancia: ${instanceName}`);
    console.log(`📤 Destinatario original: "${to}"`);
    console.log(`📝 Texto: ${text.substring(0, 100)}...`);
    
    // Ignorar grupos
    if (to.includes('@g.us')) {
      console.log('⚠️ Grupos no soportados');
      return { success: false, error: 'Groups not supported' };
    }
    
    // ============================================
    // 🔧 LÓGICA MEJORADA PARA LID
    // ============================================
    let numberToSend: string;
    const isLid = to.includes('@lid');
    const hasJidSuffix = to.includes('@s.whatsapp.net') || to.includes('@c.us') || to.includes('@lid');
    
    if (isLid) {
      // ⭐ Para LID: usar el remoteJid completo TAL CUAL
      // Evolution API v1.8 acepta "266575869378587@lid" directamente
      numberToSend = to;
      console.log(`📍 Tipo: LID - usando remoteJid completo`);
    } else if (hasJidSuffix) {
      // Para @s.whatsapp.net o @c.us: extraer solo el número
      numberToSend = to
        .replace('@s.whatsapp.net', '')
        .replace('@c.us', '')
        .replace(/\D/g, '');
      console.log(`📍 Tipo: JID normal - extrayendo número`);
    } else {
      // Ya es un número limpio
      numberToSend = to.replace(/\D/g, '');
      console.log(`📍 Tipo: Número limpio`);
    }
    
    // Validación básica (solo si NO es LID)
    if (!isLid && numberToSend.length < 10) {
      console.error('❌ Número inválido: menos de 10 dígitos');
      return { success: false, error: 'Invalid phone number' };
    }
    
    console.log(`📱 Enviando a: ${numberToSend}`);
    
    try {
      const payload = {
        number: numberToSend,
        options: { delay: 1200, presence: "composing" },
        textMessage: { text }
      };
      
      console.log(`📦 Payload:`, JSON.stringify(payload, null, 2));
      
      const response = await axios.post(
        `${this.apiUrl}/message/sendText/${instanceName}`,
        payload,
        { headers: this.getHeaders(), timeout: 30000 }
      );
      
      console.log('✅ Respuesta envío:', JSON.stringify(response.data).substring(0, 300));
      return { success: true, messageId: response.data?.key?.id };
      
    } catch (error: any) {
      const errorData = error.response?.data;
      const errorStatus = error.response?.status;
      
      console.error(`❌ Error enviando mensaje (HTTP ${errorStatus}):`, errorData || error.message);
      
      // Si falla con LID, intentar método alternativo
      if (isLid && errorStatus === 400) {
        console.log('🔄 Reintentando con formato alternativo para LID...');
        return await this.sendTextMessageAlternative(instanceName, to, text);
      }
      
      return { success: false, error: JSON.stringify(errorData || error.message) };
    }
  }

  /**
   * Método alternativo para enviar mensajes a LID
   * Algunos endpoints de Evolution API prefieren el formato sin @lid
   */
  private async sendTextMessageAlternative(instanceName: string, to: string, text: string): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
  }> {
    console.log('📤 Intentando método alternativo para LID...');
    
    try {
      // Método 1: Intentar con el LID pero en campo "remoteJid"
      const payload1 = {
        remoteJid: to, // LID completo como remoteJid
        message: { text },
        options: { delay: 1200 }
      };
      
      console.log('📦 Payload alternativo 1:', JSON.stringify(payload1, null, 2));
      
      const response = await axios.post(
        `${this.apiUrl}/message/sendText/${instanceName}`,
        payload1,
        { headers: this.getHeaders(), timeout: 30000 }
      );
      
      console.log('✅ Método alternativo exitoso:', JSON.stringify(response.data).substring(0, 200));
      return { success: true, messageId: response.data?.key?.id };
      
    } catch (error1: any) {
      console.log('⚠️ Método alternativo 1 falló, intentando método 2...');
      
      try {
        // Método 2: Usar endpoint de sendMessage genérico
        const payload2 = {
          number: to,
          text: text,
          delay: 1200
        };
        
        const response = await axios.post(
          `${this.apiUrl}/message/send/${instanceName}`,
          payload2,
          { headers: this.getHeaders(), timeout: 30000 }
        );
        
        console.log('✅ Método alternativo 2 exitoso:', JSON.stringify(response.data).substring(0, 200));
        return { success: true, messageId: response.data?.key?.id };
        
      } catch (error2: any) {
        console.error('❌ Todos los métodos fallaron');
        return { 
          success: false, 
          error: `LID send failed: ${JSON.stringify(error1.response?.data || error1.message)}` 
        };
      }
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
