import { Router, Request, Response } from 'express';

const router = Router();

// Webhook general
router.post('/', async (req: Request, res: Response) => {
  try {
    console.log('📥 Webhook recibido:', {
      headers: req.headers,
      body: req.body,
      query: req.query
    });
    
    res.json({ received: true, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error en webhook:', error);
    res.status(500).json({ error: 'Error procesando webhook' });
  }
});

// Verificación de webhook (para Facebook/Meta)
router.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  if (mode === 'subscribe' && challenge) {
    console.log('✅ Webhook verificado');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(200);
  }
});

// Webhook de WhatsApp Cloud API (si se usa en el futuro)
router.post('/whatsapp', async (req: Request, res: Response) => {
  try {
    console.log('📱 Webhook WhatsApp:', req.body);
    res.json({ received: true });
  } catch (error) {
    console.error('Error en webhook WhatsApp:', error);
    res.status(500).json({ error: 'Error' });
  }
});

// Webhook de pagos
router.post('/payments', async (req: Request, res: Response) => {
  try {
    console.log('💰 Webhook de pago:', req.body);
    res.json({ received: true });
  } catch (error) {
    console.error('Error en webhook de pago:', error);
    res.status(500).json({ error: 'Error' });
  }
});

export default router;
