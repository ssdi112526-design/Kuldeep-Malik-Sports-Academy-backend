import { body } from 'express-validator';

export const registerValidation = [
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 100 }),
  body('email').trim().isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters'),
];

export const loginValidation = [
  body('email').trim().isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required'),
];

export const contactValidation = [
  body('fullName').trim().notEmpty().withMessage('Full name is required').isLength({ max: 120 }),
  body('email').trim().isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('phone').optional({ checkFalsy: true }).trim().isLength({ max: 20 }),
  body('panNumber').optional({ checkFalsy: true }).trim().isLength({ max: 20 }),
  body('aadhaarNumber').optional({ checkFalsy: true }).trim().isLength({ max: 20 }),
  body('organisation').optional({ checkFalsy: true }).trim().isLength({ max: 150 }),
  body('serviceRequired').trim().notEmpty().withMessage('Service is required'),
  body('message')
    .trim()
    .notEmpty()
    .withMessage('Message is required')
    .isLength({ max: 2000 })
    .withMessage('Message must be under 2000 characters'),
];
