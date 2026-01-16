# 📱 Guía de Configuración - WhatsApp Business API

Esta guía te mostrará cómo configurar la integración con WhatsApp Business API para que tu asistente de IA pueda responder mensajes automáticamente.

---

## 📋 Índice

1. [Requisitos](#requisitos)
2. [Crear Cuenta Meta Business](#crear-cuenta-meta-business)
3. [Configurar WhatsApp Business API](#configurar-whatsapp-business-api)
4. [Crear App en Meta Developers](#crear-app-en-meta-developers)
5. [Configurar Webhook](#configurar-webhook)
6. [Obtener Tokens](#obtener-tokens)
7. [Probar la Integración](#probar-la-integración)
8. [Producción](#producción)
9. [Troubleshooting](#troubleshooting)

---

## 📦 Requisitos

Antes de empezar necesitas:

- ✅ Negocio legalmente registrado
- ✅ Número de teléfono dedicado (no usado en WhatsApp personal)
- ✅ Cuenta de Facebook Business verificada
- ✅ Backend de Elisa IA desplegado

**Costos:**
- Configuración: Gratis
- Mensajes iniciados por negocio: ~$0.05-0.15 USD por mensaje
- Mensajes iniciados por usuario: Gratis (primeras 1,000/mes)

---

## 1️⃣ Crear Cuenta Meta Business

### Paso 1.1: Ir a Meta Business Suite

1. Ve a [business.facebook.com](https://business.facebook.com)
2. Haz clic en "Crear cuenta"
3. Ingresa los datos de tu negocio:
   - Nombre del negocio
   - Tu nombre
   - Email de trabajo

### Paso 1.2: Verificar el Negocio

1. Ve a **Configuración del negocio** → **Centro de seguridad**
2. Inicia la **verificación del negocio**
3. Proporciona documentos:
   - Registro de la empresa
   - Factura de servicios
   - Licencia comercial

> ⏳ La verificación puede tomar 1-5 días hábiles

---

## 2️⃣ Configurar WhatsApp Business API

### Paso 2.1: Agregar WhatsApp a tu negocio

1. En Meta Business Suite, ve a **Configuración** → **Cuentas de WhatsApp**
2. Clic en "Agregar" → "Empezar"
3. Selecciona "Crear una cuenta de WhatsApp Business"

### Paso 2.2: Agregar Número de Teléfono

1. Ingresa tu número de teléfono dedicado
2. Elige método de verificación (SMS o llamada)
3. Ingresa el código de verificación

> ⚠️ **Importante**: Este número NO puede estar registrado en WhatsApp personal. Si lo está, primero debes eliminarlo de WhatsApp.

### Paso 2.3: Completar Perfil de Negocio

1. Nombre para mostrar (nombre de tu negocio)
2. Categoría del negocio
3. Descripción (aparece en el perfil)
4. Foto de perfil (logo)
5. Dirección y horarios

---

## 3️⃣ Crear App en Meta Developers

### Paso 3.1: Crear la App

1. Ve a [developers.facebook.com](https://developers.facebook.com)
2. Haz clic en "Mis Apps" → "Crear app"
3. Selecciona **"Empresa"** como tipo
4. Nombre: "Elisa IA WhatsApp Bot"
5. Vincula con tu Meta Business

### Paso 3.2: Agregar WhatsApp Product

1. En el dashboard de tu app, busca **"WhatsApp"**
2. Clic en "Configurar"
3. Selecciona tu cuenta de WhatsApp Business

### Paso 3.3: Obtener IDs Importantes

En la sección de WhatsApp encontrarás:

```
📱 Phone Number ID: 123456789012345
🏢 WhatsApp Business Account ID: 987654321098765
```

Anótalos, los necesitarás para la configuración.

---

## 4️⃣ Configurar Webhook

El webhook permite que WhatsApp envíe mensajes a tu servidor.

### Paso 4.1: URL del Webhook

Tu URL de webhook será:
```
https://tu-api.com/api/webhooks/whatsapp
```

### Paso 4.2: Configurar en Meta Developers

1. En tu app, ve a **WhatsApp** → **Configuration**
2. Sección "Webhook"
3. Clic en "Edit"
4. Ingresa:
   - **Callback URL**: `https://tu-api.com/api/webhooks/whatsapp`
   - **Verify Token**: Un string secreto que tú eliges (ej: `elisa-ia-webhook-2024`)

### Paso 4.3: Suscribirse a Eventos

Marca los siguientes eventos:
- ✅ `messages` - Para recibir mensajes
- ✅ `message_status` - Para saber si se entregaron

### Paso 4.4: Configurar Variables en Backend

```env
WHATSAPP_VERIFY_TOKEN=elisa-ia-webhook-2024
```

### Paso 4.5: Verificar Webhook

Cuando guardes, Meta enviará una solicitud GET a tu webhook.
Tu backend debe responder con el `hub.challenge`.

```typescript
// Esto ya está implementado en webhook.routes.ts
router.get('/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});
```

---

## 5️⃣ Obtener Tokens

### Paso 5.1: Token Temporal (Para pruebas)

1. En Meta Developers → WhatsApp → API Setup
2. Copia el **"Temporary access token"**

> ⚠️ Este token expira en 24 horas. Solo para pruebas.

### Paso 5.2: Token Permanente (Para producción)

1. Ve a **Configuración del negocio** → **Usuarios del sistema**
2. Clic en "Agregar"
3. Crear usuario del sistema:
   - Nombre: "Elisa IA Bot"
   - Rol: Admin
4. Asignar activos:
   - Selecciona tu app de WhatsApp
   - Permisos: `whatsapp_business_messaging`, `whatsapp_business_management`
5. Generar token:
   - Clic en "Generar nuevo token"
   - Selecciona la app
   - Permisos necesarios
   - Copiar el token generado

### Paso 5.3: Guardar en Variables de Entorno

```env
WHATSAPP_TOKEN=EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_BUSINESS_ACCOUNT_ID=987654321098765
WHATSAPP_VERIFY_TOKEN=elisa-ia-webhook-2024
```

---

## 6️⃣ Probar la Integración

### Paso 6.1: Agregar Número de Prueba

1. En Meta Developers → WhatsApp → API Setup
2. Sección "To" → Agregar número de teléfono para pruebas
3. Verificar con código SMS

### Paso 6.2: Enviar Mensaje de Prueba

Usa curl o Postman:

```bash
curl -X POST \
  'https://graph.facebook.com/v18.0/TU_PHONE_NUMBER_ID/messages' \
  -H 'Authorization: Bearer TU_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "messaging_product": "whatsapp",
    "to": "NUMERO_DESTINO",
    "type": "text",
    "text": {
      "body": "¡Hola! Este es un mensaje de prueba de Elisa IA 🤖"
    }
  }'
```

### Paso 6.3: Verificar Recepción de Mensajes

1. Envía un mensaje desde WhatsApp al número de tu negocio
2. Verifica en los logs de tu backend que se recibió
3. Verifica que la respuesta automática se envió

---

## 7️⃣ Producción

### Paso 7.1: Solicitar Acceso a Producción

1. En Meta Developers → App Review
2. Solicitar permisos:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
3. Completar el formulario de revisión
4. Esperar aprobación (1-5 días)

### Paso 7.2: Templates de Mensajes

Para iniciar conversaciones (mensajes outbound), necesitas templates aprobados.

1. Ve a WhatsApp Manager → Message Templates
2. Crear template:
   - Nombre: `welcome_message`
   - Categoría: Marketing o Utility
   - Idioma: Español
   - Contenido: "¡Hola {{1}}! Gracias por contactar a {{2}}. ¿En qué podemos ayudarte?"

3. Enviar para aprobación (24-48 horas)

### Paso 7.3: Configurar para Múltiples Negocios

Para cada negocio en tu plataforma:

1. El negocio debe tener su propio número de WhatsApp
2. Vincular el número a tu WhatsApp Business Account
3. Guardar el `phone_number_id` asociado al asistente

---

## 8️⃣ Troubleshooting

### Error: "Message failed to send"

**Posibles causas:**
- Token expirado → Regenerar token permanente
- Número no verificado → El destinatario debe iniciar la conversación primero (o usar template)
- Rate limit → Esperar y reintentar

### Error: "Webhook verification failed"

**Verificar:**
1. URL del webhook es accesible públicamente
2. `WHATSAPP_VERIFY_TOKEN` coincide exactamente
3. El endpoint responde con status 200

### Error: "Invalid phone number"

**Formato correcto:**
- Incluir código de país sin "+"
- Sin espacios ni guiones
- Ejemplo: `573101234567` (Colombia)

### Mensajes no llegan

**Verificar:**
1. Webhook está configurado y verificado
2. Suscrito al evento `messages`
3. App en modo "Live" (no desarrollo)
4. Logs del backend para errores

---

## 📊 Monitoreo

### Métricas Disponibles

En WhatsApp Manager → Insights:
- Mensajes enviados/recibidos
- Tasa de entrega
- Conversaciones activas
- Costo por mensaje

### Logs Recomendados

```typescript
// Loggear cada mensaje recibido
logger.info(`WhatsApp mensaje de ${from}: ${text}`);

// Loggear respuestas enviadas
logger.info(`WhatsApp respuesta a ${to}: ${message}`);

// Loggear errores
logger.error(`WhatsApp error: ${error.message}`);
```

---

## 💰 Costos Estimados

| Tipo de Conversación | Costo (USD) |
|---------------------|-------------|
| Usuario inicia | $0.00 (primeras 1,000/mes) |
| Negocio inicia (Utility) | ~$0.05 |
| Negocio inicia (Marketing) | ~$0.08 |
| Negocio inicia (Authentication) | ~$0.04 |

> Los precios varían por país. Consulta [Meta Business Pricing](https://developers.facebook.com/docs/whatsapp/pricing).

---

## 🔗 Recursos Adicionales

- [Documentación Oficial WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api)
- [Guía de Message Templates](https://developers.facebook.com/docs/whatsapp/message-templates)
- [Referencia de Webhooks](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks)
- [Meta Business Help Center](https://www.facebook.com/business/help)

---

## ✅ Checklist Final

- [ ] Cuenta Meta Business verificada
- [ ] Número de teléfono agregado y verificado
- [ ] App creada en Meta Developers
- [ ] WhatsApp product configurado
- [ ] Webhook configurado y verificado
- [ ] Token permanente generado
- [ ] Variables de entorno configuradas
- [ ] Mensaje de prueba enviado exitosamente
- [ ] Respuesta automática funcionando
- [ ] Templates aprobados (si necesitas outbound)
