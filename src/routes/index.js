import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Kartik Repossession Agency API is running',
    version: '1.0.0',
  });
});

export default router;
