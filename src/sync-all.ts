import dotenv from 'dotenv';
dotenv.config();

import { GoogleSheetsService } from './services/googleSheets.service.js';
import { prisma } from './config/prisma.js';
import { SyncStatus } from '@prisma/client';
import { SpreadsheetRowData } from './types/index.js';

async function syncAllExistingLogs() {
  console.log('--- SYNCING ALL FUEL LOGS TO GOOGLE SHEETS ---');
  const logs = await prisma.fuelLog.findMany({
    orderBy: { no: 'asc' },
  });

  console.log(`Found ${logs.length} total Fuel Logs in database.`);

  for (const log of logs) {
    const payload: SpreadsheetRowData = {
      no: log.no,
      unitCode: log.unitCode,
      category: log.category,
      date: log.dateStr,
      jam: log.jamStr,
      hm: log.currentHm,
      km: log.currentKm,
      qtyOut: log.volumeLiters,
      shift: log.shift,
      operator: log.operator,
      fuelIn: log.fuelInLiters,
      totalFuelOut: log.totalFuelOut,
      stockAkhir: log.stockAkhir,
      totalFuelIn: log.totalFuelIn,
      fuelman: log.fuelmanName,
    };

    console.log(`Syncing Row #${log.no} (Unit: ${log.unitCode})...`);
    const res = await GoogleSheetsService.appendFuelRow(payload);
    if (res.success) {
      await prisma.fuelLog.update({
        where: { id: log.id },
        data: { syncStatus: SyncStatus.SYNCED, syncedAt: new Date(), syncError: null },
      });
      console.log(`✓ Row #${log.no} SYNCED!`);
    } else {
      console.error(`✗ Row #${log.no} Failed:`, res.error);
    }
  }

  console.log('\n--- ALL LOGS SYNCED TO GOOGLE SHEETS SUCCESSFULLY ---');
  process.exit(0);
}

syncAllExistingLogs();
