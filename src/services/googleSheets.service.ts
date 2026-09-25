import { google } from 'googleapis';
import { config } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { logger } from '../utils/logger.js';
import { SyncStatus } from '@prisma/client';
import { SpreadsheetRowData } from '../types/index.js';

export class GoogleSheetsService {
  private static indoMonths = [
    'JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI',
    'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'
  ];

  private static readySheets = new Set<string>();
  private static sheetIdMap = new Map<string, number>();

  private static getSheetsClient() {
    if (!config.googleSheets.serviceAccountEmail || !config.googleSheets.privateKey) {
      return null;
    }

    const auth = new google.auth.JWT({
      email: config.googleSheets.serviceAccountEmail,
      key: config.googleSheets.privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    return google.sheets({ version: 'v4', auth });
  }

  /**
   * Retrieves or discovers the numeric sheetId for a sheet tab title.
   */
  static async getSheetId(sheets: any, targetSheetName: string): Promise<number | null> {
    const key = targetSheetName.trim().toLowerCase();
    if (this.sheetIdMap.has(key)) {
      return this.sheetIdMap.get(key)!;
    }

    try {
      const meta = await sheets.spreadsheets.get({
        spreadsheetId: config.googleSheets.spreadsheetId,
      });
      for (const s of meta.data.sheets || []) {
        if (s.properties?.title && s.properties?.sheetId !== undefined) {
          this.sheetIdMap.set(s.properties.title.trim().toLowerCase(), s.properties.sheetId);
        }
      }
      return this.sheetIdMap.get(key) ?? null;
    } catch (e: any) {
      logger.warn(`Failed to fetch sheetId for "${targetSheetName}":`, e.message);
      return null;
    }
  }

  /**
   * Resolves the Google Sheets monthly tab title from a date string (YYYY-MM-DD).
   * E.g. "2026-08-15" => "AGUSTUS 2026"
   */
  static getMonthlySheetName(dateStr?: string): string {
    if (!dateStr || !dateStr.includes('-')) {
      return config.googleSheets.sheetName || 'LOG FUEL MONITORING';
    }
    try {
      const parts = dateStr.trim().split('-');
      const year = parts[0];
      const monthIdx = parseInt(parts[1], 10) - 1;
      if (monthIdx >= 0 && monthIdx < 12) {
        return `${this.indoMonths[monthIdx]} ${year}`;
      }
    } catch (e) {
      // fallback
    }
    return config.googleSheets.sheetName || 'LOG FUEL MONITORING';
  }

  /**
   * Normalizes a date string to strict YYYY-MM-DD format for Google Sheets.
   */
  static normalizeDate(date?: string): string {
    if (!date) return '';
    const clean = date.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
    if (clean.includes('T')) return clean.split('T')[0];
    return clean;
  }

  /**
   * Normalizes a time string to h:mm (or HH:mm) format without seconds,
   * converting dot separators to colons, matching JANUARI - AGUSTUS tabs.
   * E.g. "14.30.00" -> "14:30", "11:04:17" -> "11:04", "0:01:00" -> "0:01"
   */
  static normalizeJam(jam?: string): string {
    if (!jam) return '00:00';
    const clean = jam.trim().replace(/\./g, ':');
    const parts = clean.split(':');
    if (parts.length >= 2) {
      const h = parseInt(parts[0], 10);
      const m = parts[1].padStart(2, '0');
      if (!isNaN(h) && h >= 0 && h < 24) {
        return `${h}:${m}`;
      }
    }
    return clean;
  }

  /**
   * Ensures that the target sheet tab exists with the standard 15 headers in Row 1.
   * Also formats the header row (Bold text and frozen top row) if newly initialized.
   */
  static async ensureSheetReady(sheets: any, targetSheetName: string) {
    if (this.readySheets.has(targetSheetName)) return;

    try {
      const meta = await sheets.spreadsheets.get({
        spreadsheetId: config.googleSheets.spreadsheetId,
      });

      const existingSheets = meta.data.sheets || [];
      for (const s of existingSheets) {
        if (s.properties?.title && s.properties?.sheetId !== undefined) {
          this.sheetIdMap.set(s.properties.title.trim().toLowerCase(), s.properties.sheetId);
        }
      }

      let foundSheet = existingSheets.find(
        (s: any) => s.properties?.title?.toLowerCase() === targetSheetName.toLowerCase()
      );

      let targetSheetId = foundSheet?.properties?.sheetId;

      if (!foundSheet) {
        logger.info(`Creating sheet tab "${targetSheetName}" in Google Sheets...`);
        const addRes = await sheets.spreadsheets.batchUpdate({
          spreadsheetId: config.googleSheets.spreadsheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: targetSheetName,
                  },
                },
              },
            ],
          },
        });

        targetSheetId = addRes.data.replies?.[0]?.addSheet?.properties?.sheetId;
        if (targetSheetId !== undefined) {
          this.sheetIdMap.set(targetSheetName.trim().toLowerCase(), targetSheetId);
        }
      }

      // Check headers in row 1
      const checkRes = await sheets.spreadsheets.values.get({
        spreadsheetId: config.googleSheets.spreadsheetId,
        range: `'${targetSheetName}'!A1:O1`,
      });

      if (!checkRes.data.values || checkRes.data.values.length === 0) {
        const headers = [
          'NO',
          'NO UNIT',
          'KATEGORI',
          'DATE',
          'JAM',
          'HM',
          'KM',
          'QTY OUT ( LITER )',
          'SHIFT',
          'OPERATOR',
          'FUEL IN',
          'TOTAL FUEL OUT',
          'STOCK AKHIR',
          'TOTAL FUEL IN',
          'FUELMAN',
        ];

        await sheets.spreadsheets.values.update({
          spreadsheetId: config.googleSheets.spreadsheetId,
          range: `'${targetSheetName}'!A1:O1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [headers] },
        });

        // Format Header Row: Match template tabs (Left aligned, non-bold Arial 10pt)
        if (targetSheetId !== undefined && targetSheetId !== null) {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: config.googleSheets.spreadsheetId,
            requestBody: {
              requests: [
                {
                  repeatCell: {
                    range: {
                      sheetId: targetSheetId,
                      startRowIndex: 0,
                      endRowIndex: 1,
                      startColumnIndex: 0,
                      endColumnIndex: 15,
                    },
                    cell: {
                      userEnteredFormat: {
                        textFormat: {
                          bold: false,
                          fontFamily: 'Arial',
                          fontSize: 10,
                        },
                        horizontalAlignment: 'LEFT',
                        verticalAlignment: 'BOTTOM',
                      },
                    },
                    fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)',
                  },
                },
              ],
            },
          }).catch((err: any) => logger.warn(`Header styling warning: ${err.message}`));
        }
      }

      // Format Date (Col D) and Jam (Col E) columns for data rows (matching template tabs Jan - Aug)
      if (targetSheetId !== undefined && targetSheetId !== null) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: config.googleSheets.spreadsheetId,
          requestBody: {
            requests: [
              {
                repeatCell: {
                  range: {
                    sheetId: targetSheetId,
                    startRowIndex: 1,
                    startColumnIndex: 3,
                    endColumnIndex: 4,
                  },
                  cell: {
                    userEnteredFormat: {
                      numberFormat: {
                        type: 'DATE',
                        pattern: 'yyyy-mm-dd',
                      },
                      textFormat: {
                        fontFamily: 'Arial',
                        fontSize: 10,
                      },
                    },
                  },
                  fields: 'userEnteredFormat(numberFormat,textFormat)',
                },
              },
              {
                repeatCell: {
                  range: {
                    sheetId: targetSheetId,
                    startRowIndex: 1,
                    startColumnIndex: 4,
                    endColumnIndex: 5,
                  },
                  cell: {
                    userEnteredFormat: {
                      numberFormat: {
                        type: 'TIME',
                        pattern: 'h:mm',
                      },
                      textFormat: {
                        fontFamily: 'Arial',
                        fontSize: 10,
                      },
                    },
                  },
                  fields: 'userEnteredFormat(numberFormat,textFormat)',
                },
              },
            ],
          },
        }).catch((err: any) => logger.warn(`Column formatting warning for "${targetSheetName}": ${err.message}`));
      }

      this.readySheets.add(targetSheetName);
    } catch (e: any) {
      logger.warn(`Google Sheets auto-initialization for "${targetSheetName}" warning:`, e.message);
    }
  }

  /**
   * Automatically sorts rows in the specified sheet tab chronologically:
   * 1. DATE (Column D / index 3) ASCENDING
   * 2. JAM (Column E / index 4) ASCENDING
   * 3. NO (Column A / index 0) ASCENDING
   */
  static async sortSheetByDateAndJam(sheets: any, sheetTitle: string) {
    try {
      const sheetId = await this.getSheetId(sheets, sheetTitle);
      if (sheetId === null || sheetId === undefined) return;

      const rowCountRes = await sheets.spreadsheets.values.get({
        spreadsheetId: config.googleSheets.spreadsheetId,
        range: `'${sheetTitle}'!A:A`,
      });

      const rowCount = rowCountRes.data.values?.length || 0;
      if (rowCount <= 2) {
        // Only 1 data row or header only, no need to sort
        return;
      }

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: config.googleSheets.spreadsheetId,
        requestBody: {
          requests: [
            {
              sortRange: {
                range: {
                  sheetId,
                  startRowIndex: 1, // Skip row 1 (Header row)
                  startColumnIndex: 0,
                  endColumnIndex: 15,
                },
                sortSpecs: [
                  { dimensionIndex: 3, sortOrder: 'ASCENDING' }, // DATE (Col D)
                  { dimensionIndex: 4, sortOrder: 'ASCENDING' }, // JAM (Col E)
                  { dimensionIndex: 0, sortOrder: 'ASCENDING' }, // NO (Col A)
                ],
              },
            },
          ],
        },
      });
      logger.info(`Successfully ordered rows in tab "${sheetTitle}" chronologically by DATE & JAM.`);
    } catch (e: any) {
      logger.warn(`Auto-sort for tab "${sheetTitle}" warning: ${e.message}`);
    }
  }

  /**
   * Appends a fuel log entry matching the exact 15-column format:
   * 1. Appends to the monthly tab (e.g. "SEPTEMBER 2026") - auto-created if missing.
   * 2. Appends to the master tab (e.g. "LOG FUEL MONITORING").
   * 3. Automatically sorts both tabs chronologically by DATE and JAM.
   */
  static async appendFuelRow(data: SpreadsheetRowData): Promise<{ success: boolean; error?: string }> {
    const sheets = this.getSheetsClient();
    if (!sheets || !config.googleSheets.spreadsheetId) {
      logger.warn('Google Sheets credentials or Spreadsheet ID missing in configuration. Row queued as PENDING.');
      return { success: false, error: 'Google Sheets integration not configured.' };
    }

    const monthlySheet = this.getMonthlySheetName(data.date);
    const masterSheet = config.googleSheets.sheetName || 'LOG FUEL MONITORING';
    const targetSheets = Array.from(new Set([monthlySheet, masterSheet]));

    const rowValues = [
      data.no,
      data.unitCode,
      data.category,
      this.normalizeDate(data.date),
      this.normalizeJam(data.jam),
      data.hm,
      data.km,
      data.qtyOut,
      data.shift,
      data.operator,
      data.fuelIn,
      data.totalFuelOut,
      data.stockAkhir,
      data.totalFuelIn,
      data.fuelman,
    ];

    let lastError: string | undefined;
    let appendedCount = 0;

    for (const targetSheet of targetSheets) {
      try {
        await this.ensureSheetReady(sheets, targetSheet);

        await sheets.spreadsheets.values.append({
          spreadsheetId: config.googleSheets.spreadsheetId,
          range: `'${targetSheet}'!A:O`,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: {
            values: [rowValues],
          },
        });

        // Auto-sort chronologically by DATE and JAM
        await this.sortSheetByDateAndJam(sheets, targetSheet);

        logger.info(`Successfully synced FuelLog row #${data.no} (Unit: ${data.unitCode}) to tab "${targetSheet}".`);
        appendedCount++;
      } catch (error: any) {
        logger.error(`Google Sheets API append failed on tab "${targetSheet}":`, error.message || error);
        lastError = error.message || 'Unknown Google Sheets API error';
      }
    }

    if (appendedCount > 0) {
      return { success: true };
    } else {
      return { success: false, error: lastError || 'Failed to append to Google Sheets tabs.' };
    }
  }

  /**
   * Synchronizes all fuel logs for a given month (e.g. "2026-08") directly into its Google Sheets monthly tab,
   * strictly ordered by DATE, JAM, and NO.
   */
  static async syncMonthToSheets(monthStr: string): Promise<{ success: boolean; targetSheet: string; totalSynced: number }> {
    const sheets = this.getSheetsClient();
    if (!sheets || !config.googleSheets.spreadsheetId) {
      throw new Error('Google Sheets credentials or Spreadsheet ID missing in configuration.');
    }

    const targetSheet = this.getMonthlySheetName(`${monthStr}-01`);
    await this.ensureSheetReady(sheets, targetSheet);

    const logs = await prisma.fuelLog.findMany({
      where: {
        dateStr: { startsWith: monthStr },
      },
      orderBy: [
        { dateStr: 'asc' },
        { jamStr: 'asc' },
        { no: 'asc' },
      ],
    });

    if (logs.length === 0) {
      return { success: true, targetSheet, totalSynced: 0 };
    }

    const rows = logs.map((l) => [
      l.no,
      l.unitCode,
      l.category,
      this.normalizeDate(l.dateStr),
      this.normalizeJam(l.jamStr),
      l.currentHm,
      l.currentKm,
      l.volumeLiters,
      l.shift,
      l.operator,
      l.fuelInLiters,
      l.totalFuelOut,
      l.stockAkhir,
      l.totalFuelIn,
      l.fuelmanName,
    ]);

    try {
      // Clear data below header row to prevent duplicate rows during full month resync
      await sheets.spreadsheets.values.clear({
        spreadsheetId: config.googleSheets.spreadsheetId,
        range: `'${targetSheet}'!A2:O`,
      });

      // Append in batches of 500
      const chunkSize = 500;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        await sheets.spreadsheets.values.append({
          spreadsheetId: config.googleSheets.spreadsheetId,
          range: `'${targetSheet}'!A:O`,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: {
            values: chunk,
          },
        });
      }

      // Ensure chronological sorting on Google Sheets
      await this.sortSheetByDateAndJam(sheets, targetSheet);

      // Mark records as SYNCED
      await prisma.fuelLog.updateMany({
        where: {
          id: { in: logs.map((l) => l.id) },
        },
        data: {
          syncStatus: SyncStatus.SYNCED,
          syncedAt: new Date(),
          syncError: null,
        },
      });

      logger.info(`Successfully synchronized ${logs.length} rows to Google Sheets tab "${targetSheet}"`);
      return { success: true, targetSheet, totalSynced: logs.length };
    } catch (err: any) {
      logger.error(`Failed to sync monthly records to "${targetSheet}":`, err);
      throw new Error(`Google Sheets synchronization failed: ${err.message}`);
    }
  }

  /**
   * Synchronizes ALL fuel logs across all dates into the master tab (e.g. "LOG FUEL MONITORING")
   * strictly ordered by DATE and JAM.
   */
  static async syncMasterSheet(): Promise<{ success: boolean; targetSheet: string; totalSynced: number }> {
    const sheets = this.getSheetsClient();
    if (!sheets || !config.googleSheets.spreadsheetId) {
      throw new Error('Google Sheets credentials or Spreadsheet ID missing in configuration.');
    }

    const masterSheet = config.googleSheets.sheetName || 'LOG FUEL MONITORING';
    await this.ensureSheetReady(sheets, masterSheet);

    const logs = await prisma.fuelLog.findMany({
      orderBy: [
        { dateStr: 'asc' },
        { jamStr: 'asc' },
        { no: 'asc' },
      ],
    });

    if (logs.length === 0) {
      return { success: true, targetSheet: masterSheet, totalSynced: 0 };
    }

    const rows = logs.map((l) => [
      l.no,
      l.unitCode,
      l.category,
      this.normalizeDate(l.dateStr),
      this.normalizeJam(l.jamStr),
      l.currentHm,
      l.currentKm,
      l.volumeLiters,
      l.shift,
      l.operator,
      l.fuelInLiters,
      l.totalFuelOut,
      l.stockAkhir,
      l.totalFuelIn,
      l.fuelmanName,
    ]);

    try {
      await sheets.spreadsheets.values.clear({
        spreadsheetId: config.googleSheets.spreadsheetId,
        range: `'${masterSheet}'!A2:O`,
      });

      const chunkSize = 500;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        await sheets.spreadsheets.values.append({
          spreadsheetId: config.googleSheets.spreadsheetId,
          range: `'${masterSheet}'!A:O`,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: {
            values: chunk,
          },
        });
      }

      await this.sortSheetByDateAndJam(sheets, masterSheet);

      logger.info(`Successfully synchronized all ${logs.length} rows to master Google Sheets tab "${masterSheet}"`);
      return { success: true, targetSheet: masterSheet, totalSynced: logs.length };
    } catch (err: any) {
      logger.error(`Failed to sync master records to "${masterSheet}":`, err);
      throw new Error(`Google Sheets master synchronization failed: ${err.message}`);
    }
  }

  /**
   * Process all pending or failed sync items from SyncQueue with retry backoff
   */
  static async processSyncQueue(): Promise<{ processed: number; succeeded: number; failed: number }> {
    const queueItems = await prisma.syncQueue.findMany({
      where: {
        status: { in: [SyncStatus.PENDING, SyncStatus.FAILED] },
        retryCount: { lt: 5 },
      },
      take: 20,
      orderBy: { createdAt: 'asc' },
    });

    let succeeded = 0;
    let failed = 0;

    for (const item of queueItems) {
      try {
        const payload: SpreadsheetRowData = JSON.parse(item.payload);
        const result = await this.appendFuelRow(payload);

        if (result.success) {
          await prisma.$transaction([
            prisma.syncQueue.update({
              where: { id: item.id },
              data: {
                status: SyncStatus.SYNCED,
                updatedAt: new Date(),
                lastError: null,
              },
            }),
            prisma.fuelLog.update({
              where: { id: item.entityId },
              data: {
                syncStatus: SyncStatus.SYNCED,
                syncedAt: new Date(),
                syncError: null,
              },
            }),
          ]);
          succeeded++;
        } else {
          await prisma.$transaction([
            prisma.syncQueue.update({
              where: { id: item.id },
              data: {
                status: SyncStatus.FAILED,
                retryCount: { increment: 1 },
                lastError: result.error,
                updatedAt: new Date(),
              },
            }),
            prisma.fuelLog.update({
              where: { id: item.entityId },
              data: {
                syncStatus: SyncStatus.FAILED,
                syncError: result.error,
              },
            }),
          ]);
          failed++;
        }
      } catch (err: any) {
        failed++;
        await prisma.syncQueue.update({
          where: { id: item.id },
          data: {
            status: SyncStatus.FAILED,
            retryCount: { increment: 1 },
            lastError: err.message,
            updatedAt: new Date(),
          },
        });
      }
    }

    return { processed: queueItems.length, succeeded, failed };
  }
}
