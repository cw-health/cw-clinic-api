import { Injectable } from '@nestjs/common';
import type {
  CapturePaymentInput,
  CapturePaymentResult,
  PaymentProvider,
} from './payment-provider.interface';

/**
 * Today's only PaymentProvider: staff record a transaction (cash handed
 * over, UPI/card charged through a separate terminal) that has already
 * completed by the time it's entered — so this always succeeds
 * synchronously. No online gateway exists yet; see payment-provider.interface.ts.
 */
@Injectable()
export class ManualPaymentProvider implements PaymentProvider {
  capture(input: CapturePaymentInput): Promise<CapturePaymentResult> {
    return Promise.resolve({
      status: 'COMPLETED',
      providerReference: input.reference,
    });
  }
}
