import { prisma } from '../config/prisma.js';

async function main() {
  console.log('Running bulk updates for storage tanks & unit meter rules...');

  // Update Tank 01 to Main Tank Senyiur
  await prisma.$executeRawUnsafe(`UPDATE "StorageTank" SET "name" = 'Main Tank Senyiur (Solar B35)', "tankCode" = 'MAIN_SENYIUR', "capacityLiters" = 40000, "tankType" = 'STATIONARY' WHERE "tankCode" = 'TANK-MAIN-01'`);

  // Ensure FT_101 exists
  const ft101 = await prisma.storageTank.findFirst({ where: { tankCode: 'FT_101' } });
  if (!ft101) {
    await prisma.storageTank.create({
      data: {
        tankCode: 'FT_101',
        name: 'Fuel Truck 101',
        capacityLiters: 20000,
        currentStockLiters: 4000,
        minStockAlertLiters: 2000,
        fuelType: 'HIGH SPEED DIESEL / SOLAR B35',
        tankType: 'MOBILE_TRUCK',
      },
    });
    console.log('Created FT_101 tank');
  }

  // Ensure FT_102 exists
  const ft102 = await prisma.storageTank.findFirst({ where: { tankCode: 'FT_102' } });
  if (!ft102) {
    await prisma.storageTank.create({
      data: {
        tankCode: 'FT_102',
        name: 'Fuel Truck 102',
        capacityLiters: 20000,
        currentStockLiters: 0,
        minStockAlertLiters: 2000,
        fuelType: 'HIGH SPEED DIESEL / SOLAR B35',
        tankType: 'MOBILE_TRUCK',
      },
    });
    console.log('Created FT_102 tank');
  }

  // Update Unit Rules in Bulk
  await prisma.$executeRawUnsafe(`UPDATE "Unit" SET "hasHm" = true, "hasKm" = true, "hasKwh" = false WHERE "unitCode" LIKE 'PM%'`);
  await prisma.$executeRawUnsafe(`UPDATE "Unit" SET "hasHm" = true, "hasKm" = false, "hasKwh" = true WHERE "unitCode" LIKE 'GS%'`);
  await prisma.$executeRawUnsafe(`UPDATE "Unit" SET "hasHm" = false, "hasKm" = true, "hasKwh" = false WHERE "unitCode" LIKE 'LV%' OR "unitCode" LIKE 'AM%' OR "unitCode" LIKE 'ST%' OR "unitCode" LIKE 'CT%' OR "unitCode" LIKE 'FT%'`);
  await prisma.$executeRawUnsafe(`UPDATE "Unit" SET "hasHm" = true, "hasKm" = false, "hasKwh" = false WHERE "unitCode" LIKE 'TH%'`);
  await prisma.$executeRawUnsafe(`UPDATE "Unit" SET "hasHm" = true, "hasKm" = true, "hasKwh" = false WHERE "unitCode" LIKE 'WT%'`);

  // Upsert 'OTHER' consumption unit
  await prisma.unit.upsert({
    where: { unitCode: 'OTHER' },
    update: { hasHm: false, hasKm: false, hasKwh: false, category: 'SUPPORT', type: 'SUPPORT_VEHICLE' },
    create: {
      unitCode: 'OTHER',
      category: 'SUPPORT',
      type: 'SUPPORT_VEHICLE',
      makeModel: 'Other Consumption (Jerigen / Drum)',
      hasHm: false,
      hasKm: false,
      hasKwh: false,
    },
  });

  // Upsert 'TRANSFER_STOCK' unit
  await prisma.unit.upsert({
    where: { unitCode: 'TRANSFER_STOCK' },
    update: { hasHm: false, hasKm: false, hasKwh: false, category: 'FUEL_IN', type: 'STORAGE_TANK' },
    create: {
      unitCode: 'TRANSFER_STOCK',
      category: 'FUEL_IN',
      type: 'STORAGE_TANK',
      makeModel: 'Stock Transfer Inter-Tank',
      hasHm: false,
      hasKm: false,
      hasKwh: false,
    },
  });

  const tanks = await prisma.storageTank.findMany({
    select: { tankCode: true, name: true, capacityLiters: true, tankType: true, currentStockLiters: true },
  });
  console.log('Tanks in Database:', tanks);

  const samplePm = await prisma.unit.findFirst({ where: { unitCode: 'PM 401' }, select: { unitCode: true, hasHm: true, hasKm: true, hasKwh: true } });
  const sampleLv = await prisma.unit.findFirst({ where: { unitCode: 'LV 501' }, select: { unitCode: true, hasHm: true, hasKm: true, hasKwh: true } });
  const sampleGs = await prisma.unit.findFirst({ where: { unitCode: 'GS 002' }, select: { unitCode: true, hasHm: true, hasKm: true, hasKwh: true } });
  console.log('Sample PM 401:', samplePm);
  console.log('Sample LV 501:', sampleLv);
  console.log('Sample GS 002:', sampleGs);

  console.log('✓ Successfully initialized customer storage tanks & meter rules!');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
