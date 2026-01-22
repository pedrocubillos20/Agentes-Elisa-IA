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
      // Generar nombre único para la instancia
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

      console.log('✅ Instancia creada:', JSON.stringify(response.data).substring(0, 300));

      const qrcode = response.data?.qrcode?.base64 || response.data?.base64;

      // Actualizar usuario con el nombre de instancia
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
      
      console.log(`📊 Estado de ${instanceName}: ${state}`);

      return {
        connected: state === 'open',
        state: state,
        phone: phone?.replace('@s.whatsapp.net', '').replace(/\D/g, '')
      };
    } catch (error: any) {
      // Si es 404, la instancia no existe
      if (error.response?.status === 404) {
        console.log(`⚠️ Instancia ${instanceName} no existe en Evolution API`);
        
        // Limpiar datos del usuario
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
      
      console.error('❌ Error verificando estado:', error.response?.data || error.message);
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
        console.log(`⚠️ Instancia no encontrada (404): ${instanceName}`);
        return {
          success: false,
          instanceNotFound: true,
          error: 'Instance not found'
        };
      }
      console.error('❌ Error obteniendo QR:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  // Obtener número real de un LID
  async getRealPhoneNumber(instanceName: string, lidJid: string): Promise<string | null> {
    try {
      console.log(`🔍 Buscando número real para LID: ${lidJid}`);
      
      const response = await axios.get(
        `${this.apiUrl}/chat/findContacts/${instanceName}`,
        { 
          headers: this.getHeaders(),
          params: { where: { id: lidJid } }
        }
      );
      
      const contact = response.data?.[0];
      const realNumber = contact?.id?.replace('@s.whatsapp.net', '').replace(/@.*$/, '') ||
                        contact?.number;
      
      if (realNumber && !realNumber.includes('@lid')) {
        console.log(`✅ Número real encontrado: ${realNumber}`);
        return realNumber;
      }
      
      return null;
    } catch (error: any) {
      console.log('⚠️ No se pudo obtener número real:', error.response?.status, error.message);
      return null;
    }
  }

  // Enviar mensaje de texto - Evolution API v1.8.2
  async sendTextMessage(instanceName: string, to: string, text: string): Promise<{ 
    success: boolean; 
    messageId?: string; 
    error?: string 
  }> {
    try {
      // ============================================
      // PARSEO DEL NÚMERO DESTINATARIO
      // ============================================
      const isLidJid = to.includes('@lid');
      const isWhatsAppJid = to.includes('@s.whatsapp.net');
      const isGroupJid = to.includes('@g.us');
      
      console.log(`📤 Enviando mensaje desde ${instanceName}`);
      console.log(`📤 Destinatario original: "${to}"`);
      console.log(`📝 Texto: ${text.substring(0, 100)}...`);
      
      let numberToUse: string;
      
      if (isLidJid) {
        // Para LID, intentar obtener número real
        const realNumber = await this.getRealPhoneNumber(instanceName, to);
        
        if (realNumber) {
          numberToUse = realNumber.replace(/\D/g, '');
          console.log(`📱 Usando número real obtenido: ${numberToUse}`);
        } else {
          // Extraer número del LID usando split
          const parts = to.split('@');
          numberToUse = parts[0].replace(/\D/g, '');
          console.log(`📱 LID: "${to}" -> partes: ${JSON.stringify(parts)} -> número: "${numberToUse}"`);
        }
      } else if (isWhatsAppJid) {
        // Formato normal @s.whatsapp.net
        const parts = to.split('@');
        numberToUse = parts[0].replace(/\D/g, '');
        console.log(`📱 WhatsApp JID: "${to}" -> número: "${numberToUse}"`);
      } else if (isGroupJid) {
        console.log('⚠️ Destino es un grupo, no soportado');
        return { success: false, error: 'Group messages not supported' };
      } else if (to.includes('@')) {
        // Otro formato con @
        const parts = to.split('@');
        numberToUse = parts[0].replace(/\D/g, '');
        console.log(`📱 Otro formato: "${to}" -> número: "${numberToUse}"`);
      } else {
        // Ya es un número limpio
        numberToUse = to.replace(/\D/g, '');
        console.log(`📱 Número limpio: "${numberToUse}"`);
      }
      
      console.log(`📤 Número final a enviar: "${numberToUse}"`);
      
      // Preparar payload para Evolution API v1.8.2
      const payload = {
        number: numberToUse,
        options: { 
          delay: 1200, 
          presence: "composing" 
        },
        textMessage: { 
          text: text 
        }
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
      const errorData = error.response?.data;
      console.error('❌ Error enviando mensaje:', JSON.stringify(errorData || error.message));
      console.error('❌ Status:', error.response?.status);
      
      return {
        success: false,
        error: JSON.stringify(errorData?.message || errorData || error.message)
      };
    }
  }

  // Configurar webhook para recibir mensajes
  async setWebhook(instanceName: string, webhookUrl: string): Promise<{ 
    success: boolean; 
    error?: string 
  }> {
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
            'QRCODE_UPDATED',
            'SEND_MESSAGE'
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

  // Desconectar instancia (logout)
  async disconnectInstance(instanceName: string): Promise<{ 
    success: boolean; 
    error?: string 
  }> {
    try {
      console.log(`🔌 Desconectando instancia: ${instanceName}`);
      
      await axios.delete(
        `${this.apiUrl}/instance/logout/${instanceName}`,
        { headers: this.getHeaders() }
      );

      // Actualizar estado del usuario
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

  // Eliminar instancia completamente
  async deleteInstance(instanceName: string): Promise<{ 
    success: boolean; 
    error?: string 
  }> {
    try {
      console.log(`🗑️ Eliminando instancia: ${instanceName}`);
      
      await axios.delete(
        `${this.apiUrl}/instance/delete/${instanceName}`,
        { headers: this.getHeaders() }
      );

      // Limpiar datos del usuario
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
    } catch (error: any) {
      // Si ya no existe, considerarlo exitoso
      if (error.response?.status === 404) {
        console.log(`⚠️ Instancia ${instanceName} ya no existe`);
        
        // Limpiar datos del usuario de todos modos
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
      
      console.error('❌ Error eliminando instancia:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }
}

export const evolutionService = new EvolutionService();
export default evolutionService;
