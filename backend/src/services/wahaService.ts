import axios from 'axios';

const WAHA_URL = process.env.WAHA_URL || 'http://31.97.142.127:8080';
const WAHA_API_KEY = process.env.WAHA_API_KEY || 'ElisaIA_Waha_Key_2026';
const SESSION_NAME = process.env.WAHA_SESSION || 'default';

class WahaService {
  private baseUrl: string;
  private apiKey: string;
  private session: string;

  constructor() {
    this.baseUrl = WAHA_URL;
    this.apiKey = WAHA_API_KEY;
    this.session = SESSION_NAME;
    console.log(`✅ Servicio WAHA inicializado: ${this.baseUrl}`);
  }

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'X-Api-Key': this.apiKey
    };
  }

  async checkConnectionStatus(): Promise<{ connected: boolean; state?: string; phone?: string }> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/api/sessions/${this.session}`,
        { headers: this.getHeaders() }
      );
      
      const data = response.data;
      const isConnected = data.status === 'WORKING' || data.state === 'CONNECTED';
      
      return {
        connected: isConnected,
        state: data.status || data.state,
        phone: data.me?.id || data.config?.phone
      };
    } catch (error: any) {
      if (error.response?.status === 404) {
        return { connected: false, state: 'NOT_FOUND' };
      }
      console.error('❌ Error verificando estado WAHA:', error.message);
      return { connected: false, state: 'ERROR' };
    }
  }

  async startSession(): Promise<{ success: boolean; error?: string }> {
    try {
      await axios.post(
        `${this.baseUrl}/api/sessions/${this.session}/start`,
        {},
        { headers: this.getHeaders() }
      );
      return { success: true };
    } catch (error: any) {
      console.error('❌ Error iniciando sesión:', error.message);
      return { success: false, error: error.message };
    }
  }

  async stopSession(): Promise<{ success: boolean; error?: string }> {
    try {
      await axios.post(
        `${this.baseUrl}/api/sessions/${this.session}/stop`,
        {},
        { headers: this.getHeaders() }
      );
      return { success: true };
    } catch (error: any) {
      console.error('❌ Error deteniendo sesión:', error.message);
      return { success: false, error: error.message };
    }
  }

  async getQRCode(): Promise<{ qrcode?: string; error?: string }> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/api/sessions/${this.session}/auth/qr`,
        { 
          headers: this.getHeaders(),
          params: { format: 'image' }
        }
      );
      
      if (response.data) {
        const qrData = response.data.value || response.data.data || response.data;
        return { qrcode: qrData };
      }
      
      return { error: 'No QR disponible' };
    } catch (error: any) {
      console.error('❌ Error obteniendo QR:', error.message);
      return { error: error.message };
    }
  }

  async setWebhook(webhookUrl: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`📡 Configurando webhook: ${webhookUrl}`);
      return { success: true };
    } catch (error: any) {
      console.error('❌ Error configurando webhook:', error.message);
      return { success: false, error: error.message };
    }
  }

  async sendTextMessage(chatId: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      // Asegurar formato correcto del chatId
      let formattedChatId = chatId;
      if (!chatId.includes('@')) {
        formattedChatId = `${chatId}@c.us`;
      }

      console.log(`📤 Enviando mensaje a ${formattedChatId}`);

      const response = await axios.post(
        `${this.baseUrl}/api/sendText`,
        {
          session: this.session,
          chatId: formattedChatId,
          text: message
        },
        { headers: this.getHeaders() }
      );

      return { 
        success: true, 
        messageId: response.data?.id || response.data?.key?.id 
      };
    } catch (error: any) {
      console.error('❌ Error enviando mensaje:', error.response?.data || error.message);
      return { success: false, error: error.message };
    }
  }

  async sendImage(chatId: string, imageUrl: string, caption?: string): Promise<{ success: boolean; error?: string }> {
    try {
      let formattedChatId = chatId;
      if (!chatId.includes('@')) {
        formattedChatId = `${chatId}@c.us`;
      }

      await axios.post(
        `${this.baseUrl}/api/sendImage`,
        {
          session: this.session,
          chatId: formattedChatId,
          file: { url: imageUrl },
          caption: caption || ''
        },
        { headers: this.getHeaders() }
      );

      return { success: true };
    } catch (error: any) {
      console.error('❌ Error enviando imagen:', error.message);
      return { success: false, error: error.message };
    }
  }
}

export const wahaService = new WahaService();
