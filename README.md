# 🤖 Elisa IA Platform

> Plataforma SaaS para crear agentes de IA personalizados para negocios.
> Modelo BYOK (Bring Your Own Key) - Los usuarios conectan su propia API Key de OpenAI.

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Node](https://img.shields.io/badge/node-18%2B-brightgreen.svg)

---

## 🌟 Características

- ✅ **Agentes de IA Personalizados** - Cada negocio tiene su propio asistente entrenado
- ✅ **Modelo BYOK** - Usuarios conectan su API Key de OpenAI
- ✅ **Multi-Canal** - Web Widget, WhatsApp Business, Instagram (próximamente)
- ✅ **Dashboard Completo** - Métricas, conversaciones, analíticas
- ✅ **Pagos con Stripe** - Planes mensuales y vitalicios
- ✅ **Panel de Admin** - Para gestionar solicitudes y configurar asistentes

---

## 🏗️ Estructura del Proyecto

```
elisa-ia-platform/
├── backend/                 # API Node.js + Express + Prisma
│   ├── src/
│   │   ├── controllers/     # Lógica de endpoints
│   │   ├── routes/          # Definición de rutas
│   │   ├── services/        # Servicios (OpenAI, WhatsApp, etc)
│   │   ├── middleware/      # Auth, validación, errores
│   │   └── utils/           # Utilidades (logger, encryption)
│   └── prisma/              # Schema de base de datos
│
├── frontend/                # Next.js 14 + React + Tailwind
│   └── src/
│       ├── app/             # App Router de Next.js
│       ├── components/      # Componentes React
│       └── services/        # API client
│
├── whatsapp-bot/            # Servicio de WhatsApp (opcional)
│
├── docs/                    # Documentación
│   ├── DEPLOYMENT.md        # Guía de despliegue
│   └── WHATSAPP_SETUP.md    # Configuración de WhatsApp
│
├── docker-compose.yml       # Desarrollo local con Docker
└── package.json             # Monorepo config
```

---

## 🚀 Inicio Rápido

### Prerrequisitos

- Node.js 18+
- PostgreSQL (o Docker)
- Cuenta de Stripe
- (Opcional) Cuenta de Meta Business para WhatsApp

### 1. Clonar el repositorio

```bash
git clone https://github.com/tu-usuario/elisa-ia-platform.git
cd elisa-ia-platform
```

### 2. Opción A: Con Docker (Recomendado)

```bash
# Iniciar todos los servicios
docker-compose up -d

# Ver logs
docker-compose logs -f backend
```

Acceder a:
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- Adminer (BD): http://localhost:8080

### 2. Opción B: Sin Docker

```bash
# Backend
cd backend
cp .env.example .env
# Editar .env con tus credenciales
npm install
npx prisma migrate dev
npm run dev

# Frontend (en otra terminal)
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

---

## 📖 Documentación

| Documento | Descripción |
|-----------|-------------|
| [DEPLOYMENT.md](./docs/DEPLOYMENT.md) | Guía completa de despliegue a producción |
| [WHATSAPP_SETUP.md](./docs/WHATSAPP_SETUP.md) | Configuración de WhatsApp Business API |
| [API.md](./docs/API.md) | Documentación de la API REST |

---

## 🔧 Configuración

### Variables de Entorno (Backend)

```env
# Base de datos
DATABASE_URL=postgresql://user:pass@localhost:5432/elisa_ia

# Auth
JWT_SECRET=tu-jwt-secret-de-32-caracteres
ENCRYPTION_KEY=tu-encryption-key-32-chars

# Stripe
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# WhatsApp (opcional)
WHATSAPP_TOKEN=EAAxxxx
WHATSAPP_PHONE_NUMBER_ID=xxx
WHATSAPP_VERIFY_TOKEN=xxx
```

---

## 🔌 API Endpoints

### Autenticación
```
POST /api/auth/register     - Registro de usuario
POST /api/auth/login        - Login
GET  /api/auth/me           - Usuario actual
POST /api/auth/connect-api-key - Conectar API Key de OpenAI
```

### Negocios
```
GET  /api/business          - Listar negocios
GET  /api/business/:id      - Detalle de negocio
PUT  /api/business/:id      - Actualizar negocio
POST /api/business/:id/products - Agregar producto
POST /api/business/:id/faqs - Agregar FAQ
```

### Asistentes
```
GET  /api/assistant         - Listar asistentes
POST /api/assistant         - Crear asistente
PUT  /api/assistant/:id     - Actualizar asistente
PATCH /api/assistant/:id/toggle - Activar/desactivar
```

### Conversaciones
```
GET  /api/conversations     - Listar conversaciones
GET  /api/conversations/:id - Detalle con mensajes
PATCH /api/conversations/:id/status - Cambiar estado
```

---

## 💳 Planes y Precios

### Plan Mensual (Servicio Gestionado)
| Plan | Precio | Asistentes |
|------|--------|------------|
| Starter | $49/mes | 1 |
| Pro | $99/mes | 3 |
| Business | $199/mes | Ilimitados |

### Plan Vitalicio (Autoservicio)
| Plan | Precio | Asistentes |
|------|--------|------------|
| Starter | $197 | 1 |
| Pro | $397 | 5 |
| Agency | $697 | Ilimitados |

---

## 🛠️ Tecnologías

### Backend
- **Node.js** + **Express** - Servidor HTTP
- **TypeScript** - Tipado estático
- **Prisma** - ORM
- **PostgreSQL** - Base de datos
- **JWT** - Autenticación
- **OpenAI API** - Inteligencia Artificial

### Frontend
- **Next.js 14** - Framework React
- **React** - UI Library
- **Tailwind CSS** - Estilos
- **TypeScript** - Tipado

### Infraestructura
- **Stripe** - Pagos
- **WhatsApp Cloud API** - Mensajería
- **Docker** - Contenedores
- **Railway/Vercel** - Hosting

---

## 📊 Base de Datos

### Modelos Principales

```prisma
model User {
  id            String
  email         String
  plan          Plan
  openaiApiKey  String?  // Encriptada
  businesses    Business[]
  assistants    Assistant[]
}

model Business {
  id            String
  name          String
  industry      String
  products      Product[]
  faqs          FAQ[]
  assistants    Assistant[]
}

model Assistant {
  id            String
  name          String
  systemPrompt  String
  conversations Conversation[]
}

model Conversation {
  id            String
  channel       Channel  // WEB, WHATSAPP
  messages      Message[]
}
```

---

## 🔐 Seguridad

- ✅ API Keys encriptadas con AES-256
- ✅ JWT para autenticación
- ✅ Rate limiting por IP
- ✅ HTTPS obligatorio
- ✅ Headers de seguridad (Helmet)
- ✅ Validación de inputs
- ✅ SQL Injection protegido (Prisma)

---

## 🤝 Contribuir

1. Fork el proyecto
2. Crea tu rama (`git checkout -b feature/amazing-feature`)
3. Commit tus cambios (`git commit -m 'Add amazing feature'`)
4. Push a la rama (`git push origin feature/amazing-feature`)
5. Abre un Pull Request

---

## 📝 Licencia

Distribuido bajo la licencia MIT. Ver `LICENSE` para más información.

---

## 📞 Soporte

- 📧 Email: soporte@elisa-ia.com
- 📖 Docs: https://docs.elisa-ia.com
- 💬 Discord: https://discord.gg/elisa-ia

---

**Hecho con ❤️ por el equipo de Elisa IA**
