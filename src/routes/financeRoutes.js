import { Router } from 'express';
import { protect, requireAdminAccess, requirePermission } from '../middleware/auth.js';
import * as ctrl from '../controllers/financeController.js';

const router = Router();

const view = [protect, requireAdminAccess, requirePermission('finance.view')];
const create = [protect, requireAdminAccess, requirePermission('finance.create')];
const edit = [protect, requireAdminAccess, requirePermission('finance.edit')];
const remove = [protect, requireAdminAccess, requirePermission('finance.delete')];
const exp = [protect, requireAdminAccess, requirePermission('finance.export')];
const print = [protect, requireAdminAccess, requirePermission('finance.print')];

router.get('/admin/finance/dashboard', ...view, ctrl.financeDashboard);
router.get('/admin/finance/report', ...view, ctrl.financeReport);

router.get('/admin/finance/students', ...view, ctrl.listStudentFees);
router.get('/admin/finance/students/search', ...view, ctrl.searchStudents);
router.get('/admin/finance/students/:studentId/history', ...view, ctrl.studentFeeHistory);
router.patch('/admin/finance/students/:studentId/defaults', ...edit, ctrl.updateStudentFeeDefaults);

router.get('/admin/finance/collect/preview', ...view, ctrl.collectPreview);
router.post('/admin/finance/collect', ...create, ctrl.collectFee);
router.post('/admin/finance/generate-monthly', ...create, ctrl.generateMonthlyFees);
router.get('/admin/finance/pending', ...view, ctrl.listPendingFees);

router.get('/admin/finance/payments', ...view, ctrl.listPayments);
router.get('/admin/finance/payments/:id', ...view, ctrl.getReceipt);
router.get('/admin/finance/receipts/:id', ...print, ctrl.getReceipt);
router.put('/admin/finance/payments/:id', ...edit, ctrl.updatePayment);
router.delete('/admin/finance/payments/:id', ...remove, ctrl.deletePayment);

router.get('/admin/finance/coach-payments', ...view, ctrl.listCoachPayments);
router.post('/admin/finance/coach-payments', ...create, ctrl.makeCoachPayment);
router.put('/admin/finance/coach-payments/:id', ...edit, ctrl.updateCoachPayment);
router.delete('/admin/finance/coach-payments/:id', ...remove, ctrl.deleteCoachPayment);

router.post('/admin/finance/export/payments', ...exp, ctrl.exportStudentPayments);
router.post('/admin/finance/export/coach-payments', ...exp, ctrl.exportCoachPayments);
router.post('/admin/finance/export/pending', ...exp, ctrl.exportPendingFees);

export default router;
