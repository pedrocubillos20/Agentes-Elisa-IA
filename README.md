# 🤖 ELISA IA - Plataforma de Chatbots WhatsApp

## Evolution API v1.8.0 (Versión Estable)

Esta versión está optimizada para **Evolution API v1.8.0**, la cual es más estable y **NO tiene problemas de LID**.

---

## 📋 ¿Por qué v1.8.0?

| Característica | v2.3.x | v1.8.0 |
|----------------|--------|--------|
| Estabilidad | ⚠️ Problemas de conexión | ✅ Muy estable |
| LID (LinkedIn ID) | ⚠️ Requiere mapeo complejo | ✅ No tiene este problema |
| Número real | Viene en `data.number` o `participant` | ✅ Viene en `key.remoteJid` |
| Redis | ⚠️ Requerido | ✅ No requerido |
| Complejidad | Alta | ✅ Simple |

---

## 🚀 Instalación en VPS

### 1. Instalar Evolution API v1.8.0

```bash
# Ir a la carpeta de evolution
cd /opt/evolution-api

# Detener contenedores actuales
docker-compose down

# Copiar el nuevo docker-compose
# (Usa el archivo docker-compose.evolution.yml de este repositorio)

# Iniciar Evolution API v1.8.0
docker-compose up -d

# Verificar que esté corriendo
docker ps
docker logs evolution_api --tail 50
```

### 2. Verificar que funciona

```bash
# Test básico
curl http://localhost:8080

# Crear instancia de prueba
curl -X POST "http://localhost:8080/instance/create" \
  -H "apikey: ElisaIA_Evolution_Key_2026_SecretKey" \
  -H "Content-Type: application/json" \
  -d '{"instanceName":"test","qrcode":true,"integration":"WHATSAPP-BAILEYS"}'
```

---

## 📱 Estructura del Webhook v1.8.0

En v1.8.0, el número real viene **directamente** en `key.remoteJid`:

```json
{
  "event": "messages.upsert",
  "instance": "elisa_xxx",
  "data": {
    "key": {
      "remoteJid": "573001234567@s.whatsapp.net",
      "fromMe": false,
      "id": "xxx"
    },
    "pushName": "Juan",
    "message": {
      "conversation": "Hola"
    }
  }
}
```

**¡No hay LID!** El número `573001234567` está directamente disponible.

---

## 🔧 Configuración de Variables de Entorno

### Backend (Vercel/Railway)

```env
NODE_ENV=production
PORT=3000

# Base de datos (Supabase)
DATABASE_URL=postgresql://postgres.xxx:password@aws-1-sa-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.xxx:password@aws-1-sa-east-1.pooler.supabase.com:5432/postgres

# JWT
JWT_SECRET=tu-secreto-jwt-seguro

# Evolution API v1.8.0
EVOLUTION_API_URL=http://31.97.142.127:8080
EVOLUTION_API_KEY=ElisaIA_Evolution_Key_2026_SecretKey

# Webhook
WEBHOOK_URL=https://tu-backend.vercel.app/api/whatsapp/webhook
```

### Frontend (Vercel)

```env
NEXT_PUBLIC_API_URL=https://tu-backend.vercel.app
```

---

## 📂 Estructura del Proyecto

```
elisa-ia-v1.8.0/
├── backend/
│   ├── src/
│   │   ├── services/
│   │   │   ├── evolutionService.ts  # ✅ Optimizado para v1.8.0
│   │   │   └── openaiService.ts
│   │   ├── routes/
│   │   │   ├── whatsapp.routes.ts   # ✅ Simplificado sin LID
│   │   │   ├── auth.routes.ts
│   │   │   ├── assistants.routes.ts
│   │   │   └── conversations.routes.ts
│   │   ├── lib/
│   │   │   └── prisma.ts
│   │   └── server.ts
│   ├── prisma/
│   │   └── schema.prisma
│   ├── package.json
│   └── Dockerfile
├── frontend/
│   └── ... (Next.js app)
├── docker-compose.evolution.yml     # ✅ Para Evolution API v1.8.0
└── README.md
```

---

## 🔄 Flujo de Mensajes

```
1. Usuario envía mensaje a WhatsApp
                ↓
2. WhatsApp → Evolution API v1.8.0
                ↓
3. Evolution API → Webhook (tu backend)
   {
     "key": {
       "remoteJid": "573001234567@s.whatsapp.net"  ← NÚMERO REAL
     }
   }
                ↓
4. Backend extrae número: "573001234567"
                ↓
5. Backend → OpenAI (genera respuesta)
                ↓
6. Backend → Evolution API → WhatsApp
   Envía respuesta a: "573001234567"
                ↓
7. Usuario recibe respuesta ✅
```

---

## 🛠️ Despliegue

### Backend en Vercel

1. Sube el código del backend a un repositorio de GitHub
2. Conecta el repositorio a Vercel
3. Configura las variables de entorno
4. Despliega

### Frontend en Vercel

1. Sube el código del frontend a GitHub
2. Conecta a Vercel
3. Configura `NEXT_PUBLIC_API_URL`
4. Despliega

### Evolution API en VPS

```bash
# En tu VPS (Hostinger)
cd /opt/evolution-api
docker-compose down
# Reemplaza docker-compose.yml con docker-compose.evolution.yml
docker-compose up -d
```

---

## 📝 Notas Importantes

1. **v1.8.0 no necesita Redis** - Es más simple de configurar
2. **El número siempre viene limpio** - No hay que buscar en múltiples campos
3. **Sin mapeo LID** - El código es mucho más simple y confiable
4. **Usa PostgreSQL local** - Más estable que Supabase para Evolution API

---

## 🆘 Solución de Problemas

### Evolution API no responde

```bash
docker logs evolution_api --tail 100
docker-compose restart
```

### Error de conexión a base de datos

```bash
docker logs evolution_postgres --tail 50
docker-compose down
docker-compose up -d
```

### El webhook no recibe mensajes

1. Verifica que el webhook esté configurado:
```bash
curl -X GET "http://localhost:8080/webhook/find/tu_instancia" \
  -H "apikey: ElisaIA_Evolution_Key_2026_SecretKey"
```

2. Configura el webhook manualmente:
```bash
curl -X POST "http://localhost:8080/webhook/set/tu_instancia" \
  -H "apikey: ElisaIA_Evolution_Key_2026_SecretKey" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook": {
      "enabled": true,
      "url": "https://tu-backend.vercel.app/api/whatsapp/webhook",
      "events": ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"]
    }
  }'
```

---

## 📞 Soporte

Si tienes problemas:
1. Revisa los logs de Docker
2. Verifica las variables de entorno
3. Asegúrate de que el puerto 8080 está abierto en el firewall

---

**Versión:** 3.1.0  
**Evolution API:** v1.8.0  
**Última actualización:** Enero 2026
