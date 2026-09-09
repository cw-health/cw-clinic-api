export interface MedicineBatchResponseDto {
  id: string;
  clinicId: string;
  branchId: string | null;
  medicineId: string;
  medicineName: string;
  batchNumber: string;
  expiryDate: Date;
  quantityReceived: number;
  quantityOnHand: number;
  purchasePrice: string;
  sellingPrice: string;
  /** Derived, not stored: `expiryDate` has passed. */
  isExpired: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface StockSummaryResponseDto {
  medicineId: string;
  medicineName: string;
  unit: string | null;
  /** Sum of `quantityOnHand` across every non-empty batch for this medicine (in the query's scope). */
  totalQuantityOnHand: number;
  batchCount: number;
  /** Earliest `expiryDate` among this medicine's batches with stock on hand — null if none. */
  nearestExpiryDate: Date | null;
}
