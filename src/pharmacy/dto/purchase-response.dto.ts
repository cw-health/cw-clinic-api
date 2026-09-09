export interface PurchaseItemResponseDto {
  id: string;
  medicineId: string;
  medicineName: string;
  batchId: string;
  batchNumber: string;
  expiryDate: Date;
  quantity: number;
  purchasePrice: string;
  sellingPrice: string;
}

export interface PurchaseResponseDto {
  id: string;
  clinicId: string;
  branchId: string | null;
  supplierName: string;
  invoiceNumber: string | null;
  purchaseDate: Date;
  notes: string | null;
  createdByUserId: string;
  totalAmount: string;
  items: PurchaseItemResponseDto[];
  createdAt: Date;
  updatedAt: Date;
}
