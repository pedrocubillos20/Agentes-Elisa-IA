# Elisa IA - Chatbots de WhatsApp con Inteligencia Artificial

## 🔧 Solución al Error de Login

El error que estabas viendo:
```
Error converting field "plan" of expected non-nullable type "String", found incompatible value of "FREE"
```

Se debe a una incompatibilidad entre el tipo del campo `plan` en la base de datos (ENUM) y el schema de Prisma (que lo tenía como String).

### Cambios Realizados:

1. **Schema de Prisma actualizado** (`prisma/schema.prisma`):
   - El campo `plan` ahora usa un enum `Plan` en lugar de String
   - Esto coincide con la estructura de la base de datos

2. **Rutas de autenticación mejoradas** (`src/routes/auth.routes.ts`):
   - Mejor manejo de errores
   - Soporte para `firstName` y `lastName` del frontend
   - Logs más detallados

3. **Servicio de WhatsApp mejorado** (`src/services/whatsappService.ts`):
   - Mejor manejo de mensajes entrantes
   - Logging mejorado para debugging
   - Mejor integración con OpenAI
   - Soporte para datos del negocio (productos, FAQs)

4. **Rutas de asistentes mejoradas** (`src/routes/assistant.routes.ts`):
   - Mejor manejo del enum Plan
   - Más endpoints para gestión de asistentes

## 🚀 Instrucciones de Despliegue en Railway

### Paso 1: Actualizar Variables de Entorno en Railway

Asegúrate de tener estas variables configuradas:

```env
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...
JWT_SECRET=tu-clave-secreta-segura
ENCRYPTION_KEY=tu-clave-encriptacion-2024
FRONTEND_URL=https://tu-frontend.vercel.app
AUTH_DIR=/app/auth_sessions
NODE_ENV=production
```

### Paso 2: Arreglar la Base de Datos

Si tienes acceso a la consola SQL de Railway o a la base de datos directamente, ejecuta:

```sql
-- Crear el enum Plan si no existe
DO $$ BEGIN
    CREATE TYPE "Plan" AS ENUM ('FREE', 'EMPRENDEDORES', 'NEGOCIOS', 'BUSINESS', 'MARCA_BLANCA');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Si el campo plan ya existe como varchar/text, convertirlo a enum
-- (Solo si es necesario)
-- ALTER TABLE "User" ALTER COLUMN "plan" TYPE "Plan" USING "plan"::"Plan";
```

### Paso 3: Redesplegar

1. Sube los archivos actualizados a tu repositorio de GitHub
2. Railway detectará los cambios y redesplegará automáticamente
3. El Dockerfile ejecutará `npx prisma db push` para sincronizar el schema

### Paso 4: Verificar

1. Revisa los logs de Railway para errores
2. Intenta iniciar sesión en tu plataforma
3. Verifica que la conexión de WhatsApp funcione

## 📱 Configuración del Chatbot

Para que el chatbot responda mensajes:

1. **Crear un Asistente**: Ve a "Asistentes" y crea uno nuevo
2. **Configurar Contexto**: Añade el JSON de configuración con:
   - Información del negocio
   - Productos/servicios
   - FAQs
   - Instrucciones especiales

3. **Agregar API Key de OpenAI**: 
   - Ve a "Configuración"
   - Ingresa tu API Key de OpenAI (sk-...)
   - Asegúrate de tener créditos en tu cuenta de OpenAI

4. **Conectar WhatsApp**:
   - Ve a "WhatsApp"
   - Genera el código QR
   - Escanéalo con WhatsApp Business en tu teléfono

## 🔍 Ejemplo de Contexto JSON

```json
{
  "negocio": {
    "nombre": "Mi Tienda",
    "descripcion": "Tienda de ropa y accesorios",
    "horarios": "Lunes a Viernes 9am-6pm",
    "telefono": "+57 300 123 4567"
  },
  "productos": [
    {
      "nombre": "Camiseta Premium",
      "precio": 50000,
      "descripcion": "100% algodón"
    },
    {
      "nombre": "Jean Clásico",
      "precio": 80000,
      "descripcion": "Disponible en todas las tallas"
    }
  ],
  "preguntas_frecuentes": [
    {
      "pregunta": "¿Hacen envíos?",
      "respuesta": "Sí, enviamos a todo el país. Envío gratis en compras mayores a $100.000"
    },
    {
      "pregunta": "¿Cuáles son los métodos de pago?",
      "respuesta": "Aceptamos efectivo, transferencia y tarjeta"
    }
  ],
  "instrucciones": [
    "Saluda amablemente",
    "Ofrece ayuda con productos",
    "Si preguntan por algo que no tienes, sugiere alternativas"
  ]
}
```

## 🐛 Troubleshooting

### El chatbot no responde:
1. Verifica que tengas un asistente activo
2. Verifica que el asistente tenga contexto configurado
3. Verifica que la API Key de OpenAI esté guardada y sea válida
4. Verifica que WhatsApp esté conectado

### Error de API Key:
- Asegúrate de que empiece con `sk-`
- Verifica que tengas créditos en platform.openai.com

### Error de conexión WhatsApp:
- Intenta desconectar y reconectar
- Verifica que tu teléfono tenga conexión a internet
- Usa WhatsApp Business, no WhatsApp normal

## 📂 Estructura del Proyecto

```
backend/
├── prisma/
│   └── schema.prisma      # Esquema de base de datos
├── src/
│   ├── lib/
│   │   └── prisma.ts      # Cliente Prisma
│   ├── routes/
│   │   ├── auth.routes.ts       # Autenticación
│   │   ├── assistant.routes.ts  # Gestión de asistentes
│   │   ├── whatsapp.routes.ts   # Conexión WhatsApp
│   │   └── ...
│   ├── services/
│   │   └── whatsappService.ts   # Lógica de WhatsApp + IA
│   └── server.ts          # Servidor Express
└── Dockerfile
```

## 🔐 Seguridad

- Las API Keys se encriptan antes de guardarse en la BD
- Los tokens JWT expiran en 30 días
- Las sesiones de WhatsApp se almacenan de forma segura

---

¿Necesitas ayuda? Revisa los logs de Railway para más detalles sobre errores.
