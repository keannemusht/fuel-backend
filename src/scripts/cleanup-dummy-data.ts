import dotenv from 'dotenv';
dotenv.config();

import { google } from 'googleapis';
import { prisma } from '../config/prisma.js';

async function cleanupDummyData() {
  console.log('=======================================================');
  console.log('   STARTING SYSTEM & DB DUMMY DATA CLEANUP');
  console.log('=======================================================');

  // 1. Locate dummy tank
  const dummyTank = await prisma.storageTank.findFirst({
    where: {
      OR: [
        { tankCode: 'TANK MAIN 02' },
        { name: { contains: 'Main Storage Tank 02' } },
        { id: '88155b9f-fdff-4458-b0d8-c2dc199121a1' },
      ],
    },
  });

  if (dummyTank) {
    console.log(`[1] Found dummy tank: ${dummyTank.name} (${dummyTank.tankCode}) [ID: ${dummyTank.id}]`);

    // Find all fuel logs attached to this dummy tank
    const dummyLogs = await prisma.fuelLog.findMany({
      where: { tankId: dummyTank.id },
      select: { id: true, logNumber: true, unitCode: true },
    });
    const dummyLogIds = dummyLogs.map((l) => l.id);
    console.log(`[2] Found ${dummyLogs.length} dummy fuel logs:`, dummyLogs);

    if (dummyLogIds.length > 0) {
      // Delete from SyncQueue
      const delSync = await prisma.syncQueue.deleteMany({
        where: { entityId: { in: dummyLogIds } },
      });
      console.log(`[3] Removed ${delSync.count} sync queue records.`);

      // Delete from AuditLog for these logs
      const delAuditLogs = await prisma.auditLog.deleteMany({
        where: { entityId: { in: dummyLogIds } },
      });
      console.log(`[4] Removed ${delAuditLogs.count} audit logs for fuel logs.`);

      // Delete the fuel logs
      const delLogs = await prisma.fuelLog.deleteMany({
        where: { id: { in: dummyLogIds } },
      });
      console.log(`[5] Deleted ${delLogs.count} dummy fuel logs.`);
    }

    // Delete AuditLog for the tank itself
    const delTankAudit = await prisma.auditLog.deleteMany({
      where: { entityId: dummyTank.id },
    });
    console.log(`[6] Removed ${delTankAudit.count} audit logs for dummy tank.`);

    // Delete the tank itself
    await prisma.storageTank.delete({
      where: { id: dummyTank.id },
    });
    console.log(`[7] Successfully deleted dummy tank "${dummyTank.name}".`);
  } else {
    console.log('[1] No dummy tank found (already cleaned).');
  }

  // 2. Reset PM 401 odometer/hour meter to legitimate latest record
  const legitimatePm401Log = await prisma.fuelLog.findFirst({
    where: { unitCode: 'PM 401' },
    orderBy: { dispensedAt: 'desc' },
  });

  if (legitimatePm401Log) {
    await prisma.unit.update({
      where: { unitCode: 'PM 401' },
      data: {
        lastHm: legitimatePm401Log.currentHm,
        lastKm: legitimatePm401Log.currentKm,
      },
    });
    console.log(
      `[8] Restored unit PM 401 meter values to: HM = ${legitimatePm401Log.currentHm}, KM = ${legitimatePm401Log.currentKm}`
    );
  }

  // 3. Clean up Google Sheets tab 'OKTOBER 2026' if service account configured
  try {
    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_SPREADSHEET_ID) {
      console.log('\n[9] Checking Google Sheets tab "OKTOBER 2026"...');
      const auth = new google.auth.JWT({
        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      const sheets = google.sheets({ version: 'v4', auth });
      const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "'OKTOBER 2026'!A2:O",
      });

      const rows = res.data.values || [];
      const dummyLogNumbers = new Set(['R-2026-10-01-0001', 'F-2026-10-01-0001']);
      const validRows = rows.filter((r) => !dummyLogNumbers.has(r[0]));

      if (rows.length !== validRows.length) {
        console.log(`  Found ${rows.length - validRows.length} dummy rows in Google Sheets. Cleaning up...`);
        // Clear old range
        await sheets.spreadsheets.values.clear({
          spreadsheetId,
          range: "'OKTOBER 2026'!A2:O",
        });

        if (validRows.length > 0) {
          // Re-write valid rows
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: "'OKTOBER 2026'!A2:O",
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: validRows,
            },
          });
        }
        console.log(`  ✓ Google Sheets updated! Retained ${validRows.length} valid rows.`);
      } else {
        console.log('  Google Sheets already contains only valid rows.');
      }
    }
  } catch (sheetErr: any) {
    console.warn('[Warning] Google Sheets cleanup note:', sheetErr.message);
  }

  // 4. Summary of remaining tanks
  const activeTanks = await prisma.storageTank.findMany({
    select: { tankCode: true, name: true, capacityLiters: true, currentStockLiters: true, tankType: true },
  });
  console.log('\n=======================================================');
  console.log('  ACTIVE OPERATIONAL STORAGE TANKS NOW:');
  console.log('=======================================================');
  console.table(activeTanks);
  console.log('CLEANUP COMPLETE!');
}

cleanupDummyData()
  .catch((err) => {
    console.error('Cleanup error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
