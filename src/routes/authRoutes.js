import { Router } from 'express';
import {
  register,
  login,
  getMe,
  logout,
  changePassword,
  verifyPassword,
  getControllerPasswordStatus,
  setupControllerPassword,
  forgotControllerPassword,
  resetControllerPassword,
  forgotPassword,
  resetPassword,
} from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { registerValidation, loginValidation } from '../validators/authValidators.js';

const router = Router();

router.post('/register', registerValidation, validate, register);
router.post('/login', loginValidation, validate, login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/me', protect, getMe);
router.post('/logout', protect, logout);
router.post('/change-password', protect, changePassword);

// Controller password (separate from login password)
router.get('/controller-password/status', protect, getControllerPasswordStatus);
router.post('/controller-password/setup', protect, setupControllerPassword);
router.post('/controller-password/verify', protect, verifyPassword);
router.post('/controller-password/forgot', protect, forgotControllerPassword);
router.post('/controller-password/reset', resetControllerPassword);
// Backward-compatible alias
router.post('/verify-password', protect, verifyPassword);

export default router;
