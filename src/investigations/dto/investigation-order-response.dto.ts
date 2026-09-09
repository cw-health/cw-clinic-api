import type { InvestigationPriority } from './create-investigation-order.dto';

/// Deliberately stops at ORDERED/CANCELLED — see model InvestigationOrder's
/// doc comment in schema.prisma. A future Lab module adds RESULT/
/// COMPLETED states plus its own LabResult child; not built here.
export type InvestigationOrderStatus = 'ORDERED' | 'CANCELLED';

export interface InvestigationOrderResponseDto {
  id: string;
  clinicId: string;
  consultationId: string;
  doctorId: string;
  testName: string;
  category: string | null;
  priority: InvestigationPriority;
  clinicalNotes: string | null;
  status: InvestigationOrderStatus;
  createdByUserId: string;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
