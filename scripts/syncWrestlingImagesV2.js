/**
 * Sync live CMS with v2 premium wrestling images (JPEG). Safe to re-run.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function upsertProgram(item) {
  const existing = await prisma.program.findFirst({
    where: { title: { equals: item.title, mode: 'insensitive' } },
  });
  if (existing) {
    await prisma.program.update({
      where: { id: existing.id },
      data: {
        description: item.description,
        image: item.image,
        displayOrder: item.displayOrder,
        isActive: true,
      },
    });
    console.log('program↑', item.title);
  } else {
    await prisma.program.create({ data: { ...item, isActive: true } });
    console.log('program+', item.title);
  }
}

async function upsertFacility(item) {
  const existing = await prisma.facility.findFirst({
    where: { name: { equals: item.name, mode: 'insensitive' } },
  });
  if (existing) {
    await prisma.facility.update({
      where: { id: existing.id },
      data: {
        description: item.description,
        image: item.image,
        displayOrder: item.displayOrder,
        isActive: true,
      },
    });
    console.log('facility↑', item.name);
  } else {
    await prisma.facility.create({ data: { ...item, isActive: true } });
    console.log('facility+', item.name);
  }
}

async function upsertGallery(item) {
  const existing = await prisma.galleryItem.findFirst({
    where: { title: { equals: item.title, mode: 'insensitive' } },
  });
  if (existing) {
    await prisma.galleryItem.update({
      where: { id: existing.id },
      data: {
        category: item.category,
        image: item.image,
        displayOrder: item.displayOrder,
      },
    });
    console.log('gallery↑', item.title);
  } else {
    await prisma.galleryItem.create({ data: item });
    console.log('gallery+', item.title);
  }
}

async function main() {
  // Hide junk CMS entries without deleting history
  await prisma.program.updateMany({
    where: { title: { equals: 'Testing', mode: 'insensitive' } },
    data: { isActive: false },
  });
  for (const title of ['test', 'jnadssafjsd']) {
    const rows = await prisma.galleryItem.findMany({
      where: { title: { equals: title, mode: 'insensitive' } },
    });
    for (const row of rows) {
      await prisma.galleryItem.delete({ where: { id: row.id } });
      console.log('gallery-deleted junk', title);
    }
  }

  const programs = [
    {
      title: 'Beginner Wrestling',
      description: 'Foundations of stance, grip, and discipline for new pehlwans.',
      image: '/uploads/seed-programs-beginner.jpg',
      displayOrder: 1,
    },
    {
      title: 'Strength Training',
      description: 'Jori, gada, and functional power built the pehlwani way.',
      image: '/uploads/seed-programs-strength-hd.jpg',
      displayOrder: 2,
    },
    {
      title: 'Mud Practice',
      description: 'Authentic kushti sessions in the mitti arena.',
      image: '/uploads/seed-programs-mud-hd.jpg',
      displayOrder: 3,
    },
    {
      title: 'Advanced Wrestling',
      description: 'Competition technique, counters, and match intelligence.',
      image: '/uploads/seed-programs-advanced.jpg',
      displayOrder: 4,
    },
    {
      title: 'Yoga & Mobility',
      description: 'Sunrise breathwork, flexibility, and recovery for lasting pehlwani power.',
      image: '/uploads/seed-programs-yoga.jpg',
      displayOrder: 5,
    },
  ];
  for (const p of programs) await upsertProgram(p);

  const facilities = [
    {
      name: 'Mud Arena',
      description: 'A sacred mitti pit prepared daily for authentic practice.',
      image: '/uploads/seed-facilities-mud.jpg',
      displayOrder: 1,
    },
    {
      name: 'Strength Gym',
      description: 'Modern racks and free weights alongside pehlwani power work.',
      image: '/uploads/seed-facilities-gym.jpg',
      displayOrder: 2,
    },
    {
      name: 'Wrestling Mats',
      description: 'Clean indoor mats for technique drills and competition prep.',
      image: '/uploads/seed-facilities-mats.jpg',
      displayOrder: 3,
    },
    {
      name: 'Changing Rooms',
      description: 'Hygienic lockers and changing space after every session.',
      image: '/uploads/seed-facilities-locker.jpg',
      displayOrder: 4,
    },
    {
      name: 'Outdoor Ground',
      description: 'Open yard for running, rope work, and dawn conditioning.',
      image: '/uploads/seed-facilities-outdoor.jpg',
      displayOrder: 5,
    },
    {
      name: 'Nutrition Support',
      description: 'Wholesome pehlwan diets guided with modern clarity.',
      image: '/uploads/seed-facilities-nutrition.jpg',
      displayOrder: 6,
    },
    {
      name: 'Recovery Area',
      description: 'Cool-down and cleansing rituals after intense sessions.',
      image: '/uploads/seed-facilities-recovery.jpg',
      displayOrder: 7,
    },
    {
      name: 'Drinking Water',
      description: 'Clean hydration point ready through long training days.',
      image: '/uploads/seed-facilities-water.jpg',
      displayOrder: 8,
    },
  ];
  for (const f of facilities) await upsertFacility(f);

  const gallery = [
    { title: 'Competition intensity', category: 'Competition', image: '/uploads/seed-gallery-competition.jpg', displayOrder: 1 },
    { title: 'Mud practice dawn', category: 'Mitti', image: '/uploads/seed-gallery-mitti.jpg', displayOrder: 2 },
    { title: 'Sunrise conditioning run', category: 'Conditioning', image: '/uploads/seed-gallery-running.jpg', displayOrder: 3 },
    { title: 'Rope climb power', category: 'Strength', image: '/uploads/seed-gallery-rope.jpg', displayOrder: 4 },
    { title: 'Jori club training', category: 'Strength', image: '/uploads/seed-gallery-jori.jpg', displayOrder: 5 },
    { title: 'Academy team spirit', category: 'Team', image: '/uploads/seed-gallery-team.jpg', displayOrder: 6 },
    { title: 'Medal ceremony glory', category: 'Achievement', image: '/uploads/seed-gallery-medal.jpg', displayOrder: 7 },
    { title: 'Yoga & mobility', category: 'Yoga', image: '/uploads/seed-gallery-yoga.jpg', displayOrder: 8 },
    { title: 'Recovery after practice', category: 'Recovery', image: '/uploads/seed-gallery-recovery.jpg', displayOrder: 9 },
    { title: 'Advanced technique', category: 'Technique', image: '/uploads/seed-gallery-action-1.jpg', displayOrder: 10 },
  ];
  for (const g of gallery) await upsertGallery(g);

  // Retarget leftover old gallery titles to unique assets
  const remaps = [
    { title: 'Technique under pressure', image: '/uploads/seed-gallery-jori.jpg' },
    { title: 'Breath, balance, recovery', image: '/uploads/seed-gallery-yoga.jpg' },
    { title: 'Traditional strength', image: '/uploads/seed-gallery-rope.jpg' },
    { title: 'Cleanse and rise again', image: '/uploads/seed-gallery-recovery.jpg' },
    { title: 'Rooted in the earth', image: '/uploads/seed-gallery-mitti.jpg' },
  ];
  for (const r of remaps) {
    await prisma.galleryItem.updateMany({
      where: { title: { equals: r.title, mode: 'insensitive' } },
      data: { image: r.image },
    });
  }

  console.log('v2 CMS sync complete');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
