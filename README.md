# 🤖 ELISA IA - Plataforma de Agentes con WhatsApp

## 📋 Descripción

Elisa IA es una plataforma completa para gestionar agentes de inteligencia artificial conectados a WhatsApp. Incluye CRM, agenda, gestión de productos, conversaciones automatizadas y almacenamiento multimedia inteligente.

## 🏗️ Arquitectura

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Frontend      │────▶│    Backend       │────▶│     WAHA        │
│   (Next.js 14)   │     │ (Express + TS)   │     │  (WhatsApp API) │
│    Vercel        │     │    Railway       │     │      VPS        │
└─────────────────┘     └────────┬─────────┘     └─────────────────┘
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
             ┌───────────┐ ┌──────────┐ ┌──────────────┐
             │ PostgreSQL │ │   R2     │ │   sharp +    │
             │ (Supabase) │ │(Cloudflare)│ │   ffmpeg    │
             │  Datos     │ │  Media   │ │ Compresión   │
             └───────────┘ └──────────┘ └──────────────┘
```

## 🚀 Tecnologías

- **Frontend**: Next.js 14, React, TailwindCSS
- **Backend**: Node.js 18, Express, TypeScript, Prisma
- **WhatsApp**: WAHA (WhatsApp HTTP API)
- **Base de datos**: PostgreSQL (Supabase)
- **Storage multimedia**: Cloudflare R2 (S3-compatible, 10GB gratis)
- **Compresión**: sharp (imágenes), ffmpeg (audio/video)
- **Hosting**: Vercel (Frontend), Railway (Backend), VPS (WAHA)
- **Pagos**: Wompi (Colombia)

## 📦 Estructura del Proyecto

```
elisa-ia/
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── auth.routes.ts          # Registro, login, JWT
│   │   │   ├── whatsapp.routes.ts      # Integración WAHA + webhooks
│   │   │   ├── conversations.routes.ts # Chat + analytics dashboard
│   │   │   ├── assistants.routes.ts    # Config IA + auto-aprendizaje
│   │   │   ├── media.routes.ts         # Upload/delete multimedia → R2
│   │   │   ├── clients.routes.ts       # CRM
│   │   │   ├── products.routes.ts      # Catálogo
│   │   │   ├── appointments.routes.ts  # Agenda
│   │   │   ├── scheduled.routes.ts     # Mensajes programados
│   │   │   ├── team.routes.ts          # Multi-usuario
│   │   │   ├── subscription.routes.ts  # Planes + Wompi
│   │   │   ├── stages.routes.ts        # Pipeline personalizable
│   │   │   └── api.routes.ts           # API pública + webhooks
│   │   ├── middleware/
│   │   │   ├── auth.middleware.ts       # JWT validation
│   │   │   └── subscription.middleware.ts # Plan enforcement
│   │   ├── lib/
│   │   │   ├── prisma.ts               # DB client + connection pool
│   │   │   ├── cache.ts                # LRU cache in-memory
│   │   │   ├── helpers.ts              # Utilidades comunes
│   │   │   ├── storage.ts              # Cloudflare R2 / local fallback
│   │   │   └── compress.ts             # Compresión multimedia
│   │   └── server.ts
│   ├── prisma/
│   │   └── schema.prisma
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── src/
│   │   └── app/
│   │       ├── dashboard/page.tsx      # Panel principal
│   │       ├── whatsapp/page.tsx        # Conexión WhatsApp
│   │       ├── conversaciones/page.tsx  # Chat + analytics
│   │       ├── asistentes/page.tsx      # Config IA + multimedia
│   │       ├── crm/page.tsx             # Gestión clientes
│   │       ├── agenda/page.tsx          # Citas
│   │       ├── programados/page.tsx     # Mensajes programados
│   │       ├── equipo/page.tsx          # Multi-usuario
│   │       ├── subscription/page.tsx    # Planes y pagos
│   │       ├── admin/page.tsx           # Panel administración
│   │       └── configuracion/page.tsx   # Ajustes
│   └── package.json
└── README.md
```

## 🗄️ Almacenamiento Multimedia

### Arquitectura de Storage

```
Usuario sube imagen/video/audio
        ↓
   Backend recibe (multer)
        ↓
   Compresión inteligente
   ├── Imagen: sharp (quality 92, mozjpeg, max 2560px)
   ├── Audio: ffmpeg (Opus 192kbps VBR, 48kHz)
   └── Video: ffmpeg (H.264 CRF 20, AAC 192k)
        ↓
   Upload a Cloudflare R2
        ↓
   URL guardada en PostgreSQL (solo ~100 bytes)
```

### Límites y Costos

| Clientes | Storage R2 | Costo/mes | DB Supabase |
|----------|-----------|-----------|-------------|
| 10       | 2.5 GB    | $0 (free) | ~5 MB       |
| 100      | 25 GB     | $0.23     | ~50 MB      |
| 1,000    | 250 GB    | $3.60     | ~500 MB     |

- Cada usuario: **250MB** incluidos (expandible)
- Cloudflare R2: **10GB gratis**, luego $0.015/GB
- **$0 egress** (descargas gratis, a diferencia de S3)

## ⚙️ Variables de Entorno

### Backend (Railway)

```env
# Base de datos
DATABASE_URL="postgresql://..."
DIRECT_URL="postgresql://..."

# JWT
JWT_SECRET="tu-secreto-seguro"
JWT_EXPIRES_IN="7d"

# WAHA
WAHA_API_URL="http://31.97.142.127:8080"
WAHA_API_KEY="tu-api-key"

# Frontend
FRONTEND_URL="https://agentes-elisa-ia.vercel.app"
BACKEND_URL="https://elisa-iaagentes-production.up.railway.app"

# Cloudflare R2 Storage
R2_ACCOUNT_ID="tu-account-id"
R2_ACCESS_KEY="tu-access-key"
R2_SECRET_KEY="tu-secret-key"
R2_BUCKET_NAME="bizonne-media"
R2_PUBLIC_URL="https://pub-xxx.r2.dev"
```

### Frontend (Vercel)

```env
NEXT_PUBLIC_API_URL="https://elisa-iaagentes-production.up.railway.app"
```

## 🔌 API Endpoints

### Autenticación
- `POST /api/auth/register` - Registrar usuario
- `POST /api/auth/login` - Iniciar sesión
- `GET /api/auth/me` - Obtener usuario actual
- `POST /api/auth/forgot-password` - Recuperar contraseña

### WhatsApp
- `GET /api/whatsapp/status` - Estado de conexión
- `POST /api/whatsapp/connect` - Conectar WhatsApp
- `GET /api/whatsapp/qr` - Obtener código QR
- `POST /api/whatsapp/disconnect` - Desconectar
- `POST /api/whatsapp/send` - Enviar mensaje

### Multimedia
- `POST /api/media/upload` - Subir archivo(s) con compresión automática
- `DELETE /api/media/:id` - Eliminar archivo de R2
- `GET /api/media/storage` - Info de storage del usuario
- `GET /api/media/files` - Listar archivos
- `POST /api/media/migrate` - Migrar base64 legacy a R2

### Conversaciones
- `GET /api/conversations` - Listar conversaciones
- `GET /api/conversations/stats` - Estadísticas y analytics
- `GET /api/conversations/:id/messages` - Mensajes

### Asistentes IA
- `GET /api/assistants` - Obtener asistente
- `POST /api/assistants` - Crear/actualizar asistente
- `POST /api/assistants/learn` - Auto-aprendizaje

### CRM, Productos, Agenda, Equipo
- `GET/POST/PUT /api/clients` - Gestión clientes
- `GET/POST /api/products` - Catálogo
- `GET/POST /api/appointments` - Citas
- `GET/POST /api/team` - Sub-usuarios

### Suscripciones
- `GET /api/subscription/plans` - Planes disponibles
- `POST /api/subscription/create` - Crear suscripción
- `POST /api/subscription/webhook/wompi` - Webhook pagos

### Webhooks
- `POST /api/webhook/whatsapp` - Recibe mensajes de WAHA
- `POST /api/subscription/webhook/wompi` - Pagos Wompi

## 🛠️ Desarrollo Local

### Backend
```bash
cd backend
npm install
npx prisma generate
npx prisma db push
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### WAHA (Docker)
```bash
docker-compose up -d
```

## 📤 Despliegue

### Railway (Backend)
1. Conectar repositorio GitHub
2. Agregar variables de entorno (ver arriba)
3. Dockerfile incluye: Node.js 18, sharp, ffmpeg
4. Deploy automático con cada push

### Vercel (Frontend)
1. Importar proyecto desde GitHub
2. Configurar `NEXT_PUBLIC_API_URL`
3. Deploy automático

### VPS (WAHA)
```bash
ssh usuario@tu-vps
cd /root/elisa-whatsapp
docker-compose up -d
```

## 🔒 Seguridad

- JWT para autenticación de usuarios
- API Key para comunicación con WAHA
- HTTPS en todos los endpoints públicos
- Rate limiting por IP (60 req/min general, 30 req/min media)
- Credenciales R2 en variables de entorno
- Webhook validación por sesión

---

**Versión**: 7.0.0
**Última actualización**: Febrero 2026
**WhatsApp Provider**: WAHA (WhatsApp HTTP API)
**Storage**: Cloudflare R2
