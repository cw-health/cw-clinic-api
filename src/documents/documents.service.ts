import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Document, Prisma } from '@prisma/client';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { AuditService } from '../audit/audit.service';
import { PatientsService } from '../patients/patients.service';
import { PrismaService } from '../prisma/prisma.service';
import type { PaginatedResult } from '../common/dto/pagination-query.dto';
import { assertScopedWrite } from '../common/scoped-write.util';
import type { CreateDocumentDto } from './dto/create-document.dto';
import type { DocumentResponseDto } from './dto/document-response.dto';
import type { QueryDocumentsDto, QueryOwnDocumentsDto } from './dto/query-documents.dto';
import type { DocumentDownloadTokenPayload } from './document-download-token.interface';
import {
  buildStorageKey,
  extensionMatchesMimeType,
  isAllowedMimeType,
} from './document-storage.util';
import {
  DOCUMENT_STORAGE_PROVIDER,
  type DocumentStorageProvider,
} from './storage-providers/document-storage-provider.interface';

/** Undefined means no restriction — mirrors BillingOwnershipScope. */
export interface DocumentOwnershipScope {
  patientId?: string;
}

const DOWNLOAD_TOKEN_TTL_SECONDS = 300;

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly patientsService: PatientsService,
    private readonly auditService: AuditService,
    @Inject(DOCUMENT_STORAGE_PROVIDER) private readonly storage: DocumentStorageProvider,
  ) {}

  private get downloadTokenSecret(): string {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) throw new Error('JWT_ACCESS_SECRET is not configured');
    return secret;
  }

  async create(
    clinicId: string,
    uploadedByUserId: string,
    dto: CreateDocumentDto,
    file: Express.Multer.File,
  ): Promise<DocumentResponseDto> {
    // Throws NotFoundException itself if the patient isn't in this clinic.
    await this.patientsService.findById(clinicId, dto.patientId);

    // Re-checked server-side (docs/SECURITY.md §5/§7) — the FileInterceptor
    // fileFilter already rejects these, this is defense in depth against a
    // future call site that bypasses it.
    if (!isAllowedMimeType(file.mimetype)) {
      throw new BadRequestException(`Unsupported file type: ${file.mimetype}`);
    }
    if (!extensionMatchesMimeType(file.originalname, file.mimetype)) {
      throw new BadRequestException("File extension doesn't match its declared content type");
    }

    const storageKey = buildStorageKey(clinicId, file.originalname);
    await this.storage.save(storageKey, file.buffer);

    let created: Document;
    try {
      created = await this.prisma.document.create({
        data: {
          clinicId,
          patientId: dto.patientId,
          uploadedByUserId,
          category: dto.category,
          fileName: path.basename(file.originalname).slice(0, 255),
          mimeType: file.mimetype,
          sizeBytes: file.size,
          storageKey,
          notes: dto.notes,
        },
      });
    } catch (error) {
      // The DB write is the source of truth — clean up the orphaned file if it fails.
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }

    await this.auditService.record({
      clinicId,
      actorUserId: uploadedByUserId,
      entity: 'Document',
      entityId: created.id,
      action: 'document.created',
      changedFields: `category=${created.category},fileName`,
    });

    return this.toResponseDto(clinicId, created);
  }

  async findAll(
    clinicId: string,
    query: QueryDocumentsDto,
  ): Promise<PaginatedResult<DocumentResponseDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.DocumentWhereInput = {
      clinicId,
      deletedAt: null,
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.category ? { category: query.category } : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.document.count({ where }),
      this.prisma.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const data = await Promise.all(rows.map((r) => this.toResponseDto(clinicId, r)));
    return { data, meta: { total, page, pageSize } };
  }

  async findOwnForPatient(
    clinicId: string,
    patientId: string,
    query: QueryOwnDocumentsDto,
  ): Promise<PaginatedResult<DocumentResponseDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.DocumentWhereInput = {
      clinicId,
      patientId,
      deletedAt: null,
      ...(query.category ? { category: query.category } : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.document.count({ where }),
      this.prisma.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const data = await Promise.all(rows.map((r) => this.toResponseDto(clinicId, r)));
    return { data, meta: { total, page, pageSize } };
  }

  async findById(
    clinicId: string,
    id: string,
    scope?: DocumentOwnershipScope,
  ): Promise<DocumentResponseDto> {
    const row = await this.findActiveRowOrThrow(clinicId, id, scope);
    return this.toResponseDto(clinicId, row);
  }

  async issueDownloadToken(
    clinicId: string,
    id: string,
    scope?: DocumentOwnershipScope,
  ): Promise<{ token: string; expiresInSeconds: number }> {
    await this.findActiveRowOrThrow(clinicId, id, scope);

    const payload: DocumentDownloadTokenPayload = { purpose: 'document-content', id, clinicId };
    const token = this.jwtService.sign(payload, {
      secret: this.downloadTokenSecret,
      expiresIn: DOWNLOAD_TOKEN_TTL_SECONDS,
    });
    return { token, expiresInSeconds: DOWNLOAD_TOKEN_TTL_SECONDS };
  }

  /**
   * Public, token-verified content stream (docs/SECURITY.md §9's second
   * option: "an authenticated download endpoint" — here authorization is
   * the signed, single-purpose, short-lived token itself, same rationale as
   * the invoice/prescription PDF routes, since the mobile client's existing
   * download UX opens this URL via Linking.openURL() without an
   * Authorization header attached).
   */
  async streamContentFromToken(
    id: string,
    token: string,
  ): Promise<{ stream: Readable; fileName: string; mimeType: string }> {
    let payload: DocumentDownloadTokenPayload;
    try {
      payload = this.jwtService.verify<DocumentDownloadTokenPayload>(token, {
        secret: this.downloadTokenSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired download link');
    }
    if (payload.purpose !== 'document-content' || payload.id !== id) {
      throw new UnauthorizedException('Invalid or expired download link');
    }

    const row = await this.prisma.document.findFirst({
      where: { id: payload.id, clinicId: payload.clinicId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Document not found');

    const stream = await this.storage.read(row.storageKey);
    return { stream, fileName: row.fileName, mimeType: row.mimeType };
  }

  async softDelete(clinicId: string, id: string, actorUserId: string): Promise<void> {
    const row = await this.findActiveRowOrThrow(clinicId, id);

    // Scoped at the query level, not only by the findActiveRowOrThrow check
    // above — see scoped-write.util.ts.
    const result = await this.prisma.document.updateMany({
      where: { id: row.id, clinicId },
      data: { deletedAt: new Date() },
    });
    assertScopedWrite(result, 'Document not found');

    await this.auditService.record({
      clinicId,
      actorUserId,
      entity: 'Document',
      entityId: row.id,
      action: 'document.deleted',
      changedFields: 'deletedAt',
    });
  }

  private async findActiveRowOrThrow(
    clinicId: string,
    id: string,
    scope?: DocumentOwnershipScope,
  ): Promise<Document> {
    const row = await this.prisma.document.findFirst({ where: { id, clinicId, deletedAt: null } });
    if (!row) throw new NotFoundException('Document not found');
    if (scope?.patientId && row.patientId !== scope.patientId) {
      throw new NotFoundException('Document not found');
    }
    return row;
  }

  private async toResponseDto(clinicId: string, row: Document): Promise<DocumentResponseDto> {
    const patientName = await this.patientsService
      .findById(clinicId, row.patientId)
      .then((p) => `${p.firstName} ${p.lastName}`)
      .catch(() => 'Unknown patient');

    return {
      id: row.id,
      clinicId: row.clinicId,
      patientId: row.patientId,
      patientName,
      category: row.category as DocumentResponseDto['category'],
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      notes: row.notes,
      uploadedByUserId: row.uploadedByUserId,
      createdAt: row.createdAt,
    };
  }
}
