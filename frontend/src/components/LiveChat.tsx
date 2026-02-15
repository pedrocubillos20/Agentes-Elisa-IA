'use client';

import { useState, useRef, useEffect } from 'react';
import {
  MessageCircle, X, Send, Headphones, ChevronRight, ExternalLink,
  Zap, Crown, CheckCircle, ArrowLeft, Sparkles, Phone, Lock, Clock
} from 'lucide-react';

const SUPPORT_PRIORITY_WA = '573213815105';

// ===== BASE DE CONOCIMIENTO DE BIZONNE =====
interface KBEntry {
  keywords: string[];
  question: string;
  answer: string;
  steps?: string[];
  category: string;
}

const KNOWLEDGE_BASE: KBEntry[] = [
  // CONEXIÓN WHATSAPP
  {
    keywords: ['conectar', 'whatsapp', 'qr', 'escanear', 'vincular', 'línea', 'linea'],
    question: '¿Cómo conecto mi WhatsApp?',
    answer: 'Para conectar tu WhatsApp sigue estos pasos:',
    steps: [
      'Ve a la sección "WhatsApp" en el menú lateral',
      'Haz clic en "Nueva Línea" y dale un nombre (ej: "Ventas")',
      'Aparecerá un código QR — escanéalo con tu WhatsApp',
      'En tu celular: WhatsApp → ⋮ Menú → Dispositivos vinculados → Vincular dispositivo',
      'Escanea el QR y espera a que diga "Conectado" ✅',
      '¡Listo! Tu asistente IA ya responderá automáticamente'
    ],
    category: 'whatsapp'
  },
  {
    keywords: ['desconectar', 'desconectó', 'desconecto', 'offline', 'no funciona whatsapp', 'caído'],
    question: 'Mi WhatsApp se desconectó',
    answer: 'Si tu WhatsApp se desconectó:',
    steps: [
      'Ve a WhatsApp → tu línea → haz clic en "Reconectar"',
      'Si no funciona, elimina la línea y vuelve a escanear el QR',
      'Verifica que tu celular tenga internet y WhatsApp abierto',
      'Asegúrate de no haber cerrado sesión en "Dispositivos vinculados" de tu celular',
      'Si el problema persiste, reinicia tu celular y vuelve a intentar'
    ],
    category: 'whatsapp'
  },
  // API KEY OPENAI
  {
    keywords: ['api key', 'openai', 'api', 'key', 'gpt', 'inteligencia', 'ia no responde', 'no responde', 'bot no responde'],
    question: '¿Cómo configuro la API Key de OpenAI?',
    answer: 'La API Key de OpenAI es necesaria para que tu asistente IA funcione. Sigue estos pasos:',
    steps: [
      'Ingresa a auth.openai.com/log-in (crea cuenta gratis si no tienes)',
      'Ve a Settings → Billing → Add payment method',
      'Recarga créditos desde $5 USD (con $5 atiendes +5,000 mensajes)',
      'Ve a platform.openai.com/api-keys → Create new secret key',
      'Copia la API Key generada',
      'En Bizonne: Configuración → pega tu API Key → Guardar',
      '¡Tu asistente IA empezará a responder automáticamente! 🚀'
    ],
    category: 'configuracion'
  },
  {
    keywords: ['créditos', 'creditos', 'saldo', 'openai cobr', 'cuánto cuesta', 'cuanto cuesta ia', 'gasto'],
    question: '¿Cuánto cuesta usar la IA?',
    answer: 'El costo es muy bajo. Usamos el modelo GPT-4o-mini que es extremadamente económico:\n\n💰 Con $5 USD puedes atender aproximadamente 5,000+ mensajes\n📊 La mayoría de negocios gastan menos de $3 USD al mes\n\nPuedes recargar desde $5 USD en platform.openai.com → Billing',
    category: 'configuracion'
  },
  // ASISTENTE IA
  {
    keywords: ['asistente', 'configurar asistente', 'bot', 'crear asistente', 'prompt', 'conocimiento'],
    question: '¿Cómo configuro mi asistente IA?',
    answer: 'Para configurar tu asistente de IA:',
    steps: [
      'Ve a "Asistentes IA" en el menú lateral',
      'Haz clic en "Crear Asistente" o edita el existente',
      'Escribe el "Conocimiento" — es la base de datos de tu negocio',
      'Incluye: productos, precios, horarios, políticas, etapas del pipeline',
      'Configura el tono (profesional, amigable, etc)',
      'Asigna el asistente a tu línea de WhatsApp',
      'Prueba enviando un mensaje desde otro número'
    ],
    category: 'asistente'
  },
  {
    keywords: ['etapa', 'pipeline', 'crm', 'embudo', 'stage', 'etapas'],
    question: '¿Cómo configuro las etapas del CRM?',
    answer: 'Las etapas se configuran dentro del conocimiento del asistente IA:',
    steps: [
      'Ve a Asistentes IA → edita tu asistente',
      'En el campo "Conocimiento", agrega una sección de etapas así:',
      '## ETAPAS DEL PIPELINE\n| Etapa | Descripción |\n|-------|-------------|\n| **Nuevo** | Acaba de escribir |\n| **Interesado** | Preguntando por productos |\n| **Cotización** | Se envió precio |\n| **Confirmado** | Compra confirmada |',
      'La IA detectará automáticamente en qué etapa está cada cliente',
      'Las etapas aparecerán como columnas en tu CRM'
    ],
    category: 'crm'
  },
  // CRM
  {
    keywords: ['crm', 'clientes', 'contactos', 'leads', 'conversaciones'],
    question: '¿Cómo uso el CRM?',
    answer: 'El CRM organiza tus clientes automáticamente por etapas:\n\n📋 Los contactos llegan automáticamente cuando te escriben por WhatsApp\n🏷️ La IA los clasifica según la etapa configurada\n💬 Puedes ver y responder conversaciones desde "Conversaciones"\n📊 Filtra por etapa para enviar mensajes masivos',
    category: 'crm'
  },
  // MENSAJES MASIVOS
  {
    keywords: ['masivo', 'masivos', 'broadcast', 'enviar a todos', 'mensaje masivo', 'bulk'],
    question: '¿Cómo envío mensajes masivos?',
    answer: 'Para enviar mensajes masivos:',
    steps: [
      'Ve a "Conversaciones" en el menú lateral',
      'Filtra por una etapa específica (ej: "Interesado")',
      'Haz clic en "📢 Masivo" (se activa al filtrar por etapa)',
      'Escribe tu mensaje — puedes adjuntar imagen o video',
      'Haz clic en "Enviar"',
      'El sistema envía con intervalos automáticos anti-bloqueo (8-15s entre cada mensaje)',
      '⚠️ Recomendación: No envíes a más de 200 contactos por día para evitar restricciones de WhatsApp'
    ],
    category: 'mensajes'
  },
  // AGENDA / CITAS
  {
    keywords: ['cita', 'citas', 'agenda', 'agendar', 'calendario', 'appointment'],
    question: '¿Cómo funcionan las citas?',
    answer: 'La agenda se gestiona desde la sección "Agenda":\n\n📅 Las citas se crean automáticamente cuando la IA detecta que un cliente quiere agendar\n✏️ También puedes crear citas manualmente\n🔔 Verás las citas pendientes organizadas por fecha\n💬 Configura en el conocimiento del asistente cómo manejar las citas',
    category: 'agenda'
  },
  // EQUIPO
  {
    keywords: ['equipo', 'miembro', 'vendedor', 'agente', 'invitar', 'usuario', 'permisos'],
    question: '¿Cómo agrego miembros a mi equipo?',
    answer: 'Para agregar miembros de equipo:',
    steps: [
      'Ve a "Equipo" en el menú lateral',
      'Haz clic en "Invitar Miembro"',
      'Ingresa el email del miembro',
      'Selecciona su rol: Admin, Gerente, Vendedor, Soporte u Observador',
      'Configura los permisos que necesite',
      'El miembro recibirá un email para crear su contraseña',
      'Disponible en plan Business y Trial'
    ],
    category: 'equipo'
  },
  // SUSCRIPCIÓN
  {
    keywords: ['plan', 'precio', 'suscripción', 'suscripcion', 'pagar', 'pago', 'starter', 'business'],
    question: '¿Cuáles son los planes?',
    answer: 'Bizonne tiene 2 planes:\n\n⭐ **Starter — $30 USD/mes**\n• 2 líneas de WhatsApp\n• CRM + Agenda + Productos\n• Soporte por chat en vivo\n\n👑 **Business — $50 USD/mes**\n• 5 líneas de WhatsApp\n• Todo Starter + Equipo + Asignación de chats\n• Soporte prioritario por WhatsApp\n\n🛠️ **Implementación — $100 USD (pago único)**\n• Nosotros configuramos todo tu negocio\n• Incluye soporte prioritario por WhatsApp',
    category: 'suscripcion'
  },
  {
    keywords: ['implementación', 'implementacion', 'configurar todo', 'servicio'],
    question: '¿Qué incluye la implementación?',
    answer: 'El servicio de implementación ($100 USD pago único) incluye:\n\n🛠️ Configuramos tu asistente IA con toda la info de tu negocio\n📦 Cargamos tus productos con precios\n📋 Configuramos las etapas del CRM\n📅 Configuramos la agenda de citas\n🔗 Conectamos tu WhatsApp\n📱 Soporte prioritario por WhatsApp incluido\n\nTú solo vendes, nosotros hacemos todo lo técnico.',
    category: 'suscripcion'
  },
  // PROBLEMAS COMUNES
  {
    keywords: ['error', 'falla', 'no carga', 'problema', 'bug', 'no sirve', 'pantalla blanca'],
    question: 'Tengo un error o problema',
    answer: 'Prueba estos pasos generales de solución:\n\n1. 🔄 Recarga la página (F5 o Ctrl+R)\n2. 🗑️ Limpia caché: Ctrl+Shift+Delete → borrar datos\n3. 🌐 Prueba en otro navegador (Chrome recomendado)\n4. 📱 Si es WhatsApp: verifica que la línea esté conectada\n5. 🤖 Si la IA no responde: revisa tu API Key en Configuración\n\nSi el problema persiste, describe exactamente qué ves y te ayudo.',
    category: 'problemas'
  },
  {
    keywords: ['contraseña', 'password', 'olvidé', 'no puedo entrar', 'login', 'iniciar sesión'],
    question: 'No puedo iniciar sesión',
    answer: 'Si no puedes iniciar sesión:',
    steps: [
      'Verifica que escribas tu email correctamente (minúsculas)',
      'Haz clic en "Olvidé mi contraseña" en la pantalla de login',
      'Revisa tu bandeja de entrada (y spam) por el email de recuperación',
      'Si eres miembro de equipo, pide a tu administrador que verifique tu cuenta',
      'Si nada funciona, contacta soporte prioritario'
    ],
    category: 'problemas'
  },
  {
    keywords: ['mensajes programados', 'programar', 'programado', 'enviar después', 'scheduled'],
    question: '¿Cómo programo mensajes?',
    answer: 'Para programar mensajes:',
    steps: [
      'Ve a "Programados" en el menú lateral',
      'Haz clic en "Nuevo Mensaje Programado"',
      'Selecciona el contacto o número de destino',
      'Escribe tu mensaje y adjunta media si quieres',
      'Configura fecha, hora y frecuencia (una vez, diario, semanal)',
      'Guarda y el sistema lo enviará automáticamente'
    ],
    category: 'mensajes'
  },
  {
    keywords: ['producto', 'productos', 'catálogo', 'catalogo', 'inventario'],
    question: '¿Cómo administro mis productos?',
    answer: 'Los productos se gestionan desde el menú "Productos":\n\n📦 Agrega productos con nombre, descripción, precio e imagen\n🏷️ La IA los usa para recomendar y cotizar automáticamente\n📋 Los productos aparecen en el conocimiento del asistente\n💰 Configura precios, descuentos y variaciones',
    category: 'productos'
  },
];

// ===== BUSCAR RESPUESTA EN KB =====
function findAnswer(query: string): KBEntry | null {
  const q = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let best: KBEntry | null = null;
  let bestScore = 0;

  for (const entry of KNOWLEDGE_BASE) {
    let score = 0;
    for (const kw of entry.keywords) {
      const kwNorm = kw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (q.includes(kwNorm)) score += kwNorm.length; // Longer matches = better
    }
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  return bestScore >= 3 ? best : null;
}

// ===== CATEGORÍAS RÁPIDAS =====
const QUICK_TOPICS = [
  { icon: '📱', label: 'Conectar WhatsApp', query: 'conectar whatsapp' },
  { icon: '🔑', label: 'API Key / IA no responde', query: 'api key openai' },
  { icon: '🤖', label: 'Configurar Asistente', query: 'configurar asistente' },
  { icon: '📢', label: 'Mensajes Masivos', query: 'mensaje masivo' },
  { icon: '📋', label: 'Etapas del CRM', query: 'etapas pipeline' },
  { icon: '💳', label: 'Planes y Precios', query: 'planes precio suscripción' },
];

// ===== TIPOS =====
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  steps?: string[];
  timestamp: Date;
}

interface LiveChatProps {
  user: any;
}

export default function LiveChat({ user }: LiveChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showUpsell, setShowUpsell] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const plan = user?.plan || 'trial';
  const hasPrioritySupport = user?.hasPrioritySupport || false;

  // Listen for external open events (from guia page etc.)
  useEffect(() => {
    const handler = () => setIsOpen(true);
    window.addEventListener('openLiveChat', handler);
    return () => window.removeEventListener('openLiveChat', handler);
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Welcome message on open
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      setMessages([{
        id: 'welcome',
        role: 'assistant',
        content: `¡Hola${user?.name ? ` ${user.name.split(' ')[0]}` : ''}! 👋 Soy el asistente de soporte de Bizonne.\n\nPuedo ayudarte con configuración, problemas técnicos y dudas sobre la plataforma.\n\n¿En qué puedo ayudarte?`,
        timestamp: new Date()
      }]);
    }
  }, [isOpen]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 300);
  }, [isOpen]);

  const handleSend = (text?: string) => {
    const msg = text || input.trim();
    if (!msg) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: msg,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    // Simulate typing delay
    setTimeout(() => {
      const kb = findAnswer(msg);
      let response: ChatMessage;

      if (kb) {
        response = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: kb.answer,
          steps: kb.steps,
          timestamp: new Date()
        };
      } else {
        response = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: 'No encontré una respuesta exacta para tu consulta. Te recomiendo:\n\n1. Intenta reformular tu pregunta con más detalle\n2. Usa los temas rápidos de abajo 👇\n3. Revisa la sección "Guía" en el menú lateral',
          timestamp: new Date()
        };
        // Show upsell after no-match for non-priority users
        if (!hasPrioritySupport) {
          setTimeout(() => setShowUpsell(true), 1000);
        }
      }

      setMessages(prev => [...prev, response]);
      setIsTyping(false);

      // Show upsell after 3 messages for starter users
      if (!hasPrioritySupport && messages.length >= 4 && !showUpsell) {
        setTimeout(() => setShowUpsell(true), 2000);
      }
    }, 800 + Math.random() * 700);
  };

  return (
    <>
      {/* ===== FLOATING BUTTON ===== */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
        {/* Priority WhatsApp — solo si tiene acceso */}
        {hasPrioritySupport && !isOpen && (
          <a
            href={`https://wa.me/${SUPPORT_PRIORITY_WA}?text=${encodeURIComponent('Hola! Necesito soporte prioritario con mi cuenta de Bizonne 🚀')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-full shadow-lg shadow-amber-500/30 text-xs font-bold hover:scale-105 transition-all"
          >
            <Crown className="w-4 h-4" />
            <span className="hidden sm:inline">Soporte Prioritario</span>
            <Phone className="w-3.5 h-3.5" />
          </a>
        )}

        {/* Chat Button */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`group flex items-center justify-center w-14 h-14 rounded-full shadow-lg transition-all hover:scale-110 ${
            isOpen 
              ? 'bg-red-500/90 hover:bg-red-500 shadow-red-500/30' 
              : 'bg-gradient-to-br from-cyan-500 to-blue-600 shadow-cyan-500/30 hover:shadow-xl hover:shadow-cyan-500/40'
          }`}
        >
          {isOpen ? (
            <X className="w-6 h-6 text-white" />
          ) : (
            <div className="relative">
              <MessageCircle className="w-6 h-6 text-white" />
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full animate-pulse border-2 border-blue-600" />
            </div>
          )}
        </button>
      </div>

      {/* ===== CHAT PANEL ===== */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 w-[380px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100vh-8rem)] rounded-2xl overflow-hidden shadow-2xl shadow-black/40 border border-white/10 flex flex-col bg-[#0d1117] animate-in slide-in-from-bottom-4">
          
          {/* Header */}
          <div className="px-4 py-3 bg-gradient-to-r from-cyan-600/20 to-blue-600/20 border-b border-white/10 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center">
                  <Headphones className="w-5 h-5 text-white" />
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 rounded-full border-2 border-[#0d1117]" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Soporte Bizonne</h3>
                <p className="text-[10px] text-emerald-400">● En línea</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {hasPrioritySupport && (
                <span className="text-[9px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                  <Crown className="w-3 h-3" /> PRIORITARIO
                </span>
              )}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${
                  msg.role === 'user'
                    ? 'bg-cyan-600/30 border border-cyan-500/20 text-white'
                    : 'bg-white/5 border border-white/5 text-gray-200'
                }`}>
                  <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  
                  {/* Steps */}
                  {msg.steps && (
                    <div className="mt-2.5 space-y-1.5">
                      {msg.steps.map((step, i) => (
                        <div key={i} className="flex gap-2 items-start">
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 text-[10px] font-bold flex items-center justify-center mt-0.5">
                            {i + 1}
                          </span>
                          <p className="text-[12px] text-gray-300 leading-relaxed">{step}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  <p className="text-[9px] text-gray-500 mt-1.5 text-right">
                    {msg.timestamp.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-white/5 border border-white/5 rounded-2xl px-4 py-3">
                  <div className="flex gap-1.5">
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            {/* Upsell card for non-priority */}
            {showUpsell && !hasPrioritySupport && (
              <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/5 border border-amber-500/20 rounded-xl p-3 mt-2">
                <div className="flex items-center gap-2 mb-2">
                  <Crown className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-bold text-amber-300">Soporte Prioritario por WhatsApp</span>
                </div>
                <p className="text-[11px] text-gray-400 mb-2">
                  Obtén respuestas inmediatas de un experto humano por WhatsApp. Resolución garantizada en menos de 2 horas.
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-black text-amber-400">$15 USD<span className="text-[10px] text-gray-500 font-normal">/año</span></span>
                  <a
                    href="/subscription"
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold rounded-lg hover:brightness-110 transition-all"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    Activar Ahora
                  </a>
                </div>
                <p className="text-[9px] text-gray-500 mt-1.5">
                  ✅ Incluido gratis en plan Business y Servicio de Implementación
                </p>
                <button onClick={() => setShowUpsell(false)} className="text-[9px] text-gray-600 mt-1 hover:text-gray-400">
                  Ahora no
                </button>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick Topics — ALWAYS visible */}
          <div className="px-3 pb-2 flex-shrink-0">
            <p className="text-[10px] text-gray-500 mb-1.5 px-1">Temas frecuentes:</p>
            <div className="grid grid-cols-2 gap-1.5">
              {QUICK_TOPICS.map((topic) => (
                <button
                  key={topic.query}
                  onClick={() => handleSend(topic.query)}
                  className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-left transition-all group"
                >
                  <span className="text-sm">{topic.icon}</span>
                  <span className="text-[11px] text-gray-300 group-hover:text-white truncate">{topic.label}</span>
                </button>
              ))}
            </div>

            {/* 🔥 Promo banner — solo para Starter sin priority */}
            {!hasPrioritySupport && messages.length >= 1 && (
              <div className="mt-2 p-2.5 rounded-lg bg-gradient-to-r from-amber-500/10 to-orange-500/5 border border-amber-500/20">
                <div className="flex items-center gap-2 mb-1">
                  <Crown className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-[10px] font-bold text-amber-300">OFERTAS ESPECIALES</span>
                </div>
                <div className="space-y-1">
                  <a href="/subscription" className="flex items-center justify-between text-[10px] text-gray-300 hover:text-white">
                    <span>📞 Soporte Prioritario WhatsApp</span>
                    <span className="text-amber-400 font-bold">$15 USD/año</span>
                  </a>
                  <a href="/subscription" className="flex items-center justify-between text-[10px] text-gray-300 hover:text-white">
                    <span>📱 Línea WhatsApp adicional</span>
                    <span className="text-cyan-400 font-bold">$10 USD</span>
                  </a>
                  <a href="/subscription" className="flex items-center justify-between text-[10px] text-gray-300 hover:text-white">
                    <span>📦 +10 productos catálogo</span>
                    <span className="text-cyan-400 font-bold">$10 USD</span>
                  </a>
                  <a href="/subscription" className="flex items-center justify-between text-[10px] text-gray-300 hover:text-white">
                    <span>🛠️ Implementación completa</span>
                    <span className="text-orange-400 font-bold">$100 USD</span>
                  </a>
                </div>
                <a href="/subscription" className="block text-center text-[9px] text-amber-400 mt-1.5 hover:underline">
                  Ver todos los addons →
                </a>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="px-3 pb-3 pt-2 border-t border-white/5 flex-shrink-0">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Escribe tu pregunta..."
                className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 focus:bg-white/[0.07] transition-all"
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim()}
                className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white hover:brightness-110 disabled:opacity-30 disabled:hover:brightness-100 transition-all flex-shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            
            {/* Priority WhatsApp link for those who have it */}
            {hasPrioritySupport && (
              <a
                href={`https://wa.me/${SUPPORT_PRIORITY_WA}?text=${encodeURIComponent('Hola! Necesito soporte prioritario con Bizonne 🚀')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 mt-2 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 text-[10px] font-medium hover:bg-emerald-500/20 transition-all"
              >
                <Phone className="w-3 h-3" />
                O escríbenos por WhatsApp prioritario
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            )}
          </div>
        </div>
      )}
    </>
  );
}
