import prisma from '../config/db.js';

const achievements = [
  { labelEn: 'Champions Trained', labelHi: 'प्रशिक्षित चैंपियन', value: 250, suffix: '+', displayOrder: 1 },
  { labelEn: 'Medals Won', labelHi: 'जीते गए पदक', value: 180, suffix: '+', displayOrder: 2 },
  { labelEn: 'National Players', labelHi: 'राष्ट्रीय खिलाड़ी', value: 45, suffix: '+', displayOrder: 3 },
  { labelEn: 'Years of Excellence', labelHi: 'श्रेष्ठता के वर्ष', value: 30, suffix: '+', displayOrder: 4 },
];

const sessions = [
  {
    key: 'morning',
    titleEn: 'Morning Session',
    titleHi: 'प्रातः सत्र',
    timeEn: '4:30 AM – 8:30 AM',
    timeHi: '4:30 AM – 8:30 AM',
    noteEn: 'Endurance, running, and core wrestling practice.',
    noteHi: 'सहनशक्ति, दौड़ और मूल कुश्ती अभ्यास।',
    displayOrder: 1,
  },
  {
    key: 'evening',
    titleEn: 'Evening Session',
    titleHi: 'सायं सत्र',
    timeEn: '4:30 PM – 7:00 PM',
    timeHi: '4:30 PM – 7:00 PM',
    noteEn: 'Technique, strength, sparring, and conditioning.',
    noteHi: 'तकनीक, शक्ति, स्पैरिंग और कंडीशनिंग।',
    displayOrder: 2,
  },
  {
    key: 'sunday',
    titleEn: 'Sunday',
    titleHi: 'रविवार',
    timeEn: 'Holiday / Recovery Day',
    timeHi: 'अवकाश / रिकवरी दिवस',
    noteEn: 'Rest, recovery, and mental reset.',
    noteHi: 'विश्राम, रिकवरी और मानसिक संतुलन।',
    displayOrder: 3,
  },
];

const days = [
  {
    dayKey: 'monday',
    labelEn: 'Monday',
    labelHi: 'सोमवार',
    morningEn: 'Running, Wrestling Practice, Strength Training',
    morningHi: 'दौड़, कुश्ती अभ्यास, शक्ति प्रशिक्षण',
    eveningEn: 'Wrestling Techniques, Strength Training',
    eveningHi: 'कुश्ती तकनीक, शक्ति प्रशिक्षण',
    displayOrder: 1,
  },
  {
    dayKey: 'tuesday',
    labelEn: 'Tuesday',
    labelHi: 'मंगलवार',
    morningEn: 'Running, Wrestling Techniques',
    morningHi: 'दौड़, कुश्ती तकनीक',
    eveningEn: 'Wrestling Techniques, Sports & Games',
    eveningHi: 'कुश्ती तकनीक, खेल एवं गेम्स',
    displayOrder: 2,
  },
  {
    dayKey: 'wednesday',
    labelEn: 'Wednesday',
    labelHi: 'बुधवार',
    morningEn: 'Running, Wrestling Practice, Strength Training',
    morningHi: 'दौड़, कुश्ती अभ्यास, शक्ति प्रशिक्षण',
    eveningEn: 'Wrestling Practice, Gym Training',
    eveningHi: 'कुश्ती अभ्यास, जिम प्रशिक्षण',
    displayOrder: 3,
  },
  {
    dayKey: 'thursday',
    labelEn: 'Thursday',
    labelHi: 'गुरुवार',
    morningEn: 'Running, Wrestling Techniques',
    morningHi: 'दौड़, कुश्ती तकनीक',
    eveningEn: 'Wrestling Techniques, Strength Training',
    eveningHi: 'कुश्ती तकनीक, शक्ति प्रशिक्षण',
    displayOrder: 4,
  },
  {
    dayKey: 'friday',
    labelEn: 'Friday',
    labelHi: 'शुक्रवार',
    morningEn: 'Running, Wrestling Practice, Endurance Training',
    morningHi: 'दौड़, कुश्ती अभ्यास, सहनशक्ति प्रशिक्षण',
    eveningEn: 'Sparring Practice, Gym Training',
    eveningHi: 'स्पैरिंग अभ्यास, जिम प्रशिक्षण',
    displayOrder: 5,
  },
  {
    dayKey: 'saturday',
    labelEn: 'Saturday',
    labelHi: 'शनिवार',
    morningEn: 'Cross Country, Wrestling Techniques',
    morningHi: 'क्रॉस कंट्री, कुश्ती तकनीक',
    eveningEn: 'Cross Country, Wrestling Techniques, Gym Training',
    eveningHi: 'क्रॉस कंट्री, कुश्ती तकनीक, जिम प्रशिक्षण',
    displayOrder: 6,
  },
  {
    dayKey: 'sunday',
    labelEn: 'Sunday',
    labelHi: 'रविवार',
    morningEn: 'Holiday / Recovery',
    morningHi: 'अवकाश / रिकवरी',
    eveningEn: 'Holiday / Recovery',
    eveningHi: 'अवकाश / रिकवरी',
    isHoliday: true,
    displayOrder: 7,
  },
];

export async function seedScheduleAchievements() {
  for (const item of achievements) {
    const existing = await prisma.achievement.findFirst({
      where: { labelEn: item.labelEn },
    });
    if (existing) {
      await prisma.achievement.update({ where: { id: existing.id }, data: item });
    } else {
      await prisma.achievement.create({ data: item });
    }
  }

  for (const item of sessions) {
    await prisma.scheduleSession.upsert({
      where: { key: item.key },
      update: item,
      create: item,
    });
  }

  for (const item of days) {
    await prisma.scheduleDay.upsert({
      where: { dayKey: item.dayKey },
      update: item,
      create: item,
    });
  }

  return {
    achievements: achievements.length,
    sessions: sessions.length,
    days: days.length,
  };
}

async function main() {
  const result = await seedScheduleAchievements();
  console.log('Schedule & Achievements seeded:', result);
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').includes('seedScheduleAchievements')) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
