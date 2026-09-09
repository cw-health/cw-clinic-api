import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Prescription, PrescriptionItem, Prisma } from '@prisma/client';
import { AuditActions } from '../audit/audit-actions';
import { AuditService } from '../audit/audit.service';
import type { AuditRequestContext } from '../common/decorators/audit-context.decorator';
import { ClinicsService } from '../clinics/clinics.service';
import { ConsultationsService } from '../consultations/consultations.service';
import { DoctorsService } from '../doctors/doctors.service';
import { MedicinesService } from '../medicines/medicines.service';
import type { NotificationType } from '../notifications/dto/notification-response.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { PatientsService } from '../patients/patients.service';
import { PrismaService } from '../prisma/prisma.service';
import type { PaginatedResult } from '../common/dto/pagination-query.dto';
import { assertScopedWrite } from '../common/scoped-write.util';
import type { CreatePrescriptionItemDto } from './dto/create-prescription-item.dto';
import type { CreatePrescriptionDto } from './dto/create-prescription.dto';
import type { PrescriptionResponseDto, PrescriptionStatus } from './dto/prescription-response.dto';
import type { QueryPrescriptionsDto } from './dto/query-prescriptions.dto';
import type { UpdatePrescriptionItemDto } from './dto/update-prescription-item.dto';
import type { UpdatePrescriptionDto } from './dto/update-prescription.dto';
import { renderPrescriptionPdf } from './prescription-pdf.util';
import type { PrescriptionDownloadTokenPayload } from './prescription-download-token.interface';

/** Mirrors appointments.service.ts's OwnershipScope, generalized to two axes (docs/RBAC.md §3). Undefined means no restriction. */
export interface PrescriptionOwnershipScope {
  doctorId?: string;
  patientId?: string;
}

type PrescriptionWithItems = Prescription & { items: PrescriptionItem[] };

const DOWNLOAD_TOKEN_TTL_SECONDS = 300;

@Injectable()
export class PrescriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly consultationsService: ConsultationsService,
    private readonly doctorsService: DoctorsService,
    private readonly patientsService: PatientsService,
    private readonly medicinesService: MedicinesService,
    private readonly clinicsService: ClinicsService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
  ) {}

  private get downloadTokenSecret(): string {
    // Reuses the access-token secret rather than minting a new one: the
    // download token is just as sensitive (grants a one-time document
    // read), and adding a second secret to configure/rotate would be
    // scope creep for what's still an access-token-shaped credential.
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) throw new Error('JWT_ACCESS_SECRET is not configured');
    return secret;
  }

  async create(
    clinicId: string,
    createdByUserId: string,
    dto: CreatePrescriptionDto,
    scope?: PrescriptionOwnershipScope,
    reqCtx?: AuditRequestContext,
  ): Promise<PrescriptionResponseDto> {
    const consultation = await this.consultationsService.findById(clinicId, dto.consultationId);
    if (scope?.doctorId && consultation.doctorId !== scope.doctorId) {
      throw new ForbiddenException('Not your consultation');
    }

    const existingActive = await this.prisma.prescription.findFirst({
      where: {
        clinicId,
        consultationId: dto.consultationId,
        deletedAt: null,
        status: { in: ['DRAFT', 'FINALIZED'] },
      },
    });
    if (existingActive) {
      throw new ConflictException(
        existingActive.status === 'DRAFT'
          ? 'A draft prescription already exists for this consultation'
          : 'A finalized prescription already exists for this consultation — use amend to correct it',
      );
    }

    let created: Prescription;
    try {
      created = await this.prisma.prescription.create({
        data: {
          clinicId,
          consultationId: dto.consultationId,
          doctorId: consultation.doctorId,
          patientId: consultation.patientId,
          notes: dto.notes,
          createdByUserId,
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('A draft prescription already exists for this consultation');
      }
      throw error;
    }

    await this.auditService.record({
      clinicId,
      actorUserId: createdByUserId,
      entity: 'Prescription',
      entityId: created.id,
      action: AuditActions.PRESCRIPTION_CREATED,
      ...reqCtx,
    });

    return this.toResponseDto(clinicId, { ...created, items: [] });
  }

  async findAll(
    clinicId: string,
    query: QueryPrescriptionsDto,
    scope?: PrescriptionOwnershipScope,
  ): Promise<PaginatedResult<PrescriptionResponseDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.PrescriptionWhereInput = {
      clinicId,
      deletedAt: null,
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.doctorId ? { doctorId: query.doctorId } : {}),
      ...(query.consultationId ? { consultationId: query.consultationId } : {}),
      ...(scope?.doctorId ? { doctorId: scope.doctorId } : {}),
      ...(scope?.patientId ? { patientId: scope.patientId } : {}),
    };

    const [total, prescriptions] = await this.prisma.$transaction([
      this.prisma.prescription.count({ where }),
      this.prisma.prescription.findMany({
        where,
        include: { items: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const data = await Promise.all(prescriptions.map((p) => this.toResponseDto(clinicId, p)));
    return { data, meta: { total, page, pageSize } };
  }

  /** Patient self-service history (docs/RBAC.md §4) — drafts (another doctor's in-progress work) are never visible here. */
  async findOwnForPatient(
    clinicId: string,
    patientId: string,
    query: QueryPrescriptionsDto,
  ): Promise<PaginatedResult<PrescriptionResponseDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.PrescriptionWhereInput = {
      clinicId,
      patientId,
      deletedAt: null,
      status: { in: ['FINALIZED', 'SUPERSEDED'] },
      ...(query.consultationId ? { consultationId: query.consultationId } : {}),
    };

    const [total, prescriptions] = await this.prisma.$transaction([
      this.prisma.prescription.count({ where }),
      this.prisma.prescription.findMany({
        where,
        include: { items: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const data = await Promise.all(prescriptions.map((p) => this.toResponseDto(clinicId, p)));
    return { data, meta: { total, page, pageSize } };
  }

  async findById(
    clinicId: string,
    id: string,
    scope?: PrescriptionOwnershipScope,
  ): Promise<PrescriptionResponseDto> {
    const row = await this.findActiveRowOrThrow(clinicId, id, scope);
    return this.toResponseDto(clinicId, row);
  }

  /**
   * Single-record PHI access surface — call only from `GET /prescriptions/:id`,
   * never from an internal cross-service lookup (mirrors the other
   * findByIdAudited wrappers in this phase).
   */
  async findByIdAudited(
    clinicId: string,
    id: string,
    actorUserId: string,
    scope?: PrescriptionOwnershipScope,
    reqCtx?: AuditRequestContext,
  ): Promise<PrescriptionResponseDto> {
    const prescription = await this.findById(clinicId, id, scope);
    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Prescription',
      entityId: id,
      action: AuditActions.PRESCRIPTION_VIEWED,
      ...reqCtx,
    });
    return prescription;
  }

  async update(
    clinicId: string,
    id: string,
    dto: UpdatePrescriptionDto,
    actorUserId: string,
    scope?: PrescriptionOwnershipScope,
    reqCtx?: AuditRequestContext,
  ): Promise<PrescriptionResponseDto> {
    const row = await this.findActiveRowOrThrow(clinicId, id, scope);
    this.assertDraft(row);
    // Scoped at the query level, not only by the findActiveRowOrThrow check
    // above — see scoped-write.util.ts.
    const result = await this.prisma.prescription.updateMany({
      where: { id, clinicId },
      data: { notes: dto.notes },
    });
    assertScopedWrite(result, 'Prescription not found');

    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Prescription',
      entityId: id,
      action: AuditActions.PRESCRIPTION_UPDATED,
      changedFields: Object.keys(dto).join(','),
      ...reqCtx,
    });

    return this.findById(clinicId, id, scope);
  }

  async addItem(
    clinicId: string,
    id: string,
    dto: CreatePrescriptionItemDto,
    scope?: PrescriptionOwnershipScope,
  ): Promise<PrescriptionResponseDto> {
    const row = await this.findActiveRowOrThrow(clinicId, id, scope);
    this.assertDraft(row);
    const medicine = await this.medicinesService.findPrescribableOrThrow(clinicId, dto.medicineId);

    await this.prisma.prescriptionItem.create({
      data: {
        prescriptionId: id,
        medicineId: medicine.id,
        medicineName: medicine.name,
        dosage: dto.dosage,
        frequency: dto.frequency,
        duration: dto.duration,
        route: dto.route,
        instructions: dto.instructions,
        sortOrder: row.items.length,
      },
    });
    return this.findById(clinicId, id, scope);
  }

  async updateItem(
    clinicId: string,
    id: string,
    itemId: string,
    dto: UpdatePrescriptionItemDto,
    scope?: PrescriptionOwnershipScope,
  ): Promise<PrescriptionResponseDto> {
    const row = await this.findActiveRowOrThrow(clinicId, id, scope);
    this.assertDraft(row);
    const item = row.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Prescription item not found');

    let medicineName: string | undefined;
    if (dto.medicineId) {
      const medicine = await this.medicinesService.findPrescribableOrThrow(
        clinicId,
        dto.medicineId,
      );
      medicineName = medicine.name;
    }

    // PrescriptionItem has no clinicId column of its own (it's a child of a
    // child) — `prescriptionId: id` folds the parent id, already verified
    // above to belong to this clinic, into the write's own where clause
    // rather than trusting the `row.items.find` check alone (see
    // scoped-write.util.ts).
    const result = await this.prisma.prescriptionItem.updateMany({
      where: { id: itemId, prescriptionId: id },
      data: {
        medicineId: dto.medicineId,
        medicineName,
        dosage: dto.dosage,
        frequency: dto.frequency,
        duration: dto.duration,
        route: dto.route,
        instructions: dto.instructions,
      },
    });
    assertScopedWrite(result, 'Prescription item not found');
    return this.findById(clinicId, id, scope);
  }

  async removeItem(
    clinicId: string,
    id: string,
    itemId: string,
    scope?: PrescriptionOwnershipScope,
  ): Promise<PrescriptionResponseDto> {
    const row = await this.findActiveRowOrThrow(clinicId, id, scope);
    this.assertDraft(row);
    const item = row.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Prescription item not found');

    const result = await this.prisma.prescriptionItem.deleteMany({
      where: { id: itemId, prescriptionId: id },
    });
    assertScopedWrite(result, 'Prescription item not found');
    return this.findById(clinicId, id, scope);
  }

  /** Finalizing an amendment also supersedes the prescription it amends — see model Prescription's doc comment. */
  async finalize(
    clinicId: string,
    id: string,
    actorUserId: string,
    scope?: PrescriptionOwnershipScope,
    reqCtx?: AuditRequestContext,
  ): Promise<PrescriptionResponseDto> {
    const row = await this.findActiveRowOrThrow(clinicId, id, scope);
    this.assertDraft(row);
    if (row.items.length === 0) {
      throw new BadRequestException('Cannot finalize a prescription with no medicines');
    }

    const now = new Date();
    const [finalizeResult] = await this.prisma.$transaction([
      this.prisma.prescription.updateMany({
        where: { id, clinicId },
        data: { status: 'FINALIZED', finalizedAt: now },
      }),
      ...(row.amendsId
        ? [
            this.prisma.prescription.updateMany({
              where: { id: row.amendsId, clinicId },
              data: { status: 'SUPERSEDED', supersededAt: now },
            }),
          ]
        : []),
    ]);
    assertScopedWrite(finalizeResult, 'Prescription not found');

    // Audited only after the transaction above has actually committed —
    // never for a finalize that failed partway through.
    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Prescription',
      entityId: id,
      action: AuditActions.PRESCRIPTION_FINALIZED,
      ...reqCtx,
    });

    await this.notifyPrescriptionReady(clinicId, row.patientId, id);
    return this.findById(clinicId, id, scope);
  }

  /**
   * Best-effort notification to the patient's portal user (docs/ROADMAP.md
   * Phase 7) — never allowed to fail the finalize it accompanies. Skipped
   * silently if the patient has no linked User (Patient.userId is
   * nullable) or if the lookup/write otherwise fails.
   */
  private async notifyPrescriptionReady(
    clinicId: string,
    patientId: string,
    prescriptionId: string,
  ): Promise<void> {
    const patient = await this.patientsService.findById(clinicId, patientId).catch(() => null);
    if (!patient?.userId) return;

    const type: NotificationType = 'PRESCRIPTION_READY';
    await this.notificationsService
      .create(
        clinicId,
        patient.userId,
        type,
        'Your prescription is ready',
        'Your prescription is ready.',
        'Prescription',
        prescriptionId,
      )
      .catch(() => undefined);
  }

  /** Explicit amendment/version strategy (task brief): correcting a finalized prescription creates a new DRAFT version rather than editing it in place. */
  async amend(
    clinicId: string,
    id: string,
    actorUserId: string,
    scope?: PrescriptionOwnershipScope,
    reqCtx?: AuditRequestContext,
  ): Promise<PrescriptionResponseDto> {
    const row = await this.findActiveRowOrThrow(clinicId, id, scope);
    if (row.status !== 'FINALIZED') {
      throw new ConflictException('Only a finalized prescription can be amended');
    }

    const existingAmendment = await this.prisma.prescription.findFirst({
      where: { amendsId: id, deletedAt: null },
    });
    if (existingAmendment) {
      throw new ConflictException(
        `This prescription has already been amended (see prescription ${existingAmendment.id})`,
      );
    }

    const created = await this.prisma.prescription.create({
      data: {
        clinicId,
        consultationId: row.consultationId,
        doctorId: row.doctorId,
        patientId: row.patientId,
        version: row.version + 1,
        amendsId: row.id,
        notes: row.notes,
        createdByUserId: row.createdByUserId,
      },
    });

    if (row.items.length > 0) {
      await this.prisma.prescriptionItem.createMany({
        data: row.items.map((item) => ({
          prescriptionId: created.id,
          medicineId: item.medicineId,
          medicineName: item.medicineName,
          dosage: item.dosage,
          frequency: item.frequency,
          duration: item.duration,
          route: item.route,
          instructions: item.instructions,
          sortOrder: item.sortOrder,
        })),
      });
    }

    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Prescription',
      entityId: created.id,
      action: AuditActions.PRESCRIPTION_AMENDED,
      changedFields: `amendsId=${row.id}`,
      ...reqCtx,
    });

    return this.findById(clinicId, created.id, scope);
  }

  /** Mints the short-lived token consumed by the public PDF route — see prescription-download-token.interface.ts. */
  async issueDownloadToken(
    clinicId: string,
    id: string,
    scope?: PrescriptionOwnershipScope,
  ): Promise<{ token: string; expiresInSeconds: number }> {
    const row = await this.findActiveRowOrThrow(clinicId, id, scope);
    if (row.status === 'DRAFT') {
      throw new ForbiddenException('Cannot download a draft prescription');
    }

    const payload: PrescriptionDownloadTokenPayload = {
      purpose: 'prescription-pdf',
      prescriptionId: id,
      clinicId,
    };
    const token = this.jwtService.sign(payload, {
      secret: this.downloadTokenSecret,
      expiresIn: DOWNLOAD_TOKEN_TTL_SECONDS,
    });
    return { token, expiresInSeconds: DOWNLOAD_TOKEN_TTL_SECONDS };
  }

  /** Verifies the signed token itself (no request-scoped auth/tenant context — this backs the `@Public()` PDF route). */
  async generatePdfFromToken(
    id: string,
    token: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    let payload: PrescriptionDownloadTokenPayload;
    try {
      payload = this.jwtService.verify<PrescriptionDownloadTokenPayload>(token, {
        secret: this.downloadTokenSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired download link');
    }
    if (payload.purpose !== 'prescription-pdf' || payload.prescriptionId !== id) {
      throw new UnauthorizedException('Invalid or expired download link');
    }

    const row = await this.prisma.prescription.findFirst({
      where: { id: payload.prescriptionId, clinicId: payload.clinicId, deletedAt: null },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!row || row.status === 'DRAFT') {
      throw new NotFoundException('Prescription not found');
    }

    const dto = await this.toResponseDto(payload.clinicId, row);
    const clinic = await this.clinicsService.getOwnClinic(payload.clinicId);
    const buffer = await renderPrescriptionPdf(dto, clinic.name);
    return { buffer, filename: `prescription-${row.id}.pdf` };
  }

  private assertDraft(row: PrescriptionWithItems): void {
    if (row.status !== 'DRAFT') {
      throw new ConflictException('Cannot modify a finalized prescription — use amend instead');
    }
  }

  private async findActiveRowOrThrow(
    clinicId: string,
    id: string,
    scope?: PrescriptionOwnershipScope,
  ): Promise<PrescriptionWithItems> {
    const row = await this.prisma.prescription.findFirst({
      where: { id, clinicId, deletedAt: null },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!row) throw new NotFoundException('Prescription not found');
    if (scope?.doctorId && row.doctorId !== scope.doctorId) {
      throw new ForbiddenException('Not your prescription');
    }
    if (scope?.patientId) {
      if (row.patientId !== scope.patientId) {
        throw new ForbiddenException('Not your prescription');
      }
      // A patient never sees another doctor's in-progress draft.
      if (row.status === 'DRAFT') throw new NotFoundException('Prescription not found');
    }
    return row;
  }

  private async toResponseDto(
    clinicId: string,
    prescription: PrescriptionWithItems,
  ): Promise<PrescriptionResponseDto> {
    const [doctorName, patientName] = await Promise.all([
      this.doctorsService
        .findById(clinicId, prescription.doctorId)
        .then((d) => `${d.firstName} ${d.lastName}`)
        .catch(() => 'Unknown doctor'),
      this.patientsService
        .findById(clinicId, prescription.patientId)
        .then((p) => `${p.firstName} ${p.lastName}`)
        .catch(() => 'Unknown patient'),
    ]);

    return {
      id: prescription.id,
      clinicId: prescription.clinicId,
      consultationId: prescription.consultationId,
      doctorId: prescription.doctorId,
      doctorName,
      patientId: prescription.patientId,
      patientName,
      status: prescription.status as PrescriptionStatus,
      version: prescription.version,
      amendsId: prescription.amendsId,
      notes: prescription.notes,
      items: prescription.items.map((item) => ({
        id: item.id,
        medicineId: item.medicineId,
        medicineName: item.medicineName,
        dosage: item.dosage,
        frequency: item.frequency,
        duration: item.duration,
        route: item.route,
        instructions: item.instructions,
        sortOrder: item.sortOrder,
      })),
      createdByUserId: prescription.createdByUserId,
      finalizedAt: prescription.finalizedAt,
      supersededAt: prescription.supersededAt,
      createdAt: prescription.createdAt,
      updatedAt: prescription.updatedAt,
    };
  }
}
