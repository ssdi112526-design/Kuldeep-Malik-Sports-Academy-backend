import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import prisma from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { withId, withIds } from '../utils/serialize.js';
import { deleteUploadedFile, toPublicPath, ENTRY_PHOTOS_DIR, ENTRY_DOCS_DIR, COACH_CERTS_DIR, ENTRY_EQUIPMENT_DIR, VIDEOS_DIR, QR_DIR } from '../middleware/upload.js';
import ExcelJS from 'exceljs';
import { centerCropSquareToJpg } from '../services/imageCropService.js';
import { cell0 } from '../utils/zeroEmpty.js';

const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
const MAX_PURCHASE_COST = new Prisma.Decimal('999999999999.99');
const INT4_MAX = 2147483647;

/** Money field — Prisma Decimal(14,2), never JS float. Returns string for safe PG binding. */
function parsePurchaseCost(value) {
  if (value === undefined || value === null || value === '') {
    return '0.00';
  }
  const raw = String(value).trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    throw new ApiError(400, 'Purchase cost must be a valid number with up to 2 decimal places');
  }
  let amount;
  try {
    amount = new Prisma.Decimal(raw);
  } catch {
    throw new ApiError(400, 'Purchase cost must be a valid number');
  }
  if (amount.isNeg()) throw new ApiError(400, 'Purchase cost cannot be negative');
  if (amount.gt(MAX_PURCHASE_COST)) {
    throw new ApiError(400, 'Purchase cost is too large (maximum 999,999,999,999.99)');
  }
  return amount.toFixed(2);
}

function parseInt4Field(value, label, { defaultValue = 0 } = {}) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > INT4_MAX) {
    throw new ApiError(400, `${label} must be a whole number between 0 and ${INT4_MAX}`);
  }
  return n;
}

async function ensureStudentRole() {
  let role = await prisma.role.findUnique({ where: { slug: 'student' } });
  if (!role) {
    role = await prisma.role.create({
      data: {
        name: 'Student',
        slug: 'student',
        description: 'Student portal only — profile, QR scan and own attendance.',
        isSystem: true,
      },
    });
  }
  return role;
}

async function ensureCoachPortalRole() {
  let role = await prisma.role.findUnique({ where: { slug: 'coach_portal' } });
  if (!role) {
    role = await prisma.role.create({
      data: {
        name: 'Coach Portal',
        slug: 'coach_portal',
        description: 'Coach user panel only — profile, own attendance and account.',
        isSystem: true,
      },
    });
  }
  return role;
}

function studentLoginEmail(registrationNumber, email) {
  if (email && String(email).trim()) return String(email).trim().toLowerCase();
  return `${String(registrationNumber).toLowerCase()}@student.akhada.local`;
}

function coachLoginEmail(coachCode, email) {
  if (email && String(email).trim()) return String(email).trim().toLowerCase();
  return `${String(coachCode).toLowerCase()}@coach.akhada.local`;
}

const USERNAME_TAKEN = 'This username is already in use. Please choose another username.';
const INACTIVE_ACCOUNT = 'Your account is currently inactive. Please contact the administrator.';
const getClientBaseUrl = () => {
  const raw = process.env.CLIENT_URL || 'http://localhost:5173';
  // allowedOrigins can be comma-separated
  return String(raw).split(',')[0].trim() || 'http://localhost:5173';
};

function parsePage(value, fallback = 1) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

function parseLimit(value, fallback = 12) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 100);
}

function parseBool(value, fallback = undefined) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return value === 'true' || value === '1';
}

function parseOrder(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function parseDateOnly(value) {
  // Accept YYYY-MM-DD
  const s = String(value || '').trim();
  if (!s) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function formatDateRangeWhere({ from, to }) {
  if (!from && !to) return undefined;
  const gte = from || undefined;
  const lte = to ? new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1) : undefined;
  return { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
}

async function generateStudentRegNo() {
  const year = new Date().getFullYear();
  const prefix = `AKH-${year}-`;
  const last = await prisma.student.findFirst({
    where: { registrationNumber: { startsWith: prefix } },
    orderBy: { registrationNumber: 'desc' },
  });
  const lastNum = last ? Number(last.registrationNumber.replace(prefix, '')) : 0;
  const next = Number.isFinite(lastNum) ? lastNum + 1 : 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

async function generateCoachCode() {
  const year = new Date().getFullYear();
  const prefix = `AKH-COACH-${year}-`;
  const last = await prisma.coach.findFirst({
    where: { coachCode: { startsWith: prefix } },
    orderBy: { coachCode: 'desc' },
  });
  const lastNum = last ? Number(last.coachCode.replace(prefix, '')) : 0;
  const next = Number.isFinite(lastNum) ? lastNum + 1 : 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

async function generateEquipmentCode() {
  const year = new Date().getFullYear();
  const prefix = `AKH-EQUIP-${year}-`;
  const last = await prisma.equipment.findFirst({
    where: { equipmentCode: { startsWith: prefix } },
    orderBy: { equipmentCode: 'desc' },
  });
  const lastNum = last ? Number(last.equipmentCode.replace(prefix, '')) : 0;
  const next = Number.isFinite(lastNum) ? lastNum + 1 : 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

function assertUniqueAcrossTables({ aadhaarNumber, panNumber, mode }) {
  // mode: 'student' | 'coach'
  return Promise.all([
    aadhaarNumber ? prisma.student.findUnique({ where: { aadhaarNumber } }).catch(() => null) : Promise.resolve(null),
    aadhaarNumber ? prisma.coach.findUnique({ where: { aadhaarNumber } }).catch(() => null) : Promise.resolve(null),
    panNumber ? prisma.student.findUnique({ where: { panNumber } }).catch(() => null) : Promise.resolve(null),
    panNumber ? prisma.coach.findUnique({ where: { panNumber } }).catch(() => null) : Promise.resolve(null),
  ]).then(([sA, cA, sP, cP]) => {
    if (mode === 'student') {
      if (sA) throw new ApiError(400, 'Aadhaar number already exists for another student');
      if (cA) throw new ApiError(400, 'Aadhaar number already exists for another coach');
      if (sP) throw new ApiError(400, 'PAN number already exists for another student');
      if (cP) throw new ApiError(400, 'PAN number already exists for another coach');
    } else {
      if (cA) throw new ApiError(400, 'Aadhaar number already exists for another coach');
      if (sA) throw new ApiError(400, 'Aadhaar number already exists for another student');
      if (cP) throw new ApiError(400, 'PAN number already exists for another coach');
      if (sP) throw new ApiError(400, 'PAN number already exists for another student');
    }
  });
}

function buildExcelBuffer(rows, columns, sheetName = 'Export') {
  return (async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName);
    sheet.columns = columns.map((c) => ({ header: c.label, key: c.key, width: c.width || 22 }));
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).alignment = { vertical: 'middle' };
    rows.forEach((r) => {
      const safe = {};
      for (const c of columns) safe[c.key] = cell0(r?.[c.key]);
      sheet.addRow(safe);
    });
    for (let r = 2; r <= sheet.rowCount; r += 1) {
      for (let c = 1; c <= columns.length; c += 1) {
        const cell = sheet.getRow(r).getCell(c);
        if (cell.value === null || cell.value === undefined || cell.value === '' || cell.value === '—') {
          cell.value = 0;
        }
      }
    }
    return workbook.xlsx.writeBuffer();
  })();
}

/**
 * Save/crop a profile photo safely.
 * Always uses a unique cropped filename so update never deletes the file it just wrote.
 */
async function processEntryPhoto(photoUpload, { prefix, oldPhotoPath = null } = {}) {
  if (!photoUpload) return oldPhotoPath || null;

  const originalPublic = toPublicPath(photoUpload.filename, 'entry/photos');
  const croppedFilename = `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e9)}.jpg`;
  const absCroppedPath = path.join(path.dirname(photoUpload.path), croppedFilename);

  let nextPhoto = originalPublic;
  try {
    const croppedResult = await centerCropSquareToJpg(photoUpload.path, absCroppedPath, 512);
    if (croppedResult && fs.existsSync(absCroppedPath)) {
      nextPhoto = toPublicPath(croppedFilename, 'entry/photos');
      // remove the raw multer upload once crop succeeded
      if (originalPublic !== nextPhoto) deleteUploadedFile(originalPublic);
    }
  } catch {
    // keep original upload if crop fails
    nextPhoto = originalPublic;
  }

  // only delete previous photo when it is a different path
  if (oldPhotoPath && oldPhotoPath !== nextPhoto) {
    deleteUploadedFile(oldPhotoPath);
  }

  return nextPhoto;
}

// ---------------------------
// STUDENTS
// ---------------------------

export const listStudentsAdmin = asyncHandler(async (req, res) => {
  const page = parsePage(req.query.page, 1);
  const limit = parseLimit(req.query.limit, 12);
  const search = String(req.query.search || '').trim();

  const coachId = req.query.coachId ? String(req.query.coachId) : undefined;
  const batch = req.query.batch ? String(req.query.batch) : undefined;
  const membershipType = req.query.membershipType ? String(req.query.membershipType) : undefined;
  const status = req.query.status ? String(req.query.status) : undefined;

  const joiningFrom = parseDateOnly(req.query.joiningFrom);
  const joiningTo = parseDateOnly(req.query.joiningTo);
  const joiningRange = formatDateRangeWhere({ from: joiningFrom, to: joiningTo });

  const where = {
    ...(coachId ? { coachId } : {}),
    ...(batch ? { batch } : {}),
    ...(membershipType ? { membershipType } : {}),
    ...(status ? { status } : {}),
    ...(joiningRange ? { joiningDate: joiningRange } : {}),
    ...(search
      ? {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { registrationNumber: { contains: search, mode: 'insensitive' } },
            { aadhaarNumber: { contains: search } },
            { panNumber: { contains: search } },
            { mobileNumber: { contains: search } },
          ],
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.student.count({ where }),
    prisma.student.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { coach: true },
    }),
  ]);

  res.json({
    success: true,
    data: {
      students: withIds(items),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    },
  });
});

export const getStudentById = asyncHandler(async (req, res) => {
  const student = await prisma.student.findUnique({
    where: { id: req.params.id },
    include: { coach: true, studentDocuments: true },
  });
  if (!student) throw new ApiError(404, 'Student not found');

  res.json({ success: true, data: { student: withId(student) } });
});

export const createStudent = asyncHandler(async (req, res) => {
  const files = req.files || {};
  const photoUpload = files.photo?.[0];
  const parentPhotoUpload = files.parentPhoto?.[0];
  const aadhaarFrontUpload = files.aadhaarFront?.[0];
  const aadhaarBackUpload = files.aadhaarBack?.[0];
  const panCardUpload = files.panCard?.[0];

  if (!photoUpload) throw new ApiError(400, 'Student photo is required');

  const {
    admissionNumber,
    fullName,
    fatherName,
    motherName,
    gender,
    dateOfBirth,
    bloodGroup,
    mobileNumber,
    alternateMobile,
    email,
    address,
    village,
    city,
    district,
    state,
    pincode,
    aadhaarNumber,
    panNumber,
    joiningDate,
    membershipType,
    batch,
    coachId,
    trainingLevel,
    heightCm,
    weightKg,
    chest,
    age,
    category,
    ageCategory,
    weightCategory,
    guardianName,
    guardianRelation,
    guardianMobile,
    allergies,
    medicalNotes,
    adminNotes,
    status,
    achievements,
    paymentStatus,
    attendanceTotal,
    attendancePresent,
    attendanceAbsent,
    password,
    confirmPassword,
    loginUsername,
  } = req.body;

  if (!fullName || !fatherName || !motherName) throw new ApiError(400, 'Missing student personal fields');
  if (!mobileNumber) throw new ApiError(400, 'Mobile number is required');
  if (!aadhaarNumber || !panNumber) throw new ApiError(400, 'Aadhaar number and PAN number are required');
  if (!password || !confirmPassword) throw new ApiError(400, 'Login password and confirm password are required');
  if (password !== confirmPassword) throw new ApiError(400, 'Passwords do not match');
  if (!STRONG_PASSWORD.test(password)) {
    throw new ApiError(400, 'Password must be 8+ characters with upper, lower and a number');
  }

  await assertUniqueAcrossTables({ aadhaarNumber, panNumber, mode: 'student' });

  const registrationNumber = await generateStudentRegNo();
  const username = String(loginUsername || registrationNumber).trim().toLowerCase();
  const userEmail = studentLoginEmail(registrationNumber, email);

  if (await prisma.user.findUnique({ where: { username } })) {
    throw new ApiError(400, USERNAME_TAKEN);
  }
  if (await prisma.user.findUnique({ where: { email: userEmail } })) {
    throw new ApiError(400, 'Email is already registered as a login account');
  }

  const photo = await processEntryPhoto(photoUpload, {
    prefix: `student-${registrationNumber}`,
  });
  const parentPhoto = parentPhotoUpload
    ? await processEntryPhoto(parentPhotoUpload, {
        prefix: `parent-${registrationNumber}`,
      })
    : null;

  const aadhaarFrontImage = aadhaarFrontUpload ? toPublicPath(aadhaarFrontUpload.filename, 'entry/documents') : null;
  const aadhaarBackImage = aadhaarBackUpload ? toPublicPath(aadhaarBackUpload.filename, 'entry/documents') : null;
  const panCardImage = panCardUpload ? toPublicPath(panCardUpload.filename, 'entry/documents') : null;

  const qrCodePath = null;
  const studentRole = await ensureStudentRole();
  const passwordHash = await bcrypt.hash(password, 12);
  const accountActive = (status || 'Active') === 'Active';

  const created = await prisma.$transaction(async (tx) => {
    const student = await tx.student.create({
      data: {
        registrationNumber,
        admissionNumber: admissionNumber || null,
        fullName: String(fullName).trim(),
        fatherName: String(fatherName).trim(),
        motherName: String(motherName).trim(),
        gender: gender || 'Other',
        dateOfBirth: new Date(dateOfBirth),
        bloodGroup: bloodGroup || null,
        mobileNumber: String(mobileNumber).trim(),
        alternateMobile: alternateMobile || null,
        email: email || null,

        address: address || null,
        village: village || null,
        city: city || null,
        district: district || null,
        state: state || null,
        pincode: pincode || null,

        aadhaarNumber: String(aadhaarNumber).trim(),
        panNumber: String(panNumber).trim(),

        photo,
        parentPhoto,
        joiningDate: new Date(joiningDate),
        membershipType: membershipType || 'General',
        batch: batch || 'General',
        coachId: coachId || null,
        trainingLevel: trainingLevel || 'Beginner',

        heightCm: heightCm ? Number(heightCm) : 0,
        weightKg: weightKg ? Number(weightKg) : 0,
        chest: chest ? Number(chest) : 0,
        age: age ? Number(age) : 0,
        category: category || null,
        ageCategory: ageCategory ? String(ageCategory).trim() || null : null,
        weightCategory: weightCategory ? String(weightCategory).trim() || null : null,

        guardianName: guardianName || null,
        guardianRelation: guardianRelation || null,
        guardianMobile: guardianMobile || null,

        allergies: allergies || null,
        medicalNotes: medicalNotes || null,

        adminNotes: adminNotes || null,
        status: status || 'Active',
        achievements: achievements || null,
        paymentStatus: paymentStatus || 'Pending',
        attendanceTotal: attendanceTotal ? Number(attendanceTotal) : 0,
        attendancePresent: attendancePresent ? Number(attendancePresent) : 0,
        attendanceAbsent: attendanceAbsent ? Number(attendanceAbsent) : 0,
        qrCodePath,
      },
    });

    await tx.studentDocument.create({
      data: {
        studentId: student.id,
        aadhaarFrontImage,
        aadhaarBackImage,
        panCardImage,
      },
    });

    await tx.user.create({
      data: {
        name: String(fullName).trim(),
        username,
        email: userEmail,
        mobile: String(mobileNumber).replace(/\D/g, '').slice(-10),
        password: passwordHash,
        role: 'student',
        roleId: studentRole.id,
        studentId: student.id,
        isActive: accountActive,
        profileImage: photo,
      },
    });

    return student;
  });

  res.status(201).json({
    success: true,
    data: {
      student: withId(created),
      login: { username, email: userEmail },
    },
    message: 'Student created with login credentials',
  });
});

// NOTE: For Phase-1 we implement update/delete/get for students with minimal file replacement handling.
// Coaches/Equipment follow the same approach.

export const updateStudent = asyncHandler(async (req, res) => {
  const student = await prisma.student.findUnique({ where: { id: req.params.id } });
  if (!student) throw new ApiError(404, 'Student not found');

  const files = req.files || {};
  const photoUpload = files.photo?.[0];
  const parentPhotoUpload = files.parentPhoto?.[0];
  const aadhaarFrontUpload = files.aadhaarFront?.[0];
  const aadhaarBackUpload = files.aadhaarBack?.[0];
  const panCardUpload = files.panCard?.[0];

  const nextAadhaarNumber = req.body.aadhaarNumber ? String(req.body.aadhaarNumber).trim() : student.aadhaarNumber;
  const nextPanNumber = req.body.panNumber ? String(req.body.panNumber).trim() : student.panNumber;
  if (nextAadhaarNumber !== student.aadhaarNumber || nextPanNumber !== student.panNumber) {
    await assertUniqueAcrossTables({ aadhaarNumber: nextAadhaarNumber, panNumber: nextPanNumber, mode: 'student' });
  }

  let nextPhoto = student.photo;
  if (photoUpload) {
    nextPhoto = await processEntryPhoto(photoUpload, {
      prefix: `student-${student.registrationNumber}`,
      oldPhotoPath: student.photo,
    });
  }

  let nextParentPhoto = student.parentPhoto;
  if (parentPhotoUpload) {
    nextParentPhoto = await processEntryPhoto(parentPhotoUpload, {
      prefix: `parent-${student.registrationNumber}`,
      oldPhotoPath: student.parentPhoto,
    });
  }

  // QR Code removed (no file generation)
  if (student.qrCodePath) deleteUploadedFile(student.qrCodePath);
  const qrCodePath = null;

  const updated = await prisma.$transaction(async (tx) => {
    const doc = await tx.studentDocument.findUnique({ where: { studentId: student.id } });
    if (!doc) throw new ApiError(400, 'Student document record missing');

    if (aadhaarFrontUpload) {
      deleteUploadedFile(toPublicPath(doc.aadhaarFrontImage, 'entry/documents'));
    }
    if (aadhaarBackUpload) {
      deleteUploadedFile(toPublicPath(doc.aadhaarBackImage, 'entry/documents'));
    }
    if (panCardUpload) {
      deleteUploadedFile(toPublicPath(doc.panCardImage, 'entry/documents'));
    }

    if (aadhaarFrontUpload)
      doc.aadhaarFrontImage = toPublicPath(aadhaarFrontUpload.filename, 'entry/documents');
    if (aadhaarBackUpload) doc.aadhaarBackImage = toPublicPath(aadhaarBackUpload.filename, 'entry/documents');
    if (panCardUpload) doc.panCardImage = toPublicPath(panCardUpload.filename, 'entry/documents');

    await tx.studentDocument.update({
      where: { studentId: student.id },
      data: {
        aadhaarFrontImage: doc.aadhaarFrontImage,
        aadhaarBackImage: doc.aadhaarBackImage,
        panCardImage: doc.panCardImage,
      },
    });

    const next = await tx.student.update({
      where: { id: student.id },
      data: {
        admissionNumber: req.body.admissionNumber !== undefined ? req.body.admissionNumber || null : student.admissionNumber,
        fullName: req.body.fullName !== undefined ? String(req.body.fullName).trim() : student.fullName,
        fatherName: req.body.fatherName !== undefined ? String(req.body.fatherName).trim() : student.fatherName,
        motherName: req.body.motherName !== undefined ? String(req.body.motherName).trim() : student.motherName,
        gender: req.body.gender !== undefined ? req.body.gender : student.gender,
        dateOfBirth: req.body.dateOfBirth ? new Date(req.body.dateOfBirth) : student.dateOfBirth,
        bloodGroup: req.body.bloodGroup !== undefined ? req.body.bloodGroup || null : student.bloodGroup,
        mobileNumber: req.body.mobileNumber !== undefined ? String(req.body.mobileNumber).trim() : student.mobileNumber,
        alternateMobile: req.body.alternateMobile !== undefined ? req.body.alternateMobile || null : student.alternateMobile,
        email: req.body.email !== undefined ? req.body.email || null : student.email,
        address: req.body.address !== undefined ? req.body.address || null : student.address,
        village: req.body.village !== undefined ? req.body.village || null : student.village,
        city: req.body.city !== undefined ? req.body.city || null : student.city,
        district: req.body.district !== undefined ? req.body.district || null : student.district,
        state: req.body.state !== undefined ? req.body.state || null : student.state,
        pincode: req.body.pincode !== undefined ? req.body.pincode || null : student.pincode,

        aadhaarNumber: nextAadhaarNumber,
        panNumber: nextPanNumber,
        photo: nextPhoto,
        parentPhoto: nextParentPhoto,

        joiningDate: req.body.joiningDate ? new Date(req.body.joiningDate) : student.joiningDate,
        membershipType: req.body.membershipType !== undefined ? req.body.membershipType || 'General' : student.membershipType,
        batch: req.body.batch !== undefined ? req.body.batch || 'General' : student.batch,
        coachId: req.body.coachId !== undefined ? req.body.coachId || null : student.coachId,
        trainingLevel: req.body.trainingLevel !== undefined ? req.body.trainingLevel : student.trainingLevel,

        heightCm: req.body.heightCm !== undefined ? Number(req.body.heightCm) || 0 : student.heightCm,
        weightKg: req.body.weightKg !== undefined ? Number(req.body.weightKg) || 0 : student.weightKg,
        chest: req.body.chest !== undefined ? Number(req.body.chest) || 0 : student.chest,
        age: req.body.age !== undefined ? Number(req.body.age) || 0 : student.age,
        category: req.body.category !== undefined ? req.body.category || null : student.category,
        ageCategory:
          req.body.ageCategory !== undefined
            ? String(req.body.ageCategory || '').trim() || null
            : student.ageCategory,
        weightCategory:
          req.body.weightCategory !== undefined
            ? String(req.body.weightCategory || '').trim() || null
            : student.weightCategory,

        guardianName: req.body.guardianName !== undefined ? req.body.guardianName || null : student.guardianName,
        guardianRelation:
          req.body.guardianRelation !== undefined ? req.body.guardianRelation || null : student.guardianRelation,
        guardianMobile:
          req.body.guardianMobile !== undefined ? req.body.guardianMobile || null : student.guardianMobile,

        allergies: req.body.allergies !== undefined ? req.body.allergies || null : student.allergies,
        medicalNotes: req.body.medicalNotes !== undefined ? req.body.medicalNotes || null : student.medicalNotes,
        adminNotes: req.body.adminNotes !== undefined ? req.body.adminNotes || null : student.adminNotes,

        status: req.body.status !== undefined ? req.body.status : student.status,
        achievements: req.body.achievements !== undefined ? req.body.achievements || null : student.achievements,
        paymentStatus:
          req.body.paymentStatus !== undefined ? req.body.paymentStatus || 'Pending' : student.paymentStatus,

        attendanceTotal:
          req.body.attendanceTotal !== undefined ? Number(req.body.attendanceTotal) || 0 : student.attendanceTotal,
        attendancePresent:
          req.body.attendancePresent !== undefined ? Number(req.body.attendancePresent) || 0 : student.attendancePresent,
        attendanceAbsent:
          req.body.attendanceAbsent !== undefined ? Number(req.body.attendanceAbsent) || 0 : student.attendanceAbsent,
        qrCodePath,
      },
    });

    return next;
  });

  // Sync linked student login account
  const loginUser = await prisma.user.findUnique({ where: { studentId: updated.id } });
  if (loginUser) {
    const userData = {
      name: updated.fullName,
      mobile: String(updated.mobileNumber || '').replace(/\D/g, '').slice(-10) || null,
      profileImage: updated.photo,
      isActive: updated.status === 'Active',
    };
    if (req.body.password) {
      if (req.body.password !== req.body.confirmPassword) {
        throw new ApiError(400, 'Passwords do not match');
      }
      if (!STRONG_PASSWORD.test(req.body.password)) {
        throw new ApiError(400, 'Password must be 8+ characters with upper, lower and a number');
      }
      userData.password = await bcrypt.hash(req.body.password, 12);
    }
    await prisma.user.update({ where: { id: loginUser.id }, data: userData });
  } else if (req.body.password) {
    // Create login for older students without account
    if (req.body.password !== req.body.confirmPassword) {
      throw new ApiError(400, 'Passwords do not match');
    }
    if (!STRONG_PASSWORD.test(req.body.password)) {
      throw new ApiError(400, 'Password must be 8+ characters with upper, lower and a number');
    }
    const studentRole = await ensureStudentRole();
    const username = updated.registrationNumber.toLowerCase();
    const userEmail = studentLoginEmail(updated.registrationNumber, updated.email);
    if (await prisma.user.findUnique({ where: { username } })) {
      throw new ApiError(400, USERNAME_TAKEN);
    }
    if (await prisma.user.findUnique({ where: { email: userEmail } })) {
      throw new ApiError(400, 'Email is already registered as a login account');
    }
    await prisma.user.create({
      data: {
        name: updated.fullName,
        username,
        email: userEmail,
        mobile: String(updated.mobileNumber || '').replace(/\D/g, '').slice(-10) || null,
        password: await bcrypt.hash(req.body.password, 12),
        role: 'student',
        roleId: studentRole.id,
        studentId: updated.id,
        isActive: updated.status === 'Active',
        profileImage: updated.photo,
      },
    });
  }

  res.json({ success: true, data: { student: withId(updated) }, message: 'Student updated' });
});

export const deleteStudent = asyncHandler(async (req, res) => {
  const student = await prisma.student.findUnique({ where: { id: req.params.id } });
  if (!student) throw new ApiError(404, 'Student not found');

  // Attendance rows historically used ON DELETE RESTRICT — remove them first so delete succeeds.
  await prisma.$transaction(async (tx) => {
    await tx.attendance.deleteMany({ where: { studentId: student.id } });
    await tx.student.delete({ where: { id: student.id } });
  });

  if (student.photo) deleteUploadedFile(student.photo);
  if (student.parentPhoto) deleteUploadedFile(student.parentPhoto);
  if (student.qrCodePath) deleteUploadedFile(student.qrCodePath);

  res.json({ success: true, message: 'Student deleted' });
});

export const getStudentStats = asyncHandler(async (_req, res) => {
  const [total, active, inactive, suspended, todayAdmissions] = await Promise.all([
    prisma.student.count(),
    prisma.student.count({ where: { status: 'Active' } }),
    prisma.student.count({ where: { status: 'Inactive' } }),
    prisma.student.count({ where: { status: 'Suspended' } }),
    prisma.student.count({ where: { joiningDate: { gte: new Date(new Date().toDateString()) } } }),
  ]);

  res.json({
    success: true,
    data: {
      totalStudents: total,
      activeStudents: active,
      inactiveStudents: inactive,
      suspendedStudents: suspended,
      todayAdmissions,
    },
  });
});

export const exportStudents = asyncHandler(async (req, res) => {
  const { format = 'xlsx' } = req.body || {};
  const allowed = ['xlsx', 'csv'];
  if (!allowed.includes(format)) throw new ApiError(400, 'Invalid format');

  // For Phase-1, export based on search only (filters later)
  const search = String(req.body.search || req.query.search || '').trim();
  const where = search
    ? {
        OR: [
          { fullName: { contains: search, mode: 'insensitive' } },
          { registrationNumber: { contains: search, mode: 'insensitive' } },
          { aadhaarNumber: { contains: search } },
          { panNumber: { contains: search } },
        ],
      }
    : {};

  const students = await prisma.student.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { coach: true },
  });

  const rows = students.map((s, idx) => ({
    serial: idx + 1,
    registrationNumber: s.registrationNumber,
    fullName: s.fullName,
    status: s.status,
    membershipType: s.membershipType,
    batch: s.batch,
    category: s.category || 0,
    ageCategory: s.ageCategory || 0,
    weightCategory: s.weightCategory || 0,
    age: s.age ?? 0,
    weightKg: s.weightKg ?? 0,
    coachName: s.coach?.fullName || 0,
    joiningDate: s.joiningDate ? new Date(s.joiningDate).toLocaleDateString('en-IN') : 0,
    mobileNumber: s.mobileNumber,
    aadhaarNumber: s.aadhaarNumber,
    panNumber: s.panNumber,
    paymentStatus: s.paymentStatus,
  }));

  const columns = [
    { key: 'serial', label: 'S.No.', width: 10 },
    { key: 'registrationNumber', label: 'Registration No', width: 20 },
    { key: 'fullName', label: 'Student Name', width: 22 },
    { key: 'status', label: 'Status', width: 14 },
    { key: 'membershipType', label: 'Membership', width: 16 },
    { key: 'batch', label: 'Batch', width: 14 },
    { key: 'category', label: 'Player Category', width: 16 },
    { key: 'ageCategory', label: 'Age Category', width: 14 },
    { key: 'weightCategory', label: 'Weight Category', width: 14 },
    { key: 'age', label: 'Age', width: 8 },
    { key: 'weightKg', label: 'Weight (kg)', width: 12 },
    { key: 'coachName', label: 'Coach', width: 20 },
    { key: 'joiningDate', label: 'Joining Date', width: 14 },
    { key: 'mobileNumber', label: 'Mobile', width: 14 },
    { key: 'aadhaarNumber', label: 'Aadhaar', width: 16 },
    { key: 'panNumber', label: 'PAN', width: 12 },
    { key: 'paymentStatus', label: 'Payment', width: 12 },
  ];

  const timestamp = new Date().toISOString().slice(0, 10);
  if (format === 'xlsx') {
    const buffer = await buildExcelBuffer(rows, columns, 'Students');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="students-${timestamp}.xlsx"`);
    return res.send(buffer);
  }

  // CSV
  const header = columns.map((c) => `"${c.label}"`).join(',');
  const escape = (v) => `"${String(v ?? 0).replace(/"/g, '""')}"`;
  const csv = [header, ...rows.map((r) => columns.map((c) => escape(r[c.key])).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="students-${timestamp}.csv"`);
  return res.send(Buffer.from(csv, 'utf8'));
});

// ---------------------------
// COACHES (Phase-1 basic)
// ---------------------------

export const listCoachesPublic = asyncHandler(async (_req, res) => {
  const items = await prisma.coach.findMany({
    where: { status: 'Active', showOnWebsite: true },
    orderBy: [{ websiteOrder: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      fullName: true,
      photo: true,
      designation: true,
      specialization: true,
      experienceYears: true,
      biography: true,
      websiteOrder: true,
    },
  });

  res.json({ success: true, data: { coaches: withIds(items) } });
});

export const listCoachesAdmin = asyncHandler(async (req, res) => {
  const page = parsePage(req.query.page, 1);
  const limit = parseLimit(req.query.limit, 12);
  const search = String(req.query.search || '').trim();

  const status = req.query.status ? String(req.query.status) : undefined;
  const specialization = req.query.specialization ? String(req.query.specialization) : undefined;
  const experienceMin = req.query.experienceMin ? Number(req.query.experienceMin) : undefined;

  const where = {
    ...(status ? { status } : {}),
    ...(specialization ? { specialization: { contains: specialization, mode: 'insensitive' } } : {}),
    ...(experienceMin !== undefined ? { experienceYears: { gte: experienceMin } } : {}),
    ...(search
      ? {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { coachCode: { contains: search, mode: 'insensitive' } },
            { mobile: { contains: search } },
            { aadhaarNumber: { contains: search } },
            { panNumber: { contains: search } },
          ],
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.coach.count({ where }),
    prisma.coach.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        loginAccount: { select: { id: true, username: true, email: true, isActive: true } },
      },
    }),
  ]);

  let attendanceByCoach = new Map();
  try {
    const { calculateCoachAttendanceSummary } = await import('../services/coachAttendanceCalc.js');
    const summary = await calculateCoachAttendanceSummary({ period: 'month' });
    for (const row of summary?.coaches || summary?.coachRows || []) {
      attendanceByCoach.set(row.coachId, row.attendancePercentage ?? 0);
    }
  } catch {
    attendanceByCoach = new Map();
  }

  const coaches = withIds(items).map((c) => ({
    ...c,
    username: c.loginAccount?.username || 0,
    accountStatus: c.loginAccount ? (c.loginAccount.isActive && c.status === 'Active' ? 'Active' : 'Inactive') : c.status,
    attendancePercentage: attendanceByCoach.get(c.id) ?? 0,
  }));

  res.json({
    success: true,
    data: {
      coaches,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    },
  });
});

export const getCoachById = asyncHandler(async (req, res) => {
  const coach = await prisma.coach.findUnique({
    where: { id: req.params.id },
    include: {
      documents: true,
      loginAccount: { select: { id: true, username: true, email: true, isActive: true, lastLoginAt: true } },
    },
  });
  if (!coach) throw new ApiError(404, 'Coach not found');
  const safe = withId(coach);
  res.json({
    success: true,
    data: {
      coach: {
        ...safe,
        username: safe.loginAccount?.username || 0,
        hasLoginAccount: Boolean(safe.loginAccount),
      },
    },
  });
});

const EMPLOYEE_CATEGORIES = ['Coach', 'Assistant Coach', 'Warden', 'Cook', 'Cleaner', 'Physio'];

function normalizeOptionalId(value) {
  const v = String(value || '').trim();
  return v || null;
}

function parseEmployeeCategory(value, { required = false } = {}) {
  const v = String(value || '').trim();
  if (!v) {
    if (required) throw new ApiError(400, 'Category is required');
    return null;
  }
  if (!EMPLOYEE_CATEGORIES.includes(v)) {
    throw new ApiError(400, `Category must be one of: ${EMPLOYEE_CATEGORIES.join(', ')}`);
  }
  return v;
}

export const createCoach = asyncHandler(async (req, res) => {
  const files = req.files || {};
  const photoUpload = files.photo?.[0];
  if (!photoUpload) throw new ApiError(400, 'Employee photo is required');

  const aadhaarFrontUpload = files.aadhaarFront?.[0];
  const aadhaarBackUpload = files.aadhaarBack?.[0];
  const panCardUpload = files.panCard?.[0];

  const {
    fullName,
    fatherName,
    mobile,
    email,
    dateOfBirth,
    gender,
    address,
    experienceYears,
    specialization,
    designation,
    qualification,
    salary,
    joiningDate,
    employeeRole,
    role,
    category,
    status,
    showOnWebsite,
    websiteOrder,
    aadhaarNumber,
    panNumber,
    achievements,
    biography,
    socialLinks,
    password,
    confirmPassword,
    loginUsername,
  } = req.body;

  if (!fullName || !mobile) throw new ApiError(400, 'Employee name and mobile are required');
  if (!dateOfBirth) throw new ApiError(400, 'Date of birth is required');
  if (!joiningDate) throw new ApiError(400, 'Joining date is required');
  const employeeCategory = parseEmployeeCategory(category, { required: true });
  const nextRole = String(employeeRole || role || '').trim() || null;
  if (!nextRole) throw new ApiError(400, 'Role is required');
  const nextAadhaar = normalizeOptionalId(aadhaarNumber);
  const nextPan = normalizeOptionalId(panNumber);
  if (!password || !confirmPassword) throw new ApiError(400, 'Login password and confirm password are required');
  if (password !== confirmPassword) throw new ApiError(400, 'Passwords do not match');
  if (!STRONG_PASSWORD.test(password)) {
    throw new ApiError(400, 'Password must be 8+ characters with upper, lower and a number');
  }

  if (nextAadhaar || nextPan) {
    await assertUniqueAcrossTables({
      aadhaarNumber: nextAadhaar,
      panNumber: nextPan,
      mode: 'coach',
    });
  }

  const coachCode = await generateCoachCode();
  const username = String(loginUsername || coachCode).trim().toLowerCase();
  if (!username) throw new ApiError(400, 'Username is required');
  const userEmail = coachLoginEmail(coachCode, email);

  if (await prisma.user.findUnique({ where: { username } })) {
    throw new ApiError(400, USERNAME_TAKEN);
  }
  if (await prisma.user.findUnique({ where: { email: userEmail } })) {
    throw new ApiError(400, 'Email is already registered as a login account');
  }

  const photo = await processEntryPhoto(photoUpload, {
    prefix: `coach-${coachCode}`,
  });

  const aadhaarFrontImage = aadhaarFrontUpload ? toPublicPath(aadhaarFrontUpload.filename, 'entry/documents') : null;
  const aadhaarBackImage = aadhaarBackUpload ? toPublicPath(aadhaarBackUpload.filename, 'entry/documents') : null;
  const panCardImage = panCardUpload ? toPublicPath(panCardUpload.filename, 'entry/documents') : null;

  const certFiles = files.certificates || [];
  const certificates = certFiles.map((f) => toPublicPath(f.filename, 'entry/coach-certificates'));

  const qrCodePath = null;
  const coachRole = await ensureCoachPortalRole();
  const passwordHash = await bcrypt.hash(password, 12);
  const accountActive = (status || 'Active') === 'Active';

  const created = await prisma.$transaction(async (tx) => {
    const coach = await tx.coach.create({
      data: {
        coachCode,
        photo,
        fullName: String(fullName).trim(),
        fatherName: fatherName ? String(fatherName).trim() : null,
        mobile: String(mobile).trim(),
        email: email || null,
        dateOfBirth: new Date(dateOfBirth),
        gender: gender ? String(gender).trim() : null,
        address: address || null,
        experienceYears: experienceYears ? Number(experienceYears) : 0,
        specialization: specialization || null,
        designation: designation ? String(designation).trim() : null,
        qualification: qualification || null,
        salary: salary ? Number(salary) : 0,
        joiningDate: new Date(joiningDate),
        employeeRole: nextRole,
        category: employeeCategory,
        status: status || 'Active',
        showOnWebsite: parseBool(showOnWebsite, false),
        websiteOrder: parseOrder(websiteOrder, 0),
        aadhaarNumber: nextAadhaar,
        panNumber: nextPan,
        achievements: achievements || null,
        biography: biography || null,
        socialLinks: socialLinks ? JSON.parse(socialLinks) : null,
        qrCodePath,
      },
    });

    await tx.coachDocument.create({
      data: {
        coachId: coach.id,
        aadhaarFrontImage,
        aadhaarBackImage,
        panCardImage,
        certificates: certificates.length ? certificates : null,
      },
    });

    await tx.user.create({
      data: {
        name: String(fullName).trim(),
        username,
        email: userEmail,
        mobile: String(mobile).replace(/\D/g, '').slice(-10),
        password: passwordHash,
        role: 'coach',
        roleId: coachRole.id,
        coachId: coach.id,
        isActive: accountActive,
        profileImage: photo,
      },
    });

    return coach;
  });

  res.status(201).json({
    success: true,
    data: {
      coach: withId(created),
      login: { username, email: userEmail },
    },
    message: 'Employee created with login credentials',
  });
});

export const updateCoach = asyncHandler(async (req, res) => {
  const coach = await prisma.coach.findUnique({ where: { id: req.params.id } });
  if (!coach) throw new ApiError(404, 'Employee not found');

  const files = req.files || {};
  const photoUpload = files.photo?.[0];
  const aadhaarFrontUpload = files.aadhaarFront?.[0];
  const aadhaarBackUpload = files.aadhaarBack?.[0];
  const panCardUpload = files.panCard?.[0];
  const certificates = files.certificates || [];

  const nextAadhaarNumber =
    req.body.aadhaarNumber !== undefined
      ? normalizeOptionalId(req.body.aadhaarNumber)
      : coach.aadhaarNumber;
  const nextPanNumber =
    req.body.panNumber !== undefined ? normalizeOptionalId(req.body.panNumber) : coach.panNumber;
  if (nextAadhaarNumber !== coach.aadhaarNumber || nextPanNumber !== coach.panNumber) {
    if (nextAadhaarNumber || nextPanNumber) {
      await assertUniqueAcrossTables({
        aadhaarNumber: nextAadhaarNumber,
        panNumber: nextPanNumber,
        mode: 'coach',
      });
    }
  }

  let nextCategory = coach.category;
  if (req.body.category !== undefined) {
    nextCategory = parseEmployeeCategory(req.body.category, { required: true });
  }
  let nextRole = coach.employeeRole;
  if (req.body.employeeRole !== undefined || req.body.role !== undefined) {
    nextRole = String(req.body.employeeRole || req.body.role || '').trim() || null;
    if (!nextRole) throw new ApiError(400, 'Role is required');
  }
  if (req.body.joiningDate !== undefined && !String(req.body.joiningDate || '').trim()) {
    throw new ApiError(400, 'Joining date is required');
  }

  let nextPhoto = coach.photo;
  if (photoUpload) {
    nextPhoto = await processEntryPhoto(photoUpload, {
      prefix: `coach-${coach.coachCode}`,
      oldPhotoPath: coach.photo,
    });
  }

  // QR Code removed (no file generation)
  if (coach.qrCodePath) deleteUploadedFile(coach.qrCodePath);
  const qrCodePath = null;

  const updated = await prisma.$transaction(async (tx) => {
    const doc = await tx.coachDocument.findUnique({ where: { coachId: coach.id } });
    if (!doc) throw new ApiError(400, 'Coach document record missing');

    let nextDoc = {
      aadhaarFrontImage: doc.aadhaarFrontImage,
      aadhaarBackImage: doc.aadhaarBackImage,
      panCardImage: doc.panCardImage,
      certificates: doc.certificates,
    };

    if (aadhaarFrontUpload) nextDoc.aadhaarFrontImage = toPublicPath(aadhaarFrontUpload.filename, 'entry/documents');
    if (aadhaarBackUpload) nextDoc.aadhaarBackImage = toPublicPath(aadhaarBackUpload.filename, 'entry/documents');
    if (panCardUpload) nextDoc.panCardImage = toPublicPath(panCardUpload.filename, 'entry/documents');
    if (certificates.length) {
      nextDoc.certificates = certificates.map((f) => toPublicPath(f.filename, 'entry/coach-certificates'));
    }

    await tx.coachDocument.update({
      where: { coachId: coach.id },
      data: nextDoc,
    });

    return tx.coach.update({
      where: { id: coach.id },
      data: {
        coachCode: coach.coachCode, // keep stable
        photo: nextPhoto,
        fullName: req.body.fullName !== undefined ? String(req.body.fullName).trim() : coach.fullName,
        fatherName:
          req.body.fatherName !== undefined
            ? req.body.fatherName
              ? String(req.body.fatherName).trim()
              : null
            : coach.fatherName,
        mobile: req.body.mobile !== undefined ? String(req.body.mobile).trim() : coach.mobile,
        email: req.body.email !== undefined ? req.body.email || null : coach.email,
        dateOfBirth: req.body.dateOfBirth ? new Date(req.body.dateOfBirth) : coach.dateOfBirth,
        gender:
          req.body.gender !== undefined
            ? req.body.gender
              ? String(req.body.gender).trim()
              : null
            : coach.gender,
        address: req.body.address !== undefined ? req.body.address || null : coach.address,
        experienceYears: req.body.experienceYears !== undefined ? Number(req.body.experienceYears) || 0 : coach.experienceYears,
        specialization: req.body.specialization !== undefined ? req.body.specialization || null : coach.specialization,
        designation:
          req.body.designation !== undefined
            ? req.body.designation
              ? String(req.body.designation).trim()
              : null
            : coach.designation,
        qualification: req.body.qualification !== undefined ? req.body.qualification || null : coach.qualification,
        salary: req.body.salary !== undefined ? Number(req.body.salary) || 0 : coach.salary,
        joiningDate:
          req.body.joiningDate !== undefined
            ? req.body.joiningDate
              ? new Date(req.body.joiningDate)
              : null
            : coach.joiningDate,
        employeeRole: nextRole,
        category: nextCategory,
        status: req.body.status !== undefined ? req.body.status : coach.status,
        showOnWebsite:
          req.body.showOnWebsite !== undefined ? parseBool(req.body.showOnWebsite, false) : coach.showOnWebsite,
        websiteOrder:
          req.body.websiteOrder !== undefined ? parseOrder(req.body.websiteOrder, coach.websiteOrder || 0) : coach.websiteOrder,
        aadhaarNumber: nextAadhaarNumber,
        panNumber: nextPanNumber,
        achievements: req.body.achievements !== undefined ? req.body.achievements || null : coach.achievements,
        biography: req.body.biography !== undefined ? req.body.biography || null : coach.biography,
        socialLinks: req.body.socialLinks !== undefined ? (req.body.socialLinks ? JSON.parse(req.body.socialLinks) : null) : coach.socialLinks,
        qrCodePath,
      },
    });
  });

  // Sync linked coach login account
  const loginUser = await prisma.user.findUnique({ where: { coachId: updated.id } });
  if (loginUser) {
    const userData = {
      name: updated.fullName,
      mobile: String(updated.mobile || '').replace(/\D/g, '').slice(-10) || null,
      profileImage: updated.photo,
      isActive: updated.status === 'Active',
    };
    if (req.body.loginUsername !== undefined && String(req.body.loginUsername).trim()) {
      const nextUsername = String(req.body.loginUsername).trim().toLowerCase();
      if (nextUsername !== loginUser.username) {
        const taken = await prisma.user.findUnique({ where: { username: nextUsername } });
        if (taken && taken.id !== loginUser.id) throw new ApiError(400, USERNAME_TAKEN);
        userData.username = nextUsername;
      }
    }
    if (req.body.password) {
      if (req.body.password !== req.body.confirmPassword) {
        throw new ApiError(400, 'Passwords do not match');
      }
      if (!STRONG_PASSWORD.test(req.body.password)) {
        throw new ApiError(400, 'Password must be 8+ characters with upper, lower and a number');
      }
      userData.password = await bcrypt.hash(req.body.password, 12);
      userData.passwordResetToken = null;
      userData.passwordResetExpires = null;
    }
    await prisma.user.update({ where: { id: loginUser.id }, data: userData });
  } else if (req.body.password) {
    if (req.body.password !== req.body.confirmPassword) {
      throw new ApiError(400, 'Passwords do not match');
    }
    if (!STRONG_PASSWORD.test(req.body.password)) {
      throw new ApiError(400, 'Password must be 8+ characters with upper, lower and a number');
    }
    const coachRole = await ensureCoachPortalRole();
    const username = String(req.body.loginUsername || updated.coachCode).trim().toLowerCase();
    const userEmail = coachLoginEmail(updated.coachCode, updated.email);
    if (await prisma.user.findUnique({ where: { username } })) {
      throw new ApiError(400, USERNAME_TAKEN);
    }
    if (await prisma.user.findUnique({ where: { email: userEmail } })) {
      throw new ApiError(400, 'Email is already registered as a login account');
    }
    await prisma.user.create({
      data: {
        name: updated.fullName,
        username,
        email: userEmail,
        mobile: String(updated.mobile || '').replace(/\D/g, '').slice(-10) || null,
        password: await bcrypt.hash(req.body.password, 12),
        role: 'coach',
        roleId: coachRole.id,
        coachId: updated.id,
        isActive: updated.status === 'Active',
        profileImage: updated.photo,
      },
    });
  }

  res.json({ success: true, data: { coach: withId(updated) }, message: 'Coach updated' });
});

export const resetCoachPassword = asyncHandler(async (req, res) => {
  const coach = await prisma.coach.findUnique({ where: { id: req.params.id } });
  if (!coach) throw new ApiError(404, 'Coach not found');

  const { password, confirmPassword } = req.body;
  if (!password || password !== confirmPassword) {
    throw new ApiError(400, 'Password and confirm password must match');
  }
  if (!STRONG_PASSWORD.test(password)) {
    throw new ApiError(400, 'Password must be 8+ characters with upper, lower and a number');
  }

  let loginUser = await prisma.user.findUnique({ where: { coachId: coach.id } });
  const passwordHash = await bcrypt.hash(password, 12);

  if (loginUser) {
    await prisma.user.update({
      where: { id: loginUser.id },
      data: {
        password: passwordHash,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });
  } else {
    const coachRole = await ensureCoachPortalRole();
    const username = coach.coachCode.toLowerCase();
    const userEmail = coachLoginEmail(coach.coachCode, coach.email);
    if (await prisma.user.findUnique({ where: { username } })) {
      throw new ApiError(400, USERNAME_TAKEN);
    }
    if (await prisma.user.findUnique({ where: { email: userEmail } })) {
      throw new ApiError(400, 'Email is already registered as a login account');
    }
    loginUser = await prisma.user.create({
      data: {
        name: coach.fullName,
        username,
        email: userEmail,
        mobile: String(coach.mobile || '').replace(/\D/g, '').slice(-10) || null,
        password: passwordHash,
        role: 'coach',
        roleId: coachRole.id,
        coachId: coach.id,
        isActive: coach.status === 'Active',
        profileImage: coach.photo,
      },
    });
  }

  const { writeAuditLog } = await import('../utils/rbac.js');
  await writeAuditLog({
    userId: req.user?.id,
    action: 'reset_password',
    entity: 'coach',
    entityId: coach.id,
    req,
  });

  res.json({
    success: true,
    message: 'Coach password reset successfully',
    data: { username: loginUser.username },
  });
});

export const resetStudentPassword = asyncHandler(async (req, res) => {
  const student = await prisma.student.findUnique({ where: { id: req.params.id } });
  if (!student) throw new ApiError(404, 'Student not found');

  const { password, confirmPassword } = req.body;
  if (!password || password !== confirmPassword) {
    throw new ApiError(400, 'Password and confirm password must match');
  }
  if (!STRONG_PASSWORD.test(password)) {
    throw new ApiError(400, 'Password must be 8+ characters with upper, lower and a number');
  }

  let loginUser = await prisma.user.findUnique({ where: { studentId: student.id } });
  const passwordHash = await bcrypt.hash(password, 12);

  if (loginUser) {
    await prisma.user.update({
      where: { id: loginUser.id },
      data: {
        password: passwordHash,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });
  } else {
    const studentRole = await ensureStudentRole();
    const username = student.registrationNumber.toLowerCase();
    const userEmail = studentLoginEmail(student.registrationNumber, student.email);
    if (await prisma.user.findUnique({ where: { username } })) {
      throw new ApiError(400, USERNAME_TAKEN);
    }
    if (await prisma.user.findUnique({ where: { email: userEmail } })) {
      throw new ApiError(400, 'Email is already registered as a login account');
    }
    loginUser = await prisma.user.create({
      data: {
        name: student.fullName,
        username,
        email: userEmail,
        mobile: String(student.mobileNumber || '').replace(/\D/g, '').slice(-10) || null,
        password: passwordHash,
        role: 'student',
        roleId: studentRole.id,
        studentId: student.id,
        isActive: student.status === 'Active',
        profileImage: student.photo,
      },
    });
  }

  const { writeAuditLog } = await import('../utils/rbac.js');
  await writeAuditLog({
    userId: req.user?.id,
    action: 'reset_password',
    entity: 'student',
    entityId: student.id,
    req,
  });

  res.json({
    success: true,
    message: 'Student password reset successfully',
    data: { username: loginUser.username },
  });
});

export const deleteCoach = asyncHandler(async (req, res) => {
  const coach = await prisma.coach.findUnique({ where: { id: req.params.id } });
  if (!coach) throw new ApiError(404, 'Coach not found');

  await prisma.$transaction(async (tx) => {
    await tx.coachAttendance.deleteMany({ where: { coachId: coach.id } });
    await tx.coach.delete({ where: { id: coach.id } });
  });

  if (coach.photo) deleteUploadedFile(coach.photo);
  if (coach.qrCodePath) deleteUploadedFile(coach.qrCodePath);
  res.json({ success: true, message: 'Coach deleted' });
});

export const getCoachStats = asyncHandler(async (_req, res) => {
  const [total, active, inactive, suspended] = await Promise.all([
    prisma.coach.count(),
    prisma.coach.count({ where: { status: 'Active' } }),
    prisma.coach.count({ where: { status: 'Inactive' } }),
    prisma.coach.count({ where: { status: 'Suspended' } }),
  ]);
  res.json({ success: true, data: { totalCoaches: total, activeCoaches: active, inactiveCoaches: inactive, suspendedCoaches: suspended } });
});

export const exportCoaches = asyncHandler(async (req, res) => {
  const { format = 'xlsx' } = req.body || {};
  const allowed = ['xlsx', 'csv'];
  if (!allowed.includes(format)) throw new ApiError(400, 'Invalid format');

  const search = String(req.body.search || req.query.search || '').trim();
  const status = req.body.status || req.query.status || undefined;
  const where = {
    ...(status && status !== 'all' ? { status: String(status) } : {}),
    ...(search
      ? {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { coachCode: { contains: search, mode: 'insensitive' } },
            { mobile: { contains: search } },
            { aadhaarNumber: { contains: search } },
            { panNumber: { contains: search } },
            { specialization: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const coaches = await prisma.coach.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  const rows = coaches.map((c, idx) => ({
    serial: idx + 1,
    coachCode: c.coachCode,
    fullName: c.fullName,
    fatherName: c.fatherName,
    mobile: c.mobile,
    email: c.email || 0,
    status: c.status,
    specialization: c.specialization || 0,
    qualification: c.qualification || 0,
    experienceYears: c.experienceYears ?? 0,
    salary: c.salary ?? 0,
    joiningDate: c.joiningDate ? new Date(c.joiningDate).toLocaleDateString('en-IN') : 0,
    aadhaarNumber: c.aadhaarNumber,
    panNumber: c.panNumber,
  }));

  const columns = [
    { key: 'serial', label: 'S.No.', width: 10 },
    { key: 'coachCode', label: 'Coach ID', width: 22 },
    { key: 'fullName', label: 'Coach Name', width: 22 },
    { key: 'fatherName', label: 'Father Name', width: 20 },
    { key: 'mobile', label: 'Mobile', width: 14 },
    { key: 'email', label: 'Email', width: 22 },
    { key: 'status', label: 'Status', width: 12 },
    { key: 'specialization', label: 'Specialization', width: 18 },
    { key: 'qualification', label: 'Qualification', width: 18 },
    { key: 'experienceYears', label: 'Experience (Years)', width: 16 },
    { key: 'salary', label: 'Salary', width: 12 },
    { key: 'joiningDate', label: 'Joining Date', width: 14 },
    { key: 'aadhaarNumber', label: 'Aadhaar', width: 16 },
    { key: 'panNumber', label: 'PAN', width: 12 },
  ];

  const timestamp = new Date().toISOString().slice(0, 10);
  if (format === 'xlsx') {
    const buffer = await buildExcelBuffer(rows, columns, 'Coaches');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="coaches-${timestamp}.xlsx"`);
    return res.send(buffer);
  }

  const header = columns.map((c) => `"${c.label}"`).join(',');
  const escape = (v) => `"${String(v ?? 0).replace(/"/g, '""')}"`;
  const csv = [header, ...rows.map((r) => columns.map((c) => escape(r[c.key])).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="coaches-${timestamp}.csv"`);
  return res.send(Buffer.from(csv, 'utf8'));
});

// ---------------------------
// Equipment / Tools
// ---------------------------

/** Public website equipment (active only, safe fields) */
export const listEquipmentPublic = asyncHandler(async (_req, res) => {
  const items = await prisma.equipment.findMany({
    where: { isActive: true },
    select: {
      id: true,
      title: true,
      description: true,
      category: true,
      image: true,
      order: true,
      icon: true,
    },
    orderBy: [{ order: 'asc' }, { title: 'asc' }],
  });
  res.json({
    success: true,
    data: { equipment: withIds(items) },
  });
});

export const listEquipmentAdmin = asyncHandler(async (req, res) => {
  const page = parsePage(req.query.page, 1);
  const limit = parseLimit(req.query.limit, 12);
  const search = String(req.query.search || '').trim();

  const category = req.query.category ? String(req.query.category) : undefined;
  const status = req.query.status ? String(req.query.status) : undefined;
  const condition = req.query.condition ? String(req.query.condition) : undefined;

  const where = {
    ...(category ? { category } : {}),
    ...(status ? { status } : {}),
    ...(condition ? { condition } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { equipmentCode: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.equipment.count({ where }),
    prisma.equipment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    success: true,
    data: {
      equipment: withIds(items),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    },
  });
});

export const getEquipmentById = asyncHandler(async (req, res) => {
  const item = await prisma.equipment.findUnique({
    where: { id: req.params.id },
  });
  if (!item) throw new ApiError(404, 'Equipment not found');
  res.json({ success: true, data: { equipment: withId(item) } });
});

export const createEquipment = asyncHandler(async (req, res) => {
  const file = req.file;
  if (!file) throw new ApiError(400, 'Equipment image is required');

  const {
    title,
    description,
    category,
    quantity,
    availableQuantity,
    purchaseDate,
    purchaseCost,
    supplier,
    condition,
    location,
    rackNumber,
    status,
    maintenance,
    remarks,
    order,
  } = req.body;

  if (!title || !description) throw new ApiError(400, 'title/description are required');
  const equipmentCode = await generateEquipmentCode();

  const image = toPublicPath(file.filename, 'entry/equipment');
  // QR Code removed (no file generation)
  const qrCodePath = null;

  const created = await prisma.equipment.create({
    data: {
      equipmentCode,
      title: String(title).trim(),
      description: String(description).trim(),
      category: category || null,
      image,

      quantity: parseInt4Field(quantity, 'Quantity'),
      availableQuantity: parseInt4Field(availableQuantity, 'Available quantity'),
      purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
      purchaseCost: parsePurchaseCost(purchaseCost),
      supplier: supplier || null,

      condition: condition || 'Good',
      location: location || null,
      rackNumber: rackNumber || null,
      status: status || 'Available',
      maintenance: maintenance || null,
      remarks: remarks || null,

      qrCodePath,
      barcodeValue: req.body.barcodeValue || null,

      order: parseInt4Field(order, 'Order'),
      isActive: true,
    },
  });

  res.status(201).json({ success: true, message: 'Equipment created', data: { equipment: withId(created) } });
});

export const updateEquipment = asyncHandler(async (req, res) => {
  const existing = await prisma.equipment.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'Equipment not found');

  const file = req.file;
  let image = existing.image;
  if (file) {
    if (existing.image) deleteUploadedFile(existing.image);
    image = toPublicPath(file.filename, 'entry/equipment');
  }

  // QR Code removed (no file generation)
  if (existing.qrCodePath) deleteUploadedFile(existing.qrCodePath);
  const qrCodePath = null;

  const next = await prisma.$transaction(async (tx) => {
    const updated = await tx.equipment.update({
      where: { id: existing.id },
      data: {
        title: req.body.title !== undefined ? String(req.body.title).trim() : existing.title,
        description: req.body.description !== undefined ? String(req.body.description).trim() : existing.description,
        category: req.body.category !== undefined ? req.body.category || null : existing.category,
        image,
        quantity:
          req.body.quantity !== undefined
            ? parseInt4Field(req.body.quantity, 'Quantity', { defaultValue: existing.quantity })
            : existing.quantity,
        availableQuantity:
          req.body.availableQuantity !== undefined
            ? parseInt4Field(req.body.availableQuantity, 'Available quantity', {
                defaultValue: existing.availableQuantity,
              })
            : existing.availableQuantity,
        purchaseDate: req.body.purchaseDate ? new Date(req.body.purchaseDate) : existing.purchaseDate,
        purchaseCost:
          req.body.purchaseCost !== undefined
            ? parsePurchaseCost(req.body.purchaseCost)
            : existing.purchaseCost,
        supplier: req.body.supplier !== undefined ? req.body.supplier || null : existing.supplier,
        condition: req.body.condition !== undefined ? req.body.condition : existing.condition,
        location: req.body.location !== undefined ? req.body.location || null : existing.location,
        rackNumber: req.body.rackNumber !== undefined ? req.body.rackNumber || null : existing.rackNumber,
        status: req.body.status !== undefined ? req.body.status : existing.status,
        maintenance: req.body.maintenance !== undefined ? req.body.maintenance || null : existing.maintenance,
        remarks: req.body.remarks !== undefined ? req.body.remarks || null : existing.remarks,
        qrCodePath: qrCodePath,
        barcodeValue: req.body.barcodeValue !== undefined ? req.body.barcodeValue || null : existing.barcodeValue,
      },
    });

    // minimal history entry on status/condition change
    const statusChanged = req.body.status !== undefined && req.body.status !== existing.status;
    const conditionChanged = req.body.condition !== undefined && req.body.condition !== existing.condition;
    if (statusChanged || conditionChanged) {
      await tx.equipmentHistory.create({
        data: {
          equipmentId: existing.id,
          eventType: 'update',
          description: [
            statusChanged ? `status: ${existing.status} -> ${updated.status}` : null,
            conditionChanged ? `condition: ${existing.condition} -> ${updated.condition}` : null,
          ]
            .filter(Boolean)
            .join(', '),
        },
      });
    }

    return updated;
  });

  res.json({ success: true, message: 'Equipment updated', data: { equipment: withId(next) } });
});

export const deleteEquipment = asyncHandler(async (req, res) => {
  const existing = await prisma.equipment.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'Equipment not found');
  await prisma.equipment.delete({ where: { id: req.params.id } });
  if (existing.image) deleteUploadedFile(existing.image);
  if (existing.qrCodePath) deleteUploadedFile(existing.qrCodePath);
  res.json({ success: true, message: 'Equipment deleted' });
});

export const getEquipmentStats = asyncHandler(async (_req, res) => {
  const [total, available, maintenance, damaged] = await Promise.all([
    prisma.equipment.count(),
    prisma.equipment.count({ where: { status: 'Available' } }),
    prisma.equipment.count({ where: { status: 'Maintenance' } }),
    prisma.equipment.count({ where: { condition: 'Damaged' } }),
  ]);
  res.json({ success: true, data: { totalEquipment: total, available, maintenance, damaged } });
});

export const exportEquipment = asyncHandler(async (req, res) => {
  const { format = 'xlsx' } = req.body || {};
  const allowed = ['xlsx', 'csv'];
  if (!allowed.includes(format)) throw new ApiError(400, 'Invalid format');

  const search = String(req.body.search || req.query.search || '').trim();
  const category = req.body.category || req.query.category || undefined;
  const status = req.body.status || req.query.status || undefined;
  const condition = req.body.condition || req.query.condition || undefined;

  const where = {
    ...(category ? { category: String(category) } : {}),
    ...(status && status !== 'all' ? { status: String(status) } : {}),
    ...(condition && condition !== 'all' ? { condition: String(condition) } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { equipmentCode: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            { supplier: { contains: search, mode: 'insensitive' } },
            { location: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const equipment = await prisma.equipment.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  const rows = equipment.map((e, idx) => ({
    serial: idx + 1,
    equipmentCode: e.equipmentCode || 0,
    title: e.title,
    category: e.category || 0,
    status: e.status,
    condition: e.condition,
    quantity: e.quantity ?? 0,
    availableQuantity: e.availableQuantity ?? 0,
    location: e.location || 0,
    rackNumber: e.rackNumber || 0,
    supplier: e.supplier || 0,
    purchaseDate: e.purchaseDate ? new Date(e.purchaseDate).toLocaleDateString('en-IN') : 0,
    purchaseCost: e.purchaseCost ?? 0,
    barcodeValue: e.barcodeValue || 0,
    remarks: e.remarks || 0,
  }));

  const columns = [
    { key: 'serial', label: 'S.No.', width: 10 },
    { key: 'equipmentCode', label: 'Equipment ID', width: 22 },
    { key: 'title', label: 'Name', width: 22 },
    { key: 'category', label: 'Category', width: 16 },
    { key: 'status', label: 'Status', width: 14 },
    { key: 'condition', label: 'Condition', width: 14 },
    { key: 'quantity', label: 'Quantity', width: 12 },
    { key: 'availableQuantity', label: 'Available Qty', width: 14 },
    { key: 'location', label: 'Location', width: 16 },
    { key: 'rackNumber', label: 'Rack No', width: 12 },
    { key: 'supplier', label: 'Supplier', width: 18 },
    { key: 'purchaseDate', label: 'Purchase Date', width: 14 },
    { key: 'purchaseCost', label: 'Purchase Cost', width: 14 },
    { key: 'barcodeValue', label: 'Barcode', width: 16 },
    { key: 'remarks', label: 'Remarks', width: 24 },
  ];

  const timestamp = new Date().toISOString().slice(0, 10);
  if (format === 'xlsx') {
    const buffer = await buildExcelBuffer(rows, columns, 'Equipment');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="equipment-${timestamp}.xlsx"`);
    return res.send(buffer);
  }

  const header = columns.map((c) => `"${c.label}"`).join(',');
  const escape = (v) => `"${String(v ?? 0).replace(/"/g, '""')}"`;
  const csv = [header, ...rows.map((r) => columns.map((c) => escape(r[c.key])).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="equipment-${timestamp}.csv"`);
  return res.send(Buffer.from(csv, 'utf8'));
});

