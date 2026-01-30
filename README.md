# 🤖 ELISA IA - Plataforma de Agentes con WhatsApp

## 📋 Descripción

Elisa IA es una plataforma completa para gestionar agentes de inteligencia artificial conectados a WhatsApp. Incluye CRM, agenda, gestión de productos y conversaciones automatizadas.

## 🏗️ Arquitectura

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Frontend     │────▶│    Backend      │────▶│     WAHA        │
│   (Next.js)     │     │   (Express)     │     │  (WhatsApp API) │
│    Vercel       │     │    Railway      │     │      VPS        │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │   PostgreSQL    │
                        │    (Railway)    │
                        └─────────────────┘
```

## 🚀 Tecnologías

- **Frontend**: Next.js 14, React, TailwindCSS
- **Backend**: Node.js, Express, TypeScript, Prisma
- **WhatsApp**: WAHA (WhatsApp HTTP API)
- **Base de datos**: PostgreSQL
- **Hosting**: Vercel (Frontend), Railway (Backend), VPS (WAHA)

## 📦 Estructura del Proyecto

```
elisa-ia/
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── auth.routes.ts
│   │   │   ├── whatsapp.routes.ts    # ← Integración WAHA
│   │   │   ├── conversations.routes.ts
│   │   │   ├── assistants.routes.ts
│   │   │   ├── clients.routes.ts
│   │   │   ├── products.routes.ts
│   │   │   └── appointments.routes.ts
│   │   ├── middleware/
│   │   ├── lib/
│   │   └── server.ts
│   ├── prisma/
│   │   └── schema.prisma
│   ├── package.json
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   └── app/
│   │       ├── whatsapp/page.tsx     # ← Conexión WhatsApp
│   │       ├── conversaciones/page.tsx
│   │       ├── asistentes/page.tsx
│   │       ├── crm/page.tsx
│   │       └── agenda/page.tsx
│   └── package.json
└── README.md
```

## ⚙️ Configuración

### 1. Variables de Entorno - Backend (Railway)

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
FRONTEND_URL="https://tu-app.vercel.app"
```

### 2. Variables de Entorno - Frontend (Vercel)

```env
NEXT_PUBLIC_API_URL="https://tu-backend.railway.app"
```

### 3. WAHA en VPS

```yaml
# docker-compose.yml
version: '3.8'

services:
  waha:
    image: devlikeapro/waha
    container_name: elisa-waha
    restart: unless-stopped
    ports:
      - "8080:3000"
    environment:
      - WAHA_DASHBOARD_ENABLED=true
      - WAHA_DASHBOARD_USERNAME=admin
      - WAHA_DASHBOARD_PASSWORD=admin
      - WHATSAPP_API_KEY=tu-api-key
      - WAHA_DEFAULT_ENGINE=WEBJS
      - WAHA_PRINT_QR=true
      - WHATSAPP_RESTART_ALL_SESSIONS=true
      - WHATSAPP_HOOK_URL=https://tu-backend.railway.app/api/webhook/whatsapp
      - WHATSAPP_HOOK_EVENTS=message,session.status
    volumes:
      - ./waha-sessions:/app/.sessions
```

## 🔌 API Endpoints

### Autenticación
- `POST /api/auth/register` - Registrar usuario
- `POST /api/auth/login` - Iniciar sesión
- `GET /api/auth/me` - Obtener usuario actual

### WhatsApp
- `GET /api/whatsapp/status` - Estado de conexión
- `POST /api/whatsapp/connect` - Conectar WhatsApp
- `GET /api/whatsapp/qr` - Obtener código QR
- `POST /api/whatsapp/disconnect` - Desconectar
- `POST /api/whatsapp/send` - Enviar mensaje

### Webhooks (Públicos)
- `POST /api/webhook/whatsapp` - Recibe mensajes de WAHA
- `POST /api/webhook/wompi` - Recibe eventos de pagos

### Conversaciones
- `GET /api/conversations` - Listar conversaciones
- `GET /api/conversations/:id` - Obtener conversación
- `GET /api/conversations/:id/messages` - Mensajes de conversación

### Asistentes IA
- `GET /api/assistants` - Listar asistentes
- `POST /api/assistants` - Crear asistente
- `PUT /api/assistants/:id` - Actualizar asistente

### CRM - Clientes
- `GET /api/clients` - Listar clientes
- `POST /api/clients` - Crear cliente
- `PUT /api/clients/:id` - Actualizar cliente

### Productos
- `GET /api/products` - Listar productos
- `POST /api/products` - Crear producto

### Agenda
- `GET /api/appointments` - Listar citas
- `POST /api/appointments` - Crear cita

## 📱 Flujo de WhatsApp con WAHA

### Conexión
```
Usuario → Frontend → Backend → WAHA (crea sesión)
                                  ↓
                              Genera QR
                                  ↓
Usuario escanea QR ← Frontend ← Backend ← WAHA
                                  ↓
                           Sesión conectada
```

### Envío de Mensajes
```
Usuario escribe mensaje
        ↓
    Frontend
        ↓
POST /api/whatsapp/send
        ↓
    Backend
        ↓
POST WAHA/api/sendText
        ↓
  WhatsApp envía
```

### Recepción de Mensajes
```
Mensaje llega a WhatsApp
        ↓
      WAHA
        ↓
POST /api/webhook/whatsapp
        ↓
    Backend
        ↓
Guarda en PostgreSQL
        ↓
Frontend actualiza (polling/websocket)
```

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
1. Conectar repositorio
2. Agregar variables de entorno
3. Deploy automático

### Vercel (Frontend)
1. Importar proyecto
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
- Webhook validación por sesión

## 📞 Soporte

Para soporte o consultas, contactar a través de la plataforma.

---

**Versión**: 5.1.0  
**Última actualización**: Enero 2026  
**WhatsApp Provider**: WAHA (WhatsApp HTTP API)
