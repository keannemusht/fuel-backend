import dotenv from 'dotenv';
dotenv.config();

import { google } from 'googleapis';
import { config } from './config/env.js';

async function testGoogleSheets() {
  console.log('--- TESTING GOOGLE SHEETS CONNECTION ---');
  console.log('Service Account Email:', config.googleSheets.serviceAccountEmail);
  console.log('Spreadsheet ID:', config.googleSheets.spreadsheetId);
  console.log('Sheet Name Target:', config.googleSheets.sheetName);

  try {
    const auth = new google.auth.JWT({
      email: config.googleSheets.serviceAccountEmail,
      key: config.googleSheets.privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Get Spreadsheet Metadata to inspect actual sheet/tab names
    console.log('\n[1] Fetching Spreadsheet Metadata...');
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: config.googleSheets.spreadsheetId,
    });

    console.log('✓ Connected! Spreadsheet Title:', meta.data.properties?.title);
    console.log('Available Sheets/Tabs:');
    const existingSheets = meta.data.sheets || [];
    existingSheets.forEach((s) => {
      console.log(`  - Sheet ID: ${s.properties?.sheetId}, Title: "${s.properties?.title}"`);
    });

    const targetSheetTitle = config.googleSheets.sheetName;
    const sheetExists = existingSheets.some((s) => s.properties?.title === targetSheetTitle);

    // If sheet doesn't exist, create it or use the first available sheet
    if (!sheetExists) {
      console.log(`\n[2] Sheet "${targetSheetTitle}" not found in spreadsheet.`);
      console.log(`Auto-creating tab "${targetSheetTitle}" with 15 header columns...`);

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: config.googleSheets.spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: targetSheetTitle,
                },
              },
            },
          ],
        },
      });
      console.log(`✓ Created tab "${targetSheetTitle}"`);
    }

    // 3. Ensure Header Row is initialized
    console.log('\n[3] Checking/Writing 15 Header Columns...');
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

    const currentValues = await sheets.spreadsheets.values.get({
      spreadsheetId: config.googleSheets.spreadsheetId,
      range: `${targetSheetTitle}!A1:O1`,
    });

    if (!currentValues.data.values || currentValues.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: config.googleSheets.spreadsheetId,
        range: `${targetSheetTitle}!A1:O1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [headers],
        },
      });
      console.log('✓ Wrote 15 column headers to Row 1.');
    } else {
      console.log('✓ Header row already present:', currentValues.data.values[0]);
    }

    // 4. Test Append a sample row
    console.log('\n[4] Appending Test Fuel Dispense Row...');
    const testRow = [
      1,
      'DT-101',
      'DUMP TRUCK',
      '2026-09-02',
      '14:50:00',
      6325.0,
      42200.0,
      250.0,
      'SHIFT 1',
      'Joko Widodo',
      0.0,
      250.0,
      48250.0,
      0.0,
      'Chief Site Superintendent (Admin)',
    ];

    const appendRes = await sheets.spreadsheets.values.append({
      spreadsheetId: config.googleSheets.spreadsheetId,
      range: `${targetSheetTitle}!A:O`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [testRow],
      },
    });

    console.log('✓ Successfully appended test row! Updated range:', appendRes.data.updates?.updatedRange);
    console.log('\n--- GOOGLE SHEETS TEST COMPLETED 100% SUCCESSFULLY ---');
  } catch (err: any) {
    console.error('\n✗ Google Sheets API Error:', err.message);
    if (err.response?.data) {
      console.error('Details:', JSON.stringify(err.response.data, null, 2));
    }
  }
}

testGoogleSheets();
