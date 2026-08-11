import dotenv from 'dotenv';
dotenv.config();
import prisma from '../src/config/db.js';

const r = await prisma.attendanceLocationSetting.updateMany({
  data: { name: 'Kuldeep Malik Sports Academy' },
});
console.log('location rows updated', r.count);
await prisma.$disconnect();
