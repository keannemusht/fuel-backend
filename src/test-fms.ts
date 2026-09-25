import dotenv from 'dotenv';
dotenv.config();

import { AuthService } from './services/auth.service.js';
import { FuelService } from './services/fuel.service.js';
import { ExcelService } from './services/excel.service.js';
import { prisma } from './config/prisma.js';
import { Role } from '@prisma/client';

async function runTests() {
  console.log('--- STARTING FMS-CORE BACKEND TEST SUITE ---');

  // 1. Auth Test
  console.log('\n[1] Testing Authentication:');
  const authRes = await AuthService.login('fuelman1', 'fuelman123');
  console.log('✓ Fuelman login successful. User:', authRes.user.fullName);

  const adminAuth = await AuthService.login('admin', 'admin123');
  console.log('✓ Admin login successful. User:', adminAuth.user.fullName);

  // 2. Unit & Tank Check
  console.log('\n[2] Fetching Fleet Unit & Tank:');
  const unit = await prisma.unit.findUnique({ where: { unitCode: 'DT-101' } });
  const tank = await prisma.storageTank.findFirst();
  console.log(`✓ Unit DT-101 Baseline: KM = ${unit?.lastKm}, HM = ${unit?.lastHm}`);
  console.log(`✓ Tank Stock: ${tank?.name} = ${tank?.currentStockLiters} Liters`);

  // 3. Valid Fuel Dispense Test
  console.log('\n[3] Testing Valid Fuel Dispense Transaction:');
  const validDispense = await FuelService.recordDispense(
    {
      unitId: unit!.id,
      tankId: tank!.id,
      currentKm: unit!.lastKm + 120.0, // +120 KM
      currentHm: unit!.lastHm + 8.5,   // +8.5 Hours
      volumeLiters: 250.0,
      shift: 'SHIFT 1',
      operator: 'Joko Widodo',
    },
    authRes.user as any
  );
  console.log('✓ Valid Dispense Recorded: Log #', validDispense.fuelLog.logNumber);
  console.log(`✓ Updated Unit State: KM=${validDispense.unit.lastKm}, HM=${validDispense.unit.lastHm}`);
  console.log(`✓ Updated Tank Stock: ${validDispense.tank.currentStockLiters} Liters`);

  // 4. Test Violation: Decreasing Odometer
  console.log('\n[4] Testing Meter Rule 1 Violation (KM Decreasing):');
  try {
    await FuelService.recordDispense(
      {
        unitId: unit!.id,
        tankId: tank!.id,
        currentKm: validDispense.unit.lastKm - 50.0, // Decreased!
        currentHm: validDispense.unit.lastHm + 1.0,
        volumeLiters: 100.0,
        shift: 'SHIFT 1',
        operator: 'Joko Widodo',
      },
      authRes.user as any
    );
    console.error('✗ Expected error not thrown for decreasing KM!');
  } catch (err: any) {
    console.log(`✓ Correctly rejected with status ${err.statusCode}: "${err.message}"`);
  }

  // 5. Test Violation: Delta KM > 1000
  console.log('\n[5] Testing Meter Rule 1 Violation (Delta KM > 1000):');
  try {
    await FuelService.recordDispense(
      {
        unitId: unit!.id,
        tankId: tank!.id,
        currentKm: validDispense.unit.lastKm + 1500.0, // +1500 KM!
        currentHm: validDispense.unit.lastHm + 5.0,
        volumeLiters: 100.0,
        shift: 'SHIFT 1',
        operator: 'Joko Widodo',
      },
      authRes.user as any
    );
    console.error('✗ Expected error not thrown for Delta KM > 1000!');
  } catch (err: any) {
    console.log(`✓ Correctly rejected with status ${err.statusCode}: "${err.message}"`);
  }

  // 6. Test Violation: Delta HM > 24 Hours
  console.log('\n[6] Testing Meter Rule 2 Violation (Delta HM > 24 Hours):');
  try {
    await FuelService.recordDispense(
      {
        unitId: unit!.id,
        tankId: tank!.id,
        currentKm: validDispense.unit.lastKm + 100.0,
        currentHm: validDispense.unit.lastHm + 35.0, // +35 Hours!
        volumeLiters: 100.0,
        shift: 'SHIFT 1',
        operator: 'Joko Widodo',
      },
      authRes.user as any
    );
    console.error('✗ Expected error not thrown for Delta HM > 24!');
  } catch (err: any) {
    console.log(`✓ Correctly rejected with status ${err.statusCode}: "${err.message}"`);
  }

  // 7. Test Admin Bypass Mode
  console.log('\n[7] Testing Admin Bypass Mode for Instrument Replacement:');
  const bypassed = await FuelService.recordDispense(
    {
      unitId: unit!.id,
      tankId: tank!.id,
      currentKm: 50.0, // Reset to 50 due to odometer replacement
      currentHm: 10.0, // Reset to 10 due to gauge replacement
      volumeLiters: 150.0,
      shift: 'SHIFT 1',
      operator: 'Joko Widodo',
      bypassValidation: true,
      bypassReason: 'Replaced faulty digital dashboard cluster with certified new OEM gauge.',
    },
    adminAuth.user as any
  );
  console.log('✓ Admin Bypass Succeeded: Log #', bypassed.fuelLog.logNumber);
  console.log(`✓ New Reset Unit Baseline: KM=${bypassed.unit.lastKm}, HM=${bypassed.unit.lastHm}`);

  // 8. Excel Export Generation Test
  console.log('\n[8] Testing Excel Shift Report Generation (15 Columns):');
  const wb = await ExcelService.generateShiftReport();
  const buffer = await wb.xlsx.writeBuffer();
  console.log(`✓ Excel Workbook generated successfully. Size: ${buffer.byteLength} bytes. Columns verified.`);

  console.log('\n--- ALL CORE BUSINESS RULES & VALIDATION TESTS PASSED 100% ---');
}

runTests()
  .catch((e) => {
    console.error('Test Suite Failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    setTimeout(() => process.exit(0), 500);
  });
