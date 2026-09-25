import dotenv from 'dotenv';
dotenv.config();

import { google } from 'googleapis';
import { config } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { SyncStatus, UnitCategory } from '@prisma/client';

const MONTH_TABS = [
  { tab: 'JANUARI 2026', monthStr: '2026-01' },
  { tab: 'FEBRUARI 2026', monthStr: '2026-02' },
  { tab: 'MARET 2026', monthStr: '2026-03' },
  { tab: 'APRIL 2026', monthStr: '2026-04' },
  { tab: 'MEI 2026', monthStr: '2026-05' },
  { tab: 'JUNI 2026', monthStr: '2026-06' },
  { tab: 'JULI 2026', monthStr: '2026-07' },
  { tab: 'AGUSTUS 2026', monthStr: '2026-08' },
];

function normalizeCategory(raw: string): UnitCategory {
  const upper = (raw || '').toUpperCase().trim();
  if (upper.includes('DUMP') || upper.includes('DT')) return UnitCategory.DUMP_TRUCK;
  if (
    upper.includes('HEAVY') ||
    upper.includes('EXCAVATOR') ||
    upper.includes('DOZER') ||
    upper.includes('LOADER') ||
    upper.includes('GRADER')
  )
    return UnitCategory.HEAVY_EQUIPMENT;
  if (upper.includes('GEN')) return UnitCategory.GENERATOR;
  if (upper.includes('LIGHT') || upper.includes('LV') || upper.includes('PATROL')) return UnitCategory.LIGHT_VEHICLE;
  if (upper.includes('SUPPORT') || upper.includes('WATER') || upper.includes('FUEL')) return UnitCategory.SUPPORT_VEHICLE;
  return UnitCategory.DUMP_TRUCK;
}

function parseNum(val: any): number {
  if (!val) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const s = String(val).trim().replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function parseDate(rawDate: any, defaultMonth: string): string {
  if (!rawDate) return `${defaultMonth}-01`;
  const s = String(rawDate).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  return `${defaultMonth}-01`;
}

function parseTime(rawJam: any): string {
  if (!rawJam) return '12:00:00';
  const s = String(rawJam).trim();
  const parts = s.split(':');
  if (parts.length === 1) return `${parts[0].padStart(2, '0')}:00:00`;
  if (parts.length === 2) return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:00`;
  if (parts.length >= 3)
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:${parts[2].padStart(2, '0')}`;
  return '12:00:00';
}

async function syncAllSheetsToDb() {
  console.log('=======================================================');
  console.log('  STARTING DIRECT GOOGLE SHEETS -> PRISMA DB SYNC');
  console.log('=======================================================');

  // 1. Ensure StorageTank exists
  let defaultTank = await prisma.storageTank.findFirst({ where: { tankCode: 'TANK-MAIN-01' } });
  if (!defaultTank) {
    defaultTank = await prisma.storageTank.create({
      data: {
        tankCode: 'TANK-MAIN-01',
        name: 'Main Storage Tank 01 (Solar B35)',
        capacityLiters: 50000.0,
        currentStockLiters: 45000.0,
        minStockAlertLiters: 5000.0,
        fuelType: 'HIGH SPEED DIESEL / SOLAR B35',
      },
    });
  }

  // 2. Ensure User exists
  let admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (!admin) {
    admin = await prisma.user.findFirst();
  }
  if (!admin) {
    throw new Error('No user account found in database. Run npm run prisma:seed first.');
  }

  // 3. Connect to Google Sheets
  const auth = new google.auth.JWT({
    email: config.googleSheets.serviceAccountEmail,
    key: config.googleSheets.privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // In-memory Unit Cache
  const unitCache = new Map<string, { id: string; lastKm: number; lastHm: number }>();
  async function refreshUnitCache() {
    const existing = await prisma.unit.findMany();
    for (const u of existing) {
      unitCache.set(u.unitCode.trim().toUpperCase(), { id: u.id, lastKm: u.lastKm, lastHm: u.lastHm });
    }
  }
  await refreshUnitCache();

  let totalLogsImported = 0;
  let latestStockAkhir = defaultTank.currentStockLiters;

  for (const { tab, monthStr } of MONTH_TABS) {
    console.log(`\n>>> [${tab}] Fetching rows from Google Sheets...`);

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: config.googleSheets.spreadsheetId,
      range: `'${tab}'!A2:O`,
    });

    const rows = res.data.values || [];
    if (rows.length === 0) {
      console.log(`  Tab "${tab}" is empty.`);
      continue;
    }

    console.log(`  Found ${rows.length} rows in "${tab}".`);

    // Step A: Bulk register new Units
    const newUnitsMap = new Map<string, { unitCode: string; category: UnitCategory; lastKm: number; lastHm: number }>();
    for (const r of rows) {
      const unitCode = String(r[1] || '').trim();
      if (!unitCode) continue;
      const key = unitCode.toUpperCase();
      if (!unitCache.has(key) && !newUnitsMap.has(key)) {
        const category = normalizeCategory(r[2]);
        const km = parseNum(r[6]);
        const hm = parseNum(r[5]);
        newUnitsMap.set(key, { unitCode, category, lastKm: km, lastHm: hm });
      }
    }

    if (newUnitsMap.size > 0) {
      const newUnitsArray = Array.from(newUnitsMap.values()).map(nu => ({
        unitCode: nu.unitCode,
        category: nu.category,
        lastKm: nu.lastKm,
        lastHm: nu.lastHm,
        isActive: true,
      }));
      console.log(`  Bulk registering ${newUnitsArray.length} new fleet units...`);
      await prisma.unit.createMany({
        data: newUnitsArray,
        skipDuplicates: true,
      });
      await refreshUnitCache();
    }

    // Step B: Build FuelLog batch
    const logsToInsert = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const no = parseInt(String(r[0] || '0').replace(/\D/g, ''), 10) || (i + 1);
      const rawUnitCode = String(r[1] || 'UNKNOWN').trim();
      const unitInfo = unitCache.get(rawUnitCode.toUpperCase());
      if (!unitInfo || !unitInfo.id) continue;

      const dateStr = parseDate(r[3], monthStr);
      const jamStr = parseTime(r[4]);
      const hm = parseNum(r[5]);
      const km = parseNum(r[6]);
      const qtyOut = parseNum(r[7]);
      const shift = String(r[8] || '1').trim();
      const operator = String(r[9] || '-').trim();
      const fuelIn = parseNum(r[10]);
      const totalFuelOut = parseNum(r[11]);
      const stockAkhir = parseNum(r[12]);
      const totalFuelIn = parseNum(r[13]);
      const fuelmanName = String(r[14] || admin.fullName).trim() || admin.fullName;

      if (stockAkhir > 0) {
        latestStockAkhir = stockAkhir;
      }

      if (km > unitInfo.lastKm) unitInfo.lastKm = km;
      if (hm > unitInfo.lastHm) unitInfo.lastHm = hm;

      let dispensedAt = new Date();
      try {
        const parsed = new Date(`${dateStr}T${jamStr}`);
        if (!isNaN(parsed.getTime())) dispensedAt = parsed;
      } catch {}

      const dateClean = dateStr.replace(/-/g, '');
      const logNumber = `LOG-${dateClean}-${monthStr.replace('-', '')}-${String(no).padStart(6, '0')}-${i + 1}`;

      logsToInsert.push({
        logNumber,
        no,
        unitId: unitInfo.id,
        fuelmanId: admin.id,
        tankId: defaultTank.id,
        unitCode: rawUnitCode,
        category: String(r[2] || 'DUMP_TRUCK').trim(),
        dateStr,
        jamStr,
        previousHm: Math.max(0, hm > 0 ? hm - 1 : 0),
        currentHm: hm,
        deltaHm: 1.0,
        previousKm: Math.max(0, km > 0 ? km - 10 : 0),
        currentKm: km,
        deltaKm: 10.0,
        volumeLiters: qtyOut,
        shift,
        operator,
        fuelInLiters: fuelIn,
        totalFuelOut,
        stockAkhir,
        totalFuelIn,
        fuelmanName,
        bypassValidation: true,
        bypassReason: 'Historical Google Sheets Sync',
        dispensedAt,
        syncStatus: SyncStatus.SYNCED,
        syncedAt: new Date(),
      });
    }

    // Step C: Bulk insert FuelLog chunks of 500
    const chunkSize = 500;
    for (let c = 0; c < logsToInsert.length; c += chunkSize) {
      const chunk = logsToInsert.slice(c, c + chunkSize);
      await prisma.fuelLog.createMany({
        data: chunk,
        skipDuplicates: true,
      });
    }

    totalLogsImported += logsToInsert.length;
    console.log(`  ✓ Synced ${logsToInsert.length} records for ${tab} successfully!`);
  }

  // 4. Update StorageTank stock
  if (latestStockAkhir > 0) {
    await prisma.storageTank.update({
      where: { id: defaultTank.id },
      data: { currentStockLiters: latestStockAkhir },
    });
    console.log(`\n✓ Updated Main Tank current stock: ${latestStockAkhir.toLocaleString()} L`);
  }

  console.log('\n=======================================================');
  console.log(`  SYNC COMPLETED! Total records synced: ${totalLogsImported.toLocaleString()}`);
  console.log(`  Total Active Fleet Units: ${unitCache.size}`);
  console.log('=======================================================');
}

syncAllSheetsToDb()
  .catch((err) => {
    console.error('Fatal Sync Error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
