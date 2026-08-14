import prisma from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import {
  normalizeFeeCategory,
  feeCategoryLabel,
  studentDefaultFeeField,
} from '../constants/feeCategories.js';
import {
  money,
  moneyStr,
  addMoney,
  subMoney,
  clampNonNegative,
  feeStatusFromAmounts,
  coachStatusFromAmounts,
  parseMonthYear,
  monthLabel,
} from '../utils/financeMoney.js';

const PAYMENT_MODES = new Set(['Cash', 'UPI', 'BankTransfer', 'Other']);

function assertMode(mode) {
  const m = String(mode || '').trim();
  if (!PAYMENT_MODES.has(m)) throw new ApiError(400, 'Invalid payment mode');
  return m;
}

function dec(v) {
  return moneyStr(v);
}

export async function nextFinanceNumber(tx, key, prefix) {
  const year = new Date().getFullYear();
  const row = await tx.financeSequence.upsert({
    where: { key_year: { key, year } },
    create: { key, year, lastValue: 1 },
    update: { lastValue: { increment: 1 } },
  });
  const n = String(row.lastValue).padStart(6, '0');
  return `${prefix}-${year}-${n}`;
}

export function serializeMoney(obj) {
  if (obj == null) return obj;
  if (Array.isArray(obj)) return obj.map(serializeMoney);
  if (typeof obj !== 'object') return obj;
  if (obj instanceof Date) return obj.toISOString();
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v != null && typeof v === 'object' && typeof v.toFixed === 'function') {
      out[k] = Number(v);
    } else if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      out[k] = serializeMoney(v);
    } else if (Array.isArray(v)) {
      out[k] = v.map(serializeMoney);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Sum remaining due across open fee months for a student (optionally one category) */
export async function getStudentOutstanding(
  studentId,
  excludeFeeMonthId = null,
  db = prisma,
  category = null
) {
  const where = {
    studentId,
    deletedAt: null,
    status: { in: ['Due', 'Partial', 'Overdue'] },
  };
  if (excludeFeeMonthId) where.id = { not: excludeFeeMonthId };
  if (category) where.category = normalizeFeeCategory(category);
  const rows = await db.studentFeeMonth.findMany({
    where,
    select: { remainingDue: true },
  });
  return rows.reduce((s, r) => addMoney(s, r.remainingDue), 0);
}

export async function recalcFeeMonth(tx, feeMonthId) {
  const fee = await tx.studentFeeMonth.findUnique({ where: { id: feeMonthId } });
  if (!fee || fee.deletedAt) return null;

  const payments = await tx.studentFeePayment.findMany({
    where: { feeMonthId, deletedAt: null },
    select: { amount: true },
  });
  const paidAmount = payments.reduce((s, p) => addMoney(s, p.amount), 0);
  const { status, remainingDue } = feeStatusFromAmounts({
    feeAmount: fee.feeAmount,
    previousDue: fee.previousDue,
    discount: fee.discount,
    paidAmount,
    dueDate: fee.dueDate,
  });

  return tx.studentFeeMonth.update({
    where: { id: feeMonthId },
    data: {
      paidAmount: dec(paidAmount),
      remainingDue: dec(remainingDue),
      status,
    },
  });
}

async function syncStudentPaymentStatus(tx, studentId) {
  const outstanding = await getStudentOutstanding(studentId, null, tx);
  let paymentStatus = 'Paid';
  if (outstanding > 0) {
    const overdue = await tx.studentFeeMonth.count({
      where: { studentId, deletedAt: null, status: 'Overdue' },
    });
    paymentStatus = overdue > 0 ? 'Overdue' : 'Pending';
  }
  await tx.student.update({
    where: { id: studentId },
    data: { paymentStatus },
  });
}

export async function updateStudentFeeDefaults(studentId, payload, userId) {
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) throw new ApiError(404, 'Student not found');

  const data = {};
  if (payload.monthlyFee != null) data.monthlyFee = dec(payload.monthlyFee);
  if (payload.hostelFee != null) data.hostelFee = dec(payload.hostelFee);
  if (payload.otherFee != null) data.otherFee = dec(payload.otherFee);
  if (payload.admissionFee != null) data.admissionFee = dec(payload.admissionFee);
  if (payload.defaultDiscount != null) data.defaultDiscount = dec(payload.defaultDiscount);

  const updated = await prisma.student.update({
    where: { id: studentId },
    data,
  });
  return serializeMoney(updated);
}

export async function listStudentFees({
  search = '',
  status,
  page = 1,
  limit = 20,
}) {
  const take = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (Math.max(1, Number(page) || 1) - 1) * take;
  const where = { status: { in: ['Active', 'Inactive'] } };
  if (search.trim()) {
    const q = search.trim();
    where.OR = [
      { fullName: { contains: q, mode: 'insensitive' } },
      { registrationNumber: { contains: q, mode: 'insensitive' } },
      { mobileNumber: { contains: q, mode: 'insensitive' } },
      { fatherName: { contains: q, mode: 'insensitive' } },
    ];
  }

  const [total, students] = await Promise.all([
    prisma.student.count({ where }),
    prisma.student.findMany({
      where,
      skip,
      take,
      orderBy: { fullName: 'asc' },
      select: {
        id: true,
        registrationNumber: true,
        fullName: true,
        fatherName: true,
        motherName: true,
        photo: true,
        mobileNumber: true,
        status: true,
        monthlyFee: true,
        hostelFee: true,
        otherFee: true,
        admissionFee: true,
        defaultDiscount: true,
        advanceBalance: true,
        paymentStatus: true,
      },
    }),
  ]);

  const ids = students.map((s) => s.id);
  const dues = await prisma.studentFeeMonth.groupBy({
    by: ['studentId'],
    where: {
      studentId: { in: ids },
      deletedAt: null,
      status: { in: ['Due', 'Partial', 'Overdue'] },
    },
    _sum: { remainingDue: true },
  });
  const paid = await prisma.studentFeePayment.groupBy({
    by: ['studentId'],
    where: { studentId: { in: ids }, deletedAt: null },
    _sum: { amount: true },
  });
  const dueMap = Object.fromEntries(dues.map((d) => [d.studentId, money(d._sum.remainingDue)]));
  const paidMap = Object.fromEntries(paid.map((d) => [d.studentId, money(d._sum.amount)]));

  let rows = students.map((s) => {
    const currentDue = dueMap[s.id] || 0;
    const totalPaid = paidMap[s.id] || 0;
    let feeStatus = 'Paid';
    if (currentDue > 0) {
      feeStatus = s.paymentStatus === 'Overdue' ? 'Overdue' : currentDue < money(s.monthlyFee) ? 'Partial' : 'Due';
    }
    if (status && feeStatus !== status && !(status === 'Partial' && feeStatus === 'Partial')) {
      /* filter later */
    }
    return serializeMoney({
      ...s,
      id: s.id,
      _id: s.id,
      currentDue,
      totalPaid,
      feeStatus,
    });
  });

  if (status) {
    rows = rows.filter((r) => r.feeStatus === status);
  }

  return { total: status ? rows.length : total, page: Number(page) || 1, limit: take, rows };
}

export async function searchStudentsForCollect(q) {
  const query = String(q || '').trim();
  if (!query) return [];
  const students = await prisma.student.findMany({
    where: {
      status: { in: ['Active', 'Inactive'] },
      OR: [
        { fullName: { contains: query, mode: 'insensitive' } },
        { registrationNumber: { contains: query, mode: 'insensitive' } },
        { mobileNumber: { contains: query, mode: 'insensitive' } },
      ],
    },
    take: 20,
    orderBy: { fullName: 'asc' },
    select: {
      id: true,
      registrationNumber: true,
      fullName: true,
      photo: true,
      mobileNumber: true,
      monthlyFee: true,
      hostelFee: true,
      otherFee: true,
      admissionFee: true,
      defaultDiscount: true,
      advanceBalance: true,
      fatherName: true,
    },
  });
  const withDue = await Promise.all(
    students.map(async (s) => ({
      ...serializeMoney(s),
      id: s.id,
      _id: s.id,
      previousDue: await getStudentOutstanding(s.id),
    }))
  );
  return withDue;
}

export async function getCollectPreview(studentId, month, year, categoryInput = 'Monthly') {
  const { month: m, year: y } = parseMonthYear(month, year);
  const category = normalizeFeeCategory(categoryInput);
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) throw new ApiError(404, 'Student not found');

  const existing = await prisma.studentFeeMonth.findFirst({
    where: { studentId, month: m, year: y, category, deletedAt: null },
  });
  const previousDue = existing
    ? money(existing.previousDue)
    : await getStudentOutstanding(studentId, null, prisma, category);

  const defaultField = studentDefaultFeeField(category);
  const feeAmount = existing ? money(existing.feeAmount) : money(student[defaultField] || 0);
  const discount = existing ? money(existing.discount) : money(student.defaultDiscount);
  const paidAmount = existing ? money(existing.paidAmount) : 0;
  const totalOutstanding = clampNonNegative(addMoney(feeAmount, previousDue) - discount - paidAmount);

  return serializeMoney({
    student: {
      id: student.id,
      _id: student.id,
      registrationNumber: student.registrationNumber,
      fullName: student.fullName,
      photo: student.photo,
      fatherName: student.fatherName,
      mobileNumber: student.mobileNumber,
      monthlyFee: student.monthlyFee,
      hostelFee: student.hostelFee,
      otherFee: student.otherFee,
      admissionFee: student.admissionFee,
      defaultDiscount: student.defaultDiscount,
      advanceBalance: student.advanceBalance,
    },
    month: m,
    year: y,
    category,
    categoryLabel: feeCategoryLabel(category),
    monthLabel: monthLabel(m, y),
    feeMonthId: existing?.id || null,
    title: existing?.title || null,
    feeAmount,
    previousDue,
    discount,
    paidAmount,
    totalOutstanding,
    status: existing?.status || (totalOutstanding > 0 ? 'Due' : 'Paid'),
  });
}

export async function collectStudentFee(payload, userId) {
  const studentId = payload.studentId;
  const { month, year } = parseMonthYear(payload.month, payload.year);
  const category = normalizeFeeCategory(payload.category || 'Monthly');
  const title =
    category === 'Other'
      ? String(payload.title || payload.notes || '').trim() || 'Other Fees'
      : null;
  const paymentMode = assertMode(payload.paymentMode);
  const paidAmount = money(payload.paidAmount);
  if (paidAmount <= 0) throw new ApiError(400, 'Paid amount must be greater than zero');

  const discount = money(payload.discount ?? 0);
  if (discount < 0) throw new ApiError(400, 'Discount cannot be negative');

  const paymentDate = payload.paymentDate ? new Date(payload.paymentDate) : new Date();
  if (Number.isNaN(paymentDate.getTime())) throw new ApiError(400, 'Invalid payment date');

  const result = await prisma.$transaction(
    async (tx) => {
    const student = await tx.student.findUnique({ where: { id: studentId } });
    if (!student) throw new ApiError(404, 'Student not found');

    let fee = await tx.studentFeeMonth.findFirst({
      where: { studentId, month, year, category, deletedAt: null },
    });

    const defaultField = studentDefaultFeeField(category);
    const feeAmount = money(
      payload.feeAmount != null ? payload.feeAmount : fee?.feeAmount ?? student[defaultField] ?? 0
    );
    if (feeAmount < 0) throw new ApiError(400, 'Fee amount cannot be negative');

    if (!fee) {
      const previousDue = await getStudentOutstanding(studentId, null, tx, category);
      const { status, remainingDue } = feeStatusFromAmounts({
        feeAmount,
        previousDue,
        discount,
        paidAmount: 0,
      });
      fee = await tx.studentFeeMonth.create({
        data: {
          studentId,
          month,
          year,
          category,
          title,
          feeAmount: dec(feeAmount),
          previousDue: dec(previousDue),
          discount: dec(discount),
          paidAmount: dec(0),
          remainingDue: dec(remainingDue),
          status,
          createdById: userId || null,
          updatedById: userId || null,
        },
      });
    } else if (payload.discount != null || payload.feeAmount != null || payload.title != null) {
      await tx.studentFeeMonth.update({
        where: { id: fee.id },
        data: {
          feeAmount: dec(feeAmount),
          discount: dec(discount),
          ...(title != null ? { title } : {}),
          updatedById: userId || null,
        },
      });
      fee = await recalcFeeMonth(tx, fee.id);
    }

    const before = await tx.studentFeeMonth.findUnique({ where: { id: fee.id } });
    const obligation = clampNonNegative(
      addMoney(before.feeAmount, before.previousDue) - money(before.discount)
    );
    const alreadyPaid = money(before.paidAmount);
    const stillDue = clampNonNegative(obligation - alreadyPaid);

    let applyAmount = paidAmount;
    let advanceAdd = 0;
    if (applyAmount > stillDue) {
      advanceAdd = money(applyAmount - stillDue);
      applyAmount = stillDue;
    }

    const receiptNumber = await nextFinanceNumber(tx, 'student_receipt', 'RCP');

    const paymentAmount = stillDue <= 0 ? paidAmount : applyAmount > 0 ? applyAmount : paidAmount;

    // Compute remaining after this payment without a second recalc round-trip where possible
    let remainingAfter = stillDue <= 0 ? 0 : clampNonNegative(stillDue - paymentAmount);
    const newPaidTotal = addMoney(alreadyPaid, stillDue <= 0 ? 0 : paymentAmount);
    const { status: newStatus } = feeStatusFromAmounts({
      feeAmount: before.feeAmount,
      previousDue: before.previousDue,
      discount: before.discount,
      paidAmount: stillDue <= 0 ? alreadyPaid : newPaidTotal,
      dueDate: before.dueDate,
    });

    const payment = await tx.studentFeePayment.create({
      data: {
        feeMonthId: fee.id,
        studentId,
        amount: dec(paymentAmount),
        paymentDate,
        paymentMode,
        transactionReference: payload.transactionReference?.trim() || null,
        receiptNumber,
        remarks: payload.remarks?.trim() || null,
        previousDueSnapshot: dec(before.previousDue),
        discountApplied: dec(before.discount),
        feeAmountSnapshot: dec(before.feeAmount),
        remainingAfter: dec(remainingAfter),
        createdById: userId || null,
        updatedById: userId || null,
      },
    });

    if (stillDue <= 0 && paidAmount > 0) {
      await tx.student.update({
        where: { id: studentId },
        data: { advanceBalance: dec(addMoney(student.advanceBalance, paidAmount)) },
      });
    } else {
      await tx.studentFeeMonth.update({
        where: { id: fee.id },
        data: {
          paidAmount: dec(newPaidTotal),
          remainingDue: dec(remainingAfter),
          status: newStatus,
          updatedById: userId || null,
        },
      });
      if (advanceAdd > 0) {
        await tx.student.update({
          where: { id: studentId },
          data: { advanceBalance: dec(addMoney(student.advanceBalance, advanceAdd)) },
        });
      }
    }

    await syncStudentPaymentStatus(tx, studentId);

    const full = await tx.studentFeePayment.findUnique({
      where: { id: payment.id },
      include: {
        student: {
          select: {
            id: true,
            registrationNumber: true,
            fullName: true,
            photo: true,
            fatherName: true,
            mobileNumber: true,
          },
        },
        feeMonth: true,
      },
    });
    return full;
  },
    { maxWait: 20000, timeout: 60000 }
  );

  return serializeMoney({ ...result, id: result.id, _id: result.id });
}

/**
 * Generate (or regenerate) fee bills for Active students.
 *
 * Preferred (combined bill):
 *   monthlyFee + hostelFee + otherFee → one Monthly category row with components + total.
 *
 * Legacy (single category):
 *   category + feeAmount → one row for that category (unchanged behaviour).
 *
 * saveAsStudentDefault: writes student monthlyFee/hostelFee/otherFee defaults when amounts given.
 */
export async function generateMonthlyFees({
  month,
  year,
  feeAmount,
  monthlyFee,
  hostelFee,
  otherFee,
  studentIds,
  userId,
  saveAsStudentDefault,
  category: categoryInput = 'Monthly',
  title: titleInput,
}) {
  const { month: m, year: y } = parseMonthYear(month, year);
  const where = { status: 'Active' };
  if (Array.isArray(studentIds) && studentIds.length) {
    where.id = { in: studentIds };
  }

  const hasCombinedInput =
    monthlyFee !== undefined || hostelFee !== undefined || otherFee !== undefined;

  // Combined Monthly + Hostel + Other → one Monthly bill (preferred UI)
  if (hasCombinedInput) {
    return generateCombinedMonthlyFees({
      month: m,
      year: y,
      monthlyFee,
      hostelFee,
      otherFee,
      studentIds,
      userId,
      saveAsStudentDefault,
      titleInput,
      where,
    });
  }

  // --- Legacy single-category generate ---
  const category = normalizeFeeCategory(categoryInput);
  const title =
    category === 'Other' ? String(titleInput || '').trim() || 'Other Fees' : null;
  const defaultField = studentDefaultFeeField(category);

  const hasOverride = feeAmount != null && feeAmount !== '';
  const saveDefaults = hasOverride && saveAsStudentDefault !== false;

  const students = await prisma.student.findMany({
    where,
    select: { id: true, monthlyFee: true, hostelFee: true, otherFee: true, defaultDiscount: true },
  });
  let created = 0;
  let updated = 0;
  let paymentsCleared = 0;
  let skipped = 0;
  let defaultsUpdated = 0;
  const now = new Date();

  for (const s of students) {
    const amount = money(hasOverride ? feeAmount : s[defaultField] || 0);
    if (amount <= 0) {
      skipped += 1;
      continue;
    }

    if (saveDefaults) {
      await prisma.student.update({
        where: { id: s.id },
        data: { [defaultField]: dec(amount) },
      });
      defaultsUpdated += 1;
    }

    const discount = money(s.defaultDiscount);
    const components = feeComponentsForCategory(category, amount);

    const existing = await prisma.studentFeeMonth.findFirst({
      where: { studentId: s.id, month: m, year: y, category },
    });

    if (existing) {
      const payResult = await prisma.studentFeePayment.updateMany({
        where: { feeMonthId: existing.id, deletedAt: null },
        data: { deletedAt: now, deletedById: userId || null },
      });
      paymentsCleared += payResult.count;

      const previousDue = await getStudentOutstanding(s.id, existing.id, prisma, category);
      const { status, remainingDue } = feeStatusFromAmounts({
        feeAmount: amount,
        previousDue,
        discount,
        paidAmount: 0,
      });

      await prisma.studentFeeMonth.update({
        where: { id: existing.id },
        data: {
          category,
          title,
          feeAmount: dec(amount),
          monthlyAmount: dec(components.monthlyAmount),
          hostelAmount: dec(components.hostelAmount),
          otherAmount: dec(components.otherAmount),
          previousDue: dec(previousDue),
          discount: dec(discount),
          paidAmount: dec(0),
          remainingDue: dec(remainingDue),
          status,
          deletedAt: null,
          updatedById: userId || null,
        },
      });
      await syncStudentPaymentStatus(prisma, s.id);
      updated += 1;
      continue;
    }

    const previousDue = await getStudentOutstanding(s.id, null, prisma, category);
    const { status, remainingDue } = feeStatusFromAmounts({
      feeAmount: amount,
      previousDue,
      discount,
      paidAmount: 0,
    });
    await prisma.studentFeeMonth.create({
      data: {
        studentId: s.id,
        month: m,
        year: y,
        category,
        title,
        feeAmount: dec(amount),
        monthlyAmount: dec(components.monthlyAmount),
        hostelAmount: dec(components.hostelAmount),
        otherAmount: dec(components.otherAmount),
        previousDue: dec(previousDue),
        discount: dec(discount),
        paidAmount: dec(0),
        remainingDue: dec(remainingDue),
        status,
        createdById: userId || null,
        updatedById: userId || null,
      },
    });
    await syncStudentPaymentStatus(prisma, s.id);
    created += 1;
  }

  if (created + updated === 0) {
    throw new ApiError(
      400,
      `No ${feeCategoryLabel(category)} generated. Enter a fee amount, or set each student’s ${feeCategoryLabel(category)} via Defaults first.`
    );
  }

  return {
    created,
    updated,
    paymentsCleared,
    skipped,
    defaultsUpdated,
    total: students.length,
    month: m,
    year: y,
    category,
    categoryLabel: feeCategoryLabel(category),
  };
}

const FEE_AMOUNT_MAX = 9999999999.99;

function parseFeeComponent(value, label) {
  if (value === undefined || value === null || value === '') return 0;
  const raw = String(value).trim().replace(/,/g, '');
  if (/^-/.test(raw)) throw new ApiError(400, 'Fees cannot be negative');
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    throw new ApiError(400, `${label} must be a valid amount`);
  }
  const n = money(raw);
  if (n < 0) throw new ApiError(400, 'Fees cannot be negative');
  if (n > FEE_AMOUNT_MAX) throw new ApiError(400, `${label} is too large`);
  return n;
}

function feeComponentsForCategory(category, amount) {
  const a = money(amount);
  if (category === 'Hostel') return { monthlyAmount: 0, hostelAmount: a, otherAmount: 0 };
  if (category === 'Other') return { monthlyAmount: 0, hostelAmount: 0, otherAmount: a };
  return { monthlyAmount: a, hostelAmount: 0, otherAmount: 0 };
}

async function generateCombinedMonthlyFees({
  month: m,
  year: y,
  monthlyFee,
  hostelFee,
  otherFee,
  userId,
  saveAsStudentDefault,
  titleInput,
  where,
}) {
  const providedAny =
    (monthlyFee !== undefined && monthlyFee !== null && String(monthlyFee).trim() !== '') ||
    (hostelFee !== undefined && hostelFee !== null && String(hostelFee).trim() !== '') ||
    (otherFee !== undefined && otherFee !== null && String(otherFee).trim() !== '');

  let overrideMonthly;
  let overrideHostel;
  let overrideOther;
  if (providedAny) {
    overrideMonthly = parseFeeComponent(monthlyFee, 'Monthly Fees');
    overrideHostel = parseFeeComponent(hostelFee, 'Hostel Fees');
    overrideOther = parseFeeComponent(otherFee, 'Other Fees');
    const totalCheck = addMoney(overrideMonthly, overrideHostel, overrideOther);
    if (totalCheck <= 0) {
      throw new ApiError(400, 'Enter at least one fee amount greater than zero');
    }
  }

  const saveDefaults = providedAny && saveAsStudentDefault !== false;
  const title = String(titleInput || '').trim() || null;

  const students = await prisma.student.findMany({
    where,
    select: { id: true, monthlyFee: true, hostelFee: true, otherFee: true, defaultDiscount: true },
  });

  let created = 0;
  let updated = 0;
  let paymentsCleared = 0;
  let skipped = 0;
  let defaultsUpdated = 0;
  const now = new Date();
  const category = 'Monthly';

  for (const s of students) {
    const monthlyAmount = providedAny ? overrideMonthly : money(s.monthlyFee);
    const hostelAmount = providedAny ? overrideHostel : money(s.hostelFee);
    const otherAmount = providedAny ? overrideOther : money(s.otherFee);
    const amount = addMoney(monthlyAmount, hostelAmount, otherAmount);

    if (amount <= 0) {
      skipped += 1;
      continue;
    }

    // Backend always owns the total — never trust a client-sent total.
    const verifiedTotal = addMoney(monthlyAmount, hostelAmount, otherAmount);
    if (verifiedTotal !== amount) {
      throw new ApiError(400, 'Fee total mismatch');
    }

    if (saveDefaults) {
      await prisma.student.update({
        where: { id: s.id },
        data: {
          monthlyFee: dec(monthlyAmount),
          hostelFee: dec(hostelAmount),
          otherFee: dec(otherAmount),
        },
      });
      defaultsUpdated += 1;
    }

    const discount = money(s.defaultDiscount);

    const existing = await prisma.studentFeeMonth.findFirst({
      where: { studentId: s.id, month: m, year: y, category },
    });

    if (existing) {
      const payResult = await prisma.studentFeePayment.updateMany({
        where: { feeMonthId: existing.id, deletedAt: null },
        data: { deletedAt: now, deletedById: userId || null },
      });
      paymentsCleared += payResult.count;

      const previousDue = await getStudentOutstanding(s.id, existing.id, prisma, category);
      const { status, remainingDue } = feeStatusFromAmounts({
        feeAmount: amount,
        previousDue,
        discount,
        paidAmount: 0,
      });

      await prisma.studentFeeMonth.update({
        where: { id: existing.id },
        data: {
          category,
          title,
          feeAmount: dec(amount),
          monthlyAmount: dec(monthlyAmount),
          hostelAmount: dec(hostelAmount),
          otherAmount: dec(otherAmount),
          previousDue: dec(previousDue),
          discount: dec(discount),
          paidAmount: dec(0),
          remainingDue: dec(remainingDue),
          status,
          deletedAt: null,
          updatedById: userId || null,
        },
      });
      await syncStudentPaymentStatus(prisma, s.id);
      updated += 1;
      continue;
    }

    const previousDue = await getStudentOutstanding(s.id, null, prisma, category);
    const { status, remainingDue } = feeStatusFromAmounts({
      feeAmount: amount,
      previousDue,
      discount,
      paidAmount: 0,
    });
    await prisma.studentFeeMonth.create({
      data: {
        studentId: s.id,
        month: m,
        year: y,
        category,
        title,
        feeAmount: dec(amount),
        monthlyAmount: dec(monthlyAmount),
        hostelAmount: dec(hostelAmount),
        otherAmount: dec(otherAmount),
        previousDue: dec(previousDue),
        discount: dec(discount),
        paidAmount: dec(0),
        remainingDue: dec(remainingDue),
        status,
        createdById: userId || null,
        updatedById: userId || null,
      },
    });
    await syncStudentPaymentStatus(prisma, s.id);
    created += 1;
  }

  if (created + updated === 0) {
    throw new ApiError(
      400,
      'No fees generated. Enter Monthly / Hostel / Other amounts, or set each player’s fee defaults first.'
    );
  }

  return {
    created,
    updated,
    paymentsCleared,
    skipped,
    defaultsUpdated,
    total: students.length,
    month: m,
    year: y,
    category,
    categoryLabel: 'Monthly Fees (combined)',
    monthlyFee: providedAny ? overrideMonthly : null,
    hostelFee: providedAny ? overrideHostel : null,
    otherFee: providedAny ? overrideOther : null,
    feeTotal: providedAny
      ? addMoney(overrideMonthly, overrideHostel, overrideOther)
      : null,
  };
}

export async function listPendingFees({ search, page = 1, limit = 20 }) {
  const take = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (Math.max(1, Number(page) || 1) - 1) * take;
  const where = {
    deletedAt: null,
    status: { in: ['Due', 'Partial', 'Overdue'] },
    remainingDue: { gt: 0 },
  };
  if (search?.trim()) {
    const q = search.trim();
    where.student = {
      OR: [
        { fullName: { contains: q, mode: 'insensitive' } },
        { registrationNumber: { contains: q, mode: 'insensitive' } },
        { mobileNumber: { contains: q, mode: 'insensitive' } },
      ],
    };
  }

  const [total, rows] = await Promise.all([
    prisma.studentFeeMonth.count({ where }),
    prisma.studentFeeMonth.findMany({
      where,
      skip,
      take,
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      include: {
        student: {
          select: {
            id: true,
            registrationNumber: true,
            fullName: true,
            photo: true,
            mobileNumber: true,
          },
        },
      },
    }),
  ]);

  return {
    total,
    page: Number(page) || 1,
    limit: take,
    rows: rows.map((r) =>
      serializeMoney({
        ...r,
        id: r.id,
        _id: r.id,
        monthLabel: monthLabel(r.month, r.year),
        categoryLabel: feeCategoryLabel(r.category),
        student: r.student ? { ...r.student, _id: r.student.id } : null,
      })
    ),
  };
}

export async function getStudentFeeHistory(studentId, filters = {}) {
  const where = { studentId, deletedAt: null };
  if (filters.month) where.month = Number(filters.month);
  if (filters.year) where.year = Number(filters.year);
  if (filters.status) where.status = filters.status;

  const months = await prisma.studentFeeMonth.findMany({
    where,
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    include: {
      payments: {
        where: {
          deletedAt: null,
          ...(filters.paymentMode ? { paymentMode: filters.paymentMode } : {}),
          ...(filters.from || filters.to
            ? {
                paymentDate: {
                  ...(filters.from ? { gte: new Date(filters.from) } : {}),
                  ...(filters.to ? { lte: new Date(filters.to) } : {}),
                },
              }
            : {}),
        },
        orderBy: { paymentDate: 'desc' },
      },
    },
  });

  return months.map((m) =>
    serializeMoney({
      ...m,
      id: m.id,
      _id: m.id,
      monthLabel: monthLabel(m.month, m.year),
      categoryLabel: feeCategoryLabel(m.category),
      payments: m.payments.map((p) => ({ ...serializeMoney(p), id: p.id, _id: p.id })),
    })
  );
}

export async function listPayments({
  search,
  status,
  paymentMode,
  from,
  to,
  month,
  year,
  page = 1,
  limit = 20,
}) {
  const take = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (Math.max(1, Number(page) || 1) - 1) * take;
  const where = { deletedAt: null };
  if (paymentMode) where.paymentMode = paymentMode;
  if (from || to) {
    where.paymentDate = {};
    if (from) where.paymentDate.gte = new Date(from);
    if (to) where.paymentDate.lte = new Date(to);
  }
  if (month || year) {
    where.feeMonth = {
      deletedAt: null,
      ...(month ? { month: Number(month) } : {}),
      ...(year ? { year: Number(year) } : {}),
      ...(status ? { status } : {}),
    };
  } else if (status) {
    where.feeMonth = { deletedAt: null, status };
  }
  if (search?.trim()) {
    const q = search.trim();
    where.OR = [
      { receiptNumber: { contains: q, mode: 'insensitive' } },
      { transactionReference: { contains: q, mode: 'insensitive' } },
      {
        student: {
          OR: [
            { fullName: { contains: q, mode: 'insensitive' } },
            { registrationNumber: { contains: q, mode: 'insensitive' } },
          ],
        },
      },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.studentFeePayment.count({ where }),
    prisma.studentFeePayment.findMany({
      where,
      skip,
      take,
      orderBy: { paymentDate: 'desc' },
      include: {
        student: {
          select: { id: true, registrationNumber: true, fullName: true, photo: true },
        },
        feeMonth: true,
      },
    }),
  ]);

  return {
    total,
    page: Number(page) || 1,
    limit: take,
    rows: rows.map((r) =>
      serializeMoney({
        ...r,
        id: r.id,
        _id: r.id,
        monthLabel: r.feeMonth ? monthLabel(r.feeMonth.month, r.feeMonth.year) : '',
        student: r.student ? { ...r.student, _id: r.student.id } : null,
      })
    ),
  };
}

export async function getPaymentReceipt(paymentId) {
  const payment = await prisma.studentFeePayment.findFirst({
    where: { id: paymentId, deletedAt: null },
    include: {
      student: true,
      feeMonth: true,
    },
  });
  if (!payment) throw new ApiError(404, 'Receipt not found');
  return serializeMoney({
    ...payment,
    id: payment.id,
    _id: payment.id,
    monthLabel: monthLabel(payment.feeMonth.month, payment.feeMonth.year),
  });
}

export async function softDeletePayment(paymentId, userId) {
  const payment = await prisma.studentFeePayment.findFirst({
    where: { id: paymentId, deletedAt: null },
  });
  if (!payment) throw new ApiError(404, 'Payment not found');

  await prisma.$transaction(
    async (tx) => {
      await tx.studentFeePayment.update({
        where: { id: paymentId },
        data: { deletedAt: new Date(), deletedById: userId || null },
      });
      await recalcFeeMonth(tx, payment.feeMonthId);
      await syncStudentPaymentStatus(tx, payment.studentId);
    },
    { maxWait: 20000, timeout: 60000 }
  );
  return { success: true };
}

export async function updatePayment(paymentId, payload, userId) {
  const payment = await prisma.studentFeePayment.findFirst({
    where: { id: paymentId, deletedAt: null },
  });
  if (!payment) throw new ApiError(404, 'Payment not found');

  const amount = payload.amount != null ? money(payload.amount) : money(payment.amount);
  if (amount <= 0) throw new ApiError(400, 'Amount must be greater than zero');

  await prisma.$transaction(
    async (tx) => {
      await tx.studentFeePayment.update({
        where: { id: paymentId },
        data: {
          amount: dec(amount),
          paymentDate: payload.paymentDate ? new Date(payload.paymentDate) : payment.paymentDate,
          paymentMode: payload.paymentMode ? assertMode(payload.paymentMode) : payment.paymentMode,
          transactionReference:
            payload.transactionReference !== undefined
              ? payload.transactionReference?.trim() || null
              : payment.transactionReference,
          remarks: payload.remarks !== undefined ? payload.remarks?.trim() || null : payment.remarks,
          updatedById: userId || null,
        },
      });
      const fee = await recalcFeeMonth(tx, payment.feeMonthId);
      await tx.studentFeePayment.update({
        where: { id: paymentId },
        data: { remainingAfter: dec(fee.remainingDue) },
      });
      await syncStudentPaymentStatus(tx, payment.studentId);
    },
    { maxWait: 20000, timeout: 60000 }
  );

  return getPaymentReceipt(paymentId);
}

/* ─── Coach payments ─── */

export async function listCoachPayments({
  search,
  status,
  paymentMode,
  month,
  year,
  coachId,
  from,
  to,
  page = 1,
  limit = 20,
}) {
  const take = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (Math.max(1, Number(page) || 1) - 1) * take;
  const where = { deletedAt: null };
  if (status) where.status = status;
  if (paymentMode) where.paymentMode = paymentMode;
  if (month) where.month = Number(month);
  if (year) where.year = Number(year);
  if (coachId) where.coachId = coachId;
  if (from || to) {
    where.paymentDate = {};
    if (from) where.paymentDate.gte = new Date(from);
    if (to) where.paymentDate.lte = new Date(to);
  }
  if (search?.trim()) {
    const q = search.trim();
    where.OR = [
      { voucherNumber: { contains: q, mode: 'insensitive' } },
      {
        coach: {
          OR: [
            { fullName: { contains: q, mode: 'insensitive' } },
            { coachCode: { contains: q, mode: 'insensitive' } },
          ],
        },
      },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.coachPayment.count({ where }),
    prisma.coachPayment.findMany({
      where,
      skip,
      take,
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      include: {
        coach: {
          select: {
            id: true,
            coachCode: true,
            fullName: true,
            photo: true,
            salary: true,
            employeeRole: true,
            category: true,
            designation: true,
          },
        },
      },
    }),
  ]);

  return {
    total,
    page: Number(page) || 1,
    limit: take,
    rows: rows.map((r) =>
      serializeMoney({
        ...r,
        id: r.id,
        _id: r.id,
        monthLabel: monthLabel(r.month, r.year),
        coach: r.coach ? { ...r.coach, _id: r.coach.id } : null,
      })
    ),
  };
}

export async function makeCoachPayment(payload, userId) {
  const coachId = payload.coachId;
  const { month, year } = parseMonthYear(payload.month, payload.year);
  const paymentMode = assertMode(payload.paymentMode);
  const coach = await prisma.coach.findUnique({ where: { id: coachId } });
  if (!coach) throw new ApiError(404, 'Coach not found');

  const baseSalary = money(payload.baseSalary != null ? payload.baseSalary : coach.salary || 0);
  const bonus = money(payload.bonus ?? 0);
  const deduction = money(payload.deduction ?? 0);
  if (baseSalary < 0 || bonus < 0 || deduction < 0) {
    throw new ApiError(400, 'Salary, bonus and deduction cannot be negative');
  }
  const netPayable = clampNonNegative(addMoney(baseSalary, bonus) - deduction);
  let paidAmount = money(payload.paidAmount);
  if (paidAmount < 0) throw new ApiError(400, 'Paid amount cannot be negative');
  if (paidAmount > netPayable) paidAmount = netPayable;

  const { status, remainingAmount } = coachStatusFromAmounts({ netPayable, paidAmount });
  const paymentDate = payload.paymentDate ? new Date(payload.paymentDate) : new Date();

  const existing = await prisma.coachPayment.findFirst({
    where: { coachId, month, year, deletedAt: null },
  });

  if (existing) {
    // Additional payment toward same month
    const newPaid = addMoney(existing.paidAmount, paidAmount);
    const capped = Math.min(newPaid, money(existing.netPayable));
    const st = coachStatusFromAmounts({ netPayable: existing.netPayable, paidAmount: capped });
    const updated = await prisma.coachPayment.update({
      where: { id: existing.id },
      data: {
        paidAmount: dec(capped),
        remainingAmount: dec(st.remainingAmount),
        status: st.status,
        paymentDate,
        paymentMode,
        transactionReference: payload.transactionReference?.trim() || existing.transactionReference,
        remarks: payload.remarks?.trim() || existing.remarks,
        updatedById: userId || null,
      },
      include: { coach: { select: { id: true, coachCode: true, fullName: true, photo: true } } },
    });
    return serializeMoney({ ...updated, id: updated.id, _id: updated.id, monthLabel: monthLabel(month, year) });
  }

    const voucherNumber = await prisma.$transaction(async (tx) =>
      nextFinanceNumber(tx, 'coach_voucher', 'CPV')
    );

  const created = await prisma.coachPayment.create({
    data: {
      coachId,
      month,
      year,
      baseSalary: dec(baseSalary),
      bonus: dec(bonus),
      deduction: dec(deduction),
      netPayable: dec(netPayable),
      paidAmount: dec(paidAmount),
      remainingAmount: dec(remainingAmount),
      paymentDate,
      paymentMode,
      transactionReference: payload.transactionReference?.trim() || null,
      voucherNumber,
      status,
      remarks: payload.remarks?.trim() || null,
      createdById: userId || null,
      updatedById: userId || null,
    },
    include: { coach: { select: { id: true, coachCode: true, fullName: true, photo: true } } },
  });

  return serializeMoney({ ...created, id: created.id, _id: created.id, monthLabel: monthLabel(month, year) });
}

export async function softDeleteCoachPayment(id, userId) {
  const row = await prisma.coachPayment.findFirst({ where: { id, deletedAt: null } });
  if (!row) throw new ApiError(404, 'Coach payment not found');
  await prisma.coachPayment.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: userId || null },
  });
  return { success: true };
}

export async function updateCoachPayment(id, payload, userId) {
  const row = await prisma.coachPayment.findFirst({ where: { id, deletedAt: null } });
  if (!row) throw new ApiError(404, 'Coach payment not found');

  const baseSalary = money(payload.baseSalary ?? row.baseSalary);
  const bonus = money(payload.bonus ?? row.bonus);
  const deduction = money(payload.deduction ?? row.deduction);
  const netPayable = clampNonNegative(addMoney(baseSalary, bonus) - deduction);
  let paidAmount = money(payload.paidAmount ?? row.paidAmount);
  if (paidAmount > netPayable) paidAmount = netPayable;
  const st = coachStatusFromAmounts({ netPayable, paidAmount });

  const updated = await prisma.coachPayment.update({
    where: { id },
    data: {
      baseSalary: dec(baseSalary),
      bonus: dec(bonus),
      deduction: dec(deduction),
      netPayable: dec(netPayable),
      paidAmount: dec(paidAmount),
      remainingAmount: dec(st.remainingAmount),
      status: st.status,
      paymentDate: payload.paymentDate ? new Date(payload.paymentDate) : row.paymentDate,
      paymentMode: payload.paymentMode ? assertMode(payload.paymentMode) : row.paymentMode,
      transactionReference:
        payload.transactionReference !== undefined
          ? payload.transactionReference?.trim() || null
          : row.transactionReference,
      remarks: payload.remarks !== undefined ? payload.remarks?.trim() || null : row.remarks,
      updatedById: userId || null,
    },
    include: { coach: { select: { id: true, coachCode: true, fullName: true, photo: true } } },
  });
  return serializeMoney({ ...updated, id: updated.id, _id: updated.id });
}

export async function getFinanceDashboard() {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const [
    todayAgg,
    monthAgg,
    pendingFees,
    studentsWithDue,
    studentsPaidThisMonth,
    coachMonthAgg,
    coachPending,
    coachesPaid,
    coachesPending,
    modeGroups,
    monthlyStudent,
    monthlyCoach,
  ] = await Promise.all([
    prisma.studentFeePayment.aggregate({
      where: { deletedAt: null, paymentDate: { gte: startToday } },
      _sum: { amount: true },
    }),
    prisma.studentFeePayment.aggregate({
      where: { deletedAt: null, paymentDate: { gte: startMonth } },
      _sum: { amount: true },
    }),
    prisma.studentFeeMonth.aggregate({
      where: { deletedAt: null, status: { in: ['Due', 'Partial', 'Overdue'] } },
      _sum: { remainingDue: true },
    }),
    prisma.studentFeeMonth.groupBy({
      by: ['studentId'],
      where: { deletedAt: null, status: { in: ['Due', 'Partial', 'Overdue'] }, remainingDue: { gt: 0 } },
    }),
    prisma.studentFeeMonth.count({
      where: { deletedAt: null, month, year, status: 'Paid' },
    }),
    prisma.coachPayment.aggregate({
      where: { deletedAt: null, month, year },
      _sum: { paidAmount: true },
    }),
    prisma.coachPayment.aggregate({
      where: { deletedAt: null, status: { in: ['Pending', 'Partial'] } },
      _sum: { remainingAmount: true },
    }),
    prisma.coachPayment.count({ where: { deletedAt: null, month, year, status: 'Paid' } }),
    prisma.coachPayment.count({
      where: { deletedAt: null, month, year, status: { in: ['Pending', 'Partial'] } },
    }),
    prisma.studentFeePayment.groupBy({
      by: ['paymentMode'],
      where: { deletedAt: null, paymentDate: { gte: startMonth } },
      _sum: { amount: true },
    }),
    prisma.$queryRaw`
      SELECT EXTRACT(MONTH FROM payment_date)::int AS month,
             EXTRACT(YEAR FROM payment_date)::int AS year,
             COALESCE(SUM(amount), 0)::float AS total
      FROM student_fee_payments
      WHERE deleted_at IS NULL
        AND payment_date >= NOW() - INTERVAL '12 months'
      GROUP BY 1, 2
      ORDER BY year, month
    `,
    prisma.$queryRaw`
      SELECT month, year, COALESCE(SUM(paid_amount), 0)::float AS total
      FROM coach_payments
      WHERE deleted_at IS NULL
        AND (year > EXTRACT(YEAR FROM NOW())::int - 1
             OR (year = EXTRACT(YEAR FROM NOW())::int AND month >= EXTRACT(MONTH FROM NOW())::int - 11))
      GROUP BY month, year
      ORDER BY year, month
    `,
  ]);

  const modeMap = { Cash: 0, UPI: 0, BankTransfer: 0, Other: 0 };
  for (const g of modeGroups) {
    modeMap[g.paymentMode] = money(g._sum.amount);
  }

  const studentCollectionMonth = money(monthAgg._sum.amount);
  const coachPaidMonth = money(coachMonthAgg._sum.paidAmount);
  const netBalance = subMoney(studentCollectionMonth, coachPaidMonth);

  return {
    studentFees: {
      todayCollection: money(todayAgg._sum.amount),
      monthCollection: studentCollectionMonth,
      totalPending: money(pendingFees._sum.remainingDue),
      studentsWithDue: studentsWithDue.length,
      studentsPaid: studentsPaidThisMonth,
    },
    coachPayments: {
      monthPayments: coachPaidMonth,
      totalPending: money(coachPending._sum.remainingAmount),
      coachesPaid,
      coachesPending,
    },
    summary: {
      studentCollection: studentCollectionMonth,
      coachPayments: coachPaidMonth,
      netBalance,
      byMode: modeMap,
    },
    charts: {
      monthlyStudentCollection: (monthlyStudent || []).map((r) => ({
        month: Number(r.month),
        year: Number(r.year),
        total: money(r.total),
        label: monthLabel(Number(r.month), Number(r.year)),
      })),
      monthlyCoachPayments: (monthlyCoach || []).map((r) => ({
        month: Number(r.month),
        year: Number(r.year),
        total: money(r.total),
        label: monthLabel(Number(r.month), Number(r.year)),
      })),
      paymentModeBreakdown: Object.entries(modeMap).map(([mode, total]) => ({ mode, total })),
    },
  };
}

export async function getFinanceReport(filters = {}) {
  const payWhere = { deletedAt: null };
  const coachWhere = { deletedAt: null };
  if (filters.from || filters.to) {
    payWhere.paymentDate = {};
    coachWhere.paymentDate = {};
    if (filters.from) {
      payWhere.paymentDate.gte = new Date(filters.from);
      coachWhere.paymentDate.gte = new Date(filters.from);
    }
    if (filters.to) {
      payWhere.paymentDate.lte = new Date(filters.to);
      coachWhere.paymentDate.lte = new Date(filters.to);
    }
  }
  if (filters.paymentMode) {
    payWhere.paymentMode = filters.paymentMode;
    coachWhere.paymentMode = filters.paymentMode;
  }
  if (filters.month) {
    payWhere.feeMonth = { ...(payWhere.feeMonth || {}), month: Number(filters.month) };
    coachWhere.month = Number(filters.month);
  }
  if (filters.year) {
    payWhere.feeMonth = { ...(payWhere.feeMonth || {}), year: Number(filters.year) };
    coachWhere.year = Number(filters.year);
  }
  if (filters.studentId) payWhere.studentId = filters.studentId;
  if (filters.coachId) coachWhere.coachId = filters.coachId;

  const [studentAgg, discountAgg, coachAgg, pendingFees] = await Promise.all([
    prisma.studentFeePayment.aggregate({ where: payWhere, _sum: { amount: true } }),
    prisma.studentFeeMonth.aggregate({
      where: { deletedAt: null, ...(filters.year ? { year: Number(filters.year) } : {}), ...(filters.month ? { month: Number(filters.month) } : {}) },
      _sum: { discount: true },
    }),
    prisma.coachPayment.aggregate({ where: coachWhere, _sum: { paidAmount: true } }),
    prisma.studentFeeMonth.aggregate({
      where: { deletedAt: null, status: { in: ['Due', 'Partial', 'Overdue'] } },
      _sum: { remainingDue: true },
    }),
  ]);

  const totalStudent = money(studentAgg._sum.amount);
  const totalCoach = money(coachAgg._sum.paidAmount);
  return {
    totalStudentFeesCollected: totalStudent,
    totalCoachPayments: totalCoach,
    totalDiscounts: money(discountAgg._sum.discount),
    totalPendingFees: money(pendingFees._sum.remainingDue),
    netBalance: subMoney(totalStudent, totalCoach),
  };
}
