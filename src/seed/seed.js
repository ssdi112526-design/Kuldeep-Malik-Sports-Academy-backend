import dotenv from 'dotenv';
dotenv.config();

import bcrypt from 'bcryptjs';
import prisma, { connectDB } from '../config/db.js';

const services = [
  {
    title: 'Repossession',
    description:
      'All Finance Assets Including Cars, Commercial Vehicles, Two-Wheelers, Three-Wheelers, Trucks, Tempo, Earthmoving Equipment, Generators, Machinery & More. Professional Legal Recovery & Parking Repossession Solutions.',
    icon: 'FaCarSide',
    slug: 'repossession',
    order: 1,
  },
  {
    title: 'Collection Debt',
    description:
      'KARTIK REPOSSESSION AGENCY is an authorized debt collection and recovery agency operating in New Delhi.',
    icon: 'FaHandHoldingUsd',
    slug: 'collection-debt',
    order: 2,
  },
  {
    title: 'Parking',
    description:
      'All Finance Assets Including Cars, Commercial Cars, Two-Wheelers, Three-Wheelers, Trucks, Tempo, Earthmoving Equipment, Generators, Machine Etc. Finance Assets Legal Parking Point Partner.',
    icon: 'FaParking',
    slug: 'parking',
    order: 3,
  },
];

const products = [
  { title: 'Cars', description: 'Legal repossession and recovery of financed passenger vehicles.', icon: 'FaCar', order: 1 },
  { title: 'Commercial Vehicles', description: 'Professional recovery of commercial vehicles and transport fleets.', icon: 'FaTruck', order: 2 },
  { title: 'Two Wheelers', description: 'Fast and secure repossession of bikes and scooters.', icon: 'FaMotorcycle', order: 3 },
  { title: 'Three Wheelers', description: 'Reliable recovery services for financed auto rickshaws.', icon: 'FaTaxi', order: 4 },
  { title: 'Truck & Tempo', description: 'Heavy commercial vehicle recovery with trained professionals.', icon: 'FaTruckMoving', order: 5 },
  { title: 'Earthmoving', description: 'Recovery of JCB, Excavator and heavy earthmoving equipment.', icon: 'FaHardHat', order: 6 },
  { title: 'Generators', description: 'Secure generator recovery for financial institutions.', icon: 'FaBolt', order: 7 },
  { title: 'Industrial Machinery', description: 'Professional machinery repossession and transportation.', icon: 'FaIndustry', order: 8 },
];

const partners = [
  { name: 'Yes Bank Limited', type: 'Bank', status: 'Active Partner', order: 1 },
  { name: 'Utkarsh Small Finance Bank', type: 'Bank', status: 'Active Partner', order: 2 },
  { name: 'Cholamandalam DBS', type: 'NBFC', status: 'Active Partner', order: 3 },
  { name: 'Shriram Transport Finance', type: 'NBFC', status: 'Active Partner', order: 4 },
  { name: 'IndusInd Bank Limited', type: 'Bank', status: 'Active Partner', order: 5 },
  { name: 'RBL Bank Limited', type: 'Bank', status: 'Active Partner', order: 6 },
  { name: 'SK Finance Limited', type: 'Finance', status: 'Active Partner', order: 7 },
  { name: 'HDB Financial Services', type: 'NBFC', status: 'Active Partner', badge: 'CV/Auto', order: 8 },
  { name: 'Mahindra & Mahindra Financial', type: 'NBFC', status: 'Active Partner', order: 9 },
  { name: 'Magma Fincorp Limited', type: 'NBFC', status: 'Active Partner', order: 10 },
  { name: 'L&T Finance Limited', type: 'Finance', status: 'Active Partner', order: 11 },
  { name: 'Kotak Mahindra Bank', type: 'Bank', status: 'Active Partner', order: 12 },
  { name: 'R.B. Finance', type: 'Finance', status: 'Active Partner', order: 13 },
  { name: 'Reliance Consumer Finance', type: 'NBFC', status: 'Active Partner', order: 14 },
  { name: 'Tata Motor Finance Limited', type: 'Finance', status: 'Active Partner', order: 15 },
  { name: 'Tata Motor Finance Solutions', type: 'Finance', status: 'Active Partner', order: 16 },
  { name: 'Hinduja Leyland Finance', type: 'NBFC', status: 'Active Partner', order: 17 },
  { name: 'Futter Capital Limited', type: 'Finance', status: 'Active Partner', order: 18 },
  { name: 'ORIX Leasing & Finance', type: 'NBFC', status: 'Active Partner', badge: 'CV/Auto', order: 19 },
  { name: 'Home Credit India Finance', type: 'Finance', status: 'Active Partner', order: 20 },
  { name: 'Anmol Financial Services', type: 'Finance', status: 'Active Partner', order: 21 },
  { name: 'Indiabulls Financial Services Ltd', type: 'Finance', status: 'Active Partner', order: 22 },
  { name: 'India Infoline Finance Ltd (IIFL Finance)', type: 'Finance', status: 'Active Partner', order: 23 },
  { name: 'Software Solutions Development India', type: 'Web Development', status: 'Active Partner', order: 24 },
];

const team = [
  {
    role: 'Operations Manager',
    experience: '15+ Years Experience',
    description: 'Managing recovery operations and client coordination professionally.',
    icon: 'FaUserTie',
    order: 1,
  },
  {
    role: 'Recovery Supervisor',
    experience: '10+ Years Experience',
    description: 'Supervising repossession teams with complete legal compliance.',
    icon: 'FaUserShield',
    order: 2,
  },
  {
    role: 'Legal Officer',
    experience: 'Legal Documentation',
    description: 'Complete documentation and legal process management.',
    icon: 'FaBalanceScale',
    order: 3,
  },
  {
    role: 'Customer Support',
    experience: '24×7 Assistance',
    description: 'Always available for finance companies and recovery support. Call +91 96540 08500.',
    icon: 'FaHeadset',
    order: 4,
  },
];

const coverage = [
  { state: 'Delhi NCR', city: 'New Delhi', status: 'Active', isHQ: true, order: 1 },
  { state: 'Uttar Pradesh', city: 'Lucknow', status: 'Active', order: 2 },
  { state: 'Haryana', city: 'Gurugram', status: 'Active', order: 3 },
  { state: 'Rajasthan', city: 'Jaipur', status: 'Active', order: 4 },
  { state: 'Punjab', city: 'Chandigarh', status: 'Active', order: 5 },
  { state: 'Maharashtra', city: 'Mumbai', status: 'Active', order: 6 },
  { state: 'Telangana', city: 'Hyderabad', status: 'Active', order: 7 },
  { state: 'Karnataka', city: 'Bengaluru', status: 'Active', order: 8 },
  { state: 'Gujarat', city: 'Ahmedabad', status: 'Active', order: 9 },
  { state: 'Madhya Pradesh', city: 'Bhopal', status: 'Active', order: 10 },
  { state: 'Bihar', city: 'Patna', status: 'Active', order: 11 },
  { state: 'Tamil Nadu', city: 'Chennai', status: 'Active', order: 12 },
  { state: 'West Bengal', city: 'Kolkata', status: 'Active', order: 13 },
  { state: 'Andhra Pradesh', city: 'Visakhapatnam', status: 'Active', order: 14 },
  { state: 'Uttarakhand', city: 'Dehradun', status: 'Active', order: 15 },
  { state: 'Jharkhand', city: 'Ranchi', status: 'Active', order: 16 },
  { state: 'Chhattisgarh', city: 'Raipur', status: 'Active', order: 17 },
  { state: 'Odisha', city: 'Bhubaneswar', status: 'Active', order: 18 },
  { state: 'Assam', city: 'Guwahati', status: 'Active', order: 19 },
  { state: 'Kerala', city: 'Kochi', status: 'Active', order: 20 },
  { state: 'Himachal Pradesh', city: 'Shimla', status: 'Active', order: 21 },
  { state: 'Jammu & Kashmir', city: 'Jammu', status: 'Active', order: 22 },
  { state: 'Goa', city: 'Panaji', status: 'Active', order: 23 },
  { state: 'Tripura', city: 'Agartala', status: 'Active', order: 24 },
  { state: 'Meghalaya', city: 'Shillong', status: 'Active', order: 25 },
  { state: 'Manipur', city: 'Imphal', status: 'Active', order: 26 },
  { state: 'Nagaland', city: 'Kohima', status: 'Active', order: 27 },
  { state: 'Sikkim', city: 'Gangtok', status: 'Growing', order: 28 },
];

const faqs = [
  {
    question: 'Are your repossession operations legally compliant?',
    answer:
      'Yes. All recovery operations follow applicable Indian laws, RBI guidelines, and lender policies. Our teams complete legal documentation including seizure memos and inventory records at every stage.',
    order: 1,
  },
  {
    question: 'How quickly can your field team be deployed?',
    answer:
      'Our field teams operate 24/7 across India. In most coverage cities we can initiate deployment within hours of case allocation, subject to documentation and jurisdiction.',
    order: 2,
  },
  {
    question: 'What types of assets do you recover?',
    answer:
      'We recover cars, commercial vehicles, two-wheelers, three-wheelers, trucks, tempos, earthmoving equipment, generators, industrial machinery, and other financed assets.',
    order: 3,
  },
  {
    question: 'Which banks and NBFC do you work with?',
    answer:
      'We are an authorised recovery partner for leading banks, NBFCs, and financial institutions including Yes Bank, IndusInd, Kotak, HDB, Mahindra Finance, Tata Motors Finance, and many more.',
    order: 4,
  },
  {
    question: 'Do you provide post-repossession yard storage?',
    answer:
      'Yes. We provide secure parking yard facilities with 24×7 monitoring for finance assets until release or further instructions from the lender.',
    order: 5,
  },
  {
    question: 'How do lenders track case progress?',
    answer:
      'We provide daily status updates, digital inventory photos, GPS-backed field reporting, and complete recovery reports for transparent case tracking.',
    order: 6,
  },
  {
    question: 'In which states do you operate?',
    answer:
      'We have active coverage across major states including Delhi NCR, UP, Haryana, Rajasthan, Maharashtra, Karnataka, Tamil Nadu, Gujarat, and more — with pan-India capability.',
    order: 7,
  },
  {
    question: 'How do we initiate a partnership with you?',
    answer:
      'Contact us via the form or call +91 96540 08400 / +91 96540 08500. Share your NPA portfolio requirements and our team will respond within one business day.',
    order: 8,
  },
];

const equipment = [
  { title: 'GPS Tracking', description: 'Real-time vehicle tracking for secure recovery operations.', icon: 'FaMapMarkerAlt', order: 1 },
  { title: 'Recovery Vehicle', description: 'Modern towing and recovery vehicles for every asset type.', icon: 'FaTruckPickup', order: 2 },
  { title: 'Digital Documentation', description: 'Photo and video evidence with complete recovery reports.', icon: 'FaFileAlt', order: 3 },
  { title: 'Professional Toolkit', description: 'Certified recovery tools ensuring damage-free operations.', icon: 'FaTools', order: 4 },
  { title: 'Secure Parking Yard', description: 'Safe parking facilities with 24×7 monitoring.', icon: 'FaWarehouse', order: 5 },
  { title: '24×7 Communication', description: 'Continuous coordination with banks, NBFCs and clients.', icon: 'FaPhoneAlt', order: 6 },
];

const seed = async () => {
  try {
    await connectDB();

    await prisma.$transaction([
      prisma.contact.deleteMany(),
      prisma.user.deleteMany(),
      prisma.service.deleteMany(),
      prisma.product.deleteMany(),
      prisma.partner.deleteMany(),
      prisma.teamMember.deleteMany(),
      prisma.coverageArea.deleteMany(),
      prisma.fAQ.deleteMany(),
      prisma.equipment.deleteMany(),
    ]);

    const adminEmail = process.env.ADMIN_EMAIL || 'admin@kartikrepossession.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123456';
    const hashed = await bcrypt.hash(adminPassword, 12);

    await prisma.user.create({
      data: {
        name: 'Admin',
        email: adminEmail.toLowerCase(),
        password: hashed,
        role: 'admin',
      },
    });

    await prisma.service.createMany({ data: services });
    await prisma.product.createMany({ data: products });
    await prisma.partner.createMany({ data: partners });
    await prisma.teamMember.createMany({ data: team });
    await prisma.coverageArea.createMany({ data: coverage });
    await prisma.fAQ.createMany({ data: faqs });
    await prisma.equipment.createMany({ data: equipment });

    console.log('Database seeded successfully');
    console.log(`Admin: ${adminEmail}`);
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Seed failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
};

seed();
