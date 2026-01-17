# Elisa IA - Backend API

Backend para la plataforma de asistentes inteligentes Elisa IA.

## 🚀 Tecnologías

- **Node.js** + **Express** - Framework web
- **TypeScript** - Tipado estático
- **Prisma** - ORM para PostgreSQL
- **JWT** - Autenticación
- **Wompi** - Pagos (Colombia)

## 📁 Estructura

```
src/
├── server.ts          # Punto de entrada
├── routes/            # Rutas de la API
│   ├── auth.routes.ts
│   ├── business.routes.ts
│   ├── assistant.routes.ts
│   ├── payment.routes.ts
│   └── webhook.routes.ts
├── middleware/        # Middlewares
│   └── auth.ts
├── services/          # Lógica de negocio
└── utils/             # Utilidades
```

## 🔧 Configuración

1. Copia `.env.example` a `.env`
2. Configura las variables de entorno
3. Ejecuta `npm install`
4. Ejecuta `npx prisma generate`
5. Ejecuta `npm run dev`

## 📡 Endpoints

### Autenticación
- `POST /api/auth/register` - Registro de usuario
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Obtener perfil

### Negocios
- `GET /api/business` - Listar negocios
- `POST /api/business` - Crear negocio
- `PUT /api/business/:id` - Actualizar negocio
- `DELETE /api/business/:id` - Eliminar negocio

### Asistentes
- `GET /api/assistants` - Listar asistentes
- `POST /api/assistants` - Crear asistente
- `PUT /api/assistants/:id` - Actualizar asistente
- `PATCH /api/assistants/:id/toggle` - Activar/Desactivar
- `DELETE /api/assistants/:id` - Eliminar asistente

### Pagos
- `POST /api/payments/create-payment` - Crear pago
- `GET /api/payments/verify/:reference` - Verificar pago
- `GET /api/payments/history` - Historial de pagos

### Webhooks
- `POST /api/webhooks/wompi` - Webhook de Wompi

## 🌐 Despliegue en Railway

1. Conecta tu repositorio de GitHub
2. Configura las variables de entorno
3. Railway detectará el Dockerfile automáticamente

## 📝 Variables de Entorno Requeridas

```
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://...
JWT_SECRET=...
WOMPI_PUBLIC_KEY=...
WOMPI_PRIVATE_KEY=...
WOMPI_EVENT_SECRET=...
FRONTEND_URL=https://tu-frontend.vercel.app
```

## 📜 Licencia

Privado - Elisa IA
