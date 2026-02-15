'use client';
import { useState } from 'react';
import Link from 'next/link';
import { 
  BookOpen, Smartphone, Bot, Users, Calendar, MessageSquare,
  ChevronRight, ChevronDown, CheckCircle, Circle, ArrowRight,
  Wifi, Settings, Zap, Shield, Star, HelpCircle, Phone,
  BarChart3, Tag, UserPlus, FileText, Image, Mic,
  Target, Layers, Bell, Send, ExternalLink, Copy, Check
} from 'lucide-react';

const SUPPORT_WHATSAPP = '573213815105'; // Número de soporte

interface StepProps {
  number: number;
  title: string;
  description: string;
  icon: any;
  color: string;
  children: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  isCompleted?: boolean;
}

function Step({ number, title, description, icon: Icon, color, children, isOpen, onToggle, isCompleted }: StepProps) {
  return (
    <div className={`rounded-2xl border transition-all ${isOpen ? `bg-${color}-500/5 border-${color}-500/30 shadow-lg` : 'bg-white/[0.04] border-white/10 hover:border-white/20 backdrop-blur-sm'}`}>
      <button onClick={onToggle} className="w-full flex items-center gap-4 p-5 text-left">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
          isCompleted ? 'bg-emerald-500/20' : `bg-${color}-500/20`
        }`}>
          {isCompleted ? (
            <CheckCircle className="w-6 h-6 text-emerald-400" />
          ) : (
            <Icon className={`w-6 h-6 text-${color}-400`} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold uppercase tracking-wider ${isCompleted ? 'text-emerald-400' : `text-${color}-400`}`}>Paso {number}</span>
            {isCompleted && <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full">Completado</span>}
          </div>
          <h3 className="text-lg font-bold text-white mt-0.5">{title}</h3>
          <p className="text-sm text-gray-500 mt-0.5">{description}</p>
        </div>
        <ChevronDown className={`w-5 h-5 text-gray-500 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      
      {isOpen && (
        <div className="px-5 pb-6 pt-0">
          <div className="ml-16 space-y-4">
            {children}
          </div>
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
      <div>
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function InfoBox({ type = 'info', children }: { type?: 'info' | 'warning' | 'tip' | 'example'; children: React.ReactNode }) {
  const styles = {
    info: { bg: 'bg-blue-500/10', border: 'border-blue-500/20', icon: HelpCircle, color: 'text-blue-400', label: 'ℹ️ Información' },
    warning: { bg: 'bg-amber-500/10', border: 'border-amber-500/20', icon: Bell, color: 'text-amber-400', label: '⚠️ Importante' },
    tip: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', icon: Zap, color: 'text-emerald-400', label: '💡 Tip' },
    example: { bg: 'bg-purple-500/10', border: 'border-purple-500/20', icon: FileText, color: 'text-purple-400', label: '📋 Ejemplo' }
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

export default function GuiaPage() {
  const [openStep, setOpenStep] = useState(0);

  const toggleStep = (index: number) => {
    setOpenStep(openStep === index ? -1 : index);
  };

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
        <p className="text-gray-400 text-lg max-w-xl mx-auto">
          Configura tu asistente de IA paso a paso y empieza a automatizar tu negocio por WhatsApp
        </p>
        <div className="flex items-center justify-center gap-4 mt-6">
          <span className="text-xs text-gray-600 flex items-center gap-1.5">
            <Circle className="w-3 h-3" /> 5 pasos
          </span>
          <span className="text-xs text-gray-600">•</span>
          <span className="text-xs text-gray-600 flex items-center gap-1.5">
            <Circle className="w-3 h-3" /> ~15 minutos
          </span>
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-4">
        
        {/* ===== PASO 1: CONECTAR WHATSAPP ===== */}
        <Step
          number={1}
          title="Conectar WhatsApp"
          description="Vincula tu número de WhatsApp para que el asistente pueda responder"
          icon={Smartphone}
          color="emerald"
          isOpen={openStep === 0}
          onToggle={() => toggleStep(0)}>
          
          <SubStep icon={ArrowRight} title="1. Ve a la sección WhatsApp" 
            description="En el menú lateral haz click en 'WhatsApp'. Verás tu panel de líneas." />
          
          <SubStep icon={Wifi} title="2. Escanea el código QR" 
            description="Haz click en 'Conectar' y te aparecerá un código QR. Abre WhatsApp en tu celular → Menú (⋮) → Dispositivos vinculados → Vincular dispositivo → Escanea el QR." />
          
          <SubStep icon={CheckCircle} title="3. Confirma la conexión" 
            description="Espera unos segundos y verás el estado cambiar a 'Conectado' en verde. ¡Tu línea ya está lista!" />

          <InfoBox type="tip">
            <strong>Multi-línea:</strong> Si tienes el plan Business puedes agregar líneas ilimitadas con el botón <strong>+ Nueva Línea</strong>. Cada línea puede tener su propio asistente IA y número de WhatsApp.
          </InfoBox>

          <InfoBox type="warning">
            No cierres sesión en tu celular. La conexión se mantiene mientras tu WhatsApp esté vinculado. Si pierdes conexión, simplemente vuelve a escanear el QR.
          </InfoBox>

          <div className="pt-2">
            <Link href="/whatsapp" className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 rounded-xl text-sm font-semibold hover:bg-emerald-500/30 transition">
              <Smartphone className="w-4 h-4" /> Ir a WhatsApp <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </Step>

        {/* ===== PASO 2: CONFIGURAR ASISTENTE IA ===== */}
        <Step
          number={2}
          title="Configurar el Asistente de IA"
          description="Personaliza cómo responde tu agente virtual con toda la información de tu negocio"
          icon={Bot}
          color="blue"
          isOpen={openStep === 1}
          onToggle={() => toggleStep(1)}>
          
          <SubStep icon={ArrowRight} title="1. Ve a Asistentes IA" 
            description="En el menú lateral haz click en 'Asistentes IA'. Verás el editor del asistente." />
          
          <SubStep icon={FileText} title="2. Escribe la Base de Conocimiento" 
            description="Este es el cerebro de tu asistente. Escribe TODO sobre tu negocio: productos, precios, métodos de pago, horarios, envíos, promociones, etc." />

          <InfoBox type="info">
            Puedes usar formato <strong>Markdown</strong> (recomendado) o <strong>JSON</strong>. El formato Markdown es más fácil de escribir y entender.
          </InfoBox>

          <InfoBox type="example">
            <p className="mb-2"><strong>Ejemplo de Base de Conocimiento (adaptable a cualquier negocio):</strong></p>
            <CodeBlock text={`# MI NEGOCIO - ASISTENTE VIRTUAL

## 🎭 IDENTIDAD
Eres el asistente virtual de **[Tu Negocio]**.

**Tu personalidad:**
- Vendedor estratégico y directo
- Hablas natural, humano y cercano
- Siempre usas emojis
- Respuestas cortas en líneas separadas
- Orientado a cerrar ventas / agendar citas

## 🛍️ PRODUCTOS / SERVICIOS Y PRECIOS
- [Producto/Servicio A] → $XX.XXX
- [Producto/Servicio B] → $XX.XXX
- [Producto/Servicio C] → $XX.XXX

## 📦 ENVÍOS / ENTREGAS
- Envío nacional: $12.000 (3-5 días)
- Envío gratis en compras +$200.000
- (O si es servicio: agenda de citas disponibles)

## 💳 MÉTODOS DE PAGO
- Efectivo / Nequi / Daviplata
- Transferencia bancaria
- Tarjeta (+5% recargo)
- Contra-entrega

## 🎯 ETAPAS DEL PIPELINE
- Nuevo Contacto → Cliente escribió
- Interesado → Preguntando por producto/servicio
- En Cotización → Revisando precios
- Realizó Pedido → Confirmó compra/cita
- Confirmado → Todo listo
- Perdido → No le interesó

## ⚠️ REGLAS
- NUNCA inventar precios
- SIEMPRE pedir nombre del cliente
- Guiar hacia la compra/cita paso a paso`} />
          </InfoBox>

          <SubStep icon={Target} title="3. Configura las Etapas del CRM" 
            description="Las etapas definen el flujo de venta. El asistente detecta automáticamente en qué etapa está cada cliente y lo mueve por el embudo." />

          <InfoBox type="tip">
            Puedes hacer click en <strong>"Detectar Etapas"</strong> en el CRM y el sistema leerá tu base de conocimiento para crear las etapas automáticamente. O puedes definirlas manualmente.
          </InfoBox>

          <SubStep icon={Image} title="4. Agrega Multimedia (opcional)" 
            description="Ve a la pestaña 'Multimedia' para subir imágenes de productos, catálogos o videos. El bot puede enviarlos cuando un cliente pregunte." />

          <SubStep icon={Mic} title="5. Voz con ElevenLabs (opcional)" 
            description="En la pestaña 'Voz' puedes conectar ElevenLabs para que el asistente envíe notas de voz con una voz personalizada." />

          <SubStep icon={Settings} title="6. Asigna el asistente a una línea" 
            description="Ve a WhatsApp → en la tarjeta de tu línea verás un ícono de lápiz. Edita la línea y selecciona el asistente que acabas de configurar." />

          <InfoBox type="warning">
            <strong>Importante:</strong> Después de escribir tu base de conocimiento, haz click en <strong>"Guardar Todo"</strong> (botón verde arriba a la derecha). Sin guardar, los cambios se pierden.
          </InfoBox>

          <div className="pt-2">
            <Link href="/asistentes" className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-500/20 border border-blue-500/30 text-blue-300 rounded-xl text-sm font-semibold hover:bg-blue-500/30 transition">
              <Bot className="w-4 h-4" /> Ir a Asistentes IA <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </Step>

        {/* ===== PASO 3: CRM Y EMBUDO ===== */}
        <Step
          number={3}
          title="CRM y Embudo de Ventas"
          description="Gestiona tus clientes, pipeline y seguimiento automático"
          icon={Users}
          color="purple"
          isOpen={openStep === 2}
          onToggle={() => toggleStep(2)}>

          <SubStep icon={Layers} title="1. Entiende el Pipeline" 
            description="El CRM muestra todos tus chats organizados por etapas. Cada contacto se mueve automáticamente según la conversación con el bot." />

          <InfoBox type="example">
            <p className="mb-2"><strong>Flujo automático del Pipeline (ejemplo genérico):</strong></p>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-gray-400" /> <strong>Nuevo Contacto</strong> → Cliente acaba de escribir</div>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-400" /> <strong>Interesado</strong> → Ya dio su nombre, preguntando por el producto/servicio</div>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-cyan-400" /> <strong>En Cotización</strong> → Preguntando precios, opciones, detalles</div>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-yellow-400" /> <strong>Pendiente Datos</strong> → Falta información para completar</div>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-orange-400" /> <strong>Realizó Pedido</strong> → Confirmó que quiere comprar/agendar</div>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-pink-400" /> <strong>Pendiente Pago</strong> → Eligiendo método de pago</div>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-400" /> <strong>Confirmado</strong> → Pedido o cita completa</div>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-400" /> <strong>Perdido</strong> → No le interesó o no respondió</div>
            </div>
            <p className="text-[10px] text-gray-500 mt-2 italic">💡 Estas etapas se adaptan a tu negocio. Puedes personalizarlas desde el CRM.</p>
          </InfoBox>

          <SubStep icon={Target} title="2. Detectar Etapas automáticamente" 
            description="Haz click en 'Detectar Etapas' en el CRM. El sistema lee tu base de conocimiento del asistente y crea las etapas del embudo automáticamente." />

          <SubStep icon={Users} title="3. Pestaña 'Clientes'" 
            description="Aquí se guardan los contactos como clientes formales con nombre, teléfono, email, dirección y notas. Puedes crear clientes manualmente o se crean desde las conversaciones." />

          <SubStep icon={Tag} title="4. Pestaña 'Productos'" 
            description="Si vendes productos, agrégalos aquí con nombre, precio, imagen y stock. El asistente puede consultarlos para dar información precisa." />

          <SubStep icon={BarChart3} title="5. Filtrar y buscar" 
            description="Usa los filtros de etapas arriba del pipeline para ver solo los clientes en cierta fase. La barra de búsqueda encuentra contactos por nombre." />

          <InfoBox type="tip">
            Activa el <strong>Auto-refresh</strong> (botón verde arriba a la derecha) para que el pipeline se actualice solo cada pocos segundos sin recargar la página.
          </InfoBox>

          <div className="pt-2">
            <Link href="/crm" className="inline-flex items-center gap-2 px-5 py-2.5 bg-purple-500/20 border border-purple-500/30 text-purple-300 rounded-xl text-sm font-semibold hover:bg-purple-500/30 transition">
              <Users className="w-4 h-4" /> Ir al CRM <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </Step>

        {/* ===== PASO 4: CONVERSACIONES ===== */}
        <Step
          number={4}
          title="Gestionar Conversaciones"
          description="Monitorea los chats, pausa la IA y responde manualmente cuando necesites"
          icon={MessageSquare}
          color="cyan"
          isOpen={openStep === 3}
          onToggle={() => toggleStep(3)}>

          <SubStep icon={MessageSquare} title="1. Panel de Conversaciones" 
            description="Aquí ves todos los chats en tiempo real. A la izquierda la lista de contactos, a la derecha el chat completo con el historial de mensajes." />

          <SubStep icon={Bot} title="2. Pausar/Reactivar IA" 
            description="Si necesitas responder personalmente, haz click en 'Pausar IA' en el chat. El bot dejará de responder y tú puedes escribir directamente. Cuando termines, reactívalo." />

          <SubStep icon={UserPlus} title="3. Asignar a un vendedor" 
            description="Con el plan Business puedes asignar chats a miembros de tu equipo. El vendedor asignado recibirá las notificaciones de ese chat." />

          <SubStep icon={Send} title="4. Enviar mensajes manuales" 
            description="Escribe en el campo de texto abajo del chat y presiona Enter o el botón de enviar. Puedes enviar texto, imágenes y archivos." />

          <InfoBox type="info">
            Los mensajes del bot aparecen con un ícono de robot 🤖 y los mensajes manuales con tu avatar. El cliente no distingue quién escribe.
          </InfoBox>

          <div className="pt-2">
            <Link href="/conversaciones" className="inline-flex items-center gap-2 px-5 py-2.5 bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 rounded-xl text-sm font-semibold hover:bg-cyan-500/30 transition">
              <MessageSquare className="w-4 h-4" /> Ir a Conversaciones <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </Step>

        {/* ===== PASO 5: AGENDA Y CITAS ===== */}
        <Step
          number={5}
          title="Agenda y Citas"
          description="Programa citas, seguimientos y pedidos con tu calendario integrado"
          icon={Calendar}
          color="orange"
          isOpen={openStep === 4}
          onToggle={() => toggleStep(4)}>

          <SubStep icon={Calendar} title="1. Crear citas" 
            description="Haz click en '+ Nueva Cita'. Selecciona el cliente, tipo de cita (consulta, pedido, seguimiento), fecha, hora y notas." />

          <SubStep icon={Bell} title="2. Estados de citas" 
            description="Las citas pueden estar: Pendiente (amarillo), Confirmada (verde), Completada (azul) o Cancelada (rojo). Actualiza el estado según avance." />

          <SubStep icon={Users} title="3. Vincular con CRM" 
            description="Al crear una cita puedes vincularla a un cliente del CRM. Así tienes el historial completo: chat + datos + citas en un solo lugar." />

          <InfoBox type="tip">
            El asistente de IA puede programar citas automáticamente si lo configuras en la base de conocimiento. Incluye frases como: "Si el cliente quiere agendar, pide fecha y hora preferida".
          </InfoBox>

          <div className="pt-2">
            <Link href="/agenda" className="inline-flex items-center gap-2 px-5 py-2.5 bg-orange-500/20 border border-orange-500/30 text-orange-300 rounded-xl text-sm font-semibold hover:bg-orange-500/30 transition">
              <Calendar className="w-4 h-4" /> Ir a Agenda <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </Step>

        {/* ===== FUNCIONES ADICIONALES ===== */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-sm p-6">
          <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
            <Star className="w-5 h-5 text-amber-400" /> Funciones Adicionales
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-4 rounded-xl bg-white/5 border border-white/5">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-semibold text-white">Equipo y Roles</span>
              </div>
              <p className="text-xs text-gray-500">Invita vendedores, soporte y gerentes. Asigna permisos por rol para controlar qué puede ver cada uno.</p>
              <Link href="/equipo" className="text-[10px] text-blue-400 mt-2 inline-block hover:underline">Ir a Equipo →</Link>
            </div>
            <div className="p-4 rounded-xl bg-white/5 border border-white/5">
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-semibold text-white">Dashboard</span>
              </div>
              <p className="text-xs text-gray-500">Ve métricas en tiempo real: mensajes, conversaciones, embudo de ventas y actividad semanal.</p>
              <Link href="/dashboard" className="text-[10px] text-emerald-400 mt-2 inline-block hover:underline">Ir a Dashboard →</Link>
            </div>
            <div className="p-4 rounded-xl bg-white/5 border border-white/5">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-semibold text-white">Auto-Aprendizaje</span>
              </div>
              <p className="text-xs text-gray-500">El asistente sugiere mejoras basadas en conversaciones reales. Aprueba o rechaza sugerencias desde la pestaña Auto-Aprendizaje.</p>
            </div>
            <div className="p-4 rounded-xl bg-white/5 border border-white/5">
              <div className="flex items-center gap-2 mb-2">
                <Settings className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-semibold text-white">Configuración</span>
              </div>
              <p className="text-xs text-gray-500">Personaliza tu perfil, cambia contraseña y conecta tu API Key de OpenAI para el funcionamiento del asistente.</p>
              <Link href="/configuracion" className="text-[10px] text-gray-400 mt-2 inline-block hover:underline">Ir a Configuración →</Link>
            </div>
          </div>
        </div>
      </div>

      {/* ===== 🚀 BANNER IMPLEMENTACIÓN PROFESIONAL ===== */}
      <div className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-rose-500/10">
        {/* Efecto decorativo */}
        <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-bl from-amber-500/20 to-transparent rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-gradient-to-tr from-orange-500/15 to-transparent rounded-full blur-3xl" />
        
        <div className="relative p-6 md:p-8">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/30 to-orange-500/30 flex items-center justify-center border border-amber-500/30">
                  <Zap className="w-5 h-5 text-amber-400" />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400 bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20">Servicio Premium</span>
              </div>
              
              <h3 className="text-xl md:text-2xl font-black text-white mb-2">
                ¿No tienes tiempo o no sabes cómo configurar tu asistente?
              </h3>
              <p className="text-gray-400 text-sm leading-relaxed mb-4">
                Nuestro equipo de expertos configura <strong className="text-white">toda la plataforma por ti</strong>. 
                Te creamos el asistente de IA perfecto para tu negocio, con tu embudo de ventas, 
                multimedia y toda la automatización funcionando.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
                <div className="flex items-center gap-2 text-xs text-gray-300">
                  <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <span>Asistente IA configurado a tu medida</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-300">
                  <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <span>Pipeline y CRM personalizado</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-300">
                  <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <span>Multimedia y catálogos incluidos</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-300">
                  <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <span>Capacitación por videollamada</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-300">
                  <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <span>Soporte prioritario 30 días</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-300">
                  <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <span>Garantía de funcionamiento</span>
                </div>
              </div>

              <a href={`https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent('¡Hola! Me interesa el servicio de implementación de Bizonne para mi negocio. Quiero agendar una videollamada para conocer los detalles y garantías 🚀')}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold rounded-xl text-sm hover:brightness-110 transition-all hover:shadow-lg hover:shadow-amber-500/30 hover:scale-[1.02]">
                <Phone className="w-5 h-5" /> Agendar Videollamada Gratis
                <ArrowRight className="w-4 h-4" />
              </a>
              <p className="text-[10px] text-gray-600 mt-2">Te contactamos por WhatsApp para programar la reunión. Sin compromiso.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Soporte */}
      <div className="bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 rounded-2xl border border-emerald-500/20 p-6">
        <div className="flex flex-col md:flex-row items-center gap-6">
          <div className="w-16 h-16 bg-emerald-500/20 rounded-2xl flex items-center justify-center flex-shrink-0">
            <HelpCircle className="w-8 h-8 text-emerald-400" />
          </div>
          <div className="flex-1 text-center md:text-left">
            <h3 className="text-xl font-bold text-white mb-1">¿Necesitas ayuda?</h3>
            <p className="text-gray-400 text-sm">
              Nuestro equipo de soporte está disponible para ayudarte con la configuración. Escríbenos por WhatsApp y te guiamos paso a paso.
            </p>
          </div>
          <div className="flex gap-3 flex-shrink-0">
            <a href={`https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent('Hola! Necesito ayuda con mi cuenta de Bizonne 🤖')}`}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-5 py-3 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 rounded-xl font-bold text-sm hover:bg-emerald-500/30 transition">
              <Phone className="w-4 h-4" /> WhatsApp
            </a>
            <button
              onClick={() => window.dispatchEvent(new Event('openLiveChat'))}
              className="flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-xl font-bold text-sm hover:brightness-110 transition-all hover:shadow-lg hover:shadow-cyan-500/30">
              <MessageSquare className="w-4 h-4" /> Chat en Vivo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
