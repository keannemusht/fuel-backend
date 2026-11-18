import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type ErpClassification = 'SITE_INTERNAL' | 'OTHER_CONSUMPTION' | 'UNREGISTERED';

export interface MasterEquipmentItem {
  unitNo: string;
  alias: string;
  name: string;
  class: string;
  site: 'SENYIUR' | 'MUARA_PAHU';
  costCenterCode: string;
  costCenterName: string;
  divisi: string;
  categoryName: string;
  cleanNo: string;
  cleanAlias: string;
}

export class MasterEquipmentService {
  private static snyMap = new Map<string, MasterEquipmentItem>();
  private static mpMap = new Map<string, MasterEquipmentItem>();
  private static isLoaded = false;

  private static ensureLoaded(): void {
    if (this.isLoaded) return;
    this.loadSync();
  }

  /**
   * Synchronously loads master equipment data from JSON cache files
   */
  public static loadSync(): void {
    if (this.isLoaded) return;

    try {
      const candidates = [
        path.resolve(process.cwd(), 'src/data'),
        path.resolve(process.cwd(), 'backend/src/data'),
        path.resolve(__dirname, '../data'),
      ];

      for (const dir of candidates) {
        const snyPath = path.join(dir, 'masterEquipmentSNY.json');
        const mpPath = path.join(dir, 'masterEquipmentMP.json');

        if (fs.existsSync(snyPath) && fs.existsSync(mpPath)) {
          const snyData: MasterEquipmentItem[] = JSON.parse(fs.readFileSync(snyPath, 'utf8'));
          const mpData: MasterEquipmentItem[] = JSON.parse(fs.readFileSync(mpPath, 'utf8'));

          snyData.forEach((item) => {
            this.snyMap.set(item.cleanNo, item);
            if (item.cleanAlias) this.snyMap.set(item.cleanAlias, item);
          });

          mpData.forEach((item) => {
            this.mpMap.set(item.cleanNo, item);
            if (item.cleanAlias) this.mpMap.set(item.cleanAlias, item);
          });

          this.isLoaded = true;
          return;
        }
      }
    } catch (e) {
      console.warn('[MasterEquipmentService] Synchronous JSON load failed:', e);
    }
  }

  /**
   * Async initialization with Excel fallback
   */
  public static async init(): Promise<void> {
    if (this.isLoaded) return;
    this.loadSync();
    if (this.isLoaded) return;

    // Fallback: Parse from Excel files
    await this.loadExcelFallback();
    this.isLoaded = true;
  }

  private static async loadExcelFallback(): Promise<void> {
    const findFile = (filename: string): string | null => {
      const candidates = [
        path.resolve(process.cwd(), 'excel', filename),
        path.resolve(process.cwd(), 'backend', 'excel', filename),
        path.resolve(__dirname, '../../excel', filename),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) return c;
      }
      return null;
    };

    const snyFile = findFile('Master Equipment SNY.xls');
    const mpFile = findFile('Master Equipment MP.xls');

    if (snyFile) await this.parseExcel(snyFile, 'SENYIUR', this.snyMap);
    if (mpFile) await this.parseExcel(mpFile, 'MUARA_PAHU', this.mpMap);
  }

  private static async parseExcel(
    filePath: string,
    site: 'SENYIUR' | 'MUARA_PAHU',
    targetMap: Map<string, MasterEquipmentItem>
  ): Promise<void> {
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(filePath);
      const sheet = wb.getWorksheet(1);
      if (!sheet) return;

      sheet.eachRow((r, i) => {
        if (i > 4 && r.getCell(5).value) {
          const unitNo = r.getCell(2).value?.toString().trim();
          const alias = r.getCell(3).value?.toString().trim();
          const name = r.getCell(4).value?.toString().trim();
          const cls = r.getCell(5).value?.toString().trim();
          const costCenterCode = r.getCell(21).value?.toString().trim();
          const costCenterName = r.getCell(22).value?.toString().trim();
          const divisi = r.getCell(23).value?.toString().trim();
          const categoryName = r.getCell(24).value?.toString().trim();

          if (unitNo) {
            const cleanNo = unitNo.toUpperCase().replace(/\s+/g, '');
            const cleanAlias = (alias || unitNo).toUpperCase().replace(/\s+/g, '');
            const item: MasterEquipmentItem = {
              unitNo,
              alias: alias || unitNo,
              name: name || '',
              class: cls || '',
              site,
              costCenterCode: costCenterCode || '',
              costCenterName: costCenterName || '',
              divisi: divisi || '',
              categoryName: categoryName || '',
              cleanNo,
              cleanAlias,
            };
            targetMap.set(cleanNo, item);
            targetMap.set(cleanAlias, item);
          }
        }
      });
    } catch (e) {
      console.error(`[MasterEquipmentService] Failed to parse Excel: ${filePath}`, e);
    }
  }

  /**
   * Normalizes unit code string by removing all whitespace and converting to uppercase
   */
  public static normalizeCode(unitCode: string | null | undefined): string {
    if (!unitCode) return '';
    return unitCode.toUpperCase().replace(/\s+/g, '');
  }

  /**
   * Returns registered site ('SENYIUR' | 'MUARA_PAHU') or null if not registered in ERP
   */
  public static getEquipmentSite(unitCode: string | null | undefined): 'SENYIUR' | 'MUARA_PAHU' | null {
    this.ensureLoaded();
    const clean = this.normalizeCode(unitCode);
    if (!clean) return null;

    if (this.snyMap.has(clean)) return 'SENYIUR';
    if (this.mpMap.has(clean)) return 'MUARA_PAHU';
    return null;
  }

  /**
   * Checks if unit is an official equipment registered in ERP
   */
  public static isRegistered(unitCode: string | null | undefined): boolean {
    return this.getEquipmentSite(unitCode) !== null;
  }

  /**
   * Classifies a fuel log transaction relative to active site context:
   * - 'SITE_INTERNAL': Vehicle belongs to this site's master equipment (e.g. LV502 at Senyiur)
   * - 'OTHER_CONSUMPTION': Vehicle belongs to the other site's master equipment (e.g. PM401 from MP fueled at Senyiur)
   * - 'UNREGISTERED': Vehicle is not in ERP master equipment (e.g. LV 002 BPU, contractor pickup, dummy)
   */
  public static classifyLog(
    log: { unitCode: string; site?: string },
    currentSite: string = 'SENYIUR'
  ): ErpClassification {
    const equipSite = this.getEquipmentSite(log.unitCode);
    if (!equipSite) {
      return 'UNREGISTERED';
    }

    const effectiveSite = (log.site || currentSite || 'SENYIUR').toUpperCase();
    if (equipSite === effectiveSite) {
      return 'SITE_INTERNAL';
    }

    return 'OTHER_CONSUMPTION';
  }

  /**
   * Returns complete info of an equipment if registered
   */
  public static getEquipmentInfo(unitCode: string | null | undefined): MasterEquipmentItem | null {
    this.ensureLoaded();
    const clean = this.normalizeCode(unitCode);
    if (!clean) return null;
    return this.snyMap.get(clean) || this.mpMap.get(clean) || null;
  }

  /**
   * Returns all units for a given site
   */
  public static getUnitsForSite(site: 'SENYIUR' | 'MUARA_PAHU'): MasterEquipmentItem[] {
    this.ensureLoaded();
    const map = site === 'SENYIUR' ? this.snyMap : this.mpMap;
    const seen = new Set<string>();
    const list: MasterEquipmentItem[] = [];
    for (const item of map.values()) {
      if (!seen.has(item.cleanNo)) {
        seen.add(item.cleanNo);
        list.push(item);
      }
    }
    return list;
  }
}
