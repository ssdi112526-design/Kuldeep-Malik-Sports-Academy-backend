import dotenv from 'dotenv';
dotenv.config();

import prisma from '../config/db.js';

export const WEBSITE_SETTING_KEY = 'website';

export const DEFAULT_WEBSITE_SETTINGS = {
  company: {
    name: 'Kuldeep Malik Sports Academy',
    address: 'Bhatgaon Road, Near Guru Sadan school Barwasni, Sonipat (Haryana)',
    phones: [],
    email: '',
  },
  social: [
    { label: 'Facebook', href: 'https://facebook.com', icon: 'FaFacebookF' },
    { label: 'Instagram', href: 'https://instagram.com', icon: 'FaInstagram' },
    { label: 'YouTube', href: 'https://youtube.com', icon: 'FaYoutube' },
    { label: 'X', href: 'https://x.com', icon: 'FaXTwitter' },
    { label: 'LinkedIn', href: 'https://linkedin.com', icon: 'FaLinkedinIn' },
  ],
  hero: {
    badgeEn: "India's Smart Digital Academy Platform",
    badgeHi: 'भारत का स्मार्ट डिजिटल अकादमी प्लेटफ़ॉर्म',
    titleEn: 'Build Champions. Preserve Tradition.',
    titleHi: 'चैंपियन तैयार करें। परंपरा को जीवित रखें।',
    subtitleEn:
      'Manage athletes, memberships, training, tournaments, attendance, and payments — all in one intelligent platform built for Indian Academies.',
    subtitleHi:
      'पहलवान, सदस्यता, प्रशिक्षण, दंगल, उपस्थिति और भुगतान — सब कुछ एक बुद्धिमान प्लेटफ़ॉर्म पर, भारतीय अकादमियों के लिए।',
    ctaPrimaryEn: 'Join Academy',
    ctaPrimaryHi: 'अकादमी से जुड़ें',
    ctaSecondaryEn: 'Explore Heritage',
    ctaSecondaryHi: 'विरासत जानें',
    image: null,
  },
  about: {
    eyebrowEn: 'About',
    eyebrowHi: 'हमारे बारे में',
    titleEn: 'Tradition meets',
    titleHi: 'जहाँ परंपरा मिलती है',
    highlightEn: 'modern excellence.',
    highlightHi: 'आधुनिक उत्कृष्टता से।',
    subtitleEn:
      'Kuldeep Malik Sports Academy unites disciplined athletic training with a clean digital operating system for every athlete and member.',
    subtitleHi:
      'कुलदीप मलिक स्पोर्ट्स अकादमी अनुशासित एथलेटिक प्रशिक्षण को हर खिलाड़ी और सदस्य के लिए स्वच्छ डिजिटल सिस्टम से जोड़ता है।',
    image: null,
  },
};

const defaultFeatures = [
  {
    titleEn: 'Athlete Profiles',
    titleHi: 'पहलवान प्रोफाइल',
    descriptionEn: 'Complete pehlwan records, progress history, and growth timelines.',
    descriptionHi: 'पूर्ण पहलवान रिकॉर्ड, प्रगति इतिहास और विकास यात्रा।',
    icon: 'FaUsers',
    displayOrder: 1,
  },
  {
    titleEn: 'Memberships',
    titleHi: 'सदस्यता',
    descriptionEn: 'Flexible plans, renewals, and clear status for every member.',
    descriptionHi: 'लचीली योजनाएँ, नवीनीकरण और हर सदस्य की स्पष्ट स्थिति।',
    icon: 'FaIdCard',
    displayOrder: 2,
  },
  {
    titleEn: 'Attendance',
    titleHi: 'उपस्थिति',
    descriptionEn: 'Reliable digital check-ins that match early-morning discipline.',
    descriptionHi: 'भरोसेमंद डिजिटल चेक-इन — सुबह के अनुशासन के अनुरूप।',
    icon: 'FaClipboardCheck',
    displayOrder: 3,
  },
  {
    titleEn: 'Training Plans',
    titleHi: 'प्रशिक्षण योजनाएँ',
    descriptionEn: 'Structured kushti, strength, and recovery programs by coaches.',
    descriptionHi: 'कोच द्वारा संरचित कुश्ती, शक्ति और रिकवरी कार्यक्रम।',
    icon: 'FaDumbbell',
    displayOrder: 4,
  },
  {
    titleEn: 'Analytics',
    titleHi: 'विश्लेषण',
    descriptionEn: 'Track strength, stamina, weight, and competition readiness.',
    descriptionHi: 'शक्ति, सहनशक्ति, वजन और प्रतियोगिता तत्परता ट्रैक करें।',
    icon: 'FaChartLine',
    displayOrder: 5,
  },
  {
    titleEn: 'Tournaments',
    titleHi: 'दंगल प्रबंधन',
    descriptionEn: 'Organize dangals, brackets, results, and rankings with ease.',
    descriptionHi: 'दंगल, ब्रैकेट, परिणाम और रैंकिंग आसानी से व्यवस्थित करें।',
    icon: 'FaTrophy',
    displayOrder: 6,
  },
  {
    titleEn: 'Coach Tools',
    titleHi: 'कोच टूल्स',
    descriptionEn: 'One dashboard for batches, schedules, and athlete insights.',
    descriptionHi: 'बैच, शेड्यूल और पहलवान अंतर्दृष्टि — एक डैशबोर्ड पर।',
    icon: 'FaChalkboardTeacher',
    displayOrder: 7,
  },
  {
    titleEn: 'Payments',
    titleHi: 'भुगतान',
    descriptionEn: 'Fees, dues, and receipts — transparent for families and admins.',
    descriptionHi: 'शुल्क, बकाया और रसीदें — परिवार और एडमिन के लिए पारदर्शी।',
    icon: 'FaCreditCard',
    displayOrder: 8,
  },
];

const defaultMembershipPlans = [
  {
    name: 'Monthly Training',
    description:
      'Full access to morning and evening sessions for one month, with attendance tracking and coach guidance.',
    priceLabel: '₹2,000 / month',
    benefits: JSON.stringify([
      'Daily morning & evening sessions',
      'Digital attendance',
      'Coach guidance',
      'Basic strength & conditioning',
    ]),
    displayOrder: 1,
    isActive: true,
  },
  {
    name: 'Quarterly Plan',
    description:
      'Three months of structured pehlwani training with progress reviews and membership priority.',
    priceLabel: '₹5,500 / quarter',
    benefits: JSON.stringify([
      'Everything in Monthly',
      'Progress reviews',
      'Priority batch placement',
      'Save vs monthly billing',
    ]),
    displayOrder: 2,
    isActive: true,
  },
  {
    name: 'Annual Championship',
    description:
      'Year-round academy membership for competition-focused athletes, including tournament prep support.',
    priceLabel: '₹20,000 / year',
    benefits: JSON.stringify([
      'Everything in Quarterly',
      'Competition peaking support',
      'Tournament prep guidance',
      'Best annual value',
    ]),
    displayOrder: 3,
    isActive: true,
  },
];

export async function seedCmsDefaults() {
  const featureCount = await prisma.feature.count();
  let featuresCreated = 0;
  if (featureCount === 0) {
    await prisma.feature.createMany({
      data: defaultFeatures.map((item) => ({
        ...item,
        image: null,
        isActive: true,
      })),
    });
    featuresCreated = defaultFeatures.length;
  }

  const planCount = await prisma.membershipPlan.count();
  let plansCreated = 0;
  if (planCount === 0) {
    await prisma.membershipPlan.createMany({
      data: defaultMembershipPlans.map((item) => ({
        ...item,
        image: null,
      })),
    });
    plansCreated = defaultMembershipPlans.length;
  }

  let siteSettingCreated = false;
  let siteSettingUpdated = false;
  const existingSetting = await prisma.siteSetting.findUnique({ where: { key: WEBSITE_SETTING_KEY } });
  if (!existingSetting) {
    await prisma.siteSetting.create({
      data: { key: WEBSITE_SETTING_KEY, value: DEFAULT_WEBSITE_SETTINGS },
    });
    siteSettingCreated = true;
  } else {
    const value = existingSetting.value && typeof existingSetting.value === 'object' ? existingSetting.value : {};
    const nextValue = {
      ...value,
      company: {
        ...(value.company || {}),
        ...DEFAULT_WEBSITE_SETTINGS.company,
      },
      about: {
        ...(value.about || {}),
        subtitleEn: DEFAULT_WEBSITE_SETTINGS.about.subtitleEn,
        subtitleHi: DEFAULT_WEBSITE_SETTINGS.about.subtitleHi,
      },
    };
    await prisma.siteSetting.update({
      where: { key: WEBSITE_SETTING_KEY },
      data: { value: nextValue },
    });
    siteSettingUpdated = true;
  }

  return {
    featuresCreated,
    featuresSkipped: featureCount > 0,
    membershipPlansCreated: plansCreated,
    membershipPlansSkipped: planCount > 0,
    siteSettingCreated,
    siteSettingUpdated,
    siteSettingExisted: Boolean(existingSetting),
  };
}

async function main() {
  const result = await seedCmsDefaults();
  console.log('CMS defaults seeded:', result);
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').includes('seedCmsDefaults')) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
