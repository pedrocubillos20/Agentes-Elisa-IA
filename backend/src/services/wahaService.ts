import axios from 'axios';
import prisma from '../lib/prisma';

const WAHA_API_URL = process.env.WAHA_API_URL || 'http://31.97.142.127:8080';
const WAHA_API_KEY = process.env.WAHA_API_KEY || 'ElisaIA_Waha_Key_2026';
const WAHA_SESSION = process.env.WAHA_SESSION || 'default';

/**
 * ============================================
 * WAHA SERVICE - WhatsApp HTTP API
 * ✅ Soporta LID nativamente
 * ✅ API simple y estable
 * ============================================
 */

class WahaService {
  private apiUrl: string;
  private apiKey: string;
  private defaultSession: string;

  constructor() {
    this.apiUrl = WAHA_API_URL;
    this.apiKey = WAHA_API_KEY;
    this.defaultSession = WAHA_SESSION;
    console.log(`🔧 WAHA Service inicializado: ${this.apiUrl}`);
  }

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'X-Api-Key': this.apiKey
    };
  }

  /**
   * Obtener estado de la sesión
   */
  async checkConnectionStatus(sessionName?: string): Promise<{ 
    connected: boolean; 
    state?: string; 
    phone?: string;
  }> {
    const session = sessionName || this.defaultSession;
    
    try {
      const response = await axios.get(
        `${this.apiUrl}/api/sessions/${session}`,
        { headers: this.getHeaders(), timeout: 10000 }
      );

      console.log('📋 [WAHA] Estado sesión:', JSON.stringify(response.data).substring(0, 300));

      const status = response.data?.status || response.data?.state;
      const connected = status === 'WORKING' || status === 'CONNECTED';
      const phone = response.data?.me?.id?.replace('@c.us', '').replace('@s.whatsapp.net', '');

      return { connected, state: status, phone };
    } catch (error: any) {
      console.error('❌ Error verificando estado:', error.message);
      return { connected: false };
    }
  }

  /**
   * Obtener código QR
   */
  async getQRCode(sessionName?: string): Promise<{ 
    success: boolean; 
    qrcode?: string; 
  }> {
    const session = sessionName || this.defaultSession;
    
    try {
      const response = await axios.get(
        `${this.apiUrl}/api/${session}/auth/qr`,
        { headers: this.getHeaders(), timeout: 15000 }
      );

      console.log('📋 [WAHA] QR obtenido');

      // WAHA puede devolver el QR en diferentes formatos
      const qrcode = response.data?.value || response.data?.qr || response.data;

      return { success: !!qrcode, qrcode };
    } catch (error: any) {
      console.error('❌ Error obteniendo QR:', error.message);
      return { success: false };
    }
  }

  /**
   * Iniciar sesión
   */
  async startSession(sessionName?: string): Promise<{ success: boolean; error?: string }> {
    const session = sessionName || this.defaultSession;
    
    try {
      const response = await axios.post(
        `${this.apiUrl}/api/sessions/${session}/start`,
        {},
        { headers: this.getHeaders(), timeout: 30000 }
      );

      console.log('📋 [WAHA] Sesión iniciada:', response.data);
      return { success: true };
    } catch (error: any) {
      // Si ya existe, no es error
      if (error.response?.status === 422) {
        return { success: true };
      }
      console.error('❌ Error iniciando sesión:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * ============================================
   * ENVIAR MENSAJE DE TEXTO
   * ============================================
   * ✅ Soporta LID nativamente
   * ✅ Convierte automáticamente el formato
   */
  async sendTextMessage(
    chatId: string, 
    text: string,
    sessionName?: string
  ): Promise<{ 
    success: boolean; 
    messageId?: string; 
    error?: string 
  }> {
    const session = sessionName || this.defaultSession;
    
    console.log(`\n📤 ========== ENVIANDO MENSAJE (WAHA) ==========`);
    console.log(`📤 Sesión: ${session}`);
    console.log(`📤 ChatId: "${chatId}"`);
    console.log(`📝 Texto: ${text.substring(0, 100)}...`);
    
    // Ignorar grupos
    if (chatId.includes('@g.us')) {
      console.log('⚠️ Grupos no soportados');
      return { success: false, error: 'Groups not supported' };
    }
    
    // Normalizar chatId: asegurar formato @c.us
    let normalizedChatId = chatId;
    if (chatId.includes('@lid')) {
      // WAHA maneja LID, pero intentamos con @c.us primero
      normalizedChatId = chatId.replace('@lid', '@c.us');
      console.log(`🔄 Convertido LID: ${chatId} → ${normalizedChatId}`);
    } else if (!chatId.includes('@')) {
      normalizedChatId = `${chatId}@c.us`;
    }
    
    try {
      const payload = {
        session: session,
        chatId: normalizedChatId,
        text: text
      };
      
      console.log(`📦 Payload:`, JSON.stringify(payload, null, 2));
      
      const response = await axios.post(
        `${this.apiUrl}/api/sendText`,
        payload,
        { headers: this.getHeaders(), timeout: 30000 }
      );
      
      console.log('✅ Respuesta envío:', JSON.stringify(response.data).substring(0, 300));
      return { success: true, messageId: response.data?.id };
      
    } catch (error: any) {
      const errorData = error.response?.data;
      const errorStatus = error.response?.status;
      
      console.error(`❌ Error enviando mensaje (HTTP ${errorStatus}):`, JSON.stringify(errorData, null, 2));
      
      // Si falla con @c.us, intentar con el original (puede ser LID puro)
      if (normalizedChatId !== chatId) {
        console.log(`🔄 Reintentando con chatId original: ${chatId}`);
        try {
          const retryResponse = await axios.post(
            `${this.apiUrl}/api/sendText`,
            { session, chatId: chatId, text },
            { headers: this.getHeaders(), timeout: 30000 }
          );
          console.log('✅ Reintento exitoso:', JSON.stringify(retryResponse.data).substring(0, 300));
          return { success: true, messageId: retryResponse.data?.id };
        } catch (retryError: any) {
          console.error('❌ Reintento también falló');
        }
      }
      
      return { success: false, error: JSON.stringify(errorData || error.message) };
    }
  }

  /**
   * Configurar webhook
   */
  async setWebhook(webhookUrl: string, sessionName?: string): Promise<{ success: boolean }> {
    const session = sessionName || this.defaultSession;
    
    try {
      console.log(`🔗 [WAHA] Configurando webhook: ${webhookUrl}`);
      
      await axios.put(
        `${this.apiUrl}/api/sessions/${session}/config`,
        {
          webhooks: [
            {
              url: webhookUrl,
              events: ['message', 'session.status']
            }
          ]
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

  /**
   * Detener sesión
   */
  async stopSession(sessionName?: string): Promise<{ success: boolean }> {
    const session = sessionName || this.defaultSession;
    
    try {
      await axios.post(
        `${this.apiUrl}/api/sessions/${session}/stop`,
        {},
        { headers: this.getHeaders() }
      );
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  }
}

export const wahaService = new WahaService();
export default wahaService;
