export interface StockMovementResponseDto {
  id: string;
  clinicId: string;
  branchId: string | null;
  medicineId: string;
  medicineName: string;
  batchId: string;
  batchNumber: string;
  type: string;
  quantity: number;
  quantityBefore: number;
  quantityAfter: number;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  performedByUserId: string;
  createdAt: Date;
}
