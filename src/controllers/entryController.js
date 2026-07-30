import path from 'path';
import fs from 'fs';
import prisma from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { withId, withIds } from '../utils/serialize.js';
import { deleteUploadedFile, toPublicPath, ENTRY_PHOTOS_DIR, ENTRY_DOCS_DIR, COACH_CERTS_DIR, ENTRY_EQUIPMENT_DIR, VIDEOS_DIR, QR_DIR } from '../middleware/upload.js';
import ExcelJS from 'exceljs';
import { centerCropSquareToJpg } from '../services/imageCropService.js';

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
    rows.forEach((r) => sheet.addRow(r));
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
  } = req.body;

  if (!fullName || !fatherName || !motherName) throw new ApiError(400, 'Missing student personal fields');
  if (!mobileNumber) throw new ApiError(400, 'Mobile number is required');
  if (!aadhaarNumber || !panNumber) throw new ApiError(400, 'Aadhaar number and PAN number are required');

  await assertUniqueAcrossTables({ aadhaarNumber, panNumber, mode: 'student' });

  const registrationNumber = await generateStudentRegNo();

  const photo = await processEntryPhoto(photoUpload, {
    prefix: `student-${registrationNumber}`,
  });

  const aadhaarFrontImage = aadhaarFrontUpload ? toPublicPath(aadhaarFrontUpload.filename, 'entry/documents') : null;
  const aadhaarBackImage = aadhaarBackUpload ? toPublicPath(aadhaarBackUpload.filename, 'entry/documents') : null;
  const panCardImage = panCardUpload ? toPublicPath(panCardUpload.filename, 'entry/documents') : null;

  // QR Code removed (no file generation)
  const qrCodePath = null;

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
        joiningDate: new Date(joiningDate),
        membershipType: membershipType || 'General',
        batch: batch || 'General',
        coachId: coachId || null,
        trainingLevel: trainingLevel || 'Beginner',

        heightCm: heightCm ? Number(heightCm) : null,
        weightKg: weightKg ? Number(weightKg) : null,
        chest: chest ? Number(chest) : null,
        age: age ? Number(age) : null,
        category: category || null,

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

    return student;
  });

  res.status(201).json({ success: true, data: { student: withId(created) }, message: 'Student created' });
});

// NOTE: For Phase-1 we implement update/delete/get for students with minimal file replacement handling.
// Coaches/Equipment follow the same approach.

export const updateStudent = asyncHandler(async (req, res) => {
  const student = await prisma.student.findUnique({ where: { id: req.params.id } });
  if (!student) throw new ApiError(404, 'Student not found');

  const files = req.files || {};
  const photoUpload = files.photo?.[0];
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

        joiningDate: req.body.joiningDate ? new Date(req.body.joiningDate) : student.joiningDate,
        membershipType: req.body.membershipType !== undefined ? req.body.membershipType || 'General' : student.membershipType,
        batch: req.body.batch !== undefined ? req.body.batch || 'General' : student.batch,
        coachId: req.body.coachId !== undefined ? req.body.coachId || null : student.coachId,
        trainingLevel: req.body.trainingLevel !== undefined ? req.body.trainingLevel : student.trainingLevel,

        heightCm: req.body.heightCm !== undefined ? Number(req.body.heightCm) || null : student.heightCm,
        weightKg: req.body.weightKg !== undefined ? Number(req.body.weightKg) || null : student.weightKg,
        chest: req.body.chest !== undefined ? Number(req.body.chest) || null : student.chest,
        age: req.body.age !== undefined ? Number(req.body.age) || null : student.age,
        category: req.body.category !== undefined ? req.body.category || null : student.category,

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

  res.json({ success: true, data: { student: withId(updated) }, message: 'Student updated' });
});

export const deleteStudent = asyncHandler(async (req, res) => {
  const student = await prisma.student.findUnique({ where: { id: req.params.id } });
  if (!student) throw new ApiError(404, 'Student not found');

  await prisma.student.delete({ where: { id: req.params.id } });
  if (student.photo) deleteUploadedFile(student.photo);
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
    coachName: s.coach?.fullName || '',
    joiningDate: s.joiningDate ? new Date(s.joiningDate).toLocaleDateString('en-IN') : '',
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
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [header, ...rows.map((r) => columns.map((c) => escape(r[c.key])).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="students-${timestamp}.csv"`);
  return res.send(Buffer.from(csv, 'utf8'));
});

// ---------------------------
// COACHES (Phase-1 basic)
// ---------------------------

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
    }),
  ]);

  res.json({
    success: true,
    data: {
      coaches: withIds(items),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    },
  });
});

export const getCoachById = asyncHandler(async (req, res) => {
  const coach = await prisma.coach.findUnique({
    where: { id: req.params.id },
    include: { documents: true },
  });
  if (!coach) throw new ApiError(404, 'Coach not found');
  res.json({ success: true, data: { coach: withId(coach) } });
});

export const createCoach = asyncHandler(async (req, res) => {
  const files = req.files || {};
  const photoUpload = files.photo?.[0];
  if (!photoUpload) throw new ApiError(400, 'Coach photo is required');

  const aadhaarFrontUpload = files.aadhaarFront?.[0];
  const aadhaarBackUpload = files.aadhaarBack?.[0];
  const panCardUpload = files.panCard?.[0];

  const { fullName, fatherName, mobile, email, dateOfBirth, address, experienceYears, specialization, qualification, salary, joiningDate, status, aadhaarNumber, panNumber, achievements, biography, socialLinks } = req.body;

  if (!fullName || !fatherName || !mobile) throw new ApiError(400, 'Missing coach fields');
  if (!aadhaarNumber || !panNumber) throw new ApiError(400, 'Aadhaar number and PAN number are required');

  // duplicate checks across tables
  await assertUniqueAcrossTables({ aadhaarNumber: String(aadhaarNumber).trim(), panNumber: String(panNumber).trim(), mode: 'coach' });

  const coachCode = await generateCoachCode();

  const photo = await processEntryPhoto(photoUpload, {
    prefix: `coach-${coachCode}`,
  });

  const aadhaarFrontImage = aadhaarFrontUpload ? toPublicPath(aadhaarFrontUpload.filename, 'entry/documents') : null;
  const aadhaarBackImage = aadhaarBackUpload ? toPublicPath(aadhaarBackUpload.filename, 'entry/documents') : null;
  const panCardImage = panCardUpload ? toPublicPath(panCardUpload.filename, 'entry/documents') : null;

  const certFiles = files.certificates || [];
  const certificates = certFiles.map((f) => toPublicPath(f.filename, 'entry/coach-certificates'));

  // QR Code removed (no file generation)
  const qrCodePath = null;

  const created = await prisma.$transaction(async (tx) => {
    const coach = await tx.coach.create({
      data: {
        coachCode,
        photo,
        fullName: String(fullName).trim(),
        fatherName: String(fatherName).trim(),
        mobile: String(mobile).trim(),
        email: email || null,
        dateOfBirth: new Date(dateOfBirth),
        address: address || null,
        experienceYears: experienceYears ? Number(experienceYears) : null,
        specialization: specialization || null,
        qualification: qualification || null,
        salary: salary ? Number(salary) : null,
        joiningDate: joiningDate ? new Date(joiningDate) : null,
        status: status || 'Active',
        aadhaarNumber: String(aadhaarNumber).trim(),
        panNumber: String(panNumber).trim(),
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

    return coach;
  });

  res.status(201).json({ success: true, data: { coach: withId(created) }, message: 'Coach created' });
});

export const updateCoach = asyncHandler(async (req, res) => {
  const coach = await prisma.coach.findUnique({ where: { id: req.params.id } });
  if (!coach) throw new ApiError(404, 'Coach not found');

  const files = req.files || {};
  const photoUpload = files.photo?.[0];
  const aadhaarFrontUpload = files.aadhaarFront?.[0];
  const aadhaarBackUpload = files.aadhaarBack?.[0];
  const panCardUpload = files.panCard?.[0];
  const certificates = files.certificates || [];

  const nextAadhaarNumber = req.body.aadhaarNumber ? String(req.body.aadhaarNumber).trim() : coach.aadhaarNumber;
  const nextPanNumber = req.body.panNumber ? String(req.body.panNumber).trim() : coach.panNumber;
  if (nextAadhaarNumber !== coach.aadhaarNumber || nextPanNumber !== coach.panNumber) {
    await assertUniqueAcrossTables({ aadhaarNumber: nextAadhaarNumber, panNumber: nextPanNumber, mode: 'coach' });
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
        fatherName: req.body.fatherName !== undefined ? String(req.body.fatherName).trim() : coach.fatherName,
        mobile: req.body.mobile !== undefined ? String(req.body.mobile).trim() : coach.mobile,
        email: req.body.email !== undefined ? req.body.email || null : coach.email,
        dateOfBirth: req.body.dateOfBirth ? new Date(req.body.dateOfBirth) : coach.dateOfBirth,
        address: req.body.address !== undefined ? req.body.address || null : coach.address,
        experienceYears: req.body.experienceYears !== undefined ? Number(req.body.experienceYears) : coach.experienceYears,
        specialization: req.body.specialization !== undefined ? req.body.specialization || null : coach.specialization,
        qualification: req.body.qualification !== undefined ? req.body.qualification || null : coach.qualification,
        salary: req.body.salary !== undefined ? Number(req.body.salary) : coach.salary,
        joiningDate: req.body.joiningDate ? new Date(req.body.joiningDate) : coach.joiningDate,
        status: req.body.status !== undefined ? req.body.status : coach.status,
        aadhaarNumber: nextAadhaarNumber,
        panNumber: nextPanNumber,
        achievements: req.body.achievements !== undefined ? req.body.achievements || null : coach.achievements,
        biography: req.body.biography !== undefined ? req.body.biography || null : coach.biography,
        socialLinks: req.body.socialLinks !== undefined ? (req.body.socialLinks ? JSON.parse(req.body.socialLinks) : null) : coach.socialLinks,
        qrCodePath,
      },
    });
  });

  res.json({ success: true, data: { coach: withId(updated) }, message: 'Coach updated' });
});

export const deleteCoach = asyncHandler(async (req, res) => {
  const coach = await prisma.coach.findUnique({ where: { id: req.params.id } });
  if (!coach) throw new ApiError(404, 'Coach not found');
  await prisma.coach.delete({ where: { id: req.params.id } });
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
    email: c.email || '',
    status: c.status,
    specialization: c.specialization || '',
    qualification: c.qualification || '',
    experienceYears: c.experienceYears ?? '',
    salary: c.salary ?? '',
    joiningDate: c.joiningDate ? new Date(c.joiningDate).toLocaleDateString('en-IN') : '',
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
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [header, ...rows.map((r) => columns.map((c) => escape(r[c.key])).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="coaches-${timestamp}.csv"`);
  return res.send(Buffer.from(csv, 'utf8'));
});

// ---------------------------
// Equipment / Tools
// ---------------------------

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

      quantity: quantity ? Number(quantity) : 0,
      availableQuantity: availableQuantity ? Number(availableQuantity) : 0,
      purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
      purchaseCost: purchaseCost ? Number(purchaseCost) : null,
      supplier: supplier || null,

      condition: condition || 'Good',
      location: location || null,
      rackNumber: rackNumber || null,
      status: status || 'Available',
      maintenance: maintenance || null,
      remarks: remarks || null,

      qrCodePath,
      barcodeValue: req.body.barcodeValue || null,

      order: order ? Number(order) : 0,
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
        quantity: req.body.quantity !== undefined ? Number(req.body.quantity) : existing.quantity,
        availableQuantity: req.body.availableQuantity !== undefined ? Number(req.body.availableQuantity) : existing.availableQuantity,
        purchaseDate: req.body.purchaseDate ? new Date(req.body.purchaseDate) : existing.purchaseDate,
        purchaseCost: req.body.purchaseCost !== undefined ? Number(req.body.purchaseCost) : existing.purchaseCost,
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
    equipmentCode: e.equipmentCode || '',
    title: e.title,
    category: e.category || '',
    status: e.status,
    condition: e.condition,
    quantity: e.quantity,
    availableQuantity: e.availableQuantity,
    location: e.location || '',
    rackNumber: e.rackNumber || '',
    supplier: e.supplier || '',
    purchaseDate: e.purchaseDate ? new Date(e.purchaseDate).toLocaleDateString('en-IN') : '',
    purchaseCost: e.purchaseCost ?? '',
    barcodeValue: e.barcodeValue || '',
    remarks: e.remarks || '',
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
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [header, ...rows.map((r) => columns.map((c) => escape(r[c.key])).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="equipment-${timestamp}.csv"`);
  return res.send(Buffer.from(csv, 'utf8'));
});

