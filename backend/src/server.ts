import express from 'express';
import cors from 'cors';
import path from 'path';
import authRoutes from './routes/auth.routes';
import assistantsRoutes from './routes/assistants.routes';
import conversationsRoutes from './routes/conversations.routes';
import whatsappRoutes from './routes/whatsapp.routes';
import productsRoutes from './routes/products.routes';
import clientsRoutes from './routes/clients.routes';
import appointmentsRoutes from './routes/appointments.routes';
import { authMiddleware } from './middleware/auth.middleware';

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://agentes-elisa-ia.vercel.app',
    process.env.FRONTEND_URL || ''
  ].filter(Boolean),
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Servir archivos estáticos (uploads)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ==========================================
// RUTAS
// ==========================================

// Auth (público)
app.use('/api/auth', authRoutes);

// Rutas protegidas
app.use('/api/assistants', authMiddleware, assistantsRoutes);
app.use('/api/conversations', authMiddleware, conversationsRoutes);
app.use('/api/whatsapp', authMiddleware, whatsappRoutes);
app.use('/api/products', authMiddleware, productsRoutes);
app.use('/api/clients', authMiddleware, clientsRoutes);
app.use('/api/appointments', authMiddleware, appointmentsRoutes);

// ==========================================
// HEALTH CHECK & INFO
// ==========================================
app.get('/', (req, res) => {
  res.json({
    name: 'Elisa IA Backend',
    version: '5.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
    features: [
      '🤖 Asistentes IA con contexto avanzado',
      '🖼️ Multimedia (imágenes, videos, audios)',
      '🎙️ Text-to-Speech con ElevenLabs',
      '📈 Auto-aprendizaje',
      '💬 WhatsApp con WAHA',
      '👥 CRM de clientes',
      '📦 Catálogo de productos',
      '📅 Sistema de agenda'
    ]
  });
});

app.get('/api', (req, res) => {
  res.json({
    endpoints: {
      auth: {
        'POST /api/auth/register': 'Registrar usuario',
        'POST /api/auth/login': 'Iniciar sesión',
        'GET /api/auth/me': 'Obtener usuario actual',
        'POST /api/auth/api-key': 'Guardar API Key OpenAI',
      },
      assistants: {
        'GET /api/assistants': 'Listar asistentes',
        'GET /api/assistants/active': 'Obtener asistente activo',
        'POST /api/assistants': 'Crear/Actualizar asistente',
        'POST /api/assistants/:id/activate': 'Activar asistente',
        'DELETE /api/assistants/:id': 'Eliminar asistente',
        'POST /api/assistants/media/upload': 'Subir archivo multimedia',
        'GET /api/assistants/media': 'Listar archivos',
        'DELETE /api/assistants/media/:id': 'Eliminar archivo',
        'POST /api/assistants/elevenlabs/voices': 'Obtener voces ElevenLabs',
        'POST /api/assistants/elevenlabs/speak': 'Generar audio TTS',
      },
      whatsapp: {
        'GET /api/whatsapp/status': 'Estado de conexión',
        'POST /api/whatsapp/connect': 'Conectar WhatsApp',
        'GET /api/whatsapp/qr': 'Obtener código QR',
        'POST /api/whatsapp/send': 'Enviar mensaje',
      },
      conversations: {
        'GET /api/conversations': 'Listar conversaciones',
        'GET /api/conversations/:id/messages': 'Obtener mensajes',
        'GET /api/conversations/stats': 'Estadísticas',
      },
      clients: {
        'GET /api/clients': 'Listar clientes',
        'GET /api/clients/stats': 'Estadísticas de clientes',
        'POST /api/clients': 'Crear cliente',
        'PUT /api/clients/:id': 'Actualizar cliente',
        'DELETE /api/clients/:id': 'Eliminar cliente',
      },
      products: {
        'GET /api/products': 'Listar productos',
        'GET /api/products/stats': 'Estadísticas de productos',
        'POST /api/products': 'Crear producto',
        'PUT /api/products/:id': 'Actualizar producto',
        'PUT /api/products/:id/stock': 'Actualizar stock',
      },
      appointments: {
        'GET /api/appointments': 'Listar citas/pedidos',
        'GET /api/appointments/today': 'Citas de hoy',
        'GET /api/appointments/stats': 'Estadísticas',
        'POST /api/appointments': 'Crear cita/pedido',
        'PUT /api/appointments/:id': 'Actualizar',
        'PUT /api/appointments/:id/status': 'Cambiar estado',
      }
    }
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint no encontrado' });
});

// Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ==========================================
// START SERVER
// ==========================================
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════╗
║                                                   ║
║     🤖 ELISA IA BACKEND v5.0                      ║
║                                                   ║
║     Server running on port ${PORT}                  ║
║                                                   ║
║     Features:                                     ║
║     ✅ Asistentes IA con contexto avanzado        ║
║     ✅ Multimedia (imágenes, videos, audios)      ║
║     ✅ Text-to-Speech con ElevenLabs              ║
║     ✅ Auto-aprendizaje                           ║
║     ✅ WhatsApp con WAHA                          ║
║     ✅ CRM de clientes                            ║
║     ✅ Catálogo de productos                      ║
║     ✅ Sistema de agenda                          ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
  `);
});

export default app;
