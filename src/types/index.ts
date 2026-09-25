import { Request } from 'express';
import { Role } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: Role;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export interface SpreadsheetRowData {
  no: number;
  unitCode: string;
  category: string;
  date: string;
  jam: string;
  hm: number;
  km: number;
  qtyOut: number;
  shift: string;
  operator: string;
  fuelIn: number;
  totalFuelOut: number;
  stockAkhir: number;
  totalFuelIn: number;
  fuelman: string;
}
