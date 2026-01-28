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
╔════════════════════════════════════════════╗
║     🤖 ELISA IA - Backend v3.0.0           ║
╠════════════════════════════════════════════╣
║  🚀 Servidor corriendo en puerto ${PORT}      ║
║  📡 API WAHA: ${process.env.WAHA_URL || 'http://31.97.142.127:8080'}
║  🔗 Interfaz: ${process.env.FRONTEND_URL || 'https://agentes-elisa-ia.vercel.app'}
╚════════════════════════════════════════════╝
`);

// Rutas
app.use('/api/auth', authRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/assistants', assistantsRoutes);
app.use('/api/conversations', conversationsRoutes);

// Ruta de salud
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'ELISA IA Backend v3.0.0 - WAHA',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`> elisa-ia-backend@1.8.0 inicio`);
});

export default app;
