import { Router, Request, Response } from 'express';

const router = Router();

router.post('/stripe', async (req: Request, res: Response) => {
  try {
    console.log('Stripe webhook:', req.body);
    res.json({ received: true });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

router.post('/bold', async (req: Request, res: Response) => {
  try {
    console.log('Bold webhook:', req.body);
    res.json({ received: true });
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

export default router;
