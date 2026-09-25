import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Cleaning up database and seeding user accounts only...');

  // 1. Clean existing records in relation order
  await prisma.auditLog.deleteMany({});
  await prisma.syncQueue.deleteMany({});
  await prisma.fuelLog.deleteMany({});
  await prisma.unit.deleteMany({});
  await prisma.storageTank.deleteMany({});
  await prisma.user.deleteMany({});

  console.log('Cleared all logs, units, storage tanks, and previous accounts.');

  // 2. Hash passwords
  const adminPassword = await bcrypt.hash('admin123', 10);
  const fuelmanPassword = await bcrypt.hash('fuelman123', 10);

  // 3. Create Admin Account
  const admin = await prisma.user.create({
    data: {
      username: 'admin',
      email: 'admin@batarafuel.com',
      passwordHash: adminPassword,
      fullName: 'Chief Site Superintendent (Admin)',
      role: Role.ADMIN,
      isActive: true,
    },
  });

  // 4. Create Fuelman Account
  const fuelman = await prisma.user.create({
    data: {
      username: 'fuelman',
      email: 'fuelman@batarafuel.com',
      passwordHash: fuelmanPassword,
      fullName: 'Site Fuelman Officer',
      role: Role.FUELMAN,
      isActive: true,
    },
  });

  // 5. Create Default Storage Tanks
  const mainTank = await prisma.storageTank.create({
    data: {
      tankCode: 'TANK-MAIN-01',
      name: 'Main Storage Tank 01 (Solar B35)',
      capacityLiters: 50000.0,
      currentStockLiters: 45000.0,
      minStockAlertLiters: 5000.0,
      fuelType: 'HIGH SPEED DIESEL / SOLAR B35',
    },
  });

  const reserveTank = await prisma.storageTank.create({
    data: {
      tankCode: 'TANK-RES-02',
      name: 'Reserve Storage Tank 02 (Solar B35)',
      capacityLiters: 30000.0,
      currentStockLiters: 28000.0,
      minStockAlertLiters: 3000.0,
      fuelType: 'HIGH SPEED DIESEL / SOLAR B35',
    },
  });

  // 6. Create Initial Operational Fleet Units
  const initialUnits = [
    { unitCode: 'DT-101', category: 'DUMP_TRUCK' as const, lastKm: 42150.0, lastHm: 6320.5, makeModel: 'Scania P460 CB 8x4 Heavy Tipper' },
    { unitCode: 'DT-102', category: 'DUMP_TRUCK' as const, lastKm: 38400.0, lastHm: 5810.0, makeModel: 'Volvo FMX 440 6x4 Dump Truck' },
    { unitCode: 'EX-201', category: 'HEAVY_EQUIPMENT' as const, lastKm: 1200.0, lastHm: 7200.0, makeModel: 'Komatsu PC200-8 Hydraulic Excavator' },
    { unitCode: 'EX-301', category: 'HEAVY_EQUIPMENT' as const, lastKm: 1340.0, lastHm: 14280.0, makeModel: 'Komatsu PC2000-8 Mining Shovel' },
    { unitCode: 'GEN-01', category: 'GENERATOR' as const, lastKm: 0.0, lastHm: 11400.0, makeModel: 'Perkins 500 kVA Primary Camp Genset' },
    { unitCode: 'LV-01', category: 'LIGHT_VEHICLE' as const, lastKm: 85000.0, lastHm: 3140.0, makeModel: 'Toyota Hilux 4x4 Site Patrol' },
    { unitCode: 'WT-01', category: 'SUPPORT_VEHICLE' as const, lastKm: 54000.0, lastHm: 4100.0, makeModel: 'Hino 500 Water Truck 15kL' },
  ];

  for (const u of initialUnits) {
    await prisma.unit.create({
      data: {
        unitCode: u.unitCode,
        category: u.category,
        lastKm: u.lastKm,
        lastHm: u.lastHm,
        makeModel: u.makeModel,
        isActive: true,
      },
    });
  }

  console.log('Database successfully seeded with clean user credentials, tanks, and initial units:');
  console.log('----------------------------------------------------');
  console.log(`1. Admin:   username: "${admin.username}"   | password: "admin123" | role: ${admin.role}`);
  console.log(`2. Fuelman: username: "${fuelman.username}" | password: "fuelman123" | role: ${fuelman.role}`);
  console.log(`3. Tanks:   ${mainTank.tankCode} (${mainTank.capacityLiters} L), ${reserveTank.tankCode} (${reserveTank.capacityLiters} L)`);
  console.log(`4. Units:   ${initialUnits.map((u) => u.unitCode).join(', ')}`);
  console.log('----------------------------------------------------');
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
