/**
 * Set NULL numeric columns to 0 (students / coaches / equipment).
 * Usage: node scripts/fillNullNumericsWithZero.js
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const students = await prisma.$executeRaw`
    UPDATE students SET
      height_cm = COALESCE(height_cm, 0),
      weight_kg = COALESCE(weight_kg, 0),
      chest = COALESCE(chest, 0),
      age = COALESCE(age, 0),
      attendance_total = COALESCE(attendance_total, 0),
      attendance_present = COALESCE(attendance_present, 0),
      attendance_absent = COALESCE(attendance_absent, 0)
  `;

  const coaches = await prisma.$executeRaw`
    UPDATE coaches SET
      experience_years = COALESCE(experience_years, 0),
      salary = COALESCE(salary, 0)
  `;

  const equipment = await prisma.$executeRaw`
    UPDATE equipment SET
      quantity = COALESCE(quantity, 0),
      available_quantity = COALESCE(available_quantity, 0),
      purchase_cost = COALESCE(purchase_cost, 0)
  `;

  console.log('Updated rows — students:', students, 'coaches:', coaches, 'equipment:', equipment);
}

run()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
