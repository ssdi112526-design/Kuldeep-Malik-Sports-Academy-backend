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
  body('panNumber')
    .trim()
    .notEmpty()
    .withMessage('PAN number is required')
    .customSanitizer((value) => String(value || '').toUpperCase().replace(/\s+/g, ''))
    .matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/)
    .withMessage('Enter a valid PAN (e.g. ABCDE1234F)'),
  body('aadhaarNumber')
    .trim()
    .notEmpty()
    .withMessage('Aadhaar number is required')
    .customSanitizer((value) => String(value || '').replace(/\s+/g, ''))
    .matches(/^[0-9]{12}$/)
    .withMessage('Enter a valid 12-digit Aadhaar number'),
  body('organisation').optional({ checkFalsy: true }).trim().isLength({ max: 150 }),
  body('serviceRequired').trim().notEmpty().withMessage('Service is required'),
  body('message')
    .trim()
    .notEmpty()
    .withMessage('Message is required')
    .isLength({ max: 2000 })
    .withMessage('Message must be under 2000 characters'),
];
