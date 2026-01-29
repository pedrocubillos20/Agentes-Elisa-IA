import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

// Importar rutas
import authRoutes from './routes/auth.routes';
import whatsappRoutes from './routes/whatsapp.routes';
import assistantsRoutes from './routes/assistants.routes';
import conversationsRoutes from './routes/conversations.routes';
import clientsRoutes from './routes/clients.routes';
import productsRoutes from './routes/products.routes';
import appointmentsRoutes from './routes/appointments.routes';

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors({
  origin: process.env.FRONTEND_URL || 'https://agentes-elisa-ia.vercel.app',
  credentials: true
}));
app.use(express.json());

// Banner de inicio
console.log(`
╔════════════════════════════════════════════════════╗
║     🤖 ELISA IA - Backend v4.0.0                   ║
╠════════════════════════════════════════════════════╣
║  🚀 Servidor corriendo en puerto ${PORT}              ║
║  📡 API WAHA: ${process.env.WAHA_URL || 'http://31.97.142.127:8080'}
║  🔗 Frontend: ${process.env.FRONTEND_URL || 'https://agentes-elisa-ia.vercel.app'}
╠════════════════════════════════════════════════════╣
║  📦 Módulos activos:                               ║
║     ✅ Auth & Usuarios                             ║
║     ✅ WhatsApp (WAHA)                             ║
║     ✅ Asistentes IA                               ║
║     ✅ Conversaciones                              ║
║     ✅ CRM - Clientes                              ║
║     ✅ CRM - Productos                             ║
║     ✅ Agenda - Citas & Pedidos                    ║
╚════════════════════════════════════════════════════╝
`);

// ==========================================
// RUTAS API
// ==========================================

// Autenticación
app.use('/api/auth', authRoutes);

// WhatsApp
app.use('/api/whatsapp', whatsappRoutes);

// Asistentes IA
app.use('/api/assistants', assistantsRoutes);

// Conversaciones
app.use('/api/conversations', conversationsRoutes);

// CRM - Clientes
app.use('/api/clients', clientsRoutes);

// CRM - Productos
app.use('/api/products', productsRoutes);

// Agenda - Citas y Pedidos
app.use('/api/appointments', appointmentsRoutes);

// ==========================================
// RUTAS DE SALUD
// ==========================================

// Ruta principal
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'ELISA IA Backend v4.0.0 - CRM & Agenda',
    version: '4.0.0',
    modules: ['auth', 'whatsapp', 'assistants', 'conversations', 'clients', 'products', 'appointments'],
    timestamp: new Date().toISOString()
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// API Info
app.get('/api', (req, res) => {
  res.json({
    name: 'ELISA IA API',
    version: '4.0.0',
    endpoints: {
      auth: '/api/auth',
      whatsapp: '/api/whatsapp',
      assistants: '/api/assistants',
      conversations: '/api/conversations',
      clients: '/api/clients',
      products: '/api/products',
      appointments: '/api/appointments'
    }
  });
});

// ==========================================
// MANEJO DE ERRORES
// ==========================================

// 404 - Ruta no encontrada
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Ruta no encontrada',
    path: req.path,
    method: req.method
  });
});

// Error handler global
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('❌ Error:', err);
  res.status(500).json({ 
    error: 'Error interno del servidor',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ==========================================
// INICIAR SERVIDOR
// ==========================================
app.listen(PORT, () => {
  console.log(`\n✅ Servidor listo en http://localhost:${PORT}`);
  console.log(`📅 Iniciado: ${new Date().toLocaleString()}\n`);
});

export default app;
