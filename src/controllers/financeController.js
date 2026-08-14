import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import { writeAuditLog } from '../utils/rbac.js';
import { toCsvBuffer, toXlsxBuffer } from '../utils/exportUtils.js';
import * as finance from '../services/financeService.js';
import { monthLabel } from '../utils/financeMoney.js';

export const financeDashboard = asyncHandler(async (req, res) => {
  const data = await finance.getFinanceDashboard();
  res.json({ success: true, data });
});

export const listStudentFees = asyncHandler(async (req, res) => {
  const data = await finance.listStudentFees(req.query);
  res.json({ success: true, data });
});

export const updateStudentFeeDefaults = asyncHandler(async (req, res) => {
  const student = await finance.updateStudentFeeDefaults(req.params.studentId, req.body, req.user?.id);
  await writeAuditLog({
    userId: req.user?.id,
    action: 'finance.student_fee_defaults',
    entity: 'Student',
    entityId: req.params.studentId,
    details: req.body,
    req,
  });
  res.json({ success: true, data: { student } });
});

export const searchStudents = asyncHandler(async (req, res) => {
  const students = await finance.searchStudentsForCollect(req.query.q || req.query.search || '');
  res.json({ success: true, data: { students } });
});

export const collectPreview = asyncHandler(async (req, res) => {
  const data = await finance.getCollectPreview(
    req.query.studentId,
    req.query.month,
    req.query.year,
    req.query.category || 'Monthly'
  );
  res.json({ success: true, data });
});

export const collectFee = asyncHandler(async (req, res) => {
  const payment = await finance.collectStudentFee(req.body, req.user?.id);
  await writeAuditLog({
    userId: req.user?.id,
    action: 'finance.collect_fee',
    entity: 'StudentFeePayment',
    entityId: payment.id,
    details: { receiptNumber: payment.receiptNumber, amount: payment.amount },
    req,
  });
  res.status(201).json({ success: true, message: 'Fee collected successfully', data: { payment } });
});

export const generateMonthlyFees = asyncHandler(async (req, res) => {
  const result = await finance.generateMonthlyFees({ ...req.body, userId: req.user?.id });
  await writeAuditLog({
    userId: req.user?.id,
    action: 'finance.generate_monthly_fees',
    entity: 'StudentFeeMonth',
    details: result,
    req,
  });
  const catLabel = result.categoryLabel || result.category || 'Monthly Fees';
  const parts = [`Created ${result.created}`, `updated ${result.updated}`];
  if (result.defaultsUpdated) parts.push(`defaults saved for ${result.defaultsUpdated} player(s)`);
  if (result.paymentsCleared) parts.push(`cleared ${result.paymentsCleared} payment(s)`);
  if (result.skipped) parts.push(`${result.skipped} skipped (₹0 fee)`);
  if (result.feeTotal != null) parts.push(`bill total ₹${Number(result.feeTotal).toLocaleString('en-IN')}`);
  res.json({
    success: true,
    message: `${catLabel} generated — ${parts.join(', ')}`,
    data: result,
  });
});

export const listPendingFees = asyncHandler(async (req, res) => {
  const data = await finance.listPendingFees(req.query);
  res.json({ success: true, data });
});

export const studentFeeHistory = asyncHandler(async (req, res) => {
  const rows = await finance.getStudentFeeHistory(req.params.studentId, req.query);
  res.json({ success: true, data: { history: rows } });
});

export const listPayments = asyncHandler(async (req, res) => {
  const data = await finance.listPayments(req.query);
  res.json({ success: true, data });
});

export const getReceipt = asyncHandler(async (req, res) => {
  const payment = await finance.getPaymentReceipt(req.params.id);
  res.json({ success: true, data: { payment } });
});

export const updatePayment = asyncHandler(async (req, res) => {
  const payment = await finance.updatePayment(req.params.id, req.body, req.user?.id);
  await writeAuditLog({
    userId: req.user?.id,
    action: 'finance.update_payment',
    entity: 'StudentFeePayment',
    entityId: req.params.id,
    details: req.body,
    req,
  });
  res.json({ success: true, data: { payment } });
});

export const deletePayment = asyncHandler(async (req, res) => {
  await finance.softDeletePayment(req.params.id, req.user?.id);
  await writeAuditLog({
    userId: req.user?.id,
    action: 'finance.delete_payment',
    entity: 'StudentFeePayment',
    entityId: req.params.id,
    req,
  });
  res.json({ success: true, message: 'Payment deleted' });
});

export const listCoachPayments = asyncHandler(async (req, res) => {
  const data = await finance.listCoachPayments(req.query);
  res.json({ success: true, data });
});

export const makeCoachPayment = asyncHandler(async (req, res) => {
  const payment = await finance.makeCoachPayment(req.body, req.user?.id);
  await writeAuditLog({
    userId: req.user?.id,
    action: 'finance.coach_payment',
    entity: 'CoachPayment',
    entityId: payment.id,
    details: { voucherNumber: payment.voucherNumber },
    req,
  });
  res.status(201).json({ success: true, message: 'Coach payment recorded', data: { payment } });
});

export const updateCoachPayment = asyncHandler(async (req, res) => {
  const payment = await finance.updateCoachPayment(req.params.id, req.body, req.user?.id);
  await writeAuditLog({
    userId: req.user?.id,
    action: 'finance.update_coach_payment',
    entity: 'CoachPayment',
    entityId: req.params.id,
    req,
  });
  res.json({ success: true, data: { payment } });
});

export const deleteCoachPayment = asyncHandler(async (req, res) => {
  await finance.softDeleteCoachPayment(req.params.id, req.user?.id);
  await writeAuditLog({
    userId: req.user?.id,
    action: 'finance.delete_coach_payment',
    entity: 'CoachPayment',
    entityId: req.params.id,
    req,
  });
  res.json({ success: true, message: 'Coach payment deleted' });
});

export const financeReport = asyncHandler(async (req, res) => {
  const data = await finance.getFinanceReport(req.query);
  res.json({ success: true, data });
});

export const exportStudentPayments = asyncHandler(async (req, res) => {
  const format = String(req.body?.format || req.query.format || 'xlsx').toLowerCase();
  const { rows } = await finance.listPayments({ ...req.body, ...req.query, page: 1, limit: 5000 });
  const columns = [
    { key: 'receiptNumber', label: 'Receipt' },
    { key: 'paymentDate', label: 'Date' },
    { key: 'studentName', label: 'Student' },
    { key: 'registrationNumber', label: 'Reg No' },
    { key: 'monthLabel', label: 'Month' },
    { key: 'amount', label: 'Paid' },
    { key: 'paymentMode', label: 'Mode' },
    { key: 'transactionReference', label: 'Reference' },
    { key: 'remarks', label: 'Remarks' },
  ];
  const mapped = rows.map((r) => ({
    receiptNumber: r.receiptNumber,
    paymentDate: r.paymentDate ? new Date(r.paymentDate).toLocaleString('en-IN') : '',
    studentName: r.student?.fullName || '',
    registrationNumber: r.student?.registrationNumber || '',
    monthLabel: r.monthLabel || (r.feeMonth ? monthLabel(r.feeMonth.month, r.feeMonth.year) : ''),
    amount: r.amount,
    paymentMode: r.paymentMode,
    transactionReference: r.transactionReference || '',
    remarks: r.remarks || '',
  }));

  if (format === 'csv') {
    const buf = toCsvBuffer(mapped, columns);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="student-fee-payments.csv"');
    return res.send(buf);
  }
  const buf = await toXlsxBuffer(mapped, columns, { sheetName: 'Fee Payments' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="student-fee-payments.xlsx"');
  return res.send(buf);
});

export const exportCoachPayments = asyncHandler(async (req, res) => {
  const format = String(req.body?.format || req.query.format || 'xlsx').toLowerCase();
  const { rows } = await finance.listCoachPayments({ ...req.body, ...req.query, page: 1, limit: 5000 });
  const columns = [
    { key: 'voucherNumber', label: 'Voucher' },
    { key: 'paymentDate', label: 'Date' },
    { key: 'coachName', label: 'Coach' },
    { key: 'coachCode', label: 'Coach ID' },
    { key: 'monthLabel', label: 'Month' },
    { key: 'baseSalary', label: 'Salary' },
    { key: 'bonus', label: 'Bonus' },
    { key: 'deduction', label: 'Deduction' },
    { key: 'netPayable', label: 'Net Payable' },
    { key: 'paidAmount', label: 'Paid' },
    { key: 'remainingAmount', label: 'Due' },
    { key: 'status', label: 'Status' },
    { key: 'paymentMode', label: 'Mode' },
  ];
  const mapped = rows.map((r) => ({
    voucherNumber: r.voucherNumber,
    paymentDate: r.paymentDate ? new Date(r.paymentDate).toLocaleString('en-IN') : '',
    coachName: r.coach?.fullName || '',
    coachCode: r.coach?.coachCode || '',
    monthLabel: r.monthLabel,
    baseSalary: r.baseSalary,
    bonus: r.bonus,
    deduction: r.deduction,
    netPayable: r.netPayable,
    paidAmount: r.paidAmount,
    remainingAmount: r.remainingAmount,
    status: r.status,
    paymentMode: r.paymentMode,
  }));

  if (format === 'csv') {
    const buf = toCsvBuffer(mapped, columns);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="coach-payments.csv"');
    return res.send(buf);
  }
  const buf = await toXlsxBuffer(mapped, columns, { sheetName: 'Coach Payments' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="coach-payments.xlsx"');
  return res.send(buf);
});

export const exportPendingFees = asyncHandler(async (req, res) => {
  const format = String(req.body?.format || req.query.format || 'xlsx').toLowerCase();
  const { rows } = await finance.listPendingFees({ ...req.body, ...req.query, page: 1, limit: 5000 });
  const columns = [
    { key: 'registrationNumber', label: 'Reg No' },
    { key: 'studentName', label: 'Student' },
    { key: 'feeType', label: 'Fee Type' },
    { key: 'monthLabel', label: 'Month' },
    { key: 'feeAmount', label: 'Fee' },
    { key: 'previousDue', label: 'Previous Due' },
    { key: 'discount', label: 'Discount' },
    { key: 'paidAmount', label: 'Paid' },
    { key: 'remainingDue', label: 'Due' },
    { key: 'status', label: 'Status' },
  ];
  const mapped = rows.map((r) => ({
    registrationNumber: r.student?.registrationNumber || '',
    studentName: r.student?.fullName || '',
    feeType: r.categoryLabel || r.category || 'Monthly Fees',
    monthLabel: r.monthLabel,
    feeAmount: r.feeAmount,
    previousDue: r.previousDue,
    discount: r.discount,
    paidAmount: r.paidAmount,
    remainingDue: r.remainingDue,
    status: r.status,
  }));
  if (format === 'csv') {
    const buf = toCsvBuffer(mapped, columns);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="pending-fees.csv"');
    return res.send(buf);
  }
  const buf = await toXlsxBuffer(mapped, columns, { sheetName: 'Pending Fees' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="pending-fees.xlsx"');
  return res.send(buf);
});
