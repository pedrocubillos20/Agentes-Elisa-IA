'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  BookOpen, Smartphone, Bot, Users, Calendar, MessageSquare,
  ChevronRight, ChevronDown, CheckCircle, Circle, ArrowRight,
  Wifi, Settings, Zap, Shield, Star, HelpCircle, Phone,
  BarChart3, Tag, UserPlus, FileText, Image, Mic,
  Target, Layers, Bell, Send, ExternalLink, Copy, Check,
  Flame, TrendingUp, Download, Upload, Package, Search,
  Filter, Sparkles, Brain, Clock, AlertTriangle, RefreshCw,
  LayoutGrid, Paintbrush, Key, CreditCard, Crown, Lock,
  Rocket, MessageCircle, Hash, Globe, Database, Code
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
  isCompleted?: boolean;
  isNew?: boolean;
}

function Step({ number, title, description, icon: Icon, color, children, isOpen, onToggle, isCompleted, isNew }: StepProps) {
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
            {isNew && <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full animate-pulse">✨ Nuevo</span>}
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

function SubStep({ icon: Icon, title, description, isNew }: { icon: any; title: string; description: string; isNew?: boolean }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.06] border border-white/[0.08]">
      <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-gray-400" />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-white">{title}</p>
          {isNew && <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded-full">Nuevo</span>}
        </div>
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
    important: { bg: 'bg-red-500/10', border: 'border-red-500/20', color: 'text-red-400', label: '🔴 Crítico' }
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
          <span className="text-xs text-gray-600 flex items-center gap-1.5"><Circle className="w-3 h-3" /> 5 pasos</span>
          <span className="text-xs text-gray-600">•</span>
          <span className="text-xs text-gray-600 flex items-center gap-1.5"><Clock className="w-3 h-3" /> ~15 minutos</span>
          <span className="text-xs text-gray-600">•</span>
          <span className="text-xs text-amber-400 flex items-center gap-1.5"><Sparkles className="w-3 h-3" /> Actualizado</span>
        </div>
      </div>

      {/* Key concept */}
      <div className="rounded-2xl bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20 p-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center flex-shrink-0">
            <Brain className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white mb-1">🧠 La Base de Conocimiento es el cerebro de todo</h3>
            <p className="text-sm text-gray-400 leading-relaxed">
              Todo en Bizonne se configura desde la <strong className="text-white">Base de Conocimiento</strong> de tu asistente IA: 
              las etapas del pipeline, los triggers automáticos, el CRM, agendamiento, pedidos y reservas. 
              <strong className="text-blue-300"> Un prompt preciso con toda la información = un asistente perfecto.</strong>
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {/* ===== PASO 1: CONECTAR WHATSAPP ===== */}
        <Step number={1} title="Conectar WhatsApp" description="Vincula tu número de WhatsApp para que el asistente pueda responder"
          icon={Smartphone} color="emerald" isOpen={openStep === 0} onToggle={() => toggleStep(0)}>
          <SubStep icon={ArrowRight} title="1. Ve a la sección WhatsApp" description="En el menú lateral haz click en 'WhatsApp'. Verás tu panel de líneas. Si no tienes línea, haz click en '+ Nueva Línea'." />
          <SubStep icon={Wifi} title="2. Escanea el código QR" description="Haz click en 'Conectar' y te aparecerá un código QR. Abre WhatsApp en tu celular → Menú (⋮) → Dispositivos vinculados → Vincular dispositivo → Escanea el QR." />
          <SubStep icon={CheckCircle} title="3. Confirma la conexión" description="Espera unos segundos y verás el estado cambiar a 'Conectado' en verde. ¡Tu línea ya está lista!" />
          <InfoBox type="tip"><strong>Multi-línea:</strong> Con el plan Business puedes agregar líneas ilimitadas. Cada línea tiene su propio asistente IA y número de WhatsApp.</InfoBox>
          <InfoBox type="warning">No cierres sesión en tu celular. Si pierdes conexión, simplemente vuelve a escanear el QR.</InfoBox>
          <div className="pt-2">
            <Link href="/whatsapp" className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 rounded-xl text-sm font-semibold hover:bg-emerald-500/30 transition">
              <Smartphone className="w-4 h-4" /> Ir a WhatsApp <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <NeedHelpBanner step="Conectar WhatsApp" context="No logro vincular mi número" />
        </Step>

        {/* ===== PASO 2: BASE DE CONOCIMIENTO ===== */}
        <Step number={2} title="Configurar el Asistente de IA" description="La base de conocimiento define TODO: pipeline, triggers, CRM, agendamiento, pedidos"
          icon={Bot} color="blue" isOpen={openStep === 1} onToggle={() => toggleStep(1)}>
          <InfoBox type="important"><strong>Este es el paso más importante.</strong> La base de conocimiento define cómo responde el bot, las etapas del CRM, qué datos recopila, cuándo envía multimedia, triggers, agendamiento y pedidos. Mientras más preciso y completo, mejor funciona todo.</InfoBox>
          <SubStep icon={ArrowRight} title="1. Ve a Asistentes IA" description="En el menú lateral haz click en 'Asistentes IA'. Verás el editor con pestañas: Base de Conocimiento, Multimedia, Auto-Aprendizaje y Voz." />
          <SubStep icon={FileText} title="2. Escribe la Base de Conocimiento" description="Escribe TODO sobre tu negocio: identidad, productos, precios, pagos, horarios, envíos, etapas del pipeline, triggers y reglas. Este es el cerebro completo del asistente." />
          <InfoBox type="example">
            <p className="mb-2"><strong>Ejemplo de Base de Conocimiento COMPLETA:</strong></p>
            <CodeBlock text={`# MI NEGOCIO - ASISTENTE VIRTUAL

## 🎭 IDENTIDAD
Eres el asistente virtual de **[Tu Negocio]**.
- Vendedor estratégico y directo
- Hablas natural, humano y cercano
- Siempre usas emojis
- Respuestas cortas, orientado a cerrar ventas

## 🛍️ PRODUCTOS / SERVICIOS Y PRECIOS
- [Producto A] → $XX.XXX
- [Producto B] → $XX.XXX
(Incluye variantes, tallas, colores, planes)

## 📦 ENVÍOS / ENTREGAS
- Envío nacional: $12.000 (3-5 días)
- Envío gratis en compras +$200.000

## 💳 MÉTODOS DE PAGO
- Nequi / Daviplata / Transferencia / Contra-entrega

## 🎯 ETAPAS DEL PIPELINE (CRM)
- Nuevo Contacto → Cliente acaba de escribir
- Interesado → Preguntando por producto
- En Cotización → Revisando precios
- Pendiente Datos → Falta info (talla, color, ciudad)
- Realizó Pedido → Confirmó compra
- Confirmado → Todo listo
- Perdido → No le interesó

## 🔄 TRIGGERS AUTOMÁTICOS
- Saludo → Presentarse y preguntar en qué ayudar
- Precio → Enviar catálogo de precios
- Pedido confirmado → Pedir datos de envío
- "catálogo" → Enviar imágenes de productos

## 📅 AGENDAMIENTO (si aplica)
- Horarios: Lunes a Viernes 9am-6pm
- Tipos: Consulta / Asesoría / Reunión
- Pedir: fecha, hora, nombre, teléfono

## 📊 DATOS A RECOPILAR
- nombre, teléfono, ciudad (obligatorios)
- dirección, producto, talla, color, método_pago

## ⚠️ REGLAS
- NUNCA inventar precios
- SIEMPRE pedir nombre primero
- Guiar paso a paso hacia la compra/cita`} />
          </InfoBox>
          <SubStep icon={Target} title="3. Define Etapas del Pipeline" description="Las etapas en la base de conocimiento se detectan automáticamente. El CRM las usa para organizar conversaciones." isNew />
          <SubStep icon={Zap} title="4. Define Triggers Automáticos" description="Acciones automáticas: enviar imagen al preguntar catálogo, mover etapa al confirmar pedido, etc." isNew />
          <SubStep icon={Image} title="5. Multimedia (opcional)" description="Sube imágenes, catálogos, PDFs o videos en la pestaña 'Multimedia'. El bot los envía cuando un cliente pregunta." />
          <SubStep icon={Mic} title="6. Voz con ElevenLabs (opcional)" description="Conecta ElevenLabs para notas de voz con voz humana personalizada." />
          <SubStep icon={Brain} title="7. Auto-Aprendizaje" description="El asistente analiza conversaciones reales y sugiere mejoras. Aprueba o rechaza cada sugerencia." isNew />
          <SubStep icon={Settings} title="8. Asigna asistente a la línea" description="Ve a WhatsApp → edita tu línea → selecciona el asistente configurado." />
          <InfoBox type="warning"><strong>Después de escribir la base de conocimiento, haz click en "Guardar Todo"</strong> (botón verde). Sin guardar, los cambios se pierden.</InfoBox>
          <div className="pt-2">
            <Link href="/asistentes" className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-500/20 border border-blue-500/30 text-blue-300 rounded-xl text-sm font-semibold hover:bg-blue-500/30 transition">
              <Bot className="w-4 h-4" /> Ir a Asistentes IA <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <NeedHelpBanner step="Configurar Asistente IA" context="No sé cómo escribir la base de conocimiento" />
        </Step>

        {/* ===== PASO 3: CRM + LEAD SCORING ===== */}
        <Step number={3} title="CRM, Pipeline y Lead Scoring" description="Pipeline automático, leads 🔥🟡🔵, clientes, productos, mensajes masivos y exportación"
          icon={Target} color="purple" isOpen={openStep === 2} onToggle={() => toggleStep(2)} isNew>
          <InfoBox type="info">El CRM se alimenta de la <strong>Base de Conocimiento</strong>. Etapas, datos y calificación de leads — todo se genera desde tu configuración del asistente.</InfoBox>
          <SubStep icon={Layers} title="1. Pipeline Automático" description="Conversaciones organizadas por etapas. El bot mueve cada contacto automáticamente por el embudo según la conversación." isNew />
          <SubStep icon={Sparkles} title="2. Detectar Etapas" description="Click en 'Detectar Etapas' en el CRM. Lee la base de conocimiento y crea etapas automáticamente. También se sincronizan cada 60 segundos." isNew />
          <InfoBox type="example">
            <p className="mb-2"><strong>Flujo del Pipeline:</strong></p>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-gray-400" /> <strong>Nuevo Contacto</strong> → Acaba de escribir</div>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-400" /> <strong>Interesado</strong> → Preguntando</div>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-cyan-400" /> <strong>Cotización</strong> → Revisando precios</div>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-yellow-400" /> <strong>Pendiente</strong> → Falta info</div>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-orange-400" /> <strong>Pedido</strong> → Confirmó compra</div>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-400" /> <strong>Confirmado</strong> → Listo</div>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-400" /> <strong>Perdido</strong> → No interesó</div>
            </div>
            <p className="text-[10px] text-gray-500 mt-2 italic">💡 Se adaptan a TU negocio según la base de conocimiento.</p>
          </InfoBox>
          <SubStep icon={Flame} title="3. Lead Scoring (🔥 Caliente / 🟡 Tibio / 🔵 Frío)" description="Puntuación 0-100 basada en: avance en embudo, datos recopilados, actividad reciente y completitud. Prioriza leads calientes para cerrar." isNew />
          <SubStep icon={Users} title="4. Clientes" description="Contactos formales con nombre, teléfono, email, dirección, notas y etiquetas (VIP, Frecuente)." />
          <SubStep icon={Send} title="5. Mensajes Masivos" description="Envía texto, imágenes, audios o archivos a todos los contactos de una etapa o a todos tus clientes." isNew />
          <SubStep icon={Download} title="6. Exportar a Excel" description="Descarga clientes como Excel profesional con colores y resumen." isNew />
          <SubStep icon={Upload} title="7. Importar CSV" description="Sube CSV con columnas: nombre, telefono. Detecta duplicados automáticamente." isNew />
          <SubStep icon={Package} title="8. Productos" description="Nombre, descripción, precio, stock y categoría. El asistente consulta precios automáticamente." />
          <SubStep icon={RefreshCw} title="9. Auto-refresh" description="Pipeline se actualiza cada 15s. Etapas cada 60s. Indicador verde confirma que está activo." isNew />
          <div className="pt-2">
            <Link href="/crm" className="inline-flex items-center gap-2 px-5 py-2.5 bg-purple-500/20 border border-purple-500/30 text-purple-300 rounded-xl text-sm font-semibold hover:bg-purple-500/30 transition">
              <LayoutGrid className="w-4 h-4" /> Ir al CRM <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <NeedHelpBanner step="CRM y Pipeline" context="Necesito ayuda con el embudo de ventas" />
        </Step>

        {/* ===== PASO 4: CONVERSACIONES ===== */}
        <Step number={4} title="Gestionar Conversaciones" description="Chats en tiempo real, pausar IA, responder manualmente, asignar vendedores"
          icon={MessageSquare} color="cyan" isOpen={openStep === 3} onToggle={() => toggleStep(3)}>
          <SubStep icon={MessageSquare} title="1. Panel de Conversaciones" description="Lista de contactos a la izquierda, chat completo a la derecha. Notificaciones en tiempo real." />
          <SubStep icon={Bot} title="2. Pausar/Reactivar IA" description="Click en 'Pausar IA' para responder personalmente. Reactiva cuando termines." />
          <SubStep icon={UserPlus} title="3. Asignar vendedor" description="Plan Business: asigna chats a miembros del equipo con notificaciones." />
          <SubStep icon={Send} title="4. Mensajes manuales" description="Envía texto, imágenes, audios, videos y archivos desde el chat." />
          <SubStep icon={Database} title="5. Datos recopilados" description="Panel derecho muestra datos que el bot recopiló automáticamente." isNew />
          <InfoBox type="info">Mensajes del bot = ícono 🤖. Mensajes manuales = tu avatar. <strong>El cliente no distingue quién escribe.</strong></InfoBox>
          <div className="pt-2">
            <Link href="/conversaciones" className="inline-flex items-center gap-2 px-5 py-2.5 bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 rounded-xl text-sm font-semibold hover:bg-cyan-500/30 transition">
              <MessageSquare className="w-4 h-4" /> Ir a Conversaciones <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <NeedHelpBanner step="Conversaciones" context="Necesito ayuda con la gestión de chats" />
        </Step>

        {/* ===== PASO 5: AGENDA Y PROGRAMADOS ===== */}
        <Step number={5} title="Agenda, Citas y Programados" description="Citas automáticas por IA, seguimientos y mensajes programados"
          icon={Calendar} color="orange" isOpen={openStep === 4} onToggle={() => toggleStep(4)}>
          <SubStep icon={Calendar} title="1. Crear citas" description="+ Nueva Cita → cliente, tipo (consulta, pedido, seguimiento), fecha, hora, notas." />
          <SubStep icon={Bot} title="2. Citas automáticas por IA" description="Si defines agendamiento en la base de conocimiento, el bot crea citas automáticamente." isNew />
          <SubStep icon={Bell} title="3. Estados" description="Pendiente (amarillo), Confirmada (verde), Completada (azul), Cancelada (rojo)." />
          <SubStep icon={Clock} title="4. Mensajes Programados" description="Crea mensajes que se envían automáticamente en fecha/hora específica. Ideal para seguimientos y campañas." isNew />
          <SubStep icon={Users} title="5. Vincular con CRM" description="Citas se vinculan a clientes: historial completo en un solo lugar." />
          <InfoBox type="tip">Incluye en la base de conocimiento: <strong>"Si el cliente quiere agendar, pide fecha y hora preferida"</strong>.</InfoBox>
          <div className="flex gap-3 pt-2 flex-wrap">
            <Link href="/agenda" className="inline-flex items-center gap-2 px-5 py-2.5 bg-orange-500/20 border border-orange-500/30 text-orange-300 rounded-xl text-sm font-semibold hover:bg-orange-500/30 transition">
              <Calendar className="w-4 h-4" /> Agenda <ArrowRight className="w-4 h-4" />
            </Link>
            <Link href="/programados" className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500/20 border border-amber-500/30 text-amber-300 rounded-xl text-sm font-semibold hover:bg-amber-500/30 transition">
              <Clock className="w-4 h-4" /> Programados <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <NeedHelpBanner step="Agenda y Citas" context="Necesito configurar agendamiento automático" />
        </Step>

        {/* ===== FUNCIONES ADICIONALES ===== */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-sm p-6">
          <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4"><Star className="w-5 h-5 text-amber-400" /> Funciones Adicionales</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              { icon: BarChart3, color: 'emerald', title: 'Dashboard Analítico', desc: 'Métricas en tiempo real: mensajes, pipeline, lead scoring, actividad por hora y tendencias.', href: '/dashboard', isNew: true },
              { icon: Shield, color: 'blue', title: 'Equipo y Roles', desc: 'Invita vendedores, soporte y gerentes. Permisos por rol.', href: '/equipo' },
              { icon: Brain, color: 'purple', title: 'Auto-Aprendizaje', desc: 'El asistente sugiere mejoras basadas en conversaciones reales.', href: '/asistentes', isNew: true },
              { icon: Key, color: 'cyan', title: 'Config IA Avanzada', desc: 'API Key de OpenAI, modelo, temperatura y tokens.', href: '/ai-config', isNew: true },
              { icon: Paintbrush, color: 'pink', title: 'Personalización', desc: 'Fondo de pantalla, app PWA instalable en celular y escritorio.' },
              { icon: Globe, color: 'indigo', title: 'Integraciones', desc: 'Webhooks, APIs y servicios externos.', href: '/integraciones' },
            ].map((f, i) => (
              <div key={i} className="p-4 rounded-xl bg-white/5 border border-white/5">
                <div className="flex items-center gap-2 mb-2">
                  <f.icon className={`w-4 h-4 text-${f.color}-400`} />
                  <span className="text-sm font-semibold text-white">{f.title}</span>
                  {f.isNew && <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded-full">Nuevo</span>}
                </div>
                <p className="text-xs text-gray-500">{f.desc}</p>
                {f.href && <Link href={f.href} className={`text-[10px] text-${f.color}-400 mt-2 inline-block hover:underline`}>Ir →</Link>}
              </div>
            ))}
          </div>
        </div>

        {/* How it all works */}
        <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-r from-emerald-500/5 to-cyan-500/5 p-6">
          <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4"><Sparkles className="w-5 h-5 text-emerald-400" /> ¿Cómo funciona todo junto?</h3>
          <div className="space-y-3 text-sm text-gray-300 leading-relaxed">
            {[
              ['1️⃣', 'Escribes la **Base de Conocimiento** con toda la info de tu negocio.'],
              ['2️⃣', 'El **Asistente IA** responde automáticamente por WhatsApp.'],
              ['3️⃣', 'Las **Etapas del Pipeline** se generan de la base de conocimiento.'],
              ['4️⃣', 'El **Lead Scoring** califica cada lead (🔥🟡🔵) automáticamente.'],
              ['5️⃣', 'Los **Datos del Cliente** se recopilan según lo que definas.'],
              ['6️⃣', 'Tú solo **monitoreas el dashboard**, revisas leads calientes y cierras ventas.'],
            ].map(([emoji, text], i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="text-lg">{emoji}</span>
                <p dangerouslySetInnerHTML={{ __html: text.replace(/\*\*(.*?)\*\*/g, '<strong class="text-white">$1</strong>') }} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ===== BANNER IMPLEMENTACIÓN ===== */}
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
            <HelpCircle className="w-8 h-8 text-emerald-400" />
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
