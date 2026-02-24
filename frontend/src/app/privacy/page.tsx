'use client';

import { Shield, ArrowLeft, Lock, Eye, Trash2, Mail, MessageSquare } from 'lucide-react';
import Link from 'next/link';

export default function PrivacyPolicy() {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #0a0a0f 0%, #0d1117 50%, #0a0a0f 100%)',
      color: '#e4e4e7',
      fontFamily: "'Plus Jakarta Sans', -apple-system, sans-serif"
    }}>
      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(10, 10, 15, 0.8)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        padding: '16px 0'
      }}>
        <div style={{ maxWidth: '720px', margin: '0 auto', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: '10px',
              background: 'linear-gradient(135deg, #10b981 0%, #06d6a0 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Shield size={18} color="#fff" />
            </div>
            <span style={{ fontWeight: 700, fontSize: '16px', color: '#fff' }}>BizonneCRM</span>
          </div>
          <Link href="/login" style={{
            color: '#71717a', fontSize: '13px', textDecoration: 'none',
            display: 'flex', alignItems: 'center', gap: '6px',
          }}>
            <ArrowLeft size={14} />
            Volver
          </Link>
        </div>
      </header>

      {/* Content */}
      <main style={{ maxWidth: '720px', margin: '0 auto', padding: '48px 24px 80px' }}>
        {/* Title Section */}
        <div style={{ marginBottom: '48px' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)',
            borderRadius: '100px', padding: '6px 14px', marginBottom: '20px',
            fontSize: '12px', color: '#10b981', fontWeight: 600
          }}>
            <Lock size={12} />
            Documento Legal
          </div>
          <h1 style={{
            fontSize: '32px', fontWeight: 800, color: '#fff',
            lineHeight: 1.2, marginBottom: '12px', letterSpacing: '-0.02em'
          }}>
            Política de Privacidad
          </h1>
          <p style={{ color: '#71717a', fontSize: '14px' }}>
            Última actualización: 24 de febrero de 2026
          </p>
        </div>

        {/* Intro */}
        <p style={{ fontSize: '15px', lineHeight: 1.8, color: '#a1a1aa', marginBottom: '40px' }}>
          En <strong style={{ color: '#fff' }}>BizonneCRM</strong> nos tomamos en serio la privacidad de nuestros usuarios
          y la de sus clientes. Esta política describe cómo recopilamos, usamos y protegemos la información
          cuando utilizas nuestra plataforma de automatización de WhatsApp Business y CRM.
        </p>

        {/* Sections */}
        {sections.map((section, i) => (
          <section key={i} style={{
            marginBottom: '36px',
            padding: '24px',
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '16px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div style={{
                width: '32px', height: '32px', borderRadius: '8px',
                background: section.iconBg,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
              }}>
                {section.icon}
              </div>
              <h2 style={{ fontSize: '17px', fontWeight: 700, color: '#fff', margin: 0 }}>
                {section.title}
              </h2>
            </div>
            <div style={{ fontSize: '14px', lineHeight: 1.8, color: '#a1a1aa' }}>
              {section.content}
            </div>
          </section>
        ))}

        {/* Contact Card */}
        <div style={{
          marginTop: '48px',
          padding: '28px',
          background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(6, 214, 160, 0.04) 100%)',
          border: '1px solid rgba(16, 185, 129, 0.15)',
          borderRadius: '16px'
        }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#fff', marginBottom: '8px' }}>
            ¿Tienes preguntas?
          </h3>
          <p style={{ fontSize: '14px', color: '#a1a1aa', marginBottom: '16px', lineHeight: 1.6 }}>
            Si tienes dudas sobre esta política de privacidad o deseas ejercer tus derechos, contáctanos:
          </p>
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px' }}>
              <Mail size={14} style={{ color: '#10b981' }} />
              <span style={{ color: '#e4e4e7' }}>soporte@bizonne.com</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px' }}>
              <MessageSquare size={14} style={{ color: '#10b981' }} />
              <span style={{ color: '#e4e4e7' }}>WhatsApp: +57 321 3815105</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ marginTop: '48px', textAlign: 'center' as const }}>
          <p style={{ fontSize: '12px', color: '#52525b' }}>
            © 2026 BizonneCRM — Automatiza tu WhatsApp con IA. Todos los derechos reservados.
          </p>
        </div>
      </main>
    </div>
  );
}

// ===== Section Data =====
const sections = [
  {
    title: 'Información que recopilamos',
    icon: <Eye size={16} color="#60a5fa" />,
    iconBg: 'rgba(96, 165, 250, 0.15)',
    content: (
      <>
        <p style={{ marginBottom: '12px' }}>Recopilamos la siguiente información cuando usas nuestra plataforma:</p>
        <ul style={{ paddingLeft: '20px', margin: 0 }}>
          <li style={{ marginBottom: '6px' }}><strong style={{ color: '#e4e4e7' }}>Datos de cuenta:</strong> nombre, correo electrónico y contraseña al registrarte.</li>
          <li style={{ marginBottom: '6px' }}><strong style={{ color: '#e4e4e7' }}>Datos de WhatsApp:</strong> números de teléfono conectados, mensajes enviados y recibidos a través de la plataforma.</li>
          <li style={{ marginBottom: '6px' }}><strong style={{ color: '#e4e4e7' }}>Datos de clientes:</strong> información de contacto de tus clientes almacenada en el CRM.</li>
          <li style={{ marginBottom: '6px' }}><strong style={{ color: '#e4e4e7' }}>Datos de uso:</strong> interacciones con la plataforma para mejorar el servicio.</li>
        </ul>
      </>
    )
  },
  {
    title: 'Cómo usamos tu información',
    icon: <Shield size={16} color="#10b981" />,
    iconBg: 'rgba(16, 185, 129, 0.15)',
    content: (
      <ul style={{ paddingLeft: '20px', margin: 0 }}>
        <li style={{ marginBottom: '6px' }}>Proporcionar y mantener los servicios de automatización de WhatsApp y CRM.</li>
        <li style={{ marginBottom: '6px' }}>Procesar y entregar mensajes a través de la API de WhatsApp Business (Meta).</li>
        <li style={{ marginBottom: '6px' }}>Gestionar respuestas automáticas con inteligencia artificial.</li>
        <li style={{ marginBottom: '6px' }}>Generar reportes y análisis de rendimiento de tus conversaciones.</li>
        <li style={{ marginBottom: '6px' }}>Mejorar la calidad y seguridad de la plataforma.</li>
        <li>Enviar notificaciones relevantes sobre tu cuenta.</li>
      </ul>
    )
  },
  {
    title: 'Compartir información',
    icon: <Lock size={16} color="#f59e0b" />,
    iconBg: 'rgba(245, 158, 11, 0.15)',
    content: (
      <>
        <p style={{ marginBottom: '12px' }}><strong style={{ color: '#e4e4e7' }}>No vendemos ni compartimos tu información personal con terceros.</strong></p>
        <p style={{ marginBottom: '12px' }}>Solo compartimos datos cuando es estrictamente necesario:</p>
        <ul style={{ paddingLeft: '20px', margin: 0 }}>
          <li style={{ marginBottom: '6px' }}><strong style={{ color: '#e4e4e7' }}>Meta (WhatsApp):</strong> Los mensajes se procesan a través de la API de WhatsApp Business conforme a las políticas de Meta.</li>
          <li style={{ marginBottom: '6px' }}><strong style={{ color: '#e4e4e7' }}>OpenAI:</strong> El contenido de mensajes puede ser procesado para generar respuestas con IA, sin almacenar datos personales.</li>
          <li><strong style={{ color: '#e4e4e7' }}>Requerimiento legal:</strong> Si la ley así lo exige.</li>
        </ul>
      </>
    )
  },
  {
    title: 'WhatsApp Business API',
    icon: <MessageSquare size={16} color="#25d366" />,
    iconBg: 'rgba(37, 211, 102, 0.15)',
    content: (
      <>
        <p style={{ marginBottom: '12px' }}>
          Nuestra plataforma utiliza la API oficial de WhatsApp Business proporcionada por Meta Platforms, Inc. para facilitar la comunicación entre negocios y sus clientes.
        </p>
        <p style={{ marginBottom: '12px' }}>
          Los mensajes enviados y recibidos a través de WhatsApp son procesados conforme a los
          términos y condiciones de Meta. Te recomendamos revisar la política de privacidad de WhatsApp.
        </p>
        <p>
          Tu número de WhatsApp Business y los tokens de acceso se almacenan de forma segura y encriptada en nuestros servidores.
        </p>
      </>
    )
  },
  {
    title: 'Seguridad de los datos',
    icon: <Lock size={16} color="#8b5cf6" />,
    iconBg: 'rgba(139, 92, 246, 0.15)',
    content: (
      <ul style={{ paddingLeft: '20px', margin: 0 }}>
        <li style={{ marginBottom: '6px' }}>Comunicaciones cifradas con HTTPS/TLS.</li>
        <li style={{ marginBottom: '6px' }}>Contraseñas almacenadas con hash seguro (bcrypt).</li>
        <li style={{ marginBottom: '6px' }}>Tokens de acceso encriptados en la base de datos.</li>
        <li style={{ marginBottom: '6px' }}>Autenticación JWT con expiración automática.</li>
        <li>Servidores protegidos con acceso restringido.</li>
      </ul>
    )
  },
  {
    title: 'Eliminación de datos',
    icon: <Trash2 size={16} color="#ef4444" />,
    iconBg: 'rgba(239, 68, 68, 0.15)',
    content: (
      <>
        <p style={{ marginBottom: '12px' }}>Tienes derecho a solicitar la eliminación de todos tus datos personales en cualquier momento.</p>
        <p style={{ marginBottom: '12px' }}>Para solicitar la eliminación:</p>
        <ul style={{ paddingLeft: '20px', margin: 0 }}>
          <li style={{ marginBottom: '6px' }}>Envía un mensaje a nuestro WhatsApp de soporte o correo electrónico.</li>
          <li style={{ marginBottom: '6px' }}>Indica tu cuenta y qué datos deseas eliminar.</li>
          <li>Procesaremos tu solicitud en un máximo de 30 días hábiles.</li>
        </ul>
        <p style={{ marginTop: '12px' }}>
          Al eliminar tu cuenta, se borrarán permanentemente: datos de perfil, conversaciones, contactos del CRM, configuraciones de asistentes IA y todo dato asociado.
        </p>
      </>
    )
  },
  {
    title: 'Tus derechos',
    icon: <Shield size={16} color="#ec4899" />,
    iconBg: 'rgba(236, 72, 153, 0.15)',
    content: (
      <>
        <p style={{ marginBottom: '12px' }}>Como usuario, tienes derecho a:</p>
        <ul style={{ paddingLeft: '20px', margin: 0 }}>
          <li style={{ marginBottom: '6px' }}>Acceder a tus datos personales almacenados.</li>
          <li style={{ marginBottom: '6px' }}>Rectificar cualquier dato incorrecto.</li>
          <li style={{ marginBottom: '6px' }}>Solicitar la eliminación de tus datos.</li>
          <li style={{ marginBottom: '6px' }}>Exportar tus datos en un formato legible.</li>
          <li>Revocar el consentimiento en cualquier momento.</li>
        </ul>
      </>
    )
  }
];
