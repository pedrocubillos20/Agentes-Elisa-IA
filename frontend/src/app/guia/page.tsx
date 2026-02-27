'use client';
import { useState } from 'react';
import Link from 'next/link';
import { 
  BookOpen, Smartphone, Bot, Users, Calendar, MessageSquare,
  ChevronDown, CheckCircle, ArrowRight,
  Wifi, Zap, Phone, Image, Mic,
  Target, Bell, Send, Copy, Check,
  Sparkles, Brain, Clock, AlertTriangle, RefreshCw,
  LayoutGrid, Paintbrush, Key, DollarSign,
  Rocket, Globe, BarChart3, Shield, Star,
  Circle, Package, FileText, Settings, Download, Upload
} from 'lucide-react';

const SUPPORT_WHATSAPP = '573213815105';

interface StepProps {
  number: number;
  title: string;
  description: string;
  icon: any;
  color: string;
  children: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  isRequired?: boolean;
}

function Step({ number, title, description, icon: Icon, color, children, isOpen, onToggle, isRequired }: StepProps) {
  return (
    <div className={`rounded-2xl border transition-all ${isOpen ? `bg-${color}-500/5 border-${color}-500/30 shadow-lg` : 'bg-white/[0.04] border-white/10 hover:border-white/20 backdrop-blur-sm'}`}>
      <button onClick={onToggle} className="w-full flex items-center gap-4 p-5 text-left">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 bg-${color}-500/20`}>
          <Icon className={`w-6 h-6 text-${color}-400`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-bold uppercase tracking-wider text-${color}-400`}>Paso {number}</span>
            {isRequired && <span className="text-[10px] bg-red-500/20 text-red-300 px-2 py-0.5 rounded-full">⚡ Obligatorio</span>}
          </div>
          <h3 className="text-lg font-bold text-white mt-0.5">{title}</h3>
          <p className="text-sm text-gray-500 mt-0.5">{description}</p>
        </div>
        <ChevronDown className={`w-5 h-5 text-gray-500 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div className="px-5 pb-6 pt-0">
          <div className="ml-16 space-y-4">{children}</div>
        </div>
      )}
    </div>
  );
}

function SubStep({ icon: Icon, title, description }: { icon: any; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.06] border border-white/[0.08]">
      <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-gray-400" />
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function InfoBox({ type = 'info', children }: { type?: 'info' | 'warning' | 'tip' | 'example' | 'important'; children: React.ReactNode }) {
  const styles: Record<string, any> = {
    info: { bg: 'bg-blue-500/10', border: 'border-blue-500/20', color: 'text-blue-400', label: 'ℹ️ Información' },
    warning: { bg: 'bg-amber-500/10', border: 'border-amber-500/20', color: 'text-amber-400', label: '⚠️ Importante' },
    tip: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', color: 'text-emerald-400', label: '💡 Tip' },
    example: { bg: 'bg-purple-500/10', border: 'border-purple-500/20', color: 'text-purple-400', label: '📋 Ejemplo' },
    important: { bg: 'bg-red-500/10', border: 'border-red-500/20', color: 'text-red-400', label: '🔴 Crítico' },
  };
  const s = styles[type];
  return (
    <div className={`${s.bg} border ${s.border} rounded-xl p-4`}>
      <p className={`text-xs font-bold ${s.color} mb-1.5`}>{s.label}</p>
      <div className="text-sm text-gray-300 leading-relaxed">{children}</div>
    </div>
  );
}

function CodeBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative bg-black/40 rounded-xl p-4 border border-white/10 font-mono text-xs text-gray-300 whitespace-pre-wrap leading-relaxed">
      <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
        className="absolute top-2 right-2 p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition">
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-gray-500" />}
      </button>
      {text}
    </div>
  );
}

function NeedHelpBanner({ step, context }: { step: string; context: string }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl bg-gradient-to-r from-amber-500/10 to-orange-500/5 border border-amber-500/20">
      <div className="w-9 h-9 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
        <Zap className="w-5 h-5 text-amber-400" />
      </div>
      <div className="flex-1">
        <p className="text-sm font-bold text-white mb-1">¿Necesitas ayuda con este paso?</p>
        <p className="text-xs text-gray-400 mb-2">Nuestro equipo configura todo por ti. Agenda una videollamada gratis.</p>
        <a href={`https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(`¡Hola! Necesito ayuda con: ${step}. ${context}. Quiero agendar una videollamada 🚀`)}`}
          target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold rounded-lg text-xs hover:brightness-110 transition-all">
          <Phone className="w-3.5 h-3.5" /> Solicitar Implementación
        </a>
      </div>
    </div>
  );
}

export default function GuiaPage() {
  const [openStep, setOpenStep] = useState(0);
  const toggleStep = (index: number) => { setOpenStep(openStep === index ? -1 : index); };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="w-20 h-20 bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 rounded-3xl mx-auto mb-4 flex items-center justify-center border border-emerald-500/20">
          <BookOpen className="w-10 h-10 text-emerald-400" />
        </div>
        <h1 className="text-3xl md:text-4xl font-black text-white mb-3">
          Guía de <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">Bizonne</span>
        </h1>
        <p className="text-gray-400 text-lg max-w-xl mx-auto">Configura tu asistente de IA paso a paso y empieza a automatizar tu negocio por WhatsApp</p>
        <div className="flex items-center justify-center gap-4 mt-6 flex-wrap">
          <span className="text-xs text-gray-600 flex items-center gap-1.5"><Circle className="w-3 h-3" /> 3 pasos obligatorios</span>
          <span className="text-xs text-gray-600">•</span>
          <span className="text-xs text-gray-600 flex items-center gap-1.5"><Clock className="w-3 h-3" /> ~10 minutos</span>
          <span className="text-xs text-gray-600">•</span>
          <span className="text-xs text-amber-400 flex items-center gap-1.5"><Sparkles className="w-3 h-3" /> Actualizado</span>
        </div>
      </div>

      {/* Key concept */}
      <div className="rounded-2xl bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 border border-emerald-500/20 p-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
            <Rocket className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white mb-1">🚀 3 pasos y tu agente IA está activo</h3>
            <p className="text-sm text-gray-400 leading-relaxed">
              Solo necesitas completar <strong className="text-white">3 pasos obligatorios</strong> para que tu asistente de IA empiece a responder por WhatsApp: 
              conectar WhatsApp, configurar el asistente y conectar OpenAI. <strong className="text-emerald-300">¡Es todo!</strong>
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {/* ═══════════════════════════════════════════ */}
        {/* PASO 1: CONECTAR WHATSAPP */}
        {/* ═══════════════════════════════════════════ */}
        <Step number={1} title="Conectar WhatsApp" description="Vincula tu número de WhatsApp para que el asistente pueda responder"
          icon={Smartphone} color="emerald" isOpen={openStep === 0} onToggle={() => toggleStep(0)} isRequired>
          <SubStep icon={ArrowRight} title="1. Ve a la sección WhatsApp" description="En el menú lateral haz click en 'WhatsApp'. Verás tu panel de líneas. Si no tienes línea, haz click en '+ Nueva Línea'." />
          <SubStep icon={Wifi} title="2. Escanea el código QR" description="Haz click en 'Conectar' y te aparecerá un código QR. Abre WhatsApp en tu celular → Menú (⋮) → Dispositivos vinculados → Vincular dispositivo → Escanea el QR." />
          <SubStep icon={CheckCircle} title="3. Confirma la conexión" description="Espera unos segundos y verás el estado cambiar a 'Conectado' en verde. ¡Tu línea ya está lista!" />
          <InfoBox type="tip"><strong>Multi-línea:</strong> Con el plan Business puedes agregar múltiples líneas. Cada línea tiene su propio asistente IA y número de WhatsApp.</InfoBox>
          <InfoBox type="warning">No cierres sesión en tu celular. Si pierdes conexión, simplemente vuelve a escanear el QR.</InfoBox>
          <div className="pt-2">
            <Link href="/whatsapp" className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 rounded-xl text-sm font-semibold hover:bg-emerald-500/30 transition">
              <Smartphone className="w-4 h-4" /> Ir a WhatsApp <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <NeedHelpBanner step="Conectar WhatsApp" context="No logro vincular mi número" />
        </Step>

        {/* ═══════════════════════════════════════════ */}
        {/* PASO 2: CONFIGURAR ASISTENTE DE IA */}
        {/* ═══════════════════════════════════════════ */}
        <Step number={2} title="Configurar el Asistente de IA" description="La base de conocimiento define TODO: cómo responde el bot, pipeline, datos que recopila, multimedia"
          icon={Bot} color="blue" isOpen={openStep === 1} onToggle={() => toggleStep(1)} isRequired>
          <InfoBox type="important"><strong>Este es el paso más importante.</strong> La base de conocimiento define cómo responde el bot, las etapas del CRM, qué datos recopila, cuándo envía multimedia y todo el flujo de ventas. Mientras más preciso y completo, mejor funciona todo.</InfoBox>
          <SubStep icon={ArrowRight} title="1. Ve a Asistentes IA" description="En el menú lateral haz click en 'Asistentes IA'. Verás el editor con pestañas: Base de Conocimiento, Multimedia, Auto-Aprendizaje y Voz." />
          <SubStep icon={FileText} title="2. Escribe la Base de Conocimiento" description="Escribe TODO sobre tu negocio: identidad, productos, precios, pagos, horarios, envíos, etapas del pipeline y reglas. Este es el cerebro completo del asistente." />
          <InfoBox type="example">
            <p className="mb-2"><strong>Ejemplo de Base de Conocimiento:</strong></p>
            <CodeBlock text={`# MI NEGOCIO - ASISTENTE VIRTUAL

## 🎭 IDENTIDAD
Eres el asistente virtual de [Tu Negocio].
- Vendedor estratégico y directo
- Hablas natural, humano y cercano
- Siempre usas emojis
- Respuestas cortas, orientado a cerrar ventas

## 🛍️ PRODUCTOS Y PRECIOS
- [Producto A] → $XX.XXX
- [Producto B] → $XX.XXX
(Incluye variantes, tallas, colores)

## 📦 ENVÍOS
- Envío nacional: $12.000 (3-5 días)
- Envío gratis en compras +$200.000

## 💳 MÉTODOS DE PAGO
- Nequi / Daviplata / Transferencia / Contra-entrega

## 🎯 ETAPAS DEL PIPELINE
- Nuevo Contacto → Cliente acaba de escribir
- Interesado → Preguntando por producto
- En Cotización → Revisando precios
- Realizó Pedido → Confirmó compra
- Confirmado → Todo listo

## 📊 DATOS A RECOPILAR
- nombre, teléfono, ciudad (obligatorios)
- dirección, producto, talla, color, método_pago

## ⚠️ REGLAS
- NUNCA inventar precios
- SIEMPRE pedir nombre primero
- Guiar paso a paso hacia la compra`} />
          </InfoBox>
          <SubStep icon={Target} title="3. Define Etapas del Pipeline" description="Las etapas en la base de conocimiento se detectan automáticamente en el CRM." />
          <SubStep icon={Image} title="4. Multimedia (opcional)" description="Sube imágenes, catálogos, PDFs o videos en la pestaña 'Multimedia'. El bot los envía automáticamente cuando un cliente pregunta." />
          <SubStep icon={Mic} title="5. Voz con ElevenLabs (opcional)" description="Conecta ElevenLabs para responder con notas de voz con voz humana personalizada." />
          <SubStep icon={Settings} title="6. Asigna asistente a la línea" description="Ve a WhatsApp → edita tu línea → selecciona el asistente configurado." />
          <InfoBox type="warning"><strong>Después de escribir la base de conocimiento, haz click en &quot;Guardar Todo&quot;</strong> (botón verde). Sin guardar, los cambios se pierden.</InfoBox>
          <div className="pt-2">
            <Link href="/asistentes" className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-500/20 border border-blue-500/30 text-blue-300 rounded-xl text-sm font-semibold hover:bg-blue-500/30 transition">
              <Bot className="w-4 h-4" /> Ir a Asistentes IA <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <NeedHelpBanner step="Configurar Asistente IA" context="No sé cómo escribir la base de conocimiento" />
        </Step>

        {/* ═══════════════════════════════════════════ */}
        {/* PASO 3: CONECTAR OPENAI */}
        {/* ═══════════════════════════════════════════ */}
        <Step number={3} title="Conectar cuenta de OpenAI" description="Conecta tu API Key de OpenAI para que el asistente funcione con inteligencia artificial"
          icon={Key} color="purple" isOpen={openStep === 2} onToggle={() => toggleStep(2)} isRequired>
          <SubStep icon={ArrowRight} title="1. Crea tu cuenta de OpenAI" description="Ve a platform.openai.com/api-keys e inicia sesión con tu cuenta de Google o crea una cuenta gratis." />
          <SubStep icon={Key} title="2. Genera una API Key" description='Haz click en "Create new secret key", ponle un nombre (ej: Bizonne) y copia la key que te genera. Empieza con sk-...' />
          <SubStep icon={Settings} title="3. Pega la API Key en Bizonne" description='Ve a Configuración → pega la API Key en el campo "Nueva API Key" → click en "Guardar API Key".' />
          <SubStep icon={CheckCircle} title="4. Verifica la conexión" description='Si la key es válida, verás "API Key configurada" en verde ✅. ¡Tu asistente IA ya puede responder!' />

          <InfoBox type="tip">
            <div className="flex items-start gap-2">
              <DollarSign className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-white mb-1">💰 ¿Cuánto cuesta OpenAI?</p>
                <p className="text-gray-300">
                  ¡Es super barato! Puedes recargar <strong className="text-emerald-300">desde $5 USD en adelante</strong>. 
                  Con $5 USD puedes tener miles de conversaciones. El cobro es por uso real — solo pagas por los mensajes que el asistente envía. 
                  La mayoría de negocios gastan menos de <strong className="text-emerald-300">$10 USD al mes</strong>.
                </p>
              </div>
            </div>
          </InfoBox>

          <InfoBox type="info">
            <p><strong>¿Cómo recargar?</strong> En platform.openai.com → Settings → Billing → Add payment method. Puedes usar tarjeta de crédito/débito internacional. El mínimo es $5 USD.</p>
          </InfoBox>

          <div className="flex gap-3 pt-2 flex-wrap">
            <Link href="/configuracion" className="inline-flex items-center gap-2 px-5 py-2.5 bg-purple-500/20 border border-purple-500/30 text-purple-300 rounded-xl text-sm font-semibold hover:bg-purple-500/30 transition">
              <Key className="w-4 h-4" /> Ir a Configuración <ArrowRight className="w-4 h-4" />
            </Link>
            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-white/5 border border-white/10 text-gray-300 rounded-xl text-sm font-semibold hover:bg-white/10 transition">
              <Sparkles className="w-4 h-4" /> Ir a OpenAI →
            </a>
          </div>
          <NeedHelpBanner step="Conectar OpenAI" context="No sé cómo crear la cuenta de OpenAI o la API Key" />
        </Step>

        {/* ═══════════════════════════════════════════ */}
        {/* ✅ LISTO — QUÉ PASA DESPUÉS */}
        {/* ═══════════════════════════════════════════ */}
        <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-r from-emerald-500/5 to-cyan-500/5 p-6">
          <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4"><Sparkles className="w-5 h-5 text-emerald-400" /> ¡Listo! ¿Qué pasa después?</h3>
          <div className="space-y-3 text-sm text-gray-300 leading-relaxed">
            {[
              ['🎉', 'Al completar los 3 pasos, tu **asistente de IA empieza a responder automáticamente** por WhatsApp.'],
              ['💬', 'Ve a **Conversaciones** para ver los chats en tiempo real con tus clientes.'],
              ['⏸️', 'Puedes **pausar la IA** en cualquier momento para responder tú personalmente.'],
              ['📊', 'El **Dashboard** te muestra métricas: mensajes, leads, conversiones y más.'],
              ['🎯', 'El **CRM** organiza tus clientes automáticamente por etapas del embudo.'],
              ['📅', 'La **Agenda** registra citas, pedidos y reservas que el bot crea automáticamente.'],
            ].map(([emoji, text], i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="text-lg">{emoji}</span>
                <p dangerouslySetInnerHTML={{ __html: (text as string).replace(/\*\*(.*?)\*\*/g, '<strong class="text-white">$1</strong>') }} />
              </div>
            ))}
          </div>
          <div className="mt-5">
            <Link href="/conversaciones" className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-bold rounded-xl text-sm hover:brightness-110 transition-all hover:shadow-lg hover:shadow-emerald-500/30 hover:scale-[1.02]">
              <MessageSquare className="w-5 h-5" /> Ir a Conversaciones <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* ═══════════════════════════════════════════ */}
        {/* FUNCIONES ADICIONALES */}
        {/* ═══════════════════════════════════════════ */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-sm p-6">
          <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4"><Star className="w-5 h-5 text-amber-400" /> Funciones Adicionales</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              { icon: BarChart3, color: 'emerald', title: 'Dashboard Analítico', desc: 'Métricas en tiempo real: mensajes, pipeline, lead scoring, actividad.', href: '/dashboard' },
              { icon: Target, color: 'purple', title: 'CRM y Pipeline', desc: 'Pipeline automático con lead scoring 🔥🟡🔵. Etapas del embudo.', href: '/crm' },
              { icon: Calendar, color: 'orange', title: 'Agenda', desc: 'Citas, pedidos y reservas creados automáticamente por la IA.', href: '/agenda' },
              { icon: Bell, color: 'cyan', title: 'Mensajes Programados', desc: 'Programa mensajes y seguimientos automáticos.', href: '/programados' },
              { icon: Shield, color: 'blue', title: 'Equipo y Roles', desc: 'Invita vendedores, soporte y gerentes con permisos por rol.', href: '/equipo' },
              { icon: Brain, color: 'purple', title: 'Auto-Aprendizaje', desc: 'El asistente sugiere mejoras basadas en conversaciones reales.', href: '/asistentes' },
              { icon: Package, color: 'pink', title: 'Productos', desc: 'Catálogo con precios, stock y categorías consultable por la IA.', href: '/crm' },
              { icon: Send, color: 'emerald', title: 'Mensajes Masivos', desc: 'Envía mensajes a todos los contactos de una etapa o clientes.', href: '/crm' },
              { icon: Download, color: 'cyan', title: 'Exportar Excel', desc: 'Descarga clientes como Excel profesional.', href: '/crm' },
              { icon: Upload, color: 'amber', title: 'Importar CSV', desc: 'Sube contactos masivamente desde un archivo CSV.', href: '/crm' },
              { icon: Globe, color: 'indigo', title: 'Integraciones', desc: 'Google Calendar, GoHighLevel, webhooks y APIs.', href: '/integraciones' },
              { icon: Paintbrush, color: 'pink', title: 'Personalización', desc: 'Fondo de pantalla, app PWA instalable en celular y escritorio.' },
            ].map((f, i) => (
              <div key={i} className="p-4 rounded-xl bg-white/5 border border-white/5">
                <div className="flex items-center gap-2 mb-2">
                  <f.icon className={`w-4 h-4 text-${f.color}-400`} />
                  <span className="text-sm font-semibold text-white">{f.title}</span>
                </div>
                <p className="text-xs text-gray-500">{f.desc}</p>
                {f.href && <Link href={f.href} className={`text-[10px] text-${f.color}-400 mt-2 inline-block hover:underline`}>Ir →</Link>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ BANNER IMPLEMENTACIÓN ═══ */}
      <div className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-rose-500/10">
        <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-bl from-amber-500/20 to-transparent rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-gradient-to-tr from-orange-500/15 to-transparent rounded-full blur-3xl" />
        <div className="relative p-6 md:p-8">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/30 to-orange-500/30 flex items-center justify-center border border-amber-500/30">
              <Zap className="w-5 h-5 text-amber-400" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400 bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20">Servicio Premium</span>
          </div>
          <h3 className="text-xl md:text-2xl font-black text-white mb-2">¿No tienes tiempo o no sabes cómo configurar?</h3>
          <p className="text-gray-400 text-sm leading-relaxed mb-4">
            Nuestro equipo configura <strong className="text-white">toda la plataforma por ti</strong>: asistente IA, pipeline, triggers, multimedia y toda la automatización.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
            {['Asistente IA a tu medida', 'Pipeline personalizado', 'Triggers y automatización', 'Multimedia incluida', 'Capacitación videollamada', 'Soporte 30 días', 'Base de conocimiento optimizada', 'Garantía de funcionamiento'].map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-gray-300">
                <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" /><span>{item}</span>
              </div>
            ))}
          </div>
          <a href={`https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent('¡Hola! Me interesa la implementación de Bizonne para mi negocio. Quiero agendar una videollamada 🚀')}`}
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold rounded-xl text-sm hover:brightness-110 transition-all hover:shadow-lg hover:shadow-amber-500/30 hover:scale-[1.02]">
            <Phone className="w-5 h-5" /> Agendar Videollamada Gratis <ArrowRight className="w-4 h-4" />
          </a>
          <p className="text-[10px] text-gray-600 mt-2">Sin compromiso. Te contactamos por WhatsApp.</p>
        </div>
      </div>

      {/* Soporte */}
      <div className="bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 rounded-2xl border border-emerald-500/20 p-6">
        <div className="flex flex-col md:flex-row items-center gap-6">
          <div className="w-16 h-16 bg-emerald-500/20 rounded-2xl flex items-center justify-center flex-shrink-0">
            <MessageSquare className="w-8 h-8 text-emerald-400" />
          </div>
          <div className="flex-1 text-center md:text-left">
            <h3 className="text-xl font-bold text-white mb-1">¿Necesitas ayuda?</h3>
            <p className="text-gray-400 text-sm">Escríbenos por WhatsApp o usa el Chat en Vivo.</p>
          </div>
          <div className="flex gap-3 flex-shrink-0">
            <a href={`https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent('Hola! Necesito ayuda con Bizonne 🤖')}`}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-5 py-3 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 rounded-xl font-bold text-sm hover:bg-emerald-500/30 transition">
              <Phone className="w-4 h-4" /> WhatsApp
            </a>
            <button onClick={() => window.dispatchEvent(new Event('openLiveChat'))}
              className="flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-xl font-bold text-sm hover:brightness-110 transition-all hover:shadow-lg hover:shadow-cyan-500/30">
              <MessageSquare className="w-4 h-4" /> Chat en Vivo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
