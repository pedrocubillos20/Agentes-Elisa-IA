# 🚀 Guía de Despliegue - Elisa IA Platform

Esta guía te llevará paso a paso para desplegar la plataforma Elisa IA en producción.

---

## 📋 Índice

1. [Requisitos Previos](#requisitos-previos)
2. [Arquitectura](#arquitectura)
3. [Configuración de Base de Datos](#configuración-de-base-de-datos)
4. [Despliegue del Backend](#despliegue-del-backend)
5. [Despliegue del Frontend](#despliegue-del-frontend)
6. [Configuración de Stripe](#configuración-de-stripe)
7. [Configuración de WhatsApp](#configuración-de-whatsapp)
8. [Variables de Entorno](#variables-de-entorno)
9. [Dominios y SSL](#dominios-y-ssl)
10. [Monitoreo](#monitoreo)

---

## 📦 Requisitos Previos

### Cuentas Necesarias

| Servicio | Para qué | Costo |
|----------|----------|-------|
| **Railway/Render/Heroku** | Backend hosting | Desde $5/mes |
| **Vercel/Netlify** | Frontend hosting | Gratis tier disponible |
| **Supabase/Neon/Railway** | PostgreSQL | Gratis tier disponible |
| **Stripe** | Pagos | 2.9% + 30¢ por transacción |
| **Meta Business** | WhatsApp API | Gratis + costo por mensaje |
| **Resend/SendGrid** | Emails | Gratis tier disponible |

### Software Local

```bash
# Verificar versiones
node --version    # v18+ requerido
npm --version     # v9+
git --version
```

---

## 🏗️ Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│                     USUARIOS                             │
└──────────────┬──────────────────────┬───────────────────┘
               │                      │
               ▼                      ▼
┌──────────────────────┐   ┌─────────────────────────────┐
│   FRONTEND (Vercel)  │   │  WIDGET CHAT (CDN/Vercel)   │
│   - Next.js 14       │   │  - JavaScript embebible     │
│   - React            │   │  - CSS inline               │
└──────────┬───────────┘   └─────────────┬───────────────┘
           │                             │
           └──────────────┬──────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│                 BACKEND API (Railway)                    │
│   - Node.js + Express                                   │
│   - Prisma ORM                                          │
│   - JWT Auth                                            │
└────────┬─────────────┬─────────────┬───────────────────┘
         │             │             │
         ▼             ▼             ▼
┌────────────┐  ┌────────────┐  ┌────────────────────────┐
│ PostgreSQL │  │   Stripe   │  │     WhatsApp API       │
│ (Supabase) │  │  (Pagos)   │  │ (Meta Cloud/Webhook)   │
└────────────┘  └────────────┘  └────────────────────────┘
```

---

## 🗄️ Configuración de Base de Datos

### Opción 1: Supabase (Recomendado para empezar)

1. **Crear cuenta** en [supabase.com](https://supabase.com)

2. **Crear proyecto** nuevo

3. **Obtener connection string**:
   - Ve a Settings → Database → Connection string
   - Copia el string de "URI"

4. **Configurar en .env**:
```env
DATABASE_URL="postgresql://postgres:[TU-PASSWORD]@db.[ID].supabase.co:5432/postgres"
```

### Opción 2: Railway

1. Crear proyecto en [railway.app](https://railway.app)
2. Add → Database → PostgreSQL
3. Copiar DATABASE_URL de Variables

### Opción 3: Neon (Serverless)

1. Crear cuenta en [neon.tech](https://neon.tech)
2. Crear proyecto
3. Copiar connection string

### Migrar Base de Datos

```bash
cd backend

# Instalar dependencias
npm install

# Generar cliente de Prisma
npx prisma generate

# Ejecutar migraciones
npx prisma migrate deploy

# (Opcional) Ver base de datos
npx prisma studio
```

---

## 🖥️ Despliegue del Backend

### Opción 1: Railway (Recomendado)

1. **Conectar repositorio**:
```bash
# Instalar CLI
npm install -g @railway/cli

# Login
railway login

# Crear proyecto
railway init
```

2. **Configurar build**:
   - Root Directory: `backend`
   - Build Command: `npm run build`
   - Start Command: `npm start`

3. **Agregar variables de entorno** en Railway Dashboard

4. **Deploy**:
```bash
railway up
```

### Opción 2: Render

1. Crear nuevo Web Service en [render.com](https://render.com)
2. Conectar repositorio GitHub
3. Configurar:
   - Root Directory: `backend`
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`

### Opción 3: Heroku

```bash
# Instalar CLI
npm install -g heroku

# Login y crear app
heroku login
heroku create elisa-ia-api

# Configurar
heroku config:set NODE_ENV=production
heroku config:set DATABASE_URL=...

# Deploy
git push heroku main
```

### Opción 4: VPS (DigitalOcean/Linode)

```bash
# En el servidor
sudo apt update
sudo apt install nodejs npm nginx certbot

# Clonar repo
git clone https://github.com/tu-usuario/elisa-ia-platform.git
cd elisa-ia-platform/backend

# Instalar y construir
npm install
npm run build

# Usar PM2 para mantener corriendo
npm install -g pm2
pm2 start dist/server.js --name "elisa-api"
pm2 save
pm2 startup
```

---

## 🌐 Despliegue del Frontend

### Vercel (Recomendado)

1. **Importar proyecto** en [vercel.com](https://vercel.com)

2. **Configurar**:
   - Framework Preset: Next.js
   - Root Directory: `frontend`

3. **Variables de entorno**:
```env
NEXT_PUBLIC_API_URL=https://tu-api.railway.app
NEXT_PUBLIC_STRIPE_PUBLIC_KEY=pk_live_xxx
```

4. **Deploy automático** con cada push a `main`

### Netlify

1. Importar proyecto
2. Build command: `npm run build`
3. Publish directory: `.next`

---

## 💳 Configuración de Stripe

### 1. Crear Cuenta y Productos

1. Registrarte en [stripe.com](https://stripe.com)
2. Ir a **Products** → **Add Product**

3. Crear productos:

**Plan Mensual Starter ($49/mes)**
- Nombre: "Plan Mensual Starter"
- Precio: $49.00 USD, Recurrente mensual
- Copiar `price_id`

**Plan Vitalicio Pro ($297)**
- Nombre: "Plan Vitalicio Pro"
- Precio: $297.00 USD, Pago único
- Copiar `price_id`

### 2. Configurar Webhooks

1. Ir a **Developers** → **Webhooks**
2. **Add endpoint**:
   - URL: `https://tu-api.com/api/webhooks/stripe`
   - Events:
     - `checkout.session.completed`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_failed`

3. Copiar **Signing secret** → `STRIPE_WEBHOOK_SECRET`

### 3. Variables en .env

```env
STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
STRIPE_PRICE_STARTER_MONTHLY=price_xxxxx
STRIPE_PRICE_PRO_MONTHLY=price_xxxxx
STRIPE_PRICE_STARTER_LIFETIME=price_xxxxx
STRIPE_PRICE_PRO_LIFETIME=price_xxxxx
```

---

## 📱 Configuración de WhatsApp

Ver [WHATSAPP_SETUP.md](./WHATSAPP_SETUP.md) para guía detallada.

**Resumen rápido:**

1. Crear cuenta en [Meta Business](https://business.facebook.com)
2. Configurar WhatsApp Business API
3. Obtener tokens y configurar webhook
4. Agregar variables:

```env
WHATSAPP_TOKEN=EAAxxxxxxxxxxxxx
WHATSAPP_PHONE_NUMBER_ID=123456789
WHATSAPP_VERIFY_TOKEN=mi-token-secreto
WHATSAPP_BUSINESS_ACCOUNT_ID=987654321
```

---

## 🔐 Variables de Entorno Completas

### Backend (.env)

```env
# General
NODE_ENV=production
PORT=3001
FRONTEND_URL=https://app.elisa-ia.com

# Base de datos
DATABASE_URL=postgresql://...

# Auth
JWT_SECRET=genera-un-string-de-64-caracteres-aleatorios
JWT_EXPIRES_IN=7d

# Encriptación
ENCRYPTION_KEY=genera-un-string-de-32-caracteres

# Stripe
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_STARTER_MONTHLY=price_xxx
STRIPE_PRICE_PRO_MONTHLY=price_xxx
STRIPE_PRICE_STARTER_LIFETIME=price_xxx
STRIPE_PRICE_PRO_LIFETIME=price_xxx

# WhatsApp
WHATSAPP_TOKEN=EAAxxxx
WHATSAPP_PHONE_NUMBER_ID=xxx
WHATSAPP_VERIFY_TOKEN=mi-token
WHATSAPP_BUSINESS_ACCOUNT_ID=xxx

# Email (opcional)
RESEND_API_KEY=re_xxx
EMAIL_FROM=noreply@elisa-ia.com
```

### Frontend (.env.local)

```env
NEXT_PUBLIC_API_URL=https://api.elisa-ia.com
NEXT_PUBLIC_STRIPE_PUBLIC_KEY=pk_live_xxx
NEXT_PUBLIC_GA_ID=G-XXXXXXX
```

---

## 🌍 Dominios y SSL

### Configuración de Dominios

1. **Comprar dominio** (Namecheap, GoDaddy, Cloudflare)

2. **Configurar DNS**:
```
# En tu proveedor de DNS
A     @       -> IP de Vercel
A     api     -> IP de Railway
CNAME www     -> tu-app.vercel.app
```

3. **SSL** es automático en Vercel, Railway, Render

### Subdominios Sugeridos

- `elisa-ia.com` - Landing page
- `app.elisa-ia.com` - Dashboard
- `api.elisa-ia.com` - Backend API
- `widget.elisa-ia.com` - Widget JS (CDN)

---

## 📊 Monitoreo

### Herramientas Recomendadas

| Herramienta | Para qué | Costo |
|-------------|----------|-------|
| **Sentry** | Errores | Gratis tier |
| **LogTail** | Logs | Gratis tier |
| **Uptime Robot** | Uptime | Gratis |
| **Google Analytics** | Analytics | Gratis |

### Configurar Sentry

```bash
npm install @sentry/node
```

```typescript
// En server.ts
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
});
```

---

## ✅ Checklist de Lanzamiento

- [ ] Base de datos configurada y migrada
- [ ] Backend desplegado y funcionando
- [ ] Frontend desplegado
- [ ] Variables de entorno configuradas
- [ ] Stripe configurado con webhooks
- [ ] WhatsApp Business API conectada
- [ ] Dominios configurados con SSL
- [ ] Monitoreo de errores activo
- [ ] Backups de base de datos configurados
- [ ] Emails transaccionales funcionando
- [ ] Tests de integración pasando

---

## 🆘 Troubleshooting

### Error: "Database connection failed"
- Verificar `DATABASE_URL`
- Verificar que la IP esté whitelisted

### Error: "Stripe webhook signature failed"
- Verificar `STRIPE_WEBHOOK_SECRET`
- Asegurar que el endpoint use `express.raw()`

### Error: "WhatsApp message not sending"
- Verificar token no expirado
- Verificar que el template esté aprobado

---

## 📞 Soporte

¿Necesitas ayuda? Contacta al equipo de desarrollo o revisa la documentación detallada en `/docs`.
