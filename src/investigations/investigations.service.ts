import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { InvestigationOrder } from '@prisma/client';
import { AuditActions } from '../audit/audit-actions';
import { AuditService } from '../audit/audit.service';
import type { AuditRequestContext } from '../common/decorators/audit-context.decorator';
import { assertScopedWrite } from '../common/scoped-write.util';
import type { DoctorOwnershipScope } from '../consultations/consultations.service';
import { ConsultationsService } from '../consultations/consultations.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateInvestigationOrderDto } from './dto/create-investigation-order.dto';
import type { InvestigationOrderResponseDto } from './dto/investigation-order-response.dto';

/**
 * Structured "Investigation orders" pipeline stage on a Consultation
 * (docs/DATABASE.md §16) — deliberately prepares for, but does not build,
 * a Lab module: `status` stops at ORDERED/CANCELLED, no result capture.
 */
@Injectable()
export class InvestigationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consultationsService: ConsultationsService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    clinicId: string,
    consultationId: string,
    createdByUserId: string,
    dto: CreateInvestigationOrderDto,
    scope?: DoctorOwnershipScope,
    reqCtx?: AuditRequestContext,
  ): Promise<InvestigationOrderResponseDto> {
    const consultation = await this.consultationsService.findById(clinicId, consultationId);
    if (scope?.doctorId && consultation.doctorId !== scope.doctorId) {
      throw new ForbiddenException('Not your consultation');
    }
    if (consultation.status === 'COMPLETED') {
      throw new ConflictException('Cannot order an investigation on a completed consultation');
    }

    const created = await this.prisma.investigationOrder.create({
      data: {
        clinicId,
        consultationId,
        doctorId: consultation.doctorId,
        testName: dto.testName,
        category: dto.category,
        priority: dto.priority ?? 'ROUTINE',
        clinicalNotes: dto.clinicalNotes,
        createdByUserId,
      },
    });

    await this.auditService.record({
      clinicId,
      actorUserId: createdByUserId,
      entity: 'InvestigationOrder',
      entityId: created.id,
      action: AuditActions.INVESTIGATION_ORDER_CREATED,
      ...reqCtx,
    });

    return this.toResponseDto(created);
  }

  async findAll(
    clinicId: string,
    consultationId: string,
    scope?: DoctorOwnershipScope,
  ): Promise<InvestigationOrderResponseDto[]> {
    const consultation = await this.consultationsService.findById(clinicId, consultationId);
    if (scope?.doctorId && consultation.doctorId !== scope.doctorId) {
      throw new ForbiddenException('Not your consultation');
    }
    const rows = await this.prisma.investigationOrder.findMany({
      where: { clinicId, consultationId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => this.toResponseDto(row));
  }

  /**
   * Single-record PHI access surface — call only from `GET
   * /investigation-orders/:id`, mirrors findByIdAudited in consultations/
   * prescriptions.
   */
  async findByIdAudited(
    clinicId: string,
    id: string,
    actorUserId: string,
    scope?: DoctorOwnershipScope,
    reqCtx?: AuditRequestContext,
  ): Promise<InvestigationOrderResponseDto> {
    const row = await this.findRowOrThrow(clinicId, id, scope);
    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'InvestigationOrder',
      entityId: id,
      action: AuditActions.INVESTIGATION_ORDER_VIEWED,
      ...reqCtx,
    });
    return this.toResponseDto(row);
  }

  async cancel(
    clinicId: string,
    id: string,
    actorUserId: string,
    scope?: DoctorOwnershipScope,
    reqCtx?: AuditRequestContext,
  ): Promise<InvestigationOrderResponseDto> {
    const row = await this.findRowOrThrow(clinicId, id, scope);
    if (row.status !== 'ORDERED') {
      throw new ConflictException('Only an ordered investigation can be cancelled');
    }

    const result = await this.prisma.investigationOrder.updateMany({
      where: { id, clinicId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    assertScopedWrite(result, 'Investigation order not found');

    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'InvestigationOrder',
      entityId: id,
      action: AuditActions.INVESTIGATION_ORDER_CANCELLED,
      ...reqCtx,
    });

    const updated = await this.findRowOrThrow(clinicId, id, scope);
    return this.toResponseDto(updated);
  }

  private async findRowOrThrow(
    clinicId: string,
    id: string,
    scope?: DoctorOwnershipScope,
  ): Promise<InvestigationOrder> {
    const row = await this.prisma.investigationOrder.findFirst({ where: { id, clinicId } });
    if (!row) throw new NotFoundException('Investigation order not found');
    if (scope?.doctorId && row.doctorId !== scope.doctorId) {
      throw new ForbiddenException('Not your investigation order');
    }
    return row;
  }

  private toResponseDto(row: InvestigationOrder): InvestigationOrderResponseDto {
    return {
      id: row.id,
      clinicId: row.clinicId,
      consultationId: row.consultationId,
      doctorId: row.doctorId,
      testName: row.testName,
      category: row.category,
      priority: row.priority as InvestigationOrderResponseDto['priority'],
      clinicalNotes: row.clinicalNotes,
      status: row.status as InvestigationOrderResponseDto['status'],
      createdByUserId: row.createdByUserId,
      cancelledAt: row.cancelledAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
