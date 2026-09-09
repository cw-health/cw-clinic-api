import { AssignSubscriptionDto } from './assign-subscription.dto';

/**
 * Same shape as `AssignSubscriptionDto` — changing a clinic's plan is
 * "assign a new plan, superseding the current one" (see `Subscription`'s
 * SUPERSEDED convention in prisma/schema.prisma), so it takes the same
 * inputs. Kept as a distinct class (not a bare alias) so Swagger documents
 * it under its own name and either can gain change-specific fields later
 * without affecting the other.
 */
export class ChangePlanDto extends AssignSubscriptionDto {}
