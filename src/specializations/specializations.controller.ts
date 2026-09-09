import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SpecializationsService } from './specializations.service';

/** Global reference data — any authenticated user may read it (no tenant/permission scoping needed, docs/DATABASE.md §1). */
@ApiTags('specializations')
@ApiBearerAuth()
@Controller({ path: 'specializations', version: '1' })
export class SpecializationsController {
  constructor(private readonly specializationsService: SpecializationsService) {}

  @Get()
  async findAll() {
    return this.specializationsService.findAll();
  }
}
