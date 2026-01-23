# 🤖 ELISA IA - Plataforma SaaS de Chatbots WhatsApp

<p align="center">
  <img src="https://img.shields.io/badge/version-3.1.0-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg" alt="Node">
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License">
</p>

## 📋 Descripción

**Elisa IA** es una plataforma SaaS multi-tenant que permite a los usuarios crear chatbots de WhatsApp con Inteligencia Artificial. Cada usuario puede:

- ✅ Registrarse y crear su cuenta
- ✅ Conectar su WhatsApp escaneando un código QR
- ✅ Configurar su propia API Key de OpenAI
- ✅ Personalizar su asistente de IA (personalidad, contexto, instrucciones)
- ✅ Agregar FAQs y productos/servicios
- ✅ Ver conversaciones en tiempo real

## 🏗️ Arquitectura

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   FRONTEND      │────▶│   BACKEND       │────▶│  EVOLUTION API  │
│   (Vercel)      │     │   (Railway)     │     │  (VPS)          │
│                 │     │                 │     │                 │
│  Next.js 14     │     │  Node.js        │     │  WhatsApp QR    │
│  Tailwind CSS   │     │  Express        │     │  v2.3.7         │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │   SUPABASE      │
                        │   PostgreSQL    │
                        └─────────────────┘
```

## 📦 Estructura del Proyecto

```
elisa-ia/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma       # Esquema de base de datos
│   ├── src/
│   │   ├── lib/
│   │   │   └── prisma.ts       # Cliente Prisma
│   │   ├── routes/
│   │   │   ├── auth.routes.ts       # Autenticación
│   │   │   ├── whatsapp.routes.ts   # WhatsApp + Webhook
│   │   │   ├── assistants.routes.ts # Asistentes
│   │   │   └── conversations.routes.ts # Conversaciones
│   │   ├── services/
│   │   │   ├── evolutionService.ts  # Evolution API
│   │   │   └── openaiService.ts     # OpenAI
│   │   └── server.ts           # Servidor principal
│   ├── Dockerfile              # Docker para Railway
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   └── app/                # Páginas Next.js
│   ├── package.json
│   └── next.config.js
├── docs/
│   └── GUIA_CONFIGURACION.md   # Guía paso a paso
└── docker-compose.evolution.yml # Docker para VPS
```

## 🚀 Inicio Rápido

### Requisitos
- Node.js 18+
- Cuenta en [Supabase](https://supabase.com)
- Cuenta en [Railway](https://railway.app)
- Cuenta en [Vercel](https://vercel.com)
- VPS con Docker (para Evolution API)

### 1. Configurar Supabase
1. Crea un proyecto en Supabase
2. Copia las URLs de conexión (ver `docs/GUIA_CONFIGURACION.md`)

### 2. Desplegar Backend en Railway
1. Conecta tu repositorio de GitHub
2. Configura las variables de entorno (ver `.env.example`)
3. Railway desplegará automáticamente

### 3. Desplegar Frontend en Vercel
1. Importa el proyecto desde GitHub
2. Configura `NEXT_PUBLIC_API_URL` con la URL de Railway

### 4. Configurar Evolution API en VPS
```bash
# En tu VPS
cd /opt
git clone <tu-repo>
cd elisa-ia
docker-compose -f docker-compose.evolution.yml up -d
```

## ⚙️ Variables de Entorno

### Backend (Railway)
| Variable | Descripción |
|----------|-------------|
| `DATABASE_URL` | URL PostgreSQL con pooling (puerto 6543) |
| `DIRECT_URL` | URL PostgreSQL directa (puerto 5432) |
| `JWT_SECRET` | Clave secreta para JWT |
| `ENCRYPTION_KEY` | Clave para encriptar API Keys |
| `EVOLUTION_API_URL` | URL de Evolution API |
| `EVOLUTION_API_KEY` | API Key de Evolution |
| `FRONTEND_URL` | URL del frontend |

### Frontend (Vercel)
| Variable | Descripción |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | URL del backend |

## 📱 Flujo de Conexión WhatsApp

1. Usuario se registra/logea
2. Va a **Configuración** → Agrega su API Key de OpenAI
3. Va a **WhatsApp** → Click en "Conectar"
4. El backend crea una instancia en Evolution API
5. Se genera y muestra el código QR
6. Usuario escanea con WhatsApp
7. Evolution API notifica vía webhook cuando está conectado
8. Los mensajes entrantes se procesan automáticamente con IA

## 🔒 Seguridad

- Las API Keys de OpenAI se almacenan **encriptadas** (AES-256)
- Autenticación con JWT
- Cada usuario tiene su propia instancia de WhatsApp aislada
- CORS configurado para el frontend

## 💰 Costos Estimados

| Servicio | Plan | Costo/mes |
|----------|------|-----------|
| Vercel | Hobby | $0 |
| Railway | Usage | ~$5-10 |
| Supabase | Free | $0 |
| VPS | Basic | ~$5-10 |
| **Total** | | **~$10-20** |

## 📖 Documentación

- [Guía de Configuración Completa](docs/GUIA_CONFIGURACION.md)
- [API Evolution v2.3.7](https://doc.evolution-api.com/v2/introduction)

## 🤝 Contribuir

1. Fork el repositorio
2. Crea tu rama (`git checkout -b feature/nueva-funcionalidad`)
3. Commit tus cambios (`git commit -am 'Agregar nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Abre un Pull Request

## 📄 Licencia

MIT License - ver [LICENSE](LICENSE)

---

**Desarrollado con ❤️ para automatizar la atención al cliente**
