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
      console.log(`🔧 Evolution Service v2.3.7 inicializado: ${this.apiUrl}`);
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
  // CREAR INSTANCIA - v2.3.7
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

      console.log('📋 Respuesta crear instancia:', JSON.stringify(response.data).substring(0, 500));

      const qrcode = response.data?.qrcode?.base64 || 
                     response.data?.base64 ||
                     response.data?.data?.qrcode?.base64;

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
        error: error.response?.data?.message || error.message
      };
    }
  }

  // ============================================
  // VERIFICAR ESTADO DE CONEXIÓN - v2.3.7
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
                   response.data?.connectionStatus;
      
      const connected = state === 'open' || state === 'connected';

      if (connected) {
        // Obtener info de la instancia para el número
        try {
          const infoResponse = await axios.get(
            `${this.apiUrl}/instance/fetchInstances`,
            { 
              headers: this.getHeaders(),
              params: { instanceName },
              timeout: 10000
            }
          );
          
          const instances = infoResponse.data || [];
          const instance = instances.find((i: any) => i.name === instanceName);
          const ownerJid = instance?.ownerJid || '';
          const phone = ownerJid.replace('@s.whatsapp.net', '');
          
          if (phone) {
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
          
          return { connected: true, state: 'open', phone };
        } catch (e) {
          return { connected: true, state: 'open' };
        }
      }

      return { connected: false, state: state };
    } catch (error: any) {
      if (error.response?.status === 404) {
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
        error: error.message
      };
    }
  }

  // ============================================
  // OBTENER QR CODE - v2.3.7
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
                     response.data?.code;

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
        error: error.message
      };
    }
  }

  // ============================================
  // ENVIAR MENSAJE DE TEXTO - v2.3.7
  // ============================================
  async sendTextMessage(
    instanceName: string, 
    to: string, 
    text: string
  ): Promise<{ 
    success: boolean; 
    messageId?: string; 
    error?: string 
  }> {
    console.log(`\n📤 ========== ENVIANDO MENSAJE v2.3.7 ==========`);
    console.log(`📤 Instancia: ${instanceName}`);
    console.log(`📤 Destinatario: "${to}"`);
    console.log(`📝 Texto: ${text.substring(0, 100)}...`);
    
    // Ignorar grupos
    if (to.includes('@g.us')) {
      console.log('⚠️ Grupos no soportados');
      return { success: false, error: 'Groups not supported' };
    }

    // Preparar el número - v2.3.7 acepta el remoteJid directamente
    let numberToSend = to;
    
    // Si no tiene @, agregarlo
    if (!to.includes('@')) {
      numberToSend = to.replace(/\D/g, '');
    }

    console.log(`📤 Número a enviar: "${numberToSend}"`);

    try {
      // Endpoint de v2.3.7: POST /message/sendText/{instanceName}
      const payload = {
        number: numberToSend,
        text: text,
        delay: 1200
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
      
      console.log('✅ Respuesta envío:', JSON.stringify(response.data).substring(0, 500));
      
      const messageId = response.data?.key?.id || 
                       response.data?.messageId ||
                       response.data?.id;
      
      return {
        success: true,
        messageId: messageId
      };
      
    } catch (error: any) {
      console.error('❌ Error enviando mensaje:', {
        status: error.response?.status,
        data: JSON.stringify(error.response?.data).substring(0, 500),
        message: error.message
      });
      
      return {
        success: false,
        error: JSON.stringify(error.response?.data || error.message)
      };
    }
  }

  // ============================================
  // CONFIGURAR WEBHOOK - v2.3.7
  // ============================================
  async setWebhook(instanceName: string, webhookUrl: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`🔗 Configurando webhook v2.3.7: ${webhookUrl}`);
      
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
        error: error.message 
      };
    }
  }

  // ============================================
  // DESCONECTAR INSTANCIA - v2.3.7
  // ============================================
  async disconnectInstance(instanceName: string): Promise<{ success: boolean; error?: string }> {
    try {
      await axios.delete(
        `${this.apiUrl}/instance/logout/${instanceName}`, 
        { headers: this.getHeaders(), timeout: 10000 }
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
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // ELIMINAR INSTANCIA - v2.3.7
  // ============================================
  async deleteInstance(instanceName: string): Promise<{ success: boolean; error?: string }> {
    try {
      await axios.delete(
        `${this.apiUrl}/instance/delete/${instanceName}`, 
        { headers: this.getHeaders(), timeout: 10000 }
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
        return { success: true };
      }
      console.error('❌ Error eliminando instancia:', error.message);
      return { success: false, error: error.message };
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
