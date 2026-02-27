'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Smartphone, Bot, Users, Calendar, CheckCircle, Circle, ArrowRight,
  Wifi, Settings, Zap, Shield, Star, Phone, BookOpen, Sparkles,
  Rocket, Target, MessageSquare, ChevronRight, Loader2, RefreshCw,
  Crown, AlertTriangle, X, PartyPopper, Gift, Trophy
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const SUPPORT_WHATSAPP = '573213815105';

interface SetupStatus {
  whatsappConnected: boolean;
  assistantConfigured: boolean;
  knowledgeBaseReady: boolean;
  stagesDetected: boolean;
  firstConversation: boolean;
}

interface OnboardingWizardProps {
  user: any;
  onComplete: () => void;
}

export default function OnboardingWizard({ user, onComplete }: OnboardingWizardProps) {
  const [status, setStatus] = useState<SetupStatus>({
    whatsappConnected: false,
    assistantConfigured: false,
    knowledgeBaseReady: false,
    stagesDetected: false,
    firstConversation: false,
  });
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [showCelebration, setShowCelebration] = useState(false);
  const [animateIn, setAnimateIn] = useState(false);

  useEffect(() => {
    checkSetupStatus();
    const interval = setInterval(checkSetupStatus, 15000); // Check every 15s
    setTimeout(() => setAnimateIn(true), 100);
    return () => clearInterval(interval);
  }, []);

  const checkSetupStatus = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const [linesRes, assistantsRes, stagesRes, convsRes] = await Promise.all([
        fetch(`${API_URL}/api/whatsapp/lines`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/assistants`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/stages?lineId=${localStorage.getItem('selectedLineId') || ''}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/api/conversations?lineId=${localStorage.getItem('selectedLineId') || ''}`, { headers: { 'Authorization': `Bearer ${token}` } }),
      ]);

      const linesData = linesRes.ok ? await linesRes.json() : { lines: [] };
      const assistantsData = assistantsRes.ok ? await assistantsRes.json() : { assistants: [] };
      const stagesData = stagesRes.ok ? await stagesRes.json() : { stages: [] };
      const convsData = convsRes.ok ? await convsRes.json() : { conversations: [] };

      const lines = linesData.lines || [];
      const assistants = assistantsData.assistants || assistantsData || [];
      const stages = stagesData.stages || [];
      const conversations = convsData.conversations || [];

      const whatsappConnected = lines.some((l: any) => l.status === 'connected' || l.status === 'ready');
      const assistantConfigured = Array.isArray(assistants) ? assistants.some((a: any) => a.context && a.context.length > 100) : false;
      const knowledgeBaseReady = assistantConfigured; // Same check - KB is the context
      const stagesDetected = stages.length >= 2;
      const firstConversation = conversations.length > 0;

      const newStatus = {
        whatsappConnected,
        assistantConfigured,
        knowledgeBaseReady,
        stagesDetected,
        firstConversation,
      };

      setStatus(newStatus);

      // Auto-advance to the first incomplete step
      const steps = [whatsappConnected, assistantConfigured, stagesDetected];
      const firstIncomplete = steps.findIndex(s => !s);
      if (firstIncomplete >= 0) {
        setCurrentStep(firstIncomplete);
      }

      // Check if all required steps are complete (first 3 are mandatory)
      if (whatsappConnected && assistantConfigured && stagesDetected) {
        setShowCelebration(true);
        // Save completion flag
        localStorage.setItem('bizonne_setup_complete', 'true');
        setTimeout(() => {
          onComplete();
        }, 5000); // Show celebration for 5 seconds
      }
    } catch (e) {
      console.error('Error checking setup:', e);
    } finally {
      setLoading(false);
      setChecking(false);
    }
  };

  const handleRefresh = () => {
    setChecking(true);
    checkSetupStatus();
  };

  const completedCount = [status.whatsappConnected, status.assistantConfigured, status.stagesDetected].filter(Boolean).length;
  const totalSteps = 3;
  const progressPct = (completedCount / totalSteps) * 100;

  // Celebration screen
  if (showCelebration) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-xl">
        <div className="text-center max-w-lg p-8 animate-fade-in">
          {/* Confetti effect */}
          <div className="relative">
            <div className="absolute -top-20 left-1/2 -translate-x-1/2 text-8xl animate-bounce">🎉</div>
            <div className="absolute -top-10 left-10 text-4xl animate-pulse delay-100">🎊</div>
            <div className="absolute -top-10 right-10 text-4xl animate-pulse delay-200">✨</div>
            <div className="absolute -top-16 left-1/4 text-3xl animate-bounce delay-300">🥳</div>
            <div className="absolute -top-16 right-1/4 text-3xl animate-bounce delay-500">🚀</div>
          </div>

          <div className="w-24 h-24 bg-gradient-to-br from-emerald-500/30 to-cyan-500/30 rounded-3xl mx-auto mb-6 flex items-center justify-center border border-emerald-500/30 shadow-2xl shadow-emerald-500/20 animate-pulse">
            <Trophy className="w-12 h-12 text-emerald-400" />
          </div>
          
          <h1 className="text-4xl md:text-5xl font-black text-white mb-4">
            ¡Felicitaciones! 🎉
          </h1>
          <h2 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent mb-4">
            Completaste la configuración
          </h2>
          <p className="text-gray-400 text-lg mb-6">
            Tu asistente de IA está listo para atender clientes 24/7 por WhatsApp. 
            ¡Empieza a vender más con inteligencia artificial!
          </p>

          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle className="w-5 h-5 text-emerald-400" />
              <span className="text-sm text-emerald-300">WhatsApp conectado</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-500/10 border border-blue-500/20">
              <CheckCircle className="w-5 h-5 text-blue-400" />
              <span className="text-sm text-blue-300">Asistente IA activo</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-500/10 border border-purple-500/20">
              <CheckCircle className="w-5 h-5 text-purple-400" />
              <span className="text-sm text-purple-300">CRM configurado</span>
            </div>
          </div>

          <div className="flex items-center justify-center gap-1.5 text-sm text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Redirigiendo al dashboard...
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#0a0a12]">
        <div className="text-center">
          <Loader2 className="w-10 h-10 text-emerald-400 animate-spin mx-auto mb-4" />
          <p className="text-gray-400 text-sm">Verificando configuración...</p>
        </div>
      </div>
    );
  }

  const steps = [
    {
      id: 'whatsapp',
      title: 'Conectar WhatsApp',
      description: 'Vincula tu número de WhatsApp escaneando el código QR',
      icon: Smartphone,
      color: 'emerald',
      completed: status.whatsappConnected,
      href: '/whatsapp',
      btnText: 'Ir a WhatsApp',
      instructions: [
        'Haz click en "Ir a WhatsApp" para abrir el panel de líneas',
        'Haz click en "Conectar" en tu línea de WhatsApp',
        'Abre WhatsApp en tu celular → Menú (⋮) → Dispositivos vinculados',
        'Escanea el código QR que aparece en pantalla',
        'Espera a que el estado cambie a "Conectado" (verde)',
      ],
    },
    {
      id: 'assistant',
      title: 'Configurar Asistente de IA',
      description: 'Escribe la base de conocimiento con toda la información de tu negocio',
      icon: Bot,
      color: 'blue',
      completed: status.assistantConfigured,
      href: '/asistentes',
      btnText: 'Ir a Asistentes IA',
      instructions: [
        'Haz click en "Ir a Asistentes IA" para abrir el editor',
        'Escribe TODA la información de tu negocio: productos, precios, envíos, pagos, horarios',
        'Define la personalidad del asistente (vendedor, soporte, etc.)',
        'Define las ETAPAS del embudo de ventas (Nuevo → Interesado → Cotización → Pedido → Confirmado)',
        'Haz click en "Guardar Todo" (botón verde arriba a la derecha)',
        'Asigna el asistente a tu línea de WhatsApp en la sección WhatsApp',
      ],
    },
    {
      id: 'stages',
      title: 'Pipeline y CRM',
      description: 'Las etapas del embudo se generan automáticamente desde la base de conocimiento',
      icon: Target,
      color: 'purple',
      completed: status.stagesDetected,
      href: '/crm',
      btnText: 'Ir al CRM',
      instructions: [
        'Primero asegúrate de que la base de conocimiento incluya las etapas del embudo',
        'Ve al CRM y haz click en "Detectar Etapas"',
        'El sistema leerá la base de conocimiento y creará las etapas automáticamente',
        'Las conversaciones se organizarán por etapas en el pipeline',
        'Los leads se clasifican automáticamente: 🔥 Caliente, 🟡 Tibio, 🔵 Frío',
      ],
    },
  ];

  return (
    <div className="fixed inset-0 z-[200] bg-[#0a0a12] overflow-y-auto">
      <div className={`max-w-3xl mx-auto px-4 py-8 transition-all duration-700 ${animateIn ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
        
        {/* Header */}
        <div className="text-center mb-10">
          <div className="w-20 h-20 bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 rounded-3xl mx-auto mb-5 flex items-center justify-center border border-emerald-500/20 shadow-lg shadow-emerald-500/10">
            <Rocket className="w-10 h-10 text-emerald-400" />
          </div>
          <h1 className="text-3xl md:text-4xl font-black text-white mb-3">
            Configura tu <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">Bizonne</span>
          </h1>
          <p className="text-gray-400 text-lg max-w-xl mx-auto">
            Completa estos {totalSteps} pasos para activar tu asistente de IA por WhatsApp
          </p>

          {/* Progress bar */}
          <div className="mt-6 max-w-md mx-auto">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500">{completedCount} de {totalSteps} completados</span>
              <span className="text-xs font-bold text-emerald-400">{Math.round(progressPct)}%</span>
            </div>
            <div className="h-3 bg-white/5 rounded-full overflow-hidden border border-white/10">
              <div 
                className="h-full bg-gradient-to-r from-emerald-500 to-cyan-500 rounded-full transition-all duration-1000 ease-out"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex justify-between mt-2">
              {steps.map((step, i) => (
                <div key={i} className="flex items-center gap-1">
                  {step.completed ? (
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Circle className="w-4 h-4 text-gray-600" />
                  )}
                  <span className={`text-[10px] ${step.completed ? 'text-emerald-400' : 'text-gray-600'}`}>
                    Paso {i + 1}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Refresh button */}
          <button
            onClick={handleRefresh}
            disabled={checking}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-gray-400 hover:text-white hover:bg-white/10 transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Verificando...' : 'Verificar progreso'}
          </button>
        </div>

        {/* Steps */}
        <div className="space-y-4 mb-8">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const isActive = currentStep === index;
            const isLocked = index > 0 && !steps[index - 1].completed;
            
            return (
              <div
                key={step.id}
                className={`rounded-2xl border transition-all duration-500 overflow-hidden ${
                  step.completed
                    ? 'bg-emerald-500/5 border-emerald-500/20'
                    : isActive
                    ? `bg-${step.color}-500/5 border-${step.color}-500/30 shadow-lg shadow-${step.color}-500/5`
                    : isLocked
                    ? 'bg-white/[0.02] border-white/5 opacity-60'
                    : 'bg-white/[0.04] border-white/10 hover:border-white/20'
                }`}
              >
                {/* Step Header */}
                <button
                  onClick={() => !isLocked && setCurrentStep(isActive ? -1 : index)}
                  disabled={isLocked}
                  className="w-full flex items-center gap-4 p-5 text-left"
                >
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all ${
                    step.completed
                      ? 'bg-emerald-500/20 border border-emerald-500/30'
                      : isLocked
                      ? 'bg-white/5 border border-white/10'
                      : `bg-${step.color}-500/20 border border-${step.color}-500/30`
                  }`}>
                    {step.completed ? (
                      <CheckCircle className="w-7 h-7 text-emerald-400" />
                    ) : isLocked ? (
                      <Shield className="w-6 h-6 text-gray-600" />
                    ) : (
                      <Icon className={`w-7 h-7 text-${step.color}-400`} />
                    )}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold uppercase tracking-wider ${
                        step.completed ? 'text-emerald-400' : isLocked ? 'text-gray-600' : `text-${step.color}-400`
                      }`}>
                        Paso {index + 1}
                      </span>
                      {step.completed && (
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2.5 py-0.5 rounded-full font-medium">
                          ✅ Completado
                        </span>
                      )}
                      {isLocked && (
                        <span className="text-[10px] bg-white/5 text-gray-600 px-2.5 py-0.5 rounded-full font-medium">
                          🔒 Completa el paso anterior
                        </span>
                      )}
                    </div>
                    <h3 className={`text-lg font-bold mt-1 ${isLocked ? 'text-gray-600' : 'text-white'}`}>
                      {step.title}
                    </h3>
                    <p className={`text-sm mt-0.5 ${isLocked ? 'text-gray-700' : 'text-gray-500'}`}>
                      {step.description}
                    </p>
                  </div>

                  <ChevronRight className={`w-5 h-5 text-gray-500 transition-transform flex-shrink-0 ${isActive ? 'rotate-90' : ''}`} />
                </button>

                {/* Step Content (expanded) */}
                {isActive && !step.completed && !isLocked && (
                  <div className="px-5 pb-6 border-t border-white/5">
                    <div className="ml-[4.5rem] space-y-4 pt-4">
                      {/* Instructions */}
                      <div className="space-y-2.5">
                        {step.instructions.map((instruction, i) => (
                          <div key={i} className="flex items-start gap-3">
                            <div className={`w-6 h-6 rounded-full bg-${step.color}-500/20 flex items-center justify-center flex-shrink-0 mt-0.5`}>
                              <span className={`text-[10px] font-black text-${step.color}-400`}>{i + 1}</span>
                            </div>
                            <p className="text-sm text-gray-300 leading-relaxed">{instruction}</p>
                          </div>
                        ))}
                      </div>

                      {/* Action button */}
                      <div className="flex items-center gap-3 pt-2">
                        <Link
                          href={step.href}
                          className={`inline-flex items-center gap-2 px-6 py-3 bg-${step.color}-500/20 border border-${step.color}-500/30 text-${step.color}-300 rounded-xl text-sm font-semibold hover:bg-${step.color}-500/30 transition-all hover:scale-[1.02]`}
                        >
                          <Icon className="w-4 h-4" /> {step.btnText} <ArrowRight className="w-4 h-4" />
                        </Link>
                        <button
                          onClick={handleRefresh}
                          disabled={checking}
                          className="inline-flex items-center gap-2 px-4 py-3 bg-white/5 border border-white/10 text-gray-400 rounded-xl text-sm hover:bg-white/10 transition-all"
                        >
                          <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
                          Verificar
                        </button>
                      </div>

                      {/* Help hint */}
                      <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/5 border border-amber-500/15">
                        <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs text-gray-400">
                            ¿No puedes completar este paso? No te preocupes, nuestro equipo lo hace por ti.
                          </p>
                          <a
                            href={`https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(`¡Hola! Necesito ayuda con el paso ${index + 1}: ${step.title}. No logro completar la configuración de mi asistente IA en Bizonne 🆘`)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 mt-2 text-xs text-amber-400 hover:text-amber-300 font-semibold"
                          >
                            <Phone className="w-3.5 h-3.5" /> Solicitar implementación profesional →
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Implementation Banner */}
        <div className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-rose-500/10 mb-8">
          <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-bl from-amber-500/20 to-transparent rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-gradient-to-tr from-orange-500/15 to-transparent rounded-full blur-3xl" />

          <div className="relative p-6 md:p-8">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/30 to-orange-500/30 flex items-center justify-center border border-amber-500/30">
                <Zap className="w-5 h-5 text-amber-400" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400 bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20">
                Servicio Premium
              </span>
            </div>

            <h3 className="text-xl md:text-2xl font-black text-white mb-2">
              ¿Prefieres que lo hagamos por ti?
            </h3>
            <p className="text-gray-400 text-sm leading-relaxed mb-5">
              Nuestro equipo de expertos configura <strong className="text-white">toda la plataforma</strong>: 
              asistente IA, embudo de ventas, multimedia, triggers y CRM. Todo listo en 24 horas.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-5">
              {[
                'Asistente IA a tu medida',
                'Pipeline personalizado',
                'Multimedia incluida',
                'Capacitación 1-a-1',
                'Soporte 30 días',
                'Garantía total',
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs text-gray-300">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                  <span>{item}</span>
                </div>
              ))}
            </div>

            <a
              href={`https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent('¡Hola! Me interesa el servicio de implementación de Bizonne para mi negocio. Quiero agendar una videollamada para conocer los detalles 🚀')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold rounded-xl text-sm hover:brightness-110 transition-all hover:shadow-lg hover:shadow-amber-500/30 hover:scale-[1.02]"
            >
              <Phone className="w-5 h-5" /> Agendar Videollamada Gratis
              <ArrowRight className="w-4 h-4" />
            </a>
            <p className="text-[10px] text-gray-600 mt-2">Sin compromiso. Te contactamos por WhatsApp.</p>
          </div>
        </div>

        {/* Skip for later (only for returning users or admins) */}
        <div className="text-center pb-8">
          <button
            onClick={() => {
              localStorage.setItem('bizonne_setup_skipped', Date.now().toString());
              onComplete();
            }}
            className="text-xs text-gray-600 hover:text-gray-400 transition-colors underline underline-offset-4"
          >
            Omitir por ahora (configurar después)
          </button>
        </div>
      </div>
    </div>
  );
}
