import axios from 'axios';
import prisma from '../lib/prisma';

// Configuración para Evolution API v1.8.2 en VPS Hostinger
const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://31.97.142.127:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || 'ElisaIA2026SecureKey';

interface EvolutionInstance {
  instanceName: string;
  instanceId?: string;
  status?: string;
  qrcode?: string;
}

class EvolutionService {
  private apiUrl: string;
  private apiKey: string;

  constructor() {
    this.apiUrl = EVOLUTION_API_URL;
    this.apiKey = EVOLUTION_API_KEY;
    console.log(`🔧 Evolution API v1.8.2 configurada: ${this.apiUrl}`);
  }

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'apikey': this.apiKey
    };
  }

  // Crear instancia de WhatsApp para un usuario - Evolution API v1.8.2
  async createInstance(userId: string): Promise<{ success: boolean; instanceName?: string; qrcode?: string; error?: string }> {
    try {
      const instanceName = `elisa_${userId.substring(0, 8)}_${Date.now()}`;
      
      console.log(`📱 Creando instancia Evolution v1.8.2: ${instanceName}`);
      console.log(`📡 URL: ${this.apiUrl}/instance/create`);
      
      // Evolution API v1.8.2 - payload simple
      const response = await axios.post(
        `${this.apiUrl}/instance/create`,
        {
          instanceName,
          qrcode: true
        },
        { headers: this.getHeaders() }
      );

      console.log('✅ Instancia creada:', JSON.stringify(response.data).substring(0, 500));

      // Evolution API v1.8.2 devuelve { instance: { instanceName, status }, hash }
      const instanceKey = typeof response.data?.hash === 'string' 
        ? response.data.hash 
        : instanceName;

      // Guardar en base de datos
      await prisma.user.update({
        where: { id: userId },
        data: {
          evolutionInstanceName: instanceName,
          evolutionInstanceKey: instanceKey,
          whatsappStatus: 'connecting'
        }
      });

      // Esperar para que la instancia se inicialice
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Obtener QR Code
      const qrResponse = await this.getQRCode(instanceName);
      
      return {
        success: true,
        instanceName,
        qrcode: qrResponse.qrcode
      };
    } catch (error: any) {
      console.error('❌ Error creando instancia:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  // Obtener QR Code - Evolution API v1.8.2
  async getQRCode(instanceName: string): Promise<{ success: boolean; qrcode?: string; error?: string; instanceNotFound?: boolean }> {
    try {
      console.log(`📷 Obteniendo QR para: ${instanceName}`);
      
      const response = await axios.get(
        `${this.apiUrl}/instance/connect/${instanceName}`,
        { headers: this.getHeaders() }
      );

      console.log('📷 Respuesta QR:', JSON.stringify(response.data).substring(0, 300));

      // Evolution API v1.8.2 - el QR viene en base64
      const qrcode = response.data?.base64 || 
                     response.data?.qrcode?.base64 || 
                     response.data?.qrcode ||
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
        success: true,
        qrcode
      };
    } catch (error: any) {
      console.error('❌ Error obteniendo QR:', error.response?.data || error.message);
      
      // Detectar si la instancia no existe (404)
      const statusCode = error.response?.status;
      const errorMessage = JSON.stringify(error.response?.data || error.message);
      const instanceNotFound = statusCode === 404 || errorMessage.includes('does not exist') || errorMessage.includes('not found');
      
      if (instanceNotFound) {
        console.log(`⚠️ Instancia ${instanceName} no existe en Evolution API - limpiando datos obsoletos`);
        // Limpiar la instancia de la base de datos
        const user = await prisma.user.findFirst({
          where: { evolutionInstanceName: instanceName }
        });
        
        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              evolutionInstanceName: null,
              evolutionInstanceKey: null,
              whatsappConnected: false,
              whatsappStatus: 'disconnected',
              whatsappPhone: null,
              whatsappQrCode: null
            }
          });
          console.log(`🗑️ Datos de instancia obsoleta limpiados para usuario ${user.email}`);
        }
      }
      
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        instanceNotFound
      };
    }
  }

  // Verificar estado de conexión - Evolution API v1.8.2
  async checkConnectionStatus(instanceName: string): Promise<{ connected: boolean; status: string; phone?: string; instanceNotFound?: boolean }> {
    try {
      const response = await axios.get(
        `${this.apiUrl}/instance/connectionState/${instanceName}`,
        { headers: this.getHeaders() }
      );

      console.log('📊 Estado conexión:', JSON.stringify(response.data));

      const state = response.data?.instance?.state || response.data?.state || 'close';
      const connected = state === 'open';
      
      let phone = null;
      if (connected) {
        try {
          const infoResponse = await axios.get(
            `${this.apiUrl}/instance/fetchInstances`,
            { headers: this.getHeaders() }
          );
          
          const instances = infoResponse.data || [];
          const instance = instances.find((i: any) => 
            i.instance?.instanceName === instanceName || 
            i.name === instanceName || 
            i.instanceName === instanceName
          );
          phone = instance?.instance?.owner?.split('@')[0] || instance?.owner?.split('@')[0];
        } catch (e) {
          console.log('No se pudo obtener el número de teléfono');
        }
      }

      const user = await prisma.user.findFirst({
        where: { evolutionInstanceName: instanceName }
      });
      
      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            whatsappConnected: connected,
            whatsappStatus: connected ? 'connected' : state,
            whatsappPhone: phone || user.whatsappPhone,
            whatsappQrCode: connected ? null : user.whatsappQrCode
          }
        });
      }

      return {
        connected,
        status: state,
        phone: phone || undefined
      };
    } catch (error: any) {
      console.error('❌ Error verificando estado:', error.response?.data || error.message);
      
      // Detectar si la instancia no existe (404)
      const statusCode = error.response?.status;
      const errorMessage = JSON.stringify(error.response?.data || error.message);
      const instanceNotFound = statusCode === 404 || errorMessage.includes('does not exist') || errorMessage.includes('not found');
      
      if (instanceNotFound) {
        console.log(`⚠️ Instancia ${instanceName} no existe - limpiando datos`);
        const user = await prisma.user.findFirst({
          where: { evolutionInstanceName: instanceName }
        });
        
        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              evolutionInstanceName: null,
              evolutionInstanceKey: null,
              whatsappConnected: false,
              whatsappStatus: 'disconnected',
              whatsappPhone: null,
              whatsappQrCode: null
            }
          });
        }
      }
      
      return {
        connected: false,
        status: 'error',
        instanceNotFound
      };
    }
  }

  // Desconectar instancia
  async disconnectInstance(instanceName: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`🔌 Desconectando instancia: ${instanceName}`);
      
      await axios.delete(
        `${this.apiUrl}/instance/logout/${instanceName}`,
        { headers: this.getHeaders() }
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

      return { success: true };
    } catch (error: any) {
      console.error('❌ Error desconectando:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  // Eliminar instancia
  async deleteInstance(instanceName: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`🗑️ Eliminando instancia: ${instanceName}`);
      
      await axios.delete(
        `${this.apiUrl}/instance/delete/${instanceName}`,
        { headers: this.getHeaders() }
      );

      const user = await prisma.user.findFirst({
        where: { evolutionInstanceName: instanceName }
      });
      
      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            evolutionInstanceName: null,
            evolutionInstanceKey: null,
            whatsappConnected: false,
            whatsappStatus: 'disconnected',
            whatsappPhone: null,
            whatsappQrCode: null
          }
        });
      }

      return { success: true };
    } catch (error: any) {
      console.error('❌ Error eliminando:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  // Obtener número real de un contacto LID
  async getRealPhoneNumber(instanceName: string, lidJid: string): Promise<string | null> {
    try {
      console.log(`🔍 Buscando número real para LID: ${lidJid}`);
      
      // Intentar obtener info del contacto
      const response = await axios.post(
        `${this.apiUrl}/chat/fetchProfile/${instanceName}`,
        { number: lidJid },
        { headers: this.getHeaders() }
      );
      
      console.log('📋 Perfil del contacto:', JSON.stringify(response.data).substring(0, 300));
      
      // El número real puede estar en diferentes campos
      const realNumber = response.data?.wid?.user || 
                        response.data?.id?.user ||
                        response.data?.jid?.replace(/@.*/, '') ||
                        response.data?.number;
      
      if (realNumber && !realNumber.includes('@lid')) {
        console.log(`✅ Número real encontrado: ${realNumber}`);
        return realNumber;
      }
      
      return null;
    } catch (error: any) {
      console.log('⚠️ No se pudo obtener número real:', error.message);
      return null;
    }
  }

  // Enviar mensaje de texto - Evolution API v1.8.2
  async sendTextMessage(instanceName: string, to: string, text: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const isLidJid = to.includes('@lid');
      const isWhatsAppJid = to.includes('@s.whatsapp.net');
      
      console.log(`📤 Enviando mensaje desde ${instanceName}`);
      console.log(`📤 Destinatario original: ${to}`);
      console.log(`📝 Texto: ${text.substring(0, 100)}...`);
      
      let numberToUse: string;
      
      if (isLidJid) {
        // Primero intentar obtener el número real del LID
        const realNumber = await this.getRealPhoneNumber(instanceName, to);
        
        if (realNumber) {
          numberToUse = realNumber;
          console.log(`📱 Usando número real obtenido: ${numberToUse}`);
        } else {
          // Si no se puede obtener, usar el LID directamente
          numberToUse = to;
          console.log(`📱 Usando LID directamente: ${numberToUse}`);
        }
      } else if (isWhatsAppJid) {
        numberToUse = to.replace('@s.whatsapp.net', '').replace(/\D/g, '');
      } else if (to.includes('@')) {
        numberToUse = to.split('@')[0].replace(/\D/g, '');
      } else {
        numberToUse = to.replace(/\D/g, '');
      }
      
      console.log(`📤 Número final a usar: ${numberToUse}`);
      
      // Preparar payload
      const payload = {
        number: numberToUse,
        options: { delay: 1200, presence: "composing" },
        textMessage: { text: text }
      };
      
      console.log(`🔄 Payload:`, JSON.stringify(payload).substring(0, 200));
      
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
      const errorData = error.response?.data;
      console.error('❌ Error enviando mensaje:', JSON.stringify(errorData || error.message));
      
      return {
        success: false,
        error: JSON.stringify(errorData?.message || errorData || error.message)
      };
    }
  }

  // Configurar webhook - Evolution API v1.8.2
  async setWebhook(instanceName: string, webhookUrl: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`🔗 Configurando webhook para ${instanceName}: ${webhookUrl}`);
      
      const response = await axios.post(
        `${this.apiUrl}/webhook/set/${instanceName}`,
        {
          enabled: true,
          url: webhookUrl,
          webhookByEvents: false,
          events: [
            'MESSAGES_UPSERT',
            'MESSAGES_UPDATE',
            'CONNECTION_UPDATE',
            'QRCODE_UPDATED'
          ]
        },
        { headers: this.getHeaders() }
      );

      console.log('✅ Webhook configurado:', response.data);

      return { success: true };
    } catch (error: any) {
      console.error('❌ Error configurando webhook:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }
}

export const evolutionService = new EvolutionService();
export default evolutionService;
