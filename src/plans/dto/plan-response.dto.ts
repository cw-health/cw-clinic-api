/**
 * Shape returned to the client. `price` is a Decimal(10,2) column,
 * serialized as a string — same convention as Doctor.consultationFee
 * (doctors.service.ts) rather than a lossy float. `features` is the flat
 * list of granted feature keys (PlanFeature rows collapsed to their key —
 * row presence is the grant, see the model's own doc comment).
 */
export interface PlanResponseDto {
  id: string;
  name: string;
  description: string | null;
  status: string;
  price: string;
  currency: string;
  billingInterval: string;
  maxDoctors: number | null;
  maxStaff: number | null;
  maxPatients: number | null;
  maxBranches: number | null;
  trialDays: number | null;
  features: string[];
  createdAt: Date;
  updatedAt: Date;
}
