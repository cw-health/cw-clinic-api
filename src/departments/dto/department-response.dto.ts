export interface DepartmentResponseDto {
  id: string;
  clinicId: string;
  branchId: string;
  /** Denormalized for display convenience ("show branch association") — never used for authorization. */
  branch: { id: string; name: string; code: string } | null;
  name: string;
  code: string;
  description: string | null;
  status: string;
  doctorIds: string[];
  createdAt: Date;
  updatedAt: Date;
}
