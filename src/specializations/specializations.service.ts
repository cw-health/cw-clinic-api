import { Injectable } from '@nestjs/common';
import type { Specialization } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Read-only lookup over the global specialization catalogue (docs/DATABASE.md §1 reference data) — used to populate the doctor form's specialization picker. */
@Injectable()
export class SpecializationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<Specialization[]> {
    return this.prisma.specialization.findMany({ orderBy: { name: 'asc' } });
  }
}
