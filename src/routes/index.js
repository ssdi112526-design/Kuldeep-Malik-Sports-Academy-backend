import { Router } from 'express';

const router = Router();

router.get('/', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'Kuldeep Malik Sports Academy API is running',
    version: '1.0.0',
  });
});

router.get('/health', (_req, res) => {
  res.status(200).json({
    success: true,
    status: 'ok',
    service: 'kuldeep-malik-sports-academy-api',
    timestamp: new Date().toISOString(),
  });
});

export default router;
