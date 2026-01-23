# 🤖 ELISA IA - Guía Completa de Configuración

## 📋 Resumen del Proyecto

**Elisa IA** es una plataforma SaaS multi-tenant para crear chatbots de WhatsApp con IA. Cada usuario puede:
- Registrarse y crear su cuenta
- Conectar su WhatsApp escaneando un QR
- Configurar su propia API Key de OpenAI
- Personalizar su asistente de IA
- Ver conversaciones en tiempo real

### 🏗️ Arquitectura

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│   FRONTEND      │────▶│   BACKEND       │────▶│  EVOLUTION API  │
│   (Vercel)      │     │   (Railway)     │     │  (VPS)          │
│                 │     │                 │     │                 │
│  Next.js 14     │     │  Node.js        │     │  WhatsApp QR    │
│  Tailwind CSS   │     │  Express        │     │  Baileys        │
│                 │     │  Prisma         │     │                 │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │                 │
                        │   SUPABASE      │
                        │   PostgreSQL    │
                        │                 │
                        │   9 Tablas      │
                        │                 │
                        └─────────────────┘
```

---

## 🔧 PASO 1: Configurar Supabase (Base de Datos)

### 1.1 Crear proyecto en Supabase
1. Ve a [supabase.com](https://supabase.com)
2. Crea un nuevo proyecto
3. Anota el **Project Reference** (ejemplo: `abcdefghijklmnop`)
4. Anota el **Password** de la base de datos

### 1.2 Obtener URLs de conexión
1. Ve a **Settings** → **Database**
2. Scroll hasta **Connection String**
3. Selecciona **URI** y copia:

**Para DATABASE_URL (con pooling, puerto 6543):**
```
postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true
```

**Para DIRECT_URL (sin pooling, puerto 5432):**
```
postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres
```

### 1.3 Ejemplo real
Si tu proyecto es `abcdefghijklmnop` y tu password es `MiPassword123`:
```
DATABASE_URL=postgresql://postgres.abcdefghijklmnop:MiPassword123@aws-0-us-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.abcdefghijklmnop:MiPassword123@aws-0-us-west-1.pooler.supabase.com:5432/postgres
```

---

## 🚀 PASO 2: Configurar Railway (Backend)

### 2.1 Variables de entorno en Railway

Ve a tu servicio en Railway → **Variables** y configura:

| Variable | Valor | Descripción |
|----------|-------|-------------|
| `DATABASE_URL` | `postgresql://postgres.xxx...` | URL con pooling (puerto 6543) |
| `DIRECT_URL` | `postgresql://postgres.xxx...` | URL directa (puerto 5432) |
| `JWT_SECRET` | `ElisaIA_JWT_2026_TuClave...` | Clave JWT (mín 32 chars) |
| `ENCRYPTION_KEY` | `ElisaIA_Encrypt_2026...` | Clave encriptación API keys |
| `EVOLUTION_API_URL` | `http://TU-IP-VPS:8080` | URL de Evolution API |
| `EVOLUTION_API_KEY` | `TuApiKeyEvolution` | API Key de Evolution |
| `FRONTEND_URL` | `https://agentes-elisa-ia.vercel.app` | URL de Vercel |
| `NODE_ENV` | `production` | Entorno |

### 2.2 Ejecutar migraciones
Railway ejecutará automáticamente las migraciones al desplegar gracias al Dockerfile actualizado.

Si necesitas ejecutarlas manualmente, ve a **Settings** → **Start Command**:
```bash
npx prisma migrate deploy && node dist/server.js
```

### 2.3 Verificar salud del backend
```bash
curl https://tu-backend.up.railway.app/health
```

Respuesta esperada:
```json
{
  "status": "ok",
  "services": {
    "database": "connected",
    "evolution_api": "configured",
    "env_vars": "complete"
  }
}
```

---

## 📱 PASO 3: Configurar Evolution API (VPS)

### 3.1 Requisitos del VPS
- Ubuntu 20.04+ o Debian 11+
- Docker y Docker Compose instalados
- Puerto 8080 abierto en firewall

### 3.2 Instalar Docker
```bash
# Actualizar sistema
sudo apt update && sudo apt upgrade -y

# Instalar Docker
curl -fsSL https://get.docker.com | sh

# Instalar Docker Compose
sudo apt install docker-compose -y

# Agregar usuario a grupo docker
sudo usermod -aG docker $USER
newgrp docker
```

### 3.3 Crear docker-compose.yml
```bash
mkdir -p /opt/evolution-api
cd /opt/evolution-api
nano docker-compose.yml
```

Contenido:
```yaml
version: '3.8'

services:
  evolution-api:
    image: atendai/evolution-api:v2.3.7
    container_name: evolution_api
    restart: always
    ports:
      - "8080:8080"
    environment:
      - SERVER_URL=http://TU_IP_PUBLICA:8080
      - AUTHENTICATION_TYPE=apikey
      - AUTHENTICATION_API_KEY=TuApiKeySegura2026
      - AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true
      - DATABASE_ENABLED=true
      - DATABASE_PROVIDER=postgresql
      - DATABASE_CONNECTION_URI=postgresql://postgres.xxx:password@aws-0-us-west-1.pooler.supabase.com:6543/postgres
      - DATABASE_SAVE_DATA_INSTANCE=true
      - DATABASE_SAVE_DATA_NEW_MESSAGE=true
      - DATABASE_SAVE_MESSAGE_UPDATE=true
      - DATABASE_SAVE_DATA_CONTACTS=true
      - DATABASE_SAVE_DATA_CHATS=true
      - QRCODE_LIMIT=10
      - QRCODE_COLOR=#0a5f54
      - CONFIG_SESSION_PHONE_CLIENT=Elisa IA
      - CONFIG_SESSION_PHONE_NAME=Chrome
      - WEBHOOK_GLOBAL_ENABLED=false
      - WEBHOOK_GLOBAL_WEBSOCKET_ENABLED=false
    volumes:
      - evolution_instances:/evolution/instances
      - evolution_store:/evolution/store

volumes:
  evolution_instances:
  evolution_store:
```

### 3.4 Iniciar Evolution API
```bash
docker-compose up -d
docker-compose logs -f evolution_api
```

### 3.5 Verificar que funciona
```bash
curl http://TU_IP:8080/ -H "apikey: TuApiKeySegura2026"
```

---

## 🌐 PASO 4: Configurar Vercel (Frontend)

### 4.1 Variables de entorno en Vercel
Ve a tu proyecto → **Settings** → **Environment Variables**:

| Variable | Valor |
|----------|-------|
| `NEXT_PUBLIC_API_URL` | `https://tu-backend.up.railway.app` |

### 4.2 Redesplegar
Después de agregar las variables, haz un nuevo deploy.

---

## ✅ PASO 5: Verificar que Todo Funciona

### 5.1 Health Check del Backend
```bash
curl https://tu-backend.up.railway.app/health
```

### 5.2 Health Check de Evolution API
```bash
curl http://tu-ip-vps:8080/ -H "apikey: TuApiKey"
```

### 5.3 Probar el flujo completo
1. Abre el frontend: `https://agentes-elisa-ia.vercel.app`
2. Registra un nuevo usuario
3. Inicia sesión
4. Ve a **Configuración** → Agrega tu API Key de OpenAI
5. Ve a **WhatsApp** → Conecta escaneando el QR
6. Envía un mensaje de prueba desde tu teléfono
7. Verifica que el bot responda automáticamente

---

## 🐛 Solución de Problemas

### Supabase muestra 0 REST Requests
**Esto es NORMAL**. Prisma usa conexión directa PostgreSQL, NO la API REST de Supabase.
- ✅ Si las tablas existen, la conexión funciona
- ✅ Verifica con el endpoint `/health` del backend

### Error: Instance not found
El QR expiró o la instancia fue eliminada. Solución:
1. En el dashboard, haz clic en "Desconectar"
2. Vuelve a hacer clic en "Conectar"
3. Escanea el nuevo QR

### Error: API Key de OpenAI inválida
1. Verifica que la API Key sea correcta en OpenAI
2. Verifica que tengas créditos en tu cuenta de OpenAI
3. Elimina y vuelve a agregar la API Key

### El bot no responde
1. Verifica que WhatsApp esté conectado (status: connected)
2. Verifica que la API Key de OpenAI esté configurada
3. Revisa los logs de Railway:
   ```bash
   railway logs
   ```

### Error de conexión a base de datos
1. Verifica que DATABASE_URL tenga el formato correcto
2. Verifica que DIRECT_URL esté configurado
3. Verifica que la IP de Railway esté permitida en Supabase

---

## 📊 Estructura de la Base de Datos

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│    User     │────▶│  Assistant  │────▶│Conversation │
├─────────────┤     ├─────────────┤     ├─────────────┤
│ id          │     │ id          │     │ id          │
│ email       │     │ userId      │     │ recipientId │
│ password    │     │ name        │     │ userId      │
│ apiKey*     │     │ personality │     │ assistantId │
│ whatsapp*   │     │ context     │     │ messages[]  │
│ plan        │     │ model       │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
       │                                       │
       ▼                                       ▼
┌─────────────┐                        ┌─────────────┐
│    FAQ      │                        │   Message   │
├─────────────┤                        ├─────────────┤
│ id          │                        │ id          │
│ userId      │                        │ conversationId
│ question    │                        │ role        │
│ answer      │                        │ content     │
└─────────────┘                        └─────────────┘
       │
       ▼
┌─────────────┐
│   Product   │
├─────────────┤
│ id          │
│ userId      │
│ name        │
│ price       │
└─────────────┘
```

---

## 💰 Costos Estimados

| Servicio | Plan | Costo Mensual |
|----------|------|---------------|
| Vercel | Hobby (gratis) | $0 |
| Railway | Usage-based | ~$5-10 |
| Supabase | Free tier | $0 |
| VPS (Evolution) | DigitalOcean/Hetzner | ~$5-10 |
| **TOTAL** | | **~$10-20/mes** |

---

## 📞 Soporte

Si tienes problemas:
1. Revisa los logs de Railway
2. Revisa los logs de Evolution API: `docker-compose logs -f`
3. Verifica el endpoint `/health` del backend
4. Verifica que todas las variables estén configuradas

---

¡Listo! Tu plataforma Elisa IA debería estar funcionando. 🎉
