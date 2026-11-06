import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import path from 'path';

const prisma = new PrismaClient();

interface ExcelUnitRow {
  no: number | string;
  unitCode: string;
  category: string;
  hasHm: boolean;
  hasKm: boolean;
  hasKwh: boolean;
  notes?: string;
}

function deduceType(code: string): string {
  const c = code.toUpperCase().trim();
  if (c.startsWith('PM')) return 'DOUBLE_TRAILER';
  if (c.startsWith('LV')) return 'LIGHT_VEHICLE';
  if (c.startsWith('GS')) return 'GENERATOR';
  if (c.startsWith('AM')) return 'SUPPORT_VEHICLE';
  if (c.startsWith('TH')) return 'SUPPORT_VEHICLE';
  if (c.startsWith('WT')) return 'SUPPORT_VEHICLE';
  if (c.startsWith('FT')) return 'SUPPORT_VEHICLE';
  if (c.startsWith('ST')) return 'SUPPORT_VEHICLE';
  if (c.startsWith('CT')) return 'SUPPORT_VEHICLE';
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
  console.log('=== Synchronizing Units from Improvement Refuelling new.xlsx ===');

  const filePath = path.resolve('backend/excel/Improvement Refuelling new.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheet = workbook.getWorksheet('Kode Unit Senyiur');
  if (!sheet) {
    throw new Error('Sheet "Kode Unit Senyiur" not found in Excel!');
  }

  const excelUnits: ExcelUnitRow[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber < 3) return; // Skip headers (rows 1 & 2)

    const no = row.getCell(1).value;
    const rawUnitCode = row.getCell(2).value;
    const rawCategory = row.getCell(3).value;
    const rawHm = row.getCell(4).value;
    const rawKm = row.getCell(5).value;
    const rawKwh = row.getCell(6).value;
    const rawNotes = row.getCell(7).value;

    if (!rawUnitCode) return;
    const unitCodeStr = String(rawUnitCode).trim();
    if (!unitCodeStr || unitCodeStr.toLowerCase() === 'no unit') return;

    const isChecked = (val: any) => {
      if (!val) return false;
      const s = String(val).trim().toLowerCase();
      return s.includes('√') || s === 'v' || s === '1' || s === 'true' || s === 'ya';
    };

    excelUnits.push({
      no: no ? String(no) : rowNumber - 2,
      unitCode: unitCodeStr,
      category: normalizeCategory(rawCategory ? String(rawCategory) : ''),
      hasHm: isChecked(rawHm),
      hasKm: isChecked(rawKm),
      hasKwh: isChecked(rawKwh),
      notes: rawNotes ? String(rawNotes).trim() : undefined,
    });
  });

  console.log(`Extracted ${excelUnits.length} active units from sheet "Kode Unit Senyiur".`);

  const activeCodesSet = new Set<string>();

  let createdCount = 0;
  let updatedCount = 0;

  for (const item of excelUnits) {
    const code = item.unitCode;
    activeCodesSet.add(code.toUpperCase());

    const type = deduceType(code);
    const makeModel = deduceMakeModel(code, item.category);

    const existing = await prisma.unit.findUnique({
      where: { unitCode: code },
    });

    if (existing) {
      await prisma.unit.update({
        where: { id: existing.id },
        data: {
          category: item.category,
          type,
          makeModel: existing.makeModel || makeModel,
          hasHm: item.hasHm,
          hasKm: item.hasKm,
          hasKwh: item.hasKwh,
          isActive: true,
        },
      });
      updatedCount++;
    } else {
      await prisma.unit.create({
        data: {
          unitCode: code,
          category: item.category,
          type,
          makeModel,
          hasHm: item.hasHm,
          hasKm: item.hasKm,
          hasKwh: item.hasKwh,
          isActive: true,
          lastKm: 0.0,
          lastHm: 0.0,
          lastKwh: 0.0,
        },
      });
      createdCount++;
    }
  }

  // Deactivate all units in DB that are not in the official Excel list
  const allDbUnits = await prisma.unit.findMany({
    select: { id: true, unitCode: true, isActive: true },
  });

  let deactivatedCount = 0;
  for (const dbUnit of allDbUnits) {
    if (!activeCodesSet.has(dbUnit.unitCode.toUpperCase())) {
      if (dbUnit.isActive) {
        await prisma.unit.update({
          where: { id: dbUnit.id },
          data: { isActive: false },
        });
        deactivatedCount++;
      }
    }
  }

  console.log(`\nSync Summary:`);
  console.log(`- Units Created: ${createdCount}`);
  console.log(`- Units Updated: ${updatedCount}`);
  console.log(`- Historical Units Deactivated (Hidden from active list/dropdown): ${deactivatedCount}`);
  console.log(`- Total Active Units in System: ${activeCodesSet.size}`);
  console.log(`✓ Unit synchronization complete!`);
}

main()
  .catch((err) => {
    console.error('Error during unit synchronization:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

