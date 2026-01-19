import { Router, Request, Response } from 'express';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  console.log('Webhook recibido:', req.body);
  res.json({ received: true });
});

router.get('/', (req: Request, res: Response) => {
  const challenge = req.query['hub.challenge'];
  if (challenge) res.send(challenge);
  else res.sendStatus(200);
});

export default router;
