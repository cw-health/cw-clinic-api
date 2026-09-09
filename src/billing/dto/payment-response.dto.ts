export type PaymentMethod = 'CASH' | 'UPI' | 'CARD' | 'OTHER';
export type PaymentStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
export type RefundStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export interface RefundResponseDto {
  id: string;
  paymentId: string;
  amount: string;
  reason: string;
  status: RefundStatus;
  processedByUserId: string;
  processedAt: Date | null;
  createdAt: Date;
}

export interface PaymentResponseDto {
  id: string;
  clinicId: string;
  invoiceId: string;
  amount: string;
  method: PaymentMethod;
  status: PaymentStatus;
  providerReference: string | null;
  receiptNumber: string | null;
  receivedByUserId: string;
  paidAt: Date | null;
  notes: string | null;
  refunds: RefundResponseDto[];
  createdAt: Date;
  updatedAt: Date;
}
