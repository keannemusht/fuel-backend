import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import path from 'path';

const prisma = new PrismaClient();

function deduceType(code: string): string {
  const c = code.toUpperCase().trim();
  if (c.startsWith('PM')) return 'DOUBLE_TRAILER';
  if (c.startsWith('LV')) return 'LIGHT_VEHICLE';
  if (c.startsWith('GS')) return 'GENERATOR';
  if (c.startsWith('AM') || c.startsWith('TH') || c.startsWith('WT') || c.startsWith('FT') || c.startsWith('ST') || c.startsWith('CT')) {
    return 'SUPPORT_VEHICLE';
  }
  if (c === 'TRANSFER STOCK' || c === 'TRANSFER_STOCK') return 'STORAGE_TANK';
  if (c === 'OTHER CONSUMPTION' || c === 'OTHER') return 'OTHER';
  return 'SUPPORT_VEHICLE';
}

function deduceMakeModel(code: string, category: string): string {
  const c = code.toUpperCase().trim();
  if (c.startsWith('PM')) return 'Double Trailer Hauler';
  if (c.startsWith('LV') && c.includes('ARCO')) return 'Vendor Vehicle (ARCO)';
  if (c.startsWith('LV') && c.includes('BPU')) return 'Vendor Vehicle (BPU)';
  if (c.startsWith('LV') && c.includes('PDM')) return 'Vendor Vehicle (PDM)';
  if (c.startsWith('LV')) return 'Light Vehicle 4x4';
  if (c.startsWith('GS')) return 'Camp & Plant Generator';
  if (c.startsWith('AM')) return 'Site Emergency Ambulance';
  if (c.startsWith('TH')) return 'Tower Lamp / Lighting Tower';
  if (c.startsWith('WT')) return 'Water Truck 15kL';
  if (c.startsWith('FT 101')) return 'Fuel Truck 101 (20kL)';
  if (c.startsWith('FT 102')) return 'Fuel Truck 102 (20kL)';
  if (c.startsWith('ST')) return 'Storing / Service Truck';
  if (c.startsWith('CT')) return 'Crane Truck';
  if (c === 'OTHER CONSUMPTION') return 'Jerigen / Drum / Alat Khusus';
  if (c === 'TRANSFER STOCK') return 'Inter-Tank Stock Transfer';
  return 'Fleet Vehicle';
}

function normalizeCategory(rawCat: string): string {
  const c = (rawCat || '').trim().toLowerCase();
  if (c.includes('produksi')) return 'PRODUKSI';
  if (c.includes('support')) return 'SUPPORT';
  if (c.includes('vendor')) return 'VENDOR';
  if (c.includes('khusus') || c.includes('tidak terdaftar') || c.includes('other')) return 'OTHER';
  if (c.includes('fuel in') || c.includes('transfer')) return 'FUEL_IN';
  return 'SUPPORT';
}

async function main() {
  console.log('--- Idempotent Seed: Users, Tanks, and Official Senyiur Fleet Units ---');

  // SAFETY GUARD: Prevent accidental seed execution if database already has live operational data
  const existingUnitsCount = await prisma.unit.count();
  const existingLogsCount = await prisma.fuelLog.count();
  if (existingUnitsCount > 0 || existingLogsCount > 0) {
    console.log('\n======================================================');
    console.log('[SEED SAFETY GUARD ACTIVATED]');
    console.log('Database already contains LIVE operational records:');
    console.log(`  - Fleet Units: ${existingUnitsCount}`);
    console.log(`  - Fuel Logs:   ${existingLogsCount}`);
    console.log('Seed execution ABORTED to protect live database integrity.');
    console.log('Manage all real fleet units and tanks directly via Web UI (/units & /tanks).');
    console.log('======================================================\n');
    return;
  }

  // 1. Upsert Accounts
  const adminPassword = await bcrypt.hash('admin123', 10);
  const fuelmanPassword = await bcrypt.hash('fuelman123', 10);

  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      email: 'admin@batarafuel.com',
      passwordHash: adminPassword,
      fullName: 'Chief Site Superintendent (Admin)',
      role: Role.ADMIN,
      isActive: true,
    },
  });

  const fuelman = await prisma.user.upsert({
    where: { username: 'fuelman' },
    update: {},
    create: {
      username: 'fuelman',
      email: 'fuelman@batarafuel.com',
      passwordHash: fuelmanPassword,
      fullName: 'Site Fuelman Officer',
      role: Role.FUELMAN,
      isActive: true,
    },
  });

  console.log(`✓ Users verified: ${admin.username}, ${fuelman.username}`);

  // 2. Upsert Tanks
  const tanks = [
    {
      tankCode: 'MAIN_SENYIUR',
      name: 'Main Tank Senyiur (Solar B35)',
      capacityLiters: 40000.0,
      currentStockLiters: 40000.0,
      minStockAlertLiters: 5000.0,
      fuelType: 'HIGH SPEED DIESEL / SOLAR B35',
      tankType: 'STATIONARY',
      site: 'SENYIUR',
      slocCode: 'MTK001',
    },
    {
      tankCode: 'FT_101',
      name: 'Fuel Truck 101',
      capacityLiters: 20000.0,
      currentStockLiters: 3850.0,
      minStockAlertLiters: 2000.0,
      fuelType: 'HIGH SPEED DIESEL / SOLAR B35',
      tankType: 'MOBILE_TRUCK',
      site: 'SENYIUR',
      slocCode: 'MTK001',
    },
    {
      tankCode: 'FT_102',
      name: 'Fuel Truck 102',
      capacityLiters: 20000.0,
      currentStockLiters: 7500.0,
      minStockAlertLiters: 2000.0,
      fuelType: 'HIGH SPEED DIESEL / SOLAR B35',
      tankType: 'MOBILE_TRUCK',
      site: 'SENYIUR',
      slocCode: 'MTK001',
    },
    {
      tankCode: 'MAIN_MUARA_PAHU',
      name: 'Main Tank Muara Pahu 01',
      capacityLiters: 40000.0,
      currentStockLiters: 0.0,
      minStockAlertLiters: 5000.0,
      fuelType: 'HIGH SPEED DIESEL / SOLAR B35',
      tankType: 'STATIONARY',
      site: 'MUARA_PAHU',
      slocCode: 'MTK003',
    },
  ];

  for (const t of tanks) {
    await prisma.storageTank.upsert({
      where: { tankCode: t.tankCode },
      update: {
        site: t.site,
        slocCode: t.slocCode,
        fuelType: t.fuelType,
      },
      create: t,
    });
  }
  console.log(`✓ Tanks verified: ${tanks.map((t) => t.tankCode).join(', ')}`);

  // 3. Upsert Official Units from Excel sheet "Kode Unit Senyiur"
  const filePath = path.resolve('backend/excel/Improvement Refuelling new.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheet = workbook.getWorksheet('Kode Unit Senyiur');
  if (!sheet) {
    console.warn('Sheet "Kode Unit Senyiur" not found, skipping unit seeding.');
    return;
  }

  const unitRows: any[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber < 3) return;
    const rawUnitCode = row.getCell(2).value;
    const rawCategory = row.getCell(3).value;
    const rawHm = row.getCell(4).value;
    const rawKm = row.getCell(5).value;
    const rawKwh = row.getCell(6).value;

    if (!rawUnitCode) return;
    const code = String(rawUnitCode).trim();
    if (!code || code.toLowerCase() === 'no unit') return;

    const isChecked = (val: any) => {
      if (!val) return false;
      const s = String(val).trim().toLowerCase();
      return s.includes('√') || s === 'v' || s === '1' || s === 'true' || s === 'ya';
    };

    unitRows.push({
      unitCode: code,
      category: normalizeCategory(rawCategory ? String(rawCategory) : ''),
      type: deduceType(code),
      makeModel: deduceMakeModel(code, normalizeCategory(rawCategory ? String(rawCategory) : '')),
      hasHm: isChecked(rawHm),
      hasKm: isChecked(rawKm),
      hasKwh: isChecked(rawKwh),
      isActive: true,
    });
  });

  for (const u of unitRows) {
    await prisma.unit.upsert({
      where: { unitCode: u.unitCode },
      update: {
        category: u.category,
        type: u.type,
        makeModel: u.makeModel,
        hasHm: u.hasHm,
        hasKm: u.hasKm,
        hasKwh: u.hasKwh,
        isActive: true,
      },
      create: {
        unitCode: u.unitCode,
        category: u.category,
        type: u.type,
        makeModel: u.makeModel,
        hasHm: u.hasHm,
        hasKm: u.hasKm,
        hasKwh: u.hasKwh,
        isActive: true,
        lastKm: 0.0,
        lastHm: 0.0,
        lastKwh: 0.0,
      },
    });
  }

  console.log(`✓ Synchronized ${unitRows.length} authentic Senyiur units into database.`);
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
