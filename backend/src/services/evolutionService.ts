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
  // ENVIAR MENSAJE DE TEXTO
  // Soporta: números normales, JIDs completos, y LIDs
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

    // ESTRATEGIA: Intentar múltiples formatos
    const attemptsToTry: string[] = [];
    
    // Si es un LID completo, usarlo directamente primero
    if (to.includes('@lid')) {
      attemptsToTry.push(to); // JID completo con @lid
    }
    
    // Si es un JID de WhatsApp normal
    if (to.includes('@s.whatsapp.net')) {
      attemptsToTry.push(to); // JID completo
      attemptsToTry.push(to.replace('@s.whatsapp.net', '')); // Solo número
    }
    
    // Si no tiene @, es solo un número
    if (!to.includes('@')) {
      attemptsToTry.push(to);
      attemptsToTry.push(`${to}@s.whatsapp.net`);
    }
    
    // Limpiar número como último recurso
    const cleanNumber = to.replace(/@.*$/, '').replace(/\D/g, '');
    if (cleanNumber && !attemptsToTry.includes(cleanNumber)) {
      attemptsToTry.push(cleanNumber);
    }

    console.log(`📋 Intentos a probar: ${JSON.stringify(attemptsToTry)}`);

    // Intentar cada formato
    for (const numberFormat of attemptsToTry) {
      console.log(`\n🔄 Intentando con: "${numberFormat}"`);
      
      try {
        const payload = {
          number: numberFormat,
          options: {
            delay: 1200,
            presence: "composing",
            linkPreview: false
          },
          textMessage: {
            text: text
          }
        };
        
        const response = await axios.post(
          `${this.apiUrl}/message/sendText/${instanceName}`,
          payload,
          { 
            headers: this.getHeaders(),
            timeout: 30000
          }
        );
        
        console.log('✅ Respuesta exitosa:', JSON.stringify(response.data).substring(0, 300));
        
        const messageId = response.data?.key?.id || 
                         response.data?.messageId ||
                         response.data?.data?.key?.id;
        
        return {
          success: true,
          messageId: messageId
        };
        
      } catch (error: any) {
        const errorData = error.response?.data;
        console.log(`⚠️ Falló con "${numberFormat}":`, JSON.stringify(errorData || error.message).substring(0, 200));
        
        // Si el error NO es "number not exists", detenerse
        const isNotExistsError = errorData?.response?.[0]?.exists === false ||
                                 JSON.stringify(errorData).includes('exists') ||
                                 JSON.stringify(errorData).includes('not registered');
        
        if (!isNotExistsError && error.response?.status !== 400) {
          // Error diferente, reportarlo
          return {
            success: false,
            error: JSON.stringify(errorData || error.message)
          };
        }
        
        // Continuar con el siguiente formato
        continue;
      }
    }
    
    // Todos los intentos fallaron
    console.error('❌ Todos los intentos de envío fallaron');
    return {
      success: false,
      error: 'No se pudo enviar el mensaje. El número puede no estar registrado en WhatsApp.'
    };
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
