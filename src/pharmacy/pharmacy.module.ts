import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BranchesModule } from '../branches/branches.module';
import { MedicinesModule } from '../medicines/medicines.module';
import { PatientsModule } from '../patients/patients.module';
import { PrescriptionsModule } from '../prescriptions/prescriptions.module';
import { DispensingController } from './dispensing.controller';
import { DispensingService } from './dispensing.service';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';
import { StockMovementsController } from './stock-movements.controller';
import { StockMovementsService } from './stock-movements.service';

/**
 * Pharmacy: Inventory -> Purchase -> Stock -> Dispensing, layered on top of
 * the existing `MedicinesModule` catalog (Medicine Master) and
 * `PrescriptionsModule` (the Prescription this module dispenses against).
 * No billing linkage (task brief: out of scope) — `MedicinesModule`/
 * `PrescriptionsModule`/`PatientsModule`/`BranchesModule` are imported for
 * their exported services only, per the module-boundary rule
 * (docs/ARCHITECTURE.md §3); this module never reaches into their Prisma
 * models directly.
 */
@Module({
  imports: [MedicinesModule, PrescriptionsModule, PatientsModule, BranchesModule, AuditModule],
  controllers: [
    InventoryController,
    PurchasesController,
    StockMovementsController,
    DispensingController,
  ],
  providers: [InventoryService, PurchasesService, StockMovementsService, DispensingService],
  exports: [InventoryService, PurchasesService, StockMovementsService, DispensingService],
})
export class PharmacyModule {}
