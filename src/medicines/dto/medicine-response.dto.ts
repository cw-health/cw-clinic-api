export interface MedicineResponseDto {
  id: string;
  clinicId: string;
  name: string;
  genericName: string | null;
  strength: string | null;
  form: string | null;
  manufacturer: string | null;
  sku: string | null;
  unit: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
