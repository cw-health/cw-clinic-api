import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Diagnosis } from '@prisma/client';
import { AuditActions } from '../audit/audit-actions';
import { AuditService } from '../audit/audit.service';
import type { AuditRequestContext } from '../common/decorators/audit-context.decorator';
import { assertScopedWrite } from '../common/scoped-write.util';
import type { DoctorOwnershipScope } from '../consultations/consultations.service';
import { ConsultationsService } from '../consultations/consultations.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateDiagnosisDto } from './dto/create-diagnosis.dto';
import type { DiagnosisResponseDto } from './dto/diagnosis-response.dto';

/**
 * Structured "Diagnosis" pipeline stage on a Consultation (docs/DATABASE.md
 * §16). Additive alongside — never a substitute for — the free-text
 * `Consultation.diagnosis` summary. Only ever written by an authenticated
 * clinician through this service; there is no autonomous/AI diagnosis path.
 */
@Injectable()
export class DiagnosesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consultationsService: ConsultationsService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    clinicId: string,
    consultationId: string,
    createdByUserId: string,
    dto: CreateDiagnosisDto,
    scope?: DoctorOwnershipScope,
    reqCtx?: AuditRequestContext,
  ): Promise<DiagnosisResponseDto> {
    const consultation = await this.consultationsService.findById(clinicId, consultationId);
    if (scope?.doctorId && consultation.doctorId !== scope.doctorId) {
      throw new ForbiddenException('Not your consultation');
    }
    if (consultation.status === 'COMPLETED') {
      throw new ConflictException(
        'Cannot add a diagnosis to a completed consultation — use consultation amendment instead',
      );
    }

    const sortOrder = await this.prisma.diagnosis.count({ where: { consultationId } });
    const created = await this.prisma.diagnosis.create({
      data: {
        clinicId,
        consultationId,
        doctorId: consultation.doctorId,
        type: dto.type,
        description: dto.description,
        icdCode: dto.icdCode,
        sortOrder,
        createdByUserId,
      },
    });

    await this.auditService.record({
      clinicId,
      actorUserId: createdByUserId,
      entity: 'Diagnosis',
      entityId: created.id,
      action: AuditActions.DIAGNOSIS_CREATED,
      ...reqCtx,
    });

    return this.toResponseDto(created);
  }

  async findAll(
    clinicId: string,
    consultationId: string,
    scope?: DoctorOwnershipScope,
  ): Promise<DiagnosisResponseDto[]> {
    const consultation = await this.consultationsService.findById(clinicId, consultationId);
    if (scope?.doctorId && consultation.doctorId !== scope.doctorId) {
      throw new ForbiddenException('Not your consultation');
    }
    const rows = await this.prisma.diagnosis.findMany({
      where: { clinicId, consultationId },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((row) => this.toResponseDto(row));
  }

  async remove(
    clinicId: string,
    consultationId: string,
    id: string,
    actorUserId: string,
    scope?: DoctorOwnershipScope,
    reqCtx?: AuditRequestContext,
  ): Promise<void> {
    const consultation = await this.consultationsService.findById(clinicId, consultationId);
    if (scope?.doctorId && consultation.doctorId !== scope.doctorId) {
      throw new ForbiddenException('Not your consultation');
    }
    if (consultation.status === 'COMPLETED') {
      throw new ConflictException('Cannot remove a diagnosis from a completed consultation');
    }

    const existing = await this.prisma.diagnosis.findFirst({
      where: { id, clinicId, consultationId },
    });
    if (!existing) throw new NotFoundException('Diagnosis not found');

    // Child row scoped by its already-verified parent id, folded into the
    // write's own where clause (docs/DATABASE.md §2), same pattern as
    // PrescriptionItem.
    const result = await this.prisma.diagnosis.deleteMany({ where: { id, consultationId } });
    assertScopedWrite(result, 'Diagnosis not found');

    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Diagnosis',
      entityId: id,
      action: AuditActions.DIAGNOSIS_DELETED,
      ...reqCtx,
    });
  }

  private toResponseDto(diagnosis: Diagnosis): DiagnosisResponseDto {
    return {
      id: diagnosis.id,
      clinicId: diagnosis.clinicId,
      consultationId: diagnosis.consultationId,
      doctorId: diagnosis.doctorId,
      type: diagnosis.type as DiagnosisResponseDto['type'],
      description: diagnosis.description,
      icdCode: diagnosis.icdCode,
      sortOrder: diagnosis.sortOrder,
      createdByUserId: diagnosis.createdByUserId,
      createdAt: diagnosis.createdAt,
      updatedAt: diagnosis.updatedAt,
    };
  }
}
