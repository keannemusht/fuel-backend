import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Checking storage tanks...');
  const tanks = await prisma.storageTank.findMany();
  console.log('Current tanks:', tanks.map(t => ({ id: t.id, code: t.tankCode, name: t.name, site: (t as any).site, sloc: (t as any).slocCode })));

  // Update Senyiur tanks with appropriate sloc codes
  await prisma.storageTank.updateMany({
    where: { tankCode: 'MAIN_SENYIUR' },
    data: { site: 'SENYIUR', slocCode: 'MTK001', projectArea: 'SNY' } as any
  });
  await prisma.storageTank.updateMany({
    where: { tankCode: 'FT_101' },
    data: { site: 'SENYIUR', slocCode: 'FTK001', projectArea: 'SNY' } as any
  });
  await prisma.storageTank.updateMany({
    where: { tankCode: 'FT_102' },
    data: { site: 'SENYIUR', slocCode: 'FTK002', projectArea: 'SNY' } as any
  });

  // Ensure Muara Pahu tank exists
  const mphTank = await prisma.storageTank.findFirst({
    where: { tankCode: 'MAIN_MUARA_PAHU' }
  });

  if (!mphTank) {
    const created = await prisma.storageTank.create({
      data: {
        tankCode: 'MAIN_MUARA_PAHU',
        name: 'Main Tank Muara Pahu 01',
        capacityLiters: 40000.0,
        currentStockLiters: 0.0,
        minStockAlertLiters: 5000.0,
        fuelType: 'HIGH SPEED DIESEL / SOLAR B35',
        tankType: 'STATIONARY',
        site: 'MUARA_PAHU',
        slocCode: 'MTK003',
        projectArea: 'MPH'
      } as any
    });
    console.log('Created Muara Pahu tank:', created.name);
  } else {
    await prisma.storageTank.update({
      where: { id: mphTank.id },
      data: { site: 'MUARA_PAHU', slocCode: 'MTK003', projectArea: 'MPH' } as any
    });
    console.log('Updated Muara Pahu tank:', mphTank.name);
  }

  // Backfill existing FuelLog site to SENYIUR if null or empty
  const res = await prisma.fuelLog.updateMany({
    where: { site: { not: 'MUARA_PAHU' } } as any,
    data: { site: 'SENYIUR', slocCode: 'MTK001' } as any
  });
  console.log(`Backfilled ${res.count} logs with site: SENYIUR`);

  const updatedTanks = await prisma.storageTank.findMany();
  console.log('Updated tanks:', updatedTanks.map(t => ({ code: t.tankCode, name: t.name, site: (t as any).site, sloc: (t as any).slocCode })));
}

main().catch(console.error).finally(() => prisma.$disconnect());

