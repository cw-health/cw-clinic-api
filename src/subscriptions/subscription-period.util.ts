import type { BillingInterval } from '../plans/dto/create-plan.dto';

/** End of a billing period starting at `start`, per the plan's `billingInterval`. */
export function addBillingInterval(start: Date, billingInterval: BillingInterval): Date {
  const end = new Date(start);
  switch (billingInterval) {
    case 'MONTHLY':
      end.setMonth(end.getMonth() + 1);
      break;
    case 'QUARTERLY':
      end.setMonth(end.getMonth() + 3);
      break;
    case 'YEARLY':
      end.setFullYear(end.getFullYear() + 1);
      break;
  }
  return end;
}

export function addDays(start: Date, days: number): Date {
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  return end;
}
