import { prisma } from './src/config/prisma.js';

async function main() {
  const units = await prisma.unit.findMany({
    select: {
      id: true,
      unitCode: true,
      category: true,
      plateNumber: true,
      makeModel: true,
      lastKm: true,
      lastHm: true,
      isActive: true,
      _count: {
        select: { fuelLogs: true }
      }
    },
    orderBy: { unitCode: 'asc' }
  });

  console.log(`Total units in DB: ${units.length}\n`);

  for (const u of units) {
    console.log(`"${u.unitCode}" [${u.category}] logs: ${u._count.fuelLogs} | KM: ${u.lastKm} | HM: ${u.lastHm}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
