import { body, query } from 'express-validator';

export const listQueryValidation = [
  query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
  query('status')
    .optional()
    .isIn(['new', 'in_progress', 'resolved', 'closed'])
    .withMessage('Invalid status value'),
  query('dateFilter')
    .optional()
    .isIn(['today', 'yesterday', 'week', 'month', 'custom'])
    .withMessage('Invalid dateFilter value'),
  query('startDate').optional().isISO8601().withMessage('startDate must be a valid date'),
  query('endDate').optional().isISO8601().withMessage('endDate must be a valid date'),
  query('search').optional().isLength({ max: 200 }).withMessage('search term too long'),
];

export const exportValidation = [
  body('ids').isArray({ min: 1, max: 500 }).withMessage('Please select at least one record'),
  body('ids.*').isUUID().withMessage('Invalid record id'),
  body('format').isIn(['csv', 'xlsx']).withMessage('Format must be csv or xlsx'),
];

export const bulkDeleteValidation = [
  body('ids').isArray({ min: 1, max: 500 }).withMessage('Please select at least one record'),
  body('ids.*').isUUID().withMessage('Invalid record id'),
];
