# 🚀 BizonneCRM — Plataforma CRM + IA para WhatsApp

## 📋 Descripción
BizonneCRM es una plataforma completa que automatiza ventas y atención al cliente por WhatsApp usando inteligencia artificial. Incluye CRM, pipeline de ventas, agenda, asistentes IA configurables, y notificaciones push.

---

## 🏗️ Arquitectura

```
┌─────────────────────────────┐     ┌──────────────────────────┐
│     FRONTEND (Next.js)      │     │   BACKEND (Express.js)   │
│     Puerto: 3001            │────▶│   Puerto: 3000           │
│     Tailwind CSS            │     │   Prisma ORM             │
│     PWA + Push Notif        │     │   PostgreSQL             │
└─────────────────────────────┘     │   OpenAI GPT-4o-mini     │
                                    │   Web Push (VAPID)       │
                                    │   WhatsApp (WAHA/Cloud)  │
                                    └──────────────────────────┘
```

---

## ⚡ Stack Tecnológico

| Componente | Tecnología |
|------------|-----------|
| Frontend | Next.js 14, React 18, Tailwind CSS |
| Backend | Node.js, Express.js, TypeScript |
| Base de datos | PostgreSQL (Supabase/Railway) |
| ORM | Prisma |
| IA | OpenAI GPT-4o-mini |
| WhatsApp | WAHA (self-hosted) + Cloud API |
| Push Notifications | Web Push API + VAPID |
| Deploy | Railway |
| Pagos | Wompi (Colombia) |

---

## 📁 Estructura del Proyecto

```
Agentes-elisa-IA/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma          # Modelos de datos
│   ├── src/
│   │   ├── lib/
│   │   │   ├── prisma.ts          # Conexión DB (pool optimizado)
│   │   │   ├── helpers.ts         # Utilidades
│   │   │   └── cache.ts           # LRU Cache system
│   │   ├── middleware/
│   │   │   ├── auth.middleware.ts  # JWT authentication
│   │   │   └── subscription.middleware.ts
│   │   ├── routes/
│   │   │   ├── whatsapp.routes.ts       # 🤖 Motor principal (IA + WhatsApp)
│   │   │   ├── conversations.routes.ts  # Dashboard + conversaciones
│   │   │   ├── ai-config.routes.ts      # 🆕 Generador de conocimiento v2
│   │   │   ├── push.routes.ts           # 🆕 Push notifications
│   │   │   ├── assistants.routes.ts     # CRUD asistentes
│   │   │   ├── appointments.routes.ts   # Agenda (citas/pedidos/reservas)
│   │   │   ├── clients.routes.ts        # CRM clientes
│   │   │   ├── stages.routes.ts         # Pipeline stages
│   │   │   ├── auth.routes.ts           # Login/Register
│   │   │   ├── subscription.routes.ts   # Planes + Wompi
│   │   │   ├── team.routes.ts           # Multi-usuario
│   │   │   ├── scheduled.routes.ts      # Mensajes programados
│   │   │   ├── media.routes.ts          # Upload archivos
│   │   │   └── products.routes.ts       # Catálogo productos
│   │   └── server.ts                    # Entry point
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/
│   ├── public/
│   │   ├── sw.js                  # 🆕 Service Worker v2 (Push)
│   │   ├── manifest.json          # PWA manifest
│   │   └── bizonne.png            # Logo
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx         # Layout principal + OnboardingWizard
│   │   │   ├── dashboard/page.tsx # Dashboard responsive
│   │   │   ├── conversaciones/    # Chat WhatsApp
│   │   │   ├── crm/page.tsx       # CRM con etapas colapsables
│   │   │   ├── agenda/            # Citas/Pedidos/Reservas
│   │   │   ├── asistentes/        # Configurar asistente IA
│   │   │   ├── ai-config/         # Generador de conocimiento
│   │   │   ├── whatsapp/          # Conexión WhatsApp
│   │   │   ├── equipo/            # Gestión de equipo
│   │   │   ├── programados/       # Mensajes programados
│   │   │   ├── configuracion/     # Settings
│   │   │   └── guia/              # Guía de inicio
│   │   └── components/
│   │       ├── NotificationSounds.tsx        # Sistema de sonidos
│   │       ├── PushNotificationManager.tsx   # 🆕 Push notifications UI
│   │       └── OnboardingWizard.tsx          # Wizard primer uso
│   ├── package.json
│   ├── tailwind.config.js
│   └── next.config.js
│
└── README.md
```

---

## 🔧 Variables de Entorno

### Backend (.env o Railway Variables)

```env
# Base de datos
DATABASE_URL=postgresql://user:pass@host:5432/db?schema=public

# JWT
JWT_SECRET=tu-secret-key-super-seguro

# WhatsApp WAHA
WAHA_URL=http://tu-waha-server:3000
WAHA_API_KEY=tu-waha-api-key

# WhatsApp Cloud API (opcional)
WHATSAPP_VERIFY_TOKEN=tu-verify-token

# Push Notifications (generar con: npx web-push generate-vapid-keys)
VAPID_PUBLIC_KEY=BEl62iUYgUivxIkv...
VAPID_PRIVATE_KEY=UUxI4o8-FbRouAev...
VAPID_EMAIL=mailto:soporte@bizonne.com

# Wompi (pagos)
WOMPI_PUBLIC_KEY=pub_...
WOMPI_PRIVATE_KEY=prv_...
WOMPI_INTEGRITY_KEY=...
WOMPI_EVENTS_SECRET=...

# ElevenLabs (voz, opcional)
ELEVENLABS_API_KEY=...

# Puerto
PORT=3000
```

### Frontend (.env.local)

```env
NEXT_PUBLIC_API_URL=https://tu-backend.railway.app
```

---

## 🚀 Instalación y Desarrollo

### Backend
```bash
cd backend
npm install
npm install web-push        # Para push notifications
npx prisma db push          # Crear/actualizar tablas
npx prisma generate         # Generar cliente
npm run dev                 # Desarrollo (ts-node)
```

### Frontend
```bash
cd frontend
npm install
npm run dev                 # http://localhost:3000
```

---

## 📦 Deploy (Railway)

### Backend
```bash
cd backend
git add .
git commit -m "deploy: backend completo"
git push origin main
```
Railway detecta el `Dockerfile` y hace build automático.

### Frontend
```bash
cd frontend
git add .
git commit -m "deploy: frontend completo"
git push origin main
```

---

## 🔔 Push Notifications — Setup

1. **Instalar:** `cd backend && npm install web-push`
2. **Generar claves:** `npx web-push generate-vapid-keys`
3. **Agregar variables** VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL en Railway
4. **Aplicar schema:** `npx prisma db push`
5. **Deploy** y activar desde la plataforma

Las push se envían automáticamente cuando:
- 📩 Un cliente escribe por WhatsApp
- 🛒 La IA crea un pedido
- 📅 La IA agenda una cita
- 🏨 La IA confirma una reserva

---

## 🤖 Sistema de IA — Cómo Funciona

1. Cliente escribe por WhatsApp
2. Sistema carga los últimos 30 mensajes + memoria guardada
3. Construye system prompt: identidad + conocimiento + reglas + memoria
4. Llama GPT-4o-mini (500 tokens, temp 0.7)
5. IA responde + genera bloque `<<MEMORY_JSON>>` con datos extraídos
6. Sistema parsea: actualiza memoria, mueve pipeline, crea pedidos/citas
7. Si hay trigger multimedia → envía archivos automáticamente
8. Push notification al dueño del negocio

### Configuración IA v2 (ai-config)
Sube un PDF con la info de tu negocio y el sistema:
- Auto-detecta el tipo de negocio (tienda, restaurante, clínica, etc.)
- Genera base de conocimiento optimizada para la plataforma
- Crea etapas del pipeline automáticamente
- Integra triggers multimedia existentes
- Configura flujo conversacional paso a paso
- Mapea campos de memoria y acciones (crear_pedido/cita/reserva)

---

## 🔒 Seguridad Aplicada

- ✅ SQL Injection: UUID validation en dashboard queries
- ✅ JWT Authentication en todas las rutas
- ✅ Rate limiting (30-60 req/min por ruta)
- ✅ Subscription middleware (control de plan)
- ✅ Connection pool optimizado (5 simultáneas, pool 10)
- ✅ CORS configurado
- ✅ Push subscriptions con limpieza automática de expiradas

---

## 📊 Fixes Aplicados en Esta Versión

| Fix | Archivo | Descripción |
|-----|---------|-------------|
| 🔴 SQL Injection | conversations.routes.ts | UUID validation para lineId |
| 🔴 Port mismatch | Dockerfile | EXPOSE 3001 → 3000 |
| 🔴 Pool exhaustion | prisma.ts | connection_limit 5→10, batched queries |
| 🟡 Trigger bug | ai-config.routes.ts | m.triggers → m.trigger (field fix) |
| 🟢 AI Config v2 | ai-config.routes.ts | Auto-detect negocio, prompt optimizado |
| 🟢 Push Notifications | push.routes.ts + sw.js | Notificaciones push reales |
| 🟢 CRM responsive | crm/page.tsx | Etapas colapsables + mobile |
| 🟢 Dashboard responsive | dashboard/page.tsx | Mobile optimizado |

---

## 📞 Soporte

BizonneCRM — Automatiza tu WhatsApp con IA
https://bizonne.com
