import axios from 'axios';

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
  async createInstance(instanceName: string): Promise<{ success: boolean; qrcode?: string; error?: string }> {
    try {
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

      console.log('✅ Instancia creada:', response.data);

      return {
        success: true,
        qrcode: response.data?.qrcode?.base64 || response.data?.base64
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
  async checkConnectionStatus(instanceName: string): Promise<{ connected: boolean; state?: string; error?: string }> {
    try {
      const response = await axios.get(
        `${this.apiUrl}/instance/connectionState/${instanceName}`,
        { headers: this.getHeaders() }
      );

      const state = response.data?.instance?.state || response.data?.state;
      console.log(`📊 Estado de ${instanceName}:`, state);

      return {
        connected: state === 'open',
        state: state
      };
    } catch (error: any) {
      // Si es 404, la instancia no existe
      if (error.response?.status === 404) {
        console.log(`⚠️ Instancia ${instanceName} no existe en Evolution API`);
        return {
          connected: false,
          state: 'not_found',
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
  async getQRCode(instanceName: string): Promise<{ success: boolean; qrcode?: string; error?: string }> {
    try {
      // Primero verificar si la instancia existe
      const status = await this.checkConnectionStatus(instanceName);
      if (status.state === 'not_found') {
        // Crear la instancia si no existe
        console.log(`🔄 Instancia no encontrada, creando: ${instanceName}`);
        return await this.createInstance(instanceName);
      }
      
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
        // La instancia no existe, crear una nueva
        console.log(`🔄 Instancia no encontrada (404), creando: ${instanceName}`);
        return await this.createInstance(instanceName);
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
      // Extraer solo el número del LID (sin @lid)
      const lidNumber = lidJid.replace('@lid', '');
      
      console.log(`🔍 Buscando número real para LID: ${lidJid}`);
      
      // Intentar buscar en contactos
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
  async sendTextMessage(instanceName: string, to: string, text: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      // IMPORTANTE: Detectar formato del destinatario
      const isLidJid = to.includes('@lid');
      const isWhatsAppJid = to.includes('@s.whatsapp.net');
      const isGroupJid = to.includes('@g.us');
      
      console.log(`📤 Enviando mensaje desde ${instanceName}`);
      console.log(`📤 Destinatario original: ${to}`);
      console.log(`📝 Texto: ${text.substring(0, 100)}...`);
      
      let numberToUse: string;
      
      if (isLidJid) {
        // Para LID, primero intentar obtener el número real
        const realNumber = await this.getRealPhoneNumber(instanceName, to);
        
        if (realNumber) {
          // Si encontramos el número real, usarlo
          numberToUse = realNumber.replace(/\D/g, '');
          console.log(`📱 Usando número real obtenido: ${numberToUse}`);
        } else {
          // Si no se puede obtener el número real, intentar con el LID como número
          // CRÍTICO: Extraer SOLO la parte numérica antes del @
          // to = "5585200637537@lid" -> numberToUse = "5585200637537"
          const parts = to.split('@');
          numberToUse = parts[0].replace(/\D/g, '');
          
          console.log(`📱 LID original: ${to}`);
          console.log(`📱 Partes separadas: ${JSON.stringify(parts)}`);
          console.log(`📱 Número extraído: ${numberToUse}`);
        }
      } else if (isWhatsAppJid) {
        // Formato normal @s.whatsapp.net
        numberToUse = to.replace('@s.whatsapp.net', '').replace(/\D/g, '');
      } else if (isGroupJid) {
        // Grupos - no enviamos automáticamente
        console.log('⚠️ Destino es un grupo, saltando...');
        return { success: false, error: 'Group messages not supported' };
      } else if (to.includes('@')) {
        // Otro formato con @
        numberToUse = to.split('@')[0].replace(/\D/g, '');
      } else {
        // Ya es un número limpio
        numberToUse = to.replace(/\D/g, '');
      }
      
      console.log(`📤 Número final a usar: ${numberToUse}`);
      
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

  // Configurar webhook para recibir mensajes - Evolution API v1.8.x
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

  // Desconectar instancia
  async disconnect(instanceName: string): Promise<{ success: boolean; error?: string }> {
    try {
      await axios.delete(
        `${this.apiUrl}/instance/logout/${instanceName}`,
        { headers: this.getHeaders() }
      );

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }
}

export const evolutionService = new EvolutionService();
export default evolutionService;
