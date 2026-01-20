import axios from 'axios';
import prisma from '../lib/prisma';
import { v4 as uuidv4 } from 'uuid';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';

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
  }

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'apikey': this.apiKey
    };
  }

  // Crear instancia de WhatsApp para un usuario
  async createInstance(userId: string): Promise<{ success: boolean; instanceName?: string; qrcode?: string; error?: string }> {
    try {
      const instanceName = `elisa_${userId.substring(0, 8)}_${Date.now()}`;
      
      console.log(`📱 Creando instancia Evolution: ${instanceName}`);
      
      const response = await axios.post(
        `${this.apiUrl}/instance/create`,
        {
          instanceName,
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS'
        },
        { headers: this.getHeaders() }
      );

      console.log('✅ Instancia creada:', response.data);

      // Guardar en base de datos
      await prisma.user.update({
        where: { id: userId },
        data: {
          evolutionInstanceName: instanceName,
          evolutionInstanceKey: response.data?.hash || response.data?.instance?.instanceId || instanceName,
          whatsappStatus: 'connecting'
        }
      });

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

  // Obtener QR Code
  async getQRCode(instanceName: string): Promise<{ success: boolean; qrcode?: string; error?: string }> {
    try {
      console.log(`📷 Obteniendo QR para: ${instanceName}`);
      
      const response = await axios.get(
        `${this.apiUrl}/instance/connect/${instanceName}`,
        { headers: this.getHeaders() }
      );

      const qrcode = response.data?.base64 || response.data?.qrcode?.base64 || response.data?.code;
      
      if (qrcode) {
        // Actualizar en DB
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
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  // Verificar estado de conexión
  async checkConnectionStatus(instanceName: string): Promise<{ connected: boolean; status: string; phone?: string }> {
    try {
      const response = await axios.get(
        `${this.apiUrl}/instance/connectionState/${instanceName}`,
        { headers: this.getHeaders() }
      );

      const state = response.data?.instance?.state || response.data?.state || 'close';
      const connected = state === 'open';
      
      // Obtener número si está conectado
      let phone = null;
      if (connected) {
        try {
          const infoResponse = await axios.get(
            `${this.apiUrl}/instance/fetchInstances`,
            { headers: this.getHeaders() }
          );
          
          const instance = infoResponse.data?.find((i: any) => i.name === instanceName || i.instanceName === instanceName);
          phone = instance?.owner || instance?.profilePictureUrl?.split('@')[0];
        } catch (e) {
          // Ignorar error
        }
      }

      // Actualizar en DB
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
            whatsappQrCode: connected ? null : user.whatsappQrCode // Limpiar QR si está conectado
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
      return {
        connected: false,
        status: 'error'
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

      // Actualizar en DB
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

      // Actualizar en DB
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

  // Enviar mensaje de texto
  async sendTextMessage(instanceName: string, to: string, text: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      // Formatear número (asegurar que tenga formato correcto)
      const formattedNumber = to.replace(/\D/g, '');
      
      console.log(`📤 Enviando mensaje a ${formattedNumber} desde ${instanceName}`);
      
      const response = await axios.post(
        `${this.apiUrl}/message/sendText/${instanceName}`,
        {
          number: formattedNumber,
          text: text
        },
        { headers: this.getHeaders() }
      );

      console.log('✅ Mensaje enviado:', response.data);

      return {
        success: true,
        messageId: response.data?.key?.id || response.data?.messageId
      };
    } catch (error: any) {
      console.error('❌ Error enviando mensaje:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  // Configurar webhook para recibir mensajes
  async setWebhook(instanceName: string, webhookUrl: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`🔗 Configurando webhook para ${instanceName}: ${webhookUrl}`);
      
      const response = await axios.post(
        `${this.apiUrl}/webhook/set/${instanceName}`,
        {
          webhook: {
            enabled: true,
            url: webhookUrl,
            webhookByEvents: false,
            events: [
              'MESSAGES_UPSERT',
              'MESSAGES_UPDATE',
              'CONNECTION_UPDATE',
              'QRCODE_UPDATED'
            ]
          }
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
