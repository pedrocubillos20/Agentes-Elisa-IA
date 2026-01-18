# 🤖 Elisa IA - Chatbots de WhatsApp con IA

Plataforma para crear chatbots inteligentes de WhatsApp Business.

## 📋 Modelo de Negocio

| Plan | Tipo | Precio | Quién Configura | Chatbots |
|------|------|--------|-----------------|----------|
| **Emprendedores** | Mensual | $180,000 COP | Admin (ustedes) | 1 |
| **Negocios en Crecimiento** | Mensual | $360,000 COP | Admin (ustedes) | 3 |
| **Business** | Vitalicio | $1,440,000 COP | El usuario | 5 |
| **Marca Blanca** | Vitalicio | $2,520,000 COP | El usuario | ∞ |

⚠️ **TODOS los planes requieren que el usuario configure su API Key de OpenAI**

## 🏗️ Arquitectura

```
├── backend/          # API REST (Node.js + Express + Prisma)
│   └── Railway
├── frontend/         # Dashboard (Next.js)
│   └── Vercel
└── database/         # PostgreSQL
    └── Supabase
```

## 🚀 URLs de Producción

- **Frontend:** https://agentes-elisa-ia.vercel.app
- **Backend:** https://elisa-iaagentes-production.up.railway.app
- **Database:** Supabase PostgreSQL

## 📦 Instalación Local

### Backend

```bash
cd backend
npm install
cp .env.example .env  # Editar con tus variables
npx prisma generate
npx prisma migrate deploy
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## 🔑 Variables de Entorno

### Backend (.env)

```
DATABASE_URL=postgresql://...
JWT_SECRET=tu-clave-secreta
ENCRYPTION_KEY=clave-32-caracteres
WOMPI_PUBLIC_KEY=pub_prod_xxx
WOMPI_PRIVATE_KEY=prv_prod_xxx
WOMPI_EVENT_SECRET=prod_event_xxx
WOMPI_INTEGRITY_SECRET=prod_integrity_xxx
FRONTEND_URL=https://agentes-elisa-ia.vercel.app
```

### Frontend (Vercel)

```
NEXT_PUBLIC_API_URL=https://elisa-iaagentes-production.up.railway.app
```

## 📱 Widget Embebible

Para integrar el chat en una web:

```html
<script>
  window.ElisaIA = { apiKey: 'TU_API_KEY' };
</script>
<script src="https://agentes-elisa-ia.vercel.app/widget.js" async></script>
```

## 🔄 Flujo de Usuario

1. Usuario se registra
2. **CONFIGURA SU API KEY DE OPENAI** (obligatorio)
3. Selecciona y paga un plan (Wompi)
4. Conecta WhatsApp (QR)
5. El chatbot comienza a responder

## 💳 Pagos con Wompi

- Tarjetas de prueba: 4242 4242 4242 4242
- Webhook: `https://backend-url/api/webhooks/wompi`

## 📞 Soporte

Para soporte técnico contactar al administrador.
