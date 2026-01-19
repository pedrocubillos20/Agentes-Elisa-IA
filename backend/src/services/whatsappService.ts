import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import { EventEmitter } from 'events';
import prisma from '../lib/prisma';
import OpenAI from 'openai';
import CryptoJS from 'crypto-js';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'clave-encriptacion-32-caracteres!';

// Desencriptar API Key
const decryptApiKey = (encrypted: string): string => {
  try {
    const bytes = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (error) {
    console.error('Error desencriptando API Key:', error);
    return '';
  }
};

interface WhatsAppSession {
  client: Client;
  qrCode: string | null;
  connected: boolean;
  phoneNumber: string | null;
  userId: string;
  ready: boolean;
}

class WhatsAppService extends EventEmitter {
  private sessions: Map<string, WhatsAppSession> = new Map();
  
  constructor() {
    super();
    console.log('📱 WhatsApp Service inicializado');
  }

  // Crear o obtener sesión para un usuario
  async getOrCreateSession(userId: string): Promise<WhatsAppSession> {
    let session = this.sessions.get(userId);
    
    if (session) {
      return session;
    }

    // Crear nuevo cliente de WhatsApp
    const client = new Client({
      authStrategy: new LocalAuth({ clientId: userId }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu'
        ],
      },
    });

    session = {
      client,
      qrCode: null,
      connected: false,
      phoneNumber: null,
      userId,
      ready: false,
    };

    this.sessions.set(userId, session);

    // Configurar eventos
    this.setupClientEvents(client, userId);

    return session;
  }

  // Configurar eventos del cliente
  private setupClientEvents(client: Client, userId: string) {
    // Evento: QR generado
    client.on('qr', (qr: string) => {
      console.log(`📱 QR generado para usuario ${userId}`);
      const session = this.sessions.get(userId);
      if (session) {
        session.qrCode = qr;
        session.connected = false;
      }
      this.emit('qr', { userId, qr });
    });

    // Evento: Autenticado
    client.on('authenticated', () => {
      console.log(`✅ Usuario ${userId} autenticado en WhatsApp`);
    });

    // Evento: Listo para usar
    client.on('ready', async () => {
      console.log(`🚀 WhatsApp listo para usuario ${userId}`);
      const session = this.sessions.get(userId);
      if (session) {
        session.connected = true;
        session.ready = true;
        session.qrCode = null;
        
        // Obtener información del número
        const info = client.info;
        session.phoneNumber = info?.wid?.user ? `+${info.wid.user}` : null;

        // Actualizar en base de datos
        try {
          await prisma.user.update({
            where: { id: userId },
            data: {
              whatsappConnected: true,
              whatsappPhone: session.phoneNumber,
            },
          });
        } catch (error) {
          console.error('Error actualizando usuario:', error);
        }
      }
      this.emit('ready', { userId });
    });

    // Evento: Mensaje recibido
    client.on('message', async (message: Message) => {
      console.log(`📨 Mensaje recibido de ${message.from}: ${message.body?.substring(0, 50)}...`);
      await this.handleIncomingMessage(userId, message);
    });

    // Evento: Desconectado
    client.on('disconnected', async (reason: string) => {
      console.log(`📴 WhatsApp desconectado para ${userId}: ${reason}`);
      const session = this.sessions.get(userId);
      if (session) {
        session.connected = false;
        session.ready = false;
        session.qrCode = null;
      }

      // Actualizar en base de datos
      try {
        await prisma.user.update({
          where: { id: userId },
          data: {
            whatsappConnected: false,
            whatsappPhone: null,
          },
        });
      } catch (error) {
        console.error('Error actualizando usuario:', error);
      }

      this.emit('disconnected', { userId, reason });
    });

    // Evento: Error de autenticación
    client.on('auth_failure', (message: string) => {
      console.error(`❌ Error de autenticación para ${userId}:`, message);
      this.emit('auth_failure', { userId, message });
    });
  }

  // Enviar mensaje de forma robusta con reintentos
  private async sendMessageSafe(userId: string, to: string, text: string, retries = 3): Promise<boolean> {
    const session = this.sessions.get(userId);
    
    if (!session) {
      console.log('❌ No hay sesión para el usuario');
      return false;
    }
    
    if (!session.connected || !session.ready) {
      console.log(`❌ Sesión no lista - connected: ${session.connected}, ready: ${session.ready}`);
      return false;
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`📤 Intento ${attempt}/${retries} de enviar mensaje a ${to}`);
        
        // Verificar que el cliente esté listo
        let state = 'UNKNOWN';
        try {
          state = await session.client.getState() || 'NULL';
          console.log(`📊 Estado de WhatsApp: ${state}`);
        } catch (stateError: any) {
          console.log(`⚠️ No se pudo obtener estado: ${stateError?.message}`);
        }
        
        if (state === 'CONFLICT' || state === 'UNPAIRED' || state === 'UNLAUNCHED') {
          console.log(`⚠️ Estado inválido de WhatsApp: ${state}`);
          if (attempt < retries) {
            await new Promise(resolve => setTimeout(resolve, 3000));
            continue;
          }
          return false;
        }

        // Extraer solo el número (sin @c.us o @lid)
        const phoneNumber = to.replace(/@c\.us$/, '').replace(/@lid$/, '').replace(/@s\.whatsapp\.net$/, '').replace(/\D/g, '');
        console.log(`📱 Número extraído: ${phoneNumber}`);
        
        // Intentar obtener el ID correcto del número
        let chatId = to; // Usar el original como fallback
        
        try {
          // Si el mensaje original venía con @lid o @c.us, usarlo directamente
          if (to.includes('@')) {
            chatId = to;
            console.log(`📱 Usando ID original: ${chatId}`);
          } else {
            // Intentar obtener el ID registrado del número
            const numberId = await session.client.getNumberId(phoneNumber);
            if (numberId) {
              chatId = numberId._serialized;
              console.log(`📱 ID obtenido de getNumberId: ${chatId}`);
            } else {
              chatId = `${phoneNumber}@c.us`;
              console.log(`📱 Usando formato @c.us: ${chatId}`);
            }
          }
        } catch (idError: any) {
          console.log(`⚠️ Error obteniendo ID: ${idError?.message}, usando original`);
          // Si falla, intentar con el formato original
          chatId = to.includes('@') ? to : `${phoneNumber}@c.us`;
        }

        console.log(`📱 Enviando a chatId final: ${chatId}`);
        
        // Enviar mensaje con timeout
        const sendPromise = session.client.sendMessage(chatId, text);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout enviando mensaje')), 30000)
        );
        
        await Promise.race([sendPromise, timeoutPromise]);
        console.log(`✅ Mensaje enviado exitosamente a ${to}`);
        return true;
        
      } catch (error: any) {
        console.error(`❌ Error en intento ${attempt}:`, error?.message || error);
        
        // Si es un error de LID, intentar con formato diferente
        if (error?.message?.includes('No LID for user') || error?.message?.includes('LID')) {
          console.log('⚠️ Error de LID detectado - intentando formato alternativo');
          
          // Extraer número y probar con @s.whatsapp.net
          const phoneNumber = to.replace(/@.*$/, '').replace(/\D/g, '');
          const altFormats = [
            `${phoneNumber}@s.whatsapp.net`,
            `${phoneNumber}@c.us`,
          ];
          
          for (const altChatId of altFormats) {
            try {
              console.log(`📱 Probando formato alternativo: ${altChatId}`);
              await session.client.sendMessage(altChatId, text);
              console.log(`✅ Mensaje enviado con formato alternativo: ${altChatId}`);
              return true;
            } catch (altError: any) {
              console.log(`❌ Formato ${altChatId} falló: ${altError?.message}`);
            }
          }
        }
        
        // Si es un error de protocolo, puede que necesitemos reconectar
        if (error?.message?.includes('Protocol error') || error?.message?.includes('Target closed')) {
          console.log('⚠️ Error de protocolo detectado - la sesión puede haber expirado');
          session.connected = false;
          session.ready = false;
        }
        
        if (attempt < retries) {
          const waitTime = attempt * 2000;
          console.log(`⏳ Esperando ${waitTime/1000} segundos antes de reintentar...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    console.error(`❌ Falló después de ${retries} intentos`);
    return false;
  }

  // Manejar mensajes entrantes
  private async handleIncomingMessage(userId: string, message: Message) {
    try {
      // Ignorar mensajes propios y de grupos
      if (message.fromMe || message.from.includes('@g.us')) {
        console.log('Mensaje ignorado (propio o de grupo)');
        return;
      }

      // Ignorar mensajes vacíos
      if (!message.body || message.body.trim() === '') {
        console.log('Mensaje ignorado (vacío)');
        return;
      }

      console.log(`📨 Procesando mensaje de ${message.from}: ${message.body}`);

      // Obtener la sesión para enviar mensajes
      const session = this.sessions.get(userId);
      if (!session || !session.connected || !session.ready) {
        console.log('❌ Sesión no disponible para responder');
        return;
      }

      // Obtener usuario y su asistente activo
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          assistants: {
            where: { isActive: true },
            take: 1,
          },
        },
      });

      if (!user) {
        console.log('❌ Usuario no encontrado');
        return;
      }

      if (user.assistants.length === 0) {
        console.log('❌ No hay asistente activo para responder');
        return;
      }

      const assistant = user.assistants[0];
      console.log(`🤖 Usando asistente: ${assistant.name}`);

      // Verificar que el asistente tenga contexto
      if (!assistant.contextJson) {
        console.log('❌ El asistente no tiene contexto configurado');
        try {
          const chat = await message.getChat();
          await chat.sendMessage('⚠️ El asistente aún no está configurado. Por favor contacta al administrador.');
        } catch (e) {
          console.error('Error enviando mensaje de config:', e);
        }
        return;
      }

      // Verificar que el usuario tenga API Key
      if (!user.openaiApiKey) {
        console.log('❌ Usuario sin API Key de OpenAI');
        try {
          const chat = await message.getChat();
          await chat.sendMessage('⚠️ El chatbot no está configurado correctamente. Por favor contacta al administrador.');
        } catch (e) {
          console.error('Error enviando mensaje de API:', e);
        }
        return;
      }

      // Obtener o crear conversación - limpiar cualquier sufijo (@c.us, @lid, @s.whatsapp.net)
      const clientPhone = message.from.replace(/@.*$/, '');
      let conversation = await prisma.conversation.findFirst({
        where: {
          assistantId: assistant.id,
          clientPhone: clientPhone,
          status: 'ACTIVE',
        },
        include: { messages: { orderBy: { createdAt: 'asc' }, take: 20 } },
      });

      if (!conversation) {
        console.log('📝 Creando nueva conversación');
        conversation = await prisma.conversation.create({
          data: {
            assistantId: assistant.id,
            clientPhone: clientPhone,
            channel: 'WHATSAPP',
            status: 'ACTIVE',
          },
          include: { messages: true },
        });
      }

      // Guardar mensaje del usuario
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'USER',
          content: message.body,
        },
      });

      console.log('🧠 Generando respuesta con IA...');
      
      // Generar respuesta con OpenAI
      const reply = await this.generateAIResponse(user, assistant, conversation, message.body);

      console.log(`💬 Respuesta generada: ${reply.substring(0, 100)}...`);

      // Guardar respuesta del asistente
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'ASSISTANT',
          content: reply,
        },
      });

      // Actualizar conversación
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          messageCount: { increment: 2 },
          lastMessageAt: new Date(),
        },
      });

      // Enviar respuesta usando getChat() para obtener el chat correcto
      console.log('📤 Enviando respuesta...');
      
      let sent = false;
      
      // Método 1: Usar getChat() del mensaje (más confiable)
      try {
        console.log('📱 Método 1: Usando message.getChat()...');
        const chat = await message.getChat();
        console.log(`📱 Chat obtenido: ${chat.id._serialized}`);
        await chat.sendMessage(reply);
        sent = true;
        console.log(`✅ Respuesta enviada usando getChat()`);
      } catch (chatError: any) {
        console.error(`❌ Error con getChat(): ${chatError?.message}`);
        
        // Método 2: Intentar con sendMessageSafe como fallback
        try {
          console.log('📱 Método 2: Usando sendMessageSafe...');
          sent = await this.sendMessageSafe(userId, message.from, reply);
        } catch (sendError: any) {
          console.error(`❌ Error con sendMessageSafe: ${sendError?.message}`);
        }
      }
      
      if (sent) {
        console.log(`✅ Respuesta enviada a ${message.from}`);
      } else {
        console.log(`❌ No se pudo enviar respuesta a ${message.from}`);
      }

    } catch (error: any) {
      console.error('❌ Error procesando mensaje:', error?.message || error);
      console.error('Stack:', error?.stack);
      
      // Intentar enviar mensaje de error al usuario
      try {
        const chat = await message.getChat();
        await chat.sendMessage('Lo siento, hubo un error procesando tu mensaje. Por favor intenta de nuevo.');
      } catch (replyError) {
        console.error('Error enviando mensaje de error:', replyError);
      }
    }
  }

  // Generar respuesta con OpenAI
  private async generateAIResponse(
    user: any,
    assistant: any,
    conversation: any,
    userMessage: string
  ): Promise<string> {
    try {
      console.log('🔐 Desencriptando API Key...');
      const userApiKey = decryptApiKey(user.openaiApiKey);
      
      if (!userApiKey) {
        console.error('❌ No se pudo desencriptar la API Key');
        return 'Lo siento, hay un problema con la configuración. Por favor contacta al administrador.';
      }

      console.log(`🔑 API Key desencriptada (últimos 4 chars): ...${userApiKey.slice(-4)}`);
      
      const openai = new OpenAI({ apiKey: userApiKey });

      // Construir contexto del negocio desde el JSON
      let businessContext = '';
      if (assistant.contextJson) {
        try {
          console.log('📋 Parseando contexto JSON...');
          const contextData = JSON.parse(assistant.contextJson);
          console.log('📋 Contexto parseado, keys:', Object.keys(contextData));
          businessContext = this.formatContextForAI(contextData);
          console.log(`📋 Contexto formateado (${businessContext.length} chars)`);
        } catch (parseError: any) {
          console.error('Error parseando contextJson:', parseError?.message);
          businessContext = assistant.contextJson; // Usar como texto plano si no es JSON válido
        }
      } else {
        console.log('⚠️ No hay contextJson en el asistente');
      }

      // Construir historial de mensajes
      const messageHistory = (conversation.messages || []).map((m: any) => ({
        role: m.role.toLowerCase() as 'user' | 'assistant',
        content: m.content,
      }));
      console.log(`📝 Historial: ${messageHistory.length} mensajes`);

      // System prompt
      const systemPrompt = this.buildSystemPrompt(assistant, businessContext);
      console.log(`📝 System prompt generado (${systemPrompt.length} chars)`);

      console.log('🚀 Llamando a OpenAI...');
      
      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messageHistory.slice(-10), // Últimos 10 mensajes para contexto
          { role: 'user', content: userMessage },
        ],
        max_tokens: 500,
        temperature: 0.7,
      });

      const response = completion.choices[0]?.message?.content;
      
      if (!response) {
        console.error('❌ OpenAI no devolvió respuesta');
        return 'Lo siento, no pude procesar tu mensaje. Por favor intenta de nuevo.';
      }

      console.log(`✅ Respuesta de OpenAI recibida (${response.length} chars)`);
      return response;
      
    } catch (error: any) {
      console.error('❌ Error OpenAI:', error?.message || error);
      console.error('Error completo:', JSON.stringify(error, null, 2));
      
      // Manejar errores específicos de OpenAI
      if (error?.status === 401 || error?.code === 'invalid_api_key') {
        return 'Error de configuración: La API Key de OpenAI no es válida. Por favor verifica tu configuración.';
      }
      if (error?.status === 429) {
        return 'El servicio está temporalmente saturado. Por favor intenta en unos minutos.';
      }
      if (error?.status === 500 || error?.status === 503) {
        return 'Hay un problema temporal con el servicio de IA. Por favor intenta más tarde.';
      }
      if (error?.code === 'insufficient_quota') {
        return 'Tu cuenta de OpenAI no tiene créditos suficientes. Por favor recarga tu cuenta.';
      }
      
      return 'Lo siento, hubo un error procesando tu mensaje. Por favor intenta de nuevo.';
    }
  }

  // Formatear el contexto JSON para que la IA lo entienda mejor
  private formatContextForAI(contextData: any): string {
    let formatted = '\n=== INFORMACIÓN DEL NEGOCIO/BOT ===\n';
    
    // Soportar estructura "negocio" o "bot"
    const businessInfo = contextData.negocio || contextData.bot || contextData.business || contextData.empresa;
    
    if (businessInfo) {
      const n = businessInfo;
      formatted += `\nNombre: ${n.nombre || n.name || 'No especificado'}`;
      if (n.empresa || n.company) formatted += `\nEmpresa: ${n.empresa || n.company}`;
      if (n.descripcion || n.description) formatted += `\nDescripción: ${n.descripcion || n.description}`;
      if (n.horario || n.hours) formatted += `\nHorario: ${n.horario || n.hours}`;
      if (n.direccion || n.address) formatted += `\nDirección: ${n.direccion || n.address}`;
      if (n.telefono || n.phone) formatted += `\nTeléfono: ${n.telefono || n.phone}`;
      if (n.whatsapp) formatted += `\nWhatsApp: ${n.whatsapp}`;
      if (n.email) formatted += `\nEmail: ${n.email}`;
      if (n.objetivo || n.goal) formatted += `\nObjetivo: ${n.objetivo || n.goal}`;
      
      // Personalidad del bot
      if (n.personalidad || n.personality) {
        const p = n.personalidad || n.personality;
        formatted += '\n\n=== PERSONALIDAD ===';
        if (p.tipo || p.type) formatted += `\nTipo: ${p.tipo || p.type}`;
        if (p.tono || p.tone) formatted += `\nTono: ${p.tono || p.tone}`;
        if (p.orientacion || p.orientation) formatted += `\nOrientación: ${p.orientacion || p.orientation}`;
        if (p.formato_respuestas) formatted += `\nFormato: ${p.formato_respuestas}`;
        if (p.usa_emojis !== undefined) formatted += `\nUsa emojis: ${p.usa_emojis ? 'Sí' : 'No'}`;
        if (p.ofrece_opciones !== undefined) formatted += `\nOfrece opciones: ${p.ofrece_opciones ? 'Sí' : 'No'}`;
      }
    }
    
    // Productos
    const products = contextData.productos || contextData.products || contextData.catalogo || contextData.catalog;
    if (products && Array.isArray(products) && products.length > 0) {
      formatted += '\n\n=== PRODUCTOS/CATÁLOGO ===\n';
      products.forEach((p: any, i: number) => {
        const name = p.nombre || p.name || p.producto || 'Producto';
        const price = p.precio || p.price;
        const desc = p.descripcion || p.description;
        const sizes = p.tallas || p.sizes;
        const colors = p.colores || p.colors;
        
        formatted += `\n${i + 1}. ${name}`;
        if (price) formatted += ` - Precio: $${typeof price === 'number' ? price.toLocaleString('es-CO') : price}`;
        if (desc) formatted += `\n   ${desc}`;
        if (sizes) formatted += `\n   Tallas: ${Array.isArray(sizes) ? sizes.join(', ') : sizes}`;
        if (colors) formatted += `\n   Colores: ${Array.isArray(colors) ? colors.join(', ') : colors}`;
      });
    }
    
    // Servicios
    const services = contextData.servicios || contextData.services;
    if (services && Array.isArray(services) && services.length > 0) {
      formatted += '\n\n=== SERVICIOS ===\n';
      services.forEach((s: any) => {
        formatted += `\n- ${typeof s === 'string' ? s : s.nombre || s.name || s}`;
      });
    }
    
    // FAQs / Preguntas frecuentes
    const faqs = contextData.preguntas_frecuentes || contextData.faqs || contextData.faq;
    if (faqs && Array.isArray(faqs) && faqs.length > 0) {
      formatted += '\n\n=== PREGUNTAS FRECUENTES ===\n';
      faqs.forEach((faq: any) => {
        const question = faq.pregunta || faq.question || faq.q;
        const answer = faq.respuesta || faq.answer || faq.a;
        if (question && answer) {
          formatted += `\nP: ${question}`;
          formatted += `\nR: ${answer}\n`;
        }
      });
    }
    
    // Instrucciones
    const instructions = contextData.instrucciones || contextData.instructions || contextData.reglas || contextData.rules;
    if (instructions) {
      formatted += `\n\n=== INSTRUCCIONES ESPECIALES ===\n`;
      if (typeof instructions === 'string') {
        formatted += instructions;
      } else if (Array.isArray(instructions)) {
        instructions.forEach((inst: any) => {
          formatted += `\n- ${typeof inst === 'string' ? inst : JSON.stringify(inst)}`;
        });
      }
    }

    // Proceso de venta / Flujo
    const salesProcess = contextData.proceso_venta || contextData.flujo || contextData.sales_process || contextData.flow;
    if (salesProcess) {
      formatted += '\n\n=== PROCESO DE VENTA/FLUJO ===\n';
      if (typeof salesProcess === 'object') {
        Object.keys(salesProcess).forEach(step => {
          formatted += `\n${step}: ${JSON.stringify(salesProcess[step])}`;
        });
      } else {
        formatted += salesProcess;
      }
    }

    // Agregar cualquier otro campo que exista al final
    const knownFields = ['negocio', 'bot', 'business', 'empresa', 'productos', 'products', 'catalogo', 'catalog', 
                         'servicios', 'services', 'preguntas_frecuentes', 'faqs', 'faq', 'instrucciones', 
                         'instructions', 'reglas', 'rules', 'proceso_venta', 'flujo', 'sales_process', 'flow'];
    
    Object.keys(contextData).forEach(key => {
      if (!knownFields.includes(key)) {
        formatted += `\n\n=== ${key.toUpperCase().replace(/_/g, ' ')} ===\n`;
        const value = contextData[key];
        if (typeof value === 'string') {
          formatted += value;
        } else if (Array.isArray(value)) {
          value.forEach((item: any) => {
            formatted += `\n- ${typeof item === 'string' ? item : JSON.stringify(item)}`;
          });
        } else if (typeof value === 'object') {
          formatted += JSON.stringify(value, null, 2);
        } else {
          formatted += String(value);
        }
      }
    });
    
    return formatted;
  }

  private buildBusinessContext(business: any): string {
    let ctx = '';
    
    if (business) {
      if (business.name) ctx += `\nNegocio: ${business.name}`;
      if (business.industry) ctx += `\nIndustria: ${business.industry}`;
      if (business.description) ctx += `\nDescripción: ${business.description}`;
      if (business.contactEmail) ctx += `\nEmail: ${business.contactEmail}`;
      if (business.contactPhone) ctx += `\nTeléfono: ${business.contactPhone}`;
      if (business.businessHours) ctx += `\nHorario: ${business.businessHours}`;

      if (business.products?.length > 0) {
        ctx += '\n\nProductos adicionales:\n';
        business.products.forEach((p: any) => {
          ctx += `- ${p.name}${p.price ? ` ($${p.price})` : ''}${p.description ? `: ${p.description}` : ''}\n`;
        });
      }

      if (business.faqs?.length > 0) {
        ctx += '\nFAQs adicionales:\n';
        business.faqs.forEach((f: any) => {
          ctx += `P: ${f.question}\nR: ${f.answer}\n\n`;
        });
      }
    }

    return ctx;
  }

  private buildSystemPrompt(assistant: any, businessContext: string): string {
    const tones: Record<string, string> = {
      'PROFESSIONAL': 'Mantén un tono profesional y formal.',
      'FRIENDLY': 'Sé amigable, cercano y usa un tono cálido.',
      'CASUAL': 'Sé casual, relajado y usa un lenguaje informal.',
    };

    return `Eres ${assistant.name}, un asistente virtual de atención al cliente por WhatsApp.
${tones[assistant.tone] || tones['PROFESSIONAL']}

${businessContext}

REGLAS IMPORTANTES:
- Responde siempre en español
- Sé conciso pero informativo (los mensajes de WhatsApp deben ser cortos)
- Si no conoces la respuesta exacta, ofrece alternativas o contactar al equipo
- No inventes información que no esté en el contexto
- Usa emojis ocasionalmente para ser más amigable 😊
- Mantén respuestas breves (máximo 2-3 párrafos cortos)
- Si te preguntan algo fuera del contexto del negocio, indica amablemente que solo puedes ayudar con temas relacionados al negocio
- Siempre saluda de forma amigable si es el primer mensaje`;
  }

  // Inicializar cliente y generar QR
  async initializeClient(userId: string): Promise<string | null> {
    const session = await this.getOrCreateSession(userId);
    
    // Si ya está conectado, retornar null (no necesita QR)
    if (session.connected && session.ready) {
      return null;
    }

    // Inicializar cliente si no está inicializado
    if (!session.client.pupBrowser) {
      await session.client.initialize();
    }

    // Esperar a que se genere el QR (máximo 30 segundos)
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(session.qrCode);
      }, 30000);

      if (session.qrCode) {
        clearTimeout(timeout);
        resolve(session.qrCode);
        return;
      }

      const checkQR = setInterval(() => {
        if (session.qrCode) {
          clearInterval(checkQR);
          clearTimeout(timeout);
          resolve(session.qrCode);
        }
      }, 1000);
    });
  }

  // Obtener estado de la sesión
  getSessionStatus(userId: string): { connected: boolean; phoneNumber: string | null; qrCode: string | null } {
    const session = this.sessions.get(userId);
    return {
      connected: session?.connected || false,
      phoneNumber: session?.phoneNumber || null,
      qrCode: session?.qrCode || null,
    };
  }

  // Desconectar sesión
  async disconnectSession(userId: string): Promise<void> {
    const session = this.sessions.get(userId);
    if (session) {
      try {
        await session.client.logout();
        await session.client.destroy();
      } catch (error) {
        console.error('Error desconectando:', error);
      }
      this.sessions.delete(userId);

      // Actualizar en base de datos
      await prisma.user.update({
        where: { id: userId },
        data: {
          whatsappConnected: false,
          whatsappPhone: null,
        },
      });
    }
  }

  // Enviar mensaje
  async sendMessage(userId: string, to: string, message: string): Promise<boolean> {
    const session = this.sessions.get(userId);
    if (!session?.connected || !session.ready) {
      return false;
    }

    try {
      const chatId = to.includes('@c.us') ? to : `${to.replace(/\D/g, '')}@c.us`;
      await session.client.sendMessage(chatId, message);
      return true;
    } catch (error) {
      console.error('Error enviando mensaje:', error);
      return false;
    }
  }
}

// Singleton
export const whatsappService = new WhatsAppService();
export default whatsappService;
