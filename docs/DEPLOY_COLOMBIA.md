# 🚀 Guía de Despliegue - Elisa IA Colombia

## Stack Tecnológico
- **Backend**: Railway
- **Frontend**: Vercel  
- **Base de Datos**: Supabase (PostgreSQL)
- **Pagos**: Wompi (Colombia)

---

## 📋 Antes de Empezar

### Cuentas que Necesitas Crear

| Servicio | URL | Tiempo |
|----------|-----|--------|
| GitHub | github.com | 2 min |
| Supabase | supabase.com | 2 min |
| Railway | railway.app | 2 min |
| Vercel | vercel.com | 2 min |
| Wompi | comercios.wompi.co | 5-10 min |

### Requisitos en tu Computador

```bash
# Verificar que tienes instalado:
node --version    # Debe ser v18 o superior
npm --version     # Debe ser v9 o superior
git --version     # Cualquier versión
```

Si no tienes Node.js, descárgalo de: https://nodejs.org

---

# PASO 1: Subir Código a GitHub

## 1.1 Crear Repositorio en GitHub

1. Ve a [github.com](https://github.com) e inicia sesión
2. Clic en el botón **"+"** (arriba derecha) → **"New repository"**
3. Configurar:
   - **Repository name**: `elisa-ia-platform`
   - **Description**: `Plataforma de agentes IA para negocios`
   - **Visibility**: Private (recomendado)
   - ✅ Add a README file
4. Clic **"Create repository"**

## 1.2 Subir el Código

Abre la terminal en la carpeta del proyecto:

```bash
# Navegar a la carpeta del proyecto
cd elisa-ia-platform

# Inicializar Git
git init

# Agregar todos los archivos
git add .

# Crear el primer commit
git commit -m "Initial commit - Elisa IA Platform"

# Conectar con GitHub (reemplaza TU_USUARIO)
git remote add origin https://github.com/TU_USUARIO/elisa-ia-platform.git

# Subir el código
git branch -M main
git push -u origin main
```

**¿Te pide credenciales?** 
- Usuario: tu email de GitHub
- Contraseña: debes crear un Personal Access Token en GitHub → Settings → Developer settings → Personal access tokens

---

# PASO 2: Configurar Supabase (Base de Datos)

## 2.1 Crear Cuenta y Proyecto

1. Ve a [supabase.com](https://supabase.com)
2. Clic **"Start your project"**
3. Inicia sesión con GitHub (más fácil)
4. Clic **"New project"**

## 2.2 Configurar el Proyecto

Completa el formulario:
- **Name**: `elisa-ia-db`
- **Database Password**: Genera uno seguro y **GUÁRDALO** (lo necesitarás)
- **Region**: `South America (São Paulo)` - El más cercano a Colombia
- **Pricing Plan**: Free tier (gratis)

5. Clic **"Create new project"**
6. Espera 2-3 minutos mientras se crea

## 2.3 Obtener Connection String

1. En el dashboard de Supabase, ve a **Settings** (ícono de engranaje)
2. Clic en **Database** (en el menú lateral)
3. Busca la sección **"Connection string"**
4. Selecciona **"URI"**
5. Copia el string, se ve así:

```
postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxxxxxx.supabase.co:5432/postgres
```

6. Reemplaza `[YOUR-PASSWORD]` con la contraseña que guardaste

**GUARDA ESTE STRING** - Lo usaremos en Railway

---

# PASO 3: Configurar Wompi (Pagos Colombia)

## 3.1 Crear Cuenta en Wompi

1. Ve a [comercios.wompi.co](https://comercios.wompi.co)
2. Clic **"Crear cuenta"**
3. Completa el registro:
   - Email empresarial
   - Número de celular
   - Tipo de documento y número (NIT o CC)
   - Nombre del comercio

## 3.2 Completar Verificación

1. Verifica tu email (te llega un correo)
2. Verifica tu celular (SMS)
3. Completa la información del negocio:
   - Razón social
   - NIT (si tienes)
   - Dirección
   - Ciudad
   - Tipo de negocio

## 3.3 Obtener Llaves de API

1. En el dashboard de Wompi, ve a **"Desarrolladores"** o **"Integraciones"**
2. Encontrarás dos ambientes:

### Ambiente de PRUEBAS (Sandbox)
```
Llave Pública: pub_test_xxxxxxxxxxxxxxxx
Llave Privada: prv_test_xxxxxxxxxxxxxxxx
```

### Ambiente de PRODUCCIÓN (cuando estés listo)
```
Llave Pública: pub_prod_xxxxxxxxxxxxxxxx
Llave Privada: prv_prod_xxxxxxxxxxxxxxxx
```

**IMPORTANTE**: Empieza SIEMPRE con las llaves de PRUEBAS

## 3.4 Configurar Evento de Webhook

1. En Wompi → **Desarrolladores** → **Eventos**
2. Clic **"Agregar endpoint"**
3. URL: `https://tu-api.railway.app/api/webhooks/wompi` (la configuraremos después)
4. Eventos a suscribir:
   - ✅ `transaction.updated`
   - ✅ `nequi_token.updated` (si usas Nequi)

5. Copia el **"Secreto de eventos"** → `WOMPI_EVENT_SECRET`

---

# PASO 4: Desplegar Backend en Railway

## 4.1 Crear Cuenta en Railway

1. Ve a [railway.app](https://railway.app)
2. Clic **"Login"** → **"Login with GitHub"**
3. Autoriza Railway para acceder a tu GitHub

## 4.2 Crear Nuevo Proyecto

1. En el dashboard, clic **"New Project"**
2. Selecciona **"Deploy from GitHub repo"**
3. Si no ves tu repo, clic **"Configure GitHub App"** y dale acceso
4. Selecciona el repositorio `elisa-ia-platform`

## 4.3 Configurar el Servicio

Railway detectará el proyecto. Necesitas configurar:

1. Clic en el servicio creado
2. Ve a **"Settings"**
3. En **"Root Directory"** escribe: `backend`
4. En **"Build Command"**: `npm install && npx prisma generate && npm run build`
5. En **"Start Command"**: `npx prisma migrate deploy && npm start`

## 4.4 Configurar Variables de Entorno

1. Ve a la pestaña **"Variables"**
2. Clic **"Raw Editor"** y pega todo esto:

```env
NODE_ENV=production
PORT=3001

# Base de datos (pega tu string de Supabase)
DATABASE_URL=postgresql://postgres:TU_PASSWORD@db.xxxxx.supabase.co:5432/postgres

# JWT - Genera uno aleatorio en: https://randomkeygen.com (CodeIgniter Encryption Keys)
JWT_SECRET=pega_aqui_un_string_de_64_caracteres_aleatorios
JWT_EXPIRES_IN=7d

# Encriptación - Genera otro string aleatorio de 32 caracteres
ENCRYPTION_KEY=pega_aqui_string_de_32_caracteres

# Wompi (pega tus llaves de PRUEBAS por ahora)
WOMPI_PUBLIC_KEY=pub_test_xxxxxxxxxx
WOMPI_PRIVATE_KEY=prv_test_xxxxxxxxxx
WOMPI_EVENT_SECRET=test_event_xxxxxxxxxx
WOMPI_ENVIRONMENT=test

# Frontend URL (la configuraremos después de Vercel)
FRONTEND_URL=http://localhost:3000
```

3. Clic **"Update variables"**

## 4.5 Desplegar

1. Railway automáticamente iniciará el deploy
2. Ve a la pestaña **"Deployments"** para ver el progreso
3. Espera 2-5 minutos

## 4.6 Obtener URL del Backend

1. Una vez desplegado, ve a **"Settings"**
2. En la sección **"Domains"**, clic **"Generate Domain"**
3. Te dará una URL tipo: `elisa-ia-platform-production.up.railway.app`

**GUARDA ESTA URL** - Es tu API

## 4.7 Verificar que Funciona

Abre en el navegador:
```
https://tu-url.railway.app/health
```

Deberías ver:
```json
{"status":"ok","timestamp":"2024-..."}
```

---

# PASO 5: Desplegar Frontend en Vercel

## 5.1 Crear Cuenta en Vercel

1. Ve a [vercel.com](https://vercel.com)
2. Clic **"Sign Up"** → **"Continue with GitHub"**
3. Autoriza Vercel

## 5.2 Importar Proyecto

1. En el dashboard, clic **"Add New..."** → **"Project"**
2. Busca y selecciona `elisa-ia-platform`
3. Clic **"Import"**

## 5.3 Configurar el Proyecto

En la pantalla de configuración:

1. **Framework Preset**: Next.js (se detecta automático)
2. **Root Directory**: Clic "Edit" y escribe `frontend`
3. **Build Command**: `npm run build`
4. **Output Directory**: `.next`

## 5.4 Variables de Entorno

En la sección **"Environment Variables"** agrega:

| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_API_URL` | `https://tu-url.railway.app` (la URL de Railway) |
| `NEXT_PUBLIC_WOMPI_PUBLIC_KEY` | `pub_test_xxxxxxxxxx` |

## 5.5 Desplegar

1. Clic **"Deploy"**
2. Espera 2-3 minutos
3. Una vez listo, te dará una URL tipo: `elisa-ia-platform.vercel.app`

## 5.6 Actualizar FRONTEND_URL en Railway

1. Vuelve a Railway
2. En las variables de entorno, actualiza:
```
FRONTEND_URL=https://elisa-ia-platform.vercel.app
```
3. Railway se redesplegará automáticamente

---

# PASO 6: Configurar Webhook de Wompi

Ahora que tienes la URL de Railway:

1. Ve a Wompi → **Desarrolladores** → **Eventos**
2. Edita el webhook que creaste
3. URL: `https://tu-url.railway.app/api/webhooks/wompi`
4. Guarda los cambios

---

# PASO 7: Probar Todo

## 7.1 Probar el Backend

```bash
# Health check
curl https://tu-url.railway.app/health

# Debería responder: {"status":"ok",...}
```

## 7.2 Probar el Frontend

1. Abre `https://tu-app.vercel.app`
2. Deberías ver la landing page

## 7.3 Probar Registro de Usuario

1. Clic en "Registrarse"
2. Completa el formulario
3. Verifica que se crea en Supabase:
   - Ve a Supabase → Table Editor → Users

## 7.4 Probar Pago con Wompi (Sandbox)

Usa estas tarjetas de prueba de Wompi:

**Tarjeta que APRUEBA:**
```
Número: 4242 4242 4242 4242
Exp: 12/28
CVV: 123
```

**Tarjeta que RECHAZA:**
```
Número: 4111 1111 1111 1111
Exp: 12/28
CVV: 123
```

---

# PASO 8: Pasar a Producción

Cuando estés listo para recibir pagos reales:

## 8.1 Verificar Cuenta en Wompi

1. En Wompi, completa todos los requisitos de verificación
2. Sube documentos si te los piden
3. Espera aprobación (1-3 días)

## 8.2 Cambiar a Llaves de Producción

En Railway, actualiza las variables:
```env
WOMPI_PUBLIC_KEY=pub_prod_xxxxxxxxxx
WOMPI_PRIVATE_KEY=prv_prod_xxxxxxxxxx
WOMPI_EVENT_SECRET=prod_event_xxxxxxxxxx
WOMPI_ENVIRONMENT=prod
```

En Vercel, actualiza:
```
NEXT_PUBLIC_WOMPI_PUBLIC_KEY=pub_prod_xxxxxxxxxx
```

## 8.3 Dominio Personalizado (Opcional)

### En Vercel:
1. Settings → Domains
2. Agrega tu dominio (ej: `app.elisa-ia.com`)
3. Configura DNS según las instrucciones

### En Railway:
1. Settings → Domains → Custom Domain
2. Agrega tu dominio (ej: `api.elisa-ia.com`)
3. Configura DNS

---

# 📊 Resumen de URLs y Credenciales

Al terminar, tendrás:

| Servicio | URL/Dato |
|----------|----------|
| **Frontend** | `https://tu-app.vercel.app` |
| **Backend API** | `https://tu-api.railway.app` |
| **Base de Datos** | `db.xxxxx.supabase.co` |
| **Wompi Dashboard** | `comercios.wompi.co` |

---

# 🆘 Solución de Problemas

## Error: "Database connection failed"
- Verifica que el DATABASE_URL esté correcto
- Verifica que la contraseña no tenga caracteres especiales sin escapar

## Error: "Build failed" en Railway
- Revisa los logs en Railway → Deployments
- Asegúrate de que Root Directory sea `backend`

## Error: "Cannot find module" en Vercel
- Verifica que Root Directory sea `frontend`
- Revisa que package.json tenga todas las dependencias

## Wompi no procesa pagos
- Verifica que estés usando las llaves correctas (test vs prod)
- Verifica que el webhook esté configurado

---

# 📞 Soporte

Si tienes problemas:
- **Railway**: [docs.railway.app](https://docs.railway.app)
- **Vercel**: [vercel.com/docs](https://vercel.com/docs)
- **Supabase**: [supabase.com/docs](https://supabase.com/docs)
- **Wompi**: [docs.wompi.co](https://docs.wompi.co)
