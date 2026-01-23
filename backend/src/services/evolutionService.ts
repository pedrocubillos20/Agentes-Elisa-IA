import axios from 'axios';
import prisma from '../lib/prisma';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://31.97.142.127:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || 'ElisaIA_Evolution_Key_2026_SecretKey';

/**
 * ============================================
 * EVOLUTION SERVICE - v1.8.0 COMPATIBLE
 * ============================================
 * 
 * En v1.8.0 el número real viene directamente en:
 * - key.remoteJid: "573001234567@s.whatsapp.net"
 * 
 * NO hay problema de LID en esta versión.
 * ============================================
 */
class EvolutionService {
  private apiUrl: string;
  private apiKey: string;

  constructor() {
    this.apiUrl = EVOLUTION_API_URL;
    this.apiKey = EVOLUTION_API_KEY;
    console.log(`🔧 Evolution Service v1.8.0 inicializado: ${this.apiUrl}`);
  }

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'apikey': this.apiKey
    };
  }

  // ============================================
  // CREAR INSTANCIA - v1.8.0
  // ============================================
  async createInstance(userId: string): Promise<{ 
    success: boolean; 
    instanceName?: string;
    qrcode?: string; 
    error?: string 
  }> {
    try {
      const instanceName = `elisa_${userId.substring(0, 8)}_${Date.now()}`;
      
      console.log(`🔧 [v1.8.0] Creando instancia: ${instanceName}`);
      
      // Evolution API v1.8.0 endpoint
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

      console.log('📋 Respuesta crear instancia:', JSON.stringify(response.data).substring(0, 500));

      // v1.8.0: QR puede venir en diferentes ubicaciones
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
  // VERIFICAR ESTADO DE CONEXIÓN - v1.8.0
  // ============================================
  async checkConnectionStatus(instanceName: string): Promise<{ 
    connected: boolean; 
    state?: string; 
    phone?: string;
    instanceNotFound?: boolean;
    error?: string 
  }> {
    try {
      // v1.8.0: Endpoint de estado de conexión
      const response = await axios.get(
        `${this.apiUrl}/instance/connectionState/${instanceName}`,
        { 
          headers: this.getHeaders(),
          timeout: 10000
        }
      );

      console.log('📋 [v1.8.0] Estado conexión:', JSON.stringify(response.data).substring(0, 300));

      // v1.8.0: Estado viene en instance.state o state
      const state = response.data?.instance?.state || 
                   response.data?.state ||
                   'disconnected';
      
      // v1.8.0: Número viene en instance.owner
      const owner = response.data?.instance?.owner || 
                   response.data?.owner;

      // Extraer número limpio (573001234567@s.whatsapp.net -> 573001234567)
      const phone = owner ? owner.replace('@s.whatsapp.net', '').replace(/\D/g, '') : null;
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
        phone: phone || undefined
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
  // OBTENER QR CODE - v1.8.0
  // ============================================
  async getQRCode(instanceName: string): Promise<{ 
    success: boolean; 
    qrcode?: string; 
    instanceNotFound?: boolean;
    error?: string 
  }> {
    try {
      // v1.8.0: Endpoint para obtener QR
      const response = await axios.get(
        `${this.apiUrl}/instance/connect/${instanceName}`,
        { 
          headers: this.getHeaders(),
          timeout: 15000
        }
      );

      console.log('📋 [v1.8.0] Respuesta QR:', JSON.stringify(response.data).substring(0, 300));

      const qrcode = response.data?.qrcode?.base64 || 
                     response.data?.base64 ||
                     response.data?.qr ||
                     null;

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
        qrcode: qrcode || undefined
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
  // ENVIAR MENSAJE DE TEXTO - v1.8.0
  // ============================================
  async sendTextMessage(instanceName: string, to: string, text: string): Promise<{ 
    success: boolean; 
    messageId?: string; 
    error?: string 
  }> {
    console.log(`\n📤 ========== ENVIANDO MENSAJE (v1.8.0) ==========`);
    console.log(`📤 Instancia: ${instanceName}`);
    console.log(`📤 Destinatario: "${to}"`);
    console.log(`📝 Texto: ${text.substring(0, 100)}...`);
    
    // Ignorar grupos
    if (to.includes('@g.us')) {
      console.log('⚠️ Grupos no soportados');
      return { success: false, error: 'Groups not supported' };
    }
    
    // Limpiar número (remover todo excepto dígitos)
    let cleanNumber = to.replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/\D/g, '');
    
    // Asegurar que no tenga el sufijo
    if (cleanNumber.length < 10) {
      return { success: false, error: 'Invalid phone number' };
    }
    
    console.log(`📱 Número limpio: ${cleanNumber}`);
    
    try {
      // v1.8.0: Payload para enviar mensaje
      const payload = {
        number: cleanNumber,
        options: {
          delay: 1200,
          presence: "composing"
        },
        textMessage: {
          text: text
        }
      };
      
      console.log(`🔄 Enviando a: ${this.apiUrl}/message/sendText/${instanceName}`);
      
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
                       response.data?.id;
      
      return {
        success: true,
        messageId: messageId
      };
      
    } catch (error: any) {
      console.error('❌ Error enviando mensaje:', error.response?.data || error.message);
      return {
        success: false,
        error: JSON.stringify(error.response?.data || error.message)
      };
    }
  }

  // ============================================
  // CONFIGURAR WEBHOOK - v1.8.0
  // ============================================
  async setWebhook(instanceName: string, webhookUrl: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`🔗 [v1.8.0] Configurando webhook: ${webhookUrl}`);
      
      // v1.8.0: Endpoint y estructura de webhook
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
              'QRCODE_UPDATED'
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
  // DESCONECTAR INSTANCIA - v1.8.0
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
  // ELIMINAR INSTANCIA - v1.8.0
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
  // OBTENER INFORMACIÓN DE LA INSTANCIA - v1.8.0
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
