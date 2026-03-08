export enum ExpenseCategory {
  ARRIENDO = 'arriendo',
  SERVICIOS_BASICOS = 'servicios básicos',
  MARKETING = 'marketing',
  SOFTWARE = 'software',
  INSUMOS = 'insumos',
  OPERACION = 'operación',
}

export enum ExpenseType {
  FIXED = 'fijo',
  VARIABLE = 'variable',
}

export interface Sale {
  id: string;
  date: string; // ISO string
  serviceName: string;
  professionalName: string;
  clientName?: string;
  totalAmount: number;
  costAmount?: number; // Cost of the product/service
  quantity: number;
  commissionType: 'percentage' | 'fixed';
  commissionPercentage: number; // This will store the value (percentage or fixed amount)
  commissionAmount: number;
  netAmount: number;
  ivaAmount: number;
  userId: string;
}

export interface Expense {
  id: string;
  category: ExpenseCategory;
  type: ExpenseType;
  amount: number;
  description: string;
  date: string; // ISO string
  userId: string;
}

export interface CommissionRule {
  type: 'percentage' | 'fixed';
  value: number;
}

export interface ServicePrice {
  price: number;
  cost?: number;
  category: string;
  type: string;
}

export interface Settings {
  userId: string;
  commissionRules: Record<string, CommissionRule>;
  servicePrices: Record<string, ServicePrice>;
  updatedAt: string;
}

export interface DailySummary {
  date: string;
  netSales: number;
  iva: number;
  totalSales: number;
  totalCost: number;
  commissionsPaid: number;
  dailyExpenses: number;
  profit: number;
}

export interface AIAnalysis {
  id: string;
  date: string;
  positives: string[];
  improvements: string[];
  alerts: string[];
  tips: string[];
  summary: string;
}
