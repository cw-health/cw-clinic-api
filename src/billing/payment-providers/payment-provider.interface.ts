import type { PaymentMethod } from '../dto/payment-response.dto';

export interface CapturePaymentInput {
  amount: number;
  method: PaymentMethod;
  reference?: string;
}

export interface CapturePaymentResult {
  status: 'COMPLETED' | 'PENDING' | 'FAILED';
  /** Opaque reference from the provider (e.g. a future gateway's charge ID). */
  providerReference?: string;
}

/**
 * Abstraction over "how a payment actually gets captured" (task brief: "a
 * payment abstraction so an online payment provider can be added later").
 * PaymentsService depends only on this interface, injected via the
 * PAYMENT_PROVIDER token (billing.module.ts) — swapping in a future online
 * gateway (Razorpay/Stripe) means adding a second implementation and
 * changing the DI binding, not touching PaymentsService's call sites.
 */
export interface PaymentProvider {
  capture(input: CapturePaymentInput): Promise<CapturePaymentResult>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
