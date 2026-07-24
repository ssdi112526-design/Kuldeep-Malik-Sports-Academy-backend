import { Router } from 'express';
import { register, login, getMe, logout } from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { registerValidation, loginValidation } from '../validators/authValidators.js';

const router = Router();

router.post('/register', registerValidation, validate, register);
router.post('/login', loginValidation, validate, login);
router.get('/me', protect, getMe);
router.post('/logout', protect, logout);

export default router;
