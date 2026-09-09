export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';
/**
 * The writable set plus two legacy values (`CONSULTATION_FEE`,
 * `PRESCRIPTION`) still readable on invoice items written before the
 * docs/DATABASE.md §18 vocabulary widening — never rewritten, no longer
 * accepted on write. See `INVOICE_ITEM_TYPES` in
 * `create-invoice-item.dto.ts` for the current writable list.
 */
export type InvoiceItemType =
  | 'CONSULTATION'
  | 'PROCEDURE'
  | 'LABORATORY'
  | 'RADIOLOGY'
  | 'PHARMACY'
  | 'ROOM'
  | 'NURSING'
  | 'OTHER'
  | 'CONSULTATION_FEE'
  | 'PRESCRIPTION';

export interface InvoiceItemResponseDto {
  id: string;
  description: string;
  itemType: InvoiceItemType;
  quantity: number;
  /** Decimal(10,2) serialized as a string — see doctors.service.ts's consultationFee convention. */
  unitPrice: string;
  discountAmount: string;
  taxRatePercent: string;
  lineTotal: string;
  sortOrder: number;
}

export interface InvoiceResponseDto {
  id: string;
  clinicId: string;
  consultationId: string;
  doctorId: string;
  doctorName: string;
  patientId: string;
  patientName: string;
  invoiceNumber: string | null;
  status: InvoiceStatus;
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  amountPaid: string;
  balanceDue: string;
  notes: string | null;
  items: InvoiceItemResponseDto[];
  createdByUserId: string;
  issuedAt: Date | null;
  dueDate: Date | null;
  voidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
