export interface DispenseItemResponseDto {
  id: string;
  medicineId: string;
  medicineName: string;
  prescriptionItemId: string | null;
  quantity: number;
  unitPrice: string;
}

export interface DispenseResponseDto {
  id: string;
  clinicId: string;
  branchId: string | null;
  patientId: string;
  prescriptionId: string | null;
  status: string;
  dispensedByUserId: string;
  dispensedAt: Date;
  notes: string | null;
  items: DispenseItemResponseDto[];
  createdAt: Date;
  updatedAt: Date;
}
