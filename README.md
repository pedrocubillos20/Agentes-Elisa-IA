# 🤖 ELISA IA - Plataforma de Chatbots WhatsApp

Plataforma SaaS completa para crear chatbots de WhatsApp con IA.

## 📂 Estructura

```
elisa-evolution/
├── backend/          # API Node.js + Express + Prisma
├── frontend/         # Next.js 14 + Tailwind
├── INSTRUCCIONES.md  # Guía completa de instalación
└── docker-compose.evolution.yml  # Referencia para Evolution API
```

## 🚀 Quick Start

### 1. Desplegar Evolution API en Railway
- Usa la imagen: `atendai/evolution-api:latest`
- Configura las variables de entorno
- Obtén la URL y API Key

### 2. Desplegar Backend en Railway
- Sube la carpeta `backend/` a GitHub
- Despliega desde GitHub en Railway
- Agrega PostgreSQL
- Configura variables de entorno

### 3. Desplegar Frontend en Vercel
- Sube la carpeta `frontend/` a GitHub
- Importa en Vercel
- Configura `NEXT_PUBLIC_API_URL`

## 📋 Variables de Entorno

### Backend
```env
DATABASE_URL=postgresql://...
JWT_SECRET=tu-secret
ENCRYPTION_KEY=otra-clave
EVOLUTION_API_URL=https://tu-evolution.railway.app
EVOLUTION_API_KEY=tu-api-key
```

### Frontend
```env
NEXT_PUBLIC_API_URL=https://tu-backend.railway.app
```

## ✨ Características

- ✅ Múltiples usuarios con sus propios WhatsApps
- ✅ Cada usuario conecta su API Key de OpenAI
- ✅ Conexión WhatsApp con QR Code
- ✅ Respuestas automáticas con IA
- ✅ Panel de administración completo
- ✅ 24/7 en línea

## 📖 Documentación Completa

Ver `INSTRUCCIONES.md` para la guía detallada paso a paso.
