# 🚀 Guía Completa de Despliegue - Colombia

## Railway + Vercel + Supabase + Wompi

Esta guía te llevará paso a paso para lanzar Elisa IA en producción.

**Tiempo estimado:** 2-3 horas
**Costo mensual estimado:** $5-15 USD (puede ser $0 con free tiers)

---

## 📋 Índice

1. [Paso 1: Crear cuenta en Supabase (Base de Datos)](#paso-1-supabase)
2. [Paso 2: Crear cuenta en Railway (Backend)](#paso-2-railway)
3. [Paso 3: Crear cuenta en Vercel (Frontend)](#paso-3-vercel)
4. [Paso 4: Crear cuenta en Wompi (Pagos)](#paso-4-wompi)
5. [Paso 5: Subir código a GitHub](#paso-5-github)
6. [Paso 6: Configurar Supabase](#paso-6-configurar-supabase)
7. [Paso 7: Desplegar Backend en Railway](#paso-7-desplegar-backend)
8. [Paso 8: Desplegar Frontend en Vercel](#paso-8-desplegar-frontend)
9. [Paso 9: Configurar Wompi](#paso-9-configurar-wompi)
10. [Paso 10: Configurar Dominio](#paso-10-dominio)
11. [Paso 11: Pruebas Finales](#paso-11-pruebas)

---

## 📦 Paso 1: Supabase (Base de Datos) {#paso-1-supabase}

### 1.1 Crear Cuenta

1. Ve a **[supabase.com](https://supabase.com)**
2. Clic en **"Start your project"**
3. Inicia sesión con **GitHub** (recomendado) o email

### 1.2 Crear Proyecto

1. Clic en **"New Project"**
2. Completa los datos:
   - **Name:** `elisa-ia-db`
   - **Database Password:** Genera una contraseña segura (¡GUÁRDALA!)
   - **Region:** `South America (São Paulo)` - más cercano a Colombia
   - **Pricing Plan:** Free tier (suficiente para empezar)

3. Clic en **"Create new project"**
4. Espera 2-3 minutos mientras se crea

### 1.3 Obtener Connection String

1. Una vez creado, ve a **Settings** (ícono de engranaje)
2. Clic en **Database**
3. Busca la sección **"Connection string"**
4. Selecciona **"URI"**
5. Copia el string, se ve así:

```
postgresql://postgres:[TU-PASSWORD]@db.xxxxxxxxxxxx.supabase.co:5432/postgres
```

6. **¡IMPORTANTE!** Reemplaza `[TU-PASSWORD]` con la contraseña que creaste

### 1.4 Guardar Credenciales

Crea un archivo de texto temporal y guarda:

```
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
DATABASE_URL=postgresql://postgres:TU_PASSWORD@db.xxxxxxxxxxxx.supabase.co:5432/postgres
```

Encuentra estos valores en:
- **Settings → API** para URL y ANON_KEY
- **Settings → Database** para DATABASE_URL

---

## 🚂 Paso 2: Railway (Backend) {#paso-2-railway}

### 2.1 Crear Cuenta

1. Ve a **[railway.app](https://railway.app)**
2. Clic en **"Login"**
3. Inicia sesión con **GitHub** (obligatorio)
4. Autoriza Railway a acceder a tu GitHub

### 2.2 Verificar Cuenta (Importante)

Para evitar limitaciones:
1. Ve a **Account Settings**
2. Agrega un método de pago (no te cobran, solo verifican)
3. O conecta tu cuenta de GitHub con historial

---

## ▲ Paso 3: Vercel (Frontend) {#paso-3-vercel}

### 3.1 Crear Cuenta

1. Ve a **[vercel.com](https://vercel.com)**
2. Clic en **"Sign Up"**
3. Selecciona **"Continue with GitHub"**
4. Autoriza Vercel

---

## 💳 Paso 4: Wompi (Pagos Colombia) {#paso-4-wompi}

### 4.1 Crear Cuenta

1. Ve a **[wompi.com](https://wompi.com)** o **[comercios.wompi.co](https://comercios.wompi.co)**
2. Clic en **"Crear cuenta"** o **"Regístrate"**
3. Completa el formulario:
   - Nombre del negocio
   - NIT o Cédula
   - Email corporativo
   - Teléfono

### 4.2 Verificar Negocio

Wompi requiere verificación para producción:
1. Subir RUT
2. Cámara de Comercio (si aplica)
3. Documento de identidad del representante legal

> ⏳ La verificación puede tomar 1-3 días hábiles

### 4.3 Obtener Credenciales de Sandbox (Para Pruebas)

Mientras verifican, puedes usar Sandbox:
1. Inicia sesión en el **Dashboard de Wompi**
2. Ve a **Desarrolladores** o **API Keys**
3. Copia las credenciales de **Sandbox**:

```
WOMPI_PUBLIC_KEY=pub_test_xxxxxxxxxxxxxxxxxx
WOMPI_PRIVATE_KEY=prv_test_xxxxxxxxxxxxxxxxxx
WOMPI_EVENTS_KEY=test_events_xxxxxxxxxxxxxxxxxx
WOMPI_INTEGRITY_KEY=test_integrity_xxxxxxxxxxxxxxxxxx
```

---

## 📤 Paso 5: Subir Código a GitHub {#paso-5-github}

### 5.1 Crear Repositorio

1. Ve a **[github.com](https://github.com)**
2. Clic en **"+"** → **"New repository"**
3. Configura:
   - **Name:** `elisa-ia-platform`
   - **Visibility:** Private (recomendado)
   - NO marques "Add README"

4. Clic en **"Create repository"**

### 5.2 Subir el Código

Abre tu terminal y ejecuta:

```bash
# Navega a la carpeta del proyecto
cd elisa-ia-platform

# Inicializa git
git init

# Agrega todos los archivos
git add .

# Crea el primer commit
git commit -m "Initial commit - Elisa IA Platform"

# Conecta con GitHub (reemplaza con tu usuario)
git remote add origin https://github.com/TU_USUARIO/elisa-ia-platform.git

# Sube el código
git branch -M main
git push -u origin main
```

### 5.3 Verificar

1. Refresca tu repositorio en GitHub
2. Deberías ver todas las carpetas: `backend/`, `frontend/`, `docs/`, etc.

---

## 🗄️ Paso 6: Configurar Supabase {#paso-6-configurar-supabase}

### 6.1 Ejecutar Migraciones

Necesitas crear las tablas en la base de datos. Desde tu computadora:

```bash
# Entra a la carpeta del backend
cd backend

# Instala dependencias
npm install

# Crea archivo .env
cp .env.example .env
```

### 6.2 Editar archivo .env

Abre el archivo `backend/.env` y completa:

```env
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:3000

# Base de datos - Pega tu connection string de Supabase
DATABASE_URL="postgresql://postgres:TU_PASSWORD@db.xxxx.supabase.co:5432/postgres"

# Auth - Genera strings aleatorios
JWT_SECRET=genera-un-texto-aleatorio-de-32-caracteres-aqui
ENCRYPTION_KEY=otro-texto-aleatorio-de-32-caracteres

# Wompi (por ahora vacío, lo agregaremos después)
WOMPI_PUBLIC_KEY=
WOMPI_PRIVATE_KEY=
```

### 6.3 Ejecutar Migraciones

```bash
# Genera el cliente de Prisma
npx prisma generate

# Ejecuta las migraciones (crea las tablas)
npx prisma migrate deploy

# (Opcional) Ver la base de datos
npx prisma studio
```

Si todo salió bien, verás:
```
✓ 1 migration applied successfully
```

### 6.4 Verificar en Supabase

1. Ve a tu proyecto en Supabase
2. Clic en **Table Editor**
3. Deberías ver las tablas: `User`, `Business`, `Assistant`, `Conversation`, etc.

---

## 🚀 Paso 7: Desplegar Backend en Railway {#paso-7-desplegar-backend}

### 7.1 Crear Nuevo Proyecto

1. Ve a **[railway.app](https://railway.app)**
2. Clic en **"New Project"**
3. Selecciona **"Deploy from GitHub repo"**
4. Busca y selecciona **"elisa-ia-platform"**
5. Clic en **"Deploy Now"**

### 7.2 Configurar el Servicio

Railway detectará el repositorio. Ahora configura:

1. Clic en el servicio desplegado
2. Ve a **"Settings"**
3. Configura:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install && npx prisma generate && npm run build`
   - **Start Command:** `npm start`

### 7.3 Agregar Variables de Entorno

1. Ve a la pestaña **"Variables"**
2. Clic en **"Raw Editor"**
3. Pega todas las variables:

```env
NODE_ENV=production
PORT=3001
FRONTEND_URL=https://tu-app.vercel.app

# Supabase
DATABASE_URL=postgresql://postgres:TU_PASSWORD@db.xxxx.supabase.co:5432/postgres

# Auth (genera strings únicos)
JWT_SECRET=pon-aqui-un-texto-muy-largo-y-aleatorio-de-64-caracteres-minimo
JWT_EXPIRES_IN=7d
ENCRYPTION_KEY=texto-aleatorio-de-32-caracteres!!

# Wompi
WOMPI_PUBLIC_KEY=pub_test_xxxxxxxxxxxx
WOMPI_PRIVATE_KEY=prv_test_xxxxxxxxxxxx
WOMPI_EVENTS_KEY=test_events_xxxxxxxxxxxx
WOMPI_INTEGRITY_KEY=test_integrity_xxxxxxxxxxxx
WOMPI_API_URL=https://sandbox.wompi.co/v1
```

4. Clic en **"Update Variables"**

### 7.4 Generar Dominio

1. Ve a **"Settings"** → **"Networking"**
2. Clic en **"Generate Domain"**
3. Railway generará algo como: `elisa-ia-backend-production.up.railway.app`
4. **¡GUARDA ESTA URL!** La necesitarás para el frontend

### 7.5 Verificar Despliegue

1. Ve a la pestaña **"Deployments"**
2. Espera a que el estado sea **"Success"** ✅
3. Visita: `https://tu-url.railway.app/health`
4. Deberías ver: `{"status":"ok","timestamp":"..."}`

---

## ▲ Paso 8: Desplegar Frontend en Vercel {#paso-8-desplegar-frontend}

### 8.1 Importar Proyecto

1. Ve a **[vercel.com](https://vercel.com)**
2. Clic en **"Add New..."** → **"Project"**
3. Busca **"elisa-ia-platform"** en la lista
4. Clic en **"Import"**

### 8.2 Configurar Build

1. **Framework Preset:** Next.js
2. **Root Directory:** Clic en "Edit" → escribe `frontend`
3. **Build Command:** `npm run build`
4. **Output Directory:** `.next`

### 8.3 Variables de Entorno

Clic en **"Environment Variables"** y agrega:

| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_API_URL` | `https://tu-url.railway.app` (la URL de Railway) |
| `NEXT_PUBLIC_WOMPI_PUBLIC_KEY` | `pub_test_xxxxxxxxxxxx` |

### 8.4 Desplegar

1. Clic en **"Deploy"**
2. Espera 2-3 minutos
3. Vercel te dará una URL como: `elisa-ia-platform.vercel.app`

### 8.5 Actualizar Backend con URL del Frontend

Vuelve a Railway y actualiza la variable:

```env
FRONTEND_URL=https://elisa-ia-platform.vercel.app
```

---

## 💰 Paso 9: Configurar Wompi {#paso-9-configurar-wompi}

### 9.1 Entender el Flujo de Pagos

```
Usuario → Selecciona Plan → Frontend genera link de pago → 
Wompi procesa → Webhook notifica al Backend → Se activa la cuenta
```

### 9.2 Configurar Webhook en Wompi

1. Ve al **Dashboard de Wompi**
2. **Configuración** → **Webhooks**
3. Agrega un nuevo webhook:
   - **URL:** `https://tu-url.railway.app/api/webhooks/wompi`
   - **Eventos:** 
     - ✅ `transaction.updated`
     - ✅ `nequi_token.updated` (si usas Nequi)

4. Copia la **"Events Key"** que te dan

### 9.3 Actualizar Variables en Railway

Agrega/actualiza en Railway:

```env
WOMPI_EVENTS_KEY=la-key-que-te-dieron
```

---

## 🌐 Paso 10: Configurar Dominio Personalizado (Opcional) {#paso-10-dominio}

### 10.1 Comprar Dominio

Opciones recomendadas para Colombia:
- **[Namecheap](https://namecheap.com)** - Desde $9 USD/año
- **[GoDaddy](https://godaddy.com)** - Desde $12 USD/año
- **[Google Domains](https://domains.google)** - Desde $12 USD/año
- **[.com.co](https://www.cointernet.com.co)** - Dominio colombiano

### 10.2 Configurar en Vercel (Frontend)

1. En Vercel, ve a tu proyecto
2. **Settings** → **Domains**
3. Agrega tu dominio: `elisa-ia.com`
4. Vercel te mostrará los DNS records necesarios

### 10.3 Configurar DNS

En tu proveedor de dominio, agrega:

```
Tipo    Nombre    Valor
A       @         76.76.21.21
CNAME   www       cname.vercel-dns.com
```

### 10.4 Configurar en Railway (Backend API)

1. En Railway, ve a **Settings** → **Networking**
2. **Custom Domain** → agrega: `api.elisa-ia.com`
3. Configura en tu DNS:

```
Tipo    Nombre    Valor
CNAME   api       tu-proyecto.up.railway.app
```

### 10.5 Actualizar URLs

Actualiza las variables de entorno con los nuevos dominios:

**En Railway:**
```env
FRONTEND_URL=https://elisa-ia.com
```

**En Vercel:**
```env
NEXT_PUBLIC_API_URL=https://api.elisa-ia.com
```

---

## ✅ Paso 11: Pruebas Finales {#paso-11-pruebas}

### 11.1 Verificar Backend

```bash
# Health check
curl https://api.elisa-ia.com/health

# Debe responder:
# {"status":"ok","timestamp":"2024-01-15T..."}
```

### 11.2 Verificar Frontend

1. Visita `https://elisa-ia.com`
2. Deberías ver la landing page
3. Prueba el registro de usuario

### 11.3 Probar Flujo Completo

1. **Registrar usuario** → Ve a /register
2. **Login** → Ve a /login
3. **Conectar API Key** → En dashboard
4. **Completar onboarding** → Agregar info del negocio
5. **Probar pago** con tarjeta de prueba de Wompi

### 11.4 Tarjetas de Prueba Wompi

Para pruebas en Sandbox:

| Tarjeta | Número | Resultado |
|---------|--------|-----------|
| Visa Aprobada | `4242 4242 4242 4242` | ✅ Aprobada |
| Visa Rechazada | `4111 1111 1111 1111` | ❌ Rechazada |
| Mastercard | `5555 5555 5555 4444` | ✅ Aprobada |

- **CVV:** Cualquier 3 dígitos (123)
- **Fecha:** Cualquier fecha futura
- **Nombre:** Cualquier nombre

---

## 🎉 ¡Listo!

Tu plataforma Elisa IA está desplegada y funcionando.

### Resumen de URLs

| Servicio | URL |
|----------|-----|
| Frontend | `https://elisa-ia.com` o `https://tu-app.vercel.app` |
| Backend API | `https://api.elisa-ia.com` o `https://tu-app.railway.app` |
| Base de Datos | Dashboard de Supabase |
| Pagos | Dashboard de Wompi |

### Próximos Pasos

1. [ ] Cambiar a credenciales de **producción** de Wompi cuando verifiquen
2. [ ] Configurar WhatsApp Business API
3. [ ] Agregar dominio personalizado
4. [ ] Configurar emails transaccionales (Resend/SendGrid)
5. [ ] Configurar monitoreo (Sentry)

---

## 🆘 Problemas Comunes

### "Cannot connect to database"
- Verificar que DATABASE_URL tenga la contraseña correcta
- Verificar que no haya espacios extra en la URL

### "Build failed" en Railway
- Verificar que Root Directory sea `backend`
- Revisar logs para ver el error específico

### "CORS error" en el frontend
- Verificar que FRONTEND_URL en Railway sea exacta (con https://)
- No debe tener `/` al final

### Pagos no funcionan
- Verificar que estés usando las keys de Sandbox para pruebas
- Verificar que el webhook esté configurado correctamente

---

**¿Necesitas ayuda?** Revisa los logs en Railway y Vercel para más detalles.
