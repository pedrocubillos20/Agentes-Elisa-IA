# 🚀 ELISA IA - Guía de Instalación Completa

## Arquitectura del Sistema

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│   Backend API    │────▶│  Evolution API  │
│   (Vercel)      │     │   (Railway)      │     │   (Railway)     │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │                        │
                               ▼                        ▼
                        ┌──────────────┐         ┌──────────────┐
                        │  PostgreSQL  │         │   WhatsApp   │
                        │  (Railway)   │         │   (QR Code)  │
                        └──────────────┘         └──────────────┘
```

## 📋 Requisitos

- Cuenta en [Railway](https://railway.app)
- Cuenta en [Vercel](https://vercel.com)
- Cuenta en [GitHub](https://github.com)

---

## 🔧 PASO 1: Desplegar Evolution API en Railway

### 1.1 Crear proyecto en Railway

1. Ve a [railway.app](https://railway.app)
2. Click en **"New Project"**
3. Selecciona **"Deploy from GitHub repo"**
4. Busca: `EvolutionAPI/evolution-api`
5. O usa la opción **"Deploy Template"** y busca "Evolution API"

### 1.2 Alternativamente, usar Docker

1. En Railway, click **"New Project"** → **"Deploy from Docker Image"**
2. Imagen: `atendai/evolution-api:latest`

### 1.3 Configurar variables de entorno en Evolution API

En Railway, ve a tu servicio de Evolution API y agrega estas variables:

```env
# Servidor
SERVER_URL=https://tu-evolution-api.railway.app

# Autenticación
AUTHENTICATION_TYPE=apikey
AUTHENTICATION_API_KEY=tu-api-key-segura-genera-una-aleatoria

# Almacenamiento (usar PostgreSQL de Railway)
DATABASE_ENABLED=true
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://user:pass@host:5432/evolution

# O usar Redis si prefieres
CACHE_REDIS_ENABLED=false

# Webhook global (opcional)
WEBHOOK_GLOBAL_ENABLED=false

# Logs
LOG_LEVEL=ERROR
LOG_COLOR=true

# Puerto (Railway lo asigna)
PORT=8080
```

### 1.4 Agregar PostgreSQL a Evolution API

1. En tu proyecto de Railway, click **"+ New"** → **"Database"** → **"PostgreSQL"**
2. Conecta la variable `DATABASE_CONNECTION_URI` al servicio Evolution

### 1.5 Obtener URL de Evolution API

Una vez desplegado, copia la URL pública (ej: `https://evolution-api-production-xxxx.up.railway.app`)

---

## 🔧 PASO 2: Desplegar Backend de Elisa IA

### 2.1 Subir código a GitHub

1. Crea un nuevo repositorio en GitHub: `elisa-ia-backend`
2. Sube la carpeta `backend` a este repositorio

### 2.2 Desplegar en Railway

1. En Railway, **"New Project"** → **"Deploy from GitHub"**
2. Selecciona tu repositorio `elisa-ia-backend`

### 2.3 Agregar PostgreSQL

1. Click **"+ New"** → **"Database"** → **"PostgreSQL"**
2. Conecta la variable `DATABASE_URL` automáticamente

### 2.4 Configurar variables de entorno

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=genera-un-string-aleatorio-largo
ENCRYPTION_KEY=otra-clave-aleatoria-para-encriptar

# Conectar con Evolution API
EVOLUTION_API_URL=https://tu-evolution-api.railway.app
EVOLUTION_API_KEY=tu-api-key-de-evolution-del-paso-1

# URLs
FRONTEND_URL=https://agentes-elisa-ia.vercel.app
```

### 2.5 La variable WEBHOOK_URL se genera automáticamente

Railway te dará una URL como: `https://elisa-backend-xxx.railway.app`

El webhook será: `https://elisa-backend-xxx.railway.app/api/whatsapp/webhook`

---

## 🔧 PASO 3: Desplegar Frontend en Vercel

### 3.1 Subir código a GitHub

1. Crea repositorio: `elisa-ia-frontend`
2. Sube la carpeta `frontend`

### 3.2 Desplegar en Vercel

1. Ve a [vercel.com](https://vercel.com)
2. **"New Project"** → Importar tu repositorio
3. Framework: **Next.js**
4. Variables de entorno:

```env
NEXT_PUBLIC_API_URL=https://tu-backend-railway.railway.app
```

---

## 🔧 PASO 4: Configurar Webhook en Evolution API

El backend configura automáticamente el webhook por cada usuario cuando se conecta.
Pero también puedes configurar un webhook global si prefieres:

1. Haz una petición POST a tu Evolution API:

```bash
curl -X POST "https://tu-evolution-api.railway.app/webhook/set/global" \
  -H "apikey: tu-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook": {
      "enabled": true,
      "url": "https://tu-backend.railway.app/api/whatsapp/webhook",
      "events": ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"]
    }
  }'
```

---

## 🔧 PASO 5: Probar el Sistema

### 5.1 Verificar Backend

```bash
curl https://tu-backend.railway.app/health
# Debe retornar: {"status":"ok","timestamp":"..."}
```

### 5.2 Verificar Evolution API

```bash
curl https://tu-evolution-api.railway.app/ \
  -H "apikey: tu-api-key"
# Debe retornar información del servidor
```

### 5.3 Probar flujo completo

1. Abre tu frontend: `https://tu-frontend.vercel.app`
2. Regístrate como usuario
3. Configura tu API Key de OpenAI
4. Ve a "Conectar WhatsApp"
5. Escanea el QR Code con tu teléfono
6. ¡Envía un mensaje y verifica la respuesta automática!

---

## 📊 Estructura de Costos (Railway)

| Servicio | Estimado/mes |
|----------|-------------|
| Evolution API | ~$5-10 |
| Backend Elisa IA | ~$5-10 |
| PostgreSQL x2 | ~$5-10 |
| **Total** | **~$15-30** |

*Los costos varían según uso. Railway cobra por consumo.*

---

## 🐛 Troubleshooting

### QR no aparece
- Verifica que Evolution API esté corriendo
- Revisa los logs de Evolution en Railway
- Verifica la API Key

### Mensajes no llegan
- Verifica el webhook en los logs del backend
- Asegúrate que el usuario tenga API Key de OpenAI configurada
- Revisa que haya un asistente activo

### Error de conexión
- Verifica las URLs en variables de entorno
- Asegúrate que CORS esté bien configurado

---

## 📞 Soporte

Si tienes problemas, revisa:
1. Logs de Railway (Backend)
2. Logs de Railway (Evolution API)
3. Consola del navegador (Frontend)

---

## 🎉 ¡Listo!

Tu plataforma Elisa IA está lista para:
- ✅ Múltiples usuarios
- ✅ Cada uno con su WhatsApp (QR Code)
- ✅ Cada uno con su API Key de OpenAI
- ✅ Respuestas automáticas 24/7
- ✅ Panel de administración completo
