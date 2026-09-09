import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { PatientsService } from '../patients/patients.service';
import type { PrismaService } from '../prisma/prisma.service';
import { DocumentsService } from './documents.service';
import type { DocumentStorageProvider } from './storage-providers/document-storage-provider.interface';

const patientDto = {
  id: 'patient-1',
  clinicId: 'clinic-a',
  firstName: 'Grace',
  lastName: 'Hopper',
};

const baseDocument = {
  id: 'doc-1',
  clinicId: 'clinic-a',
  patientId: 'patient-1',
  uploadedByUserId: 'user-fd-1',
  category: 'LAB_REPORT',
  fileName: 'report.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1024,
  storageKey: 'clinic-a/uuid-report.pdf',
  notes: null,
  deletedAt: null as Date | null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeService() {
  const prisma = {
    document: {
      create: jest.fn().mockResolvedValue(baseDocument),
      findFirst: jest.fn().mockResolvedValue(baseDocument),
      findMany: jest.fn().mockResolvedValue([baseDocument]),
      count: jest.fn().mockResolvedValue(1),
      update: jest.fn().mockResolvedValue({ ...baseDocument, deletedAt: new Date() }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  } as unknown as Record<string, unknown>;
  prisma.$transaction = jest.fn(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(prisma);
    return Promise.all(arg as Promise<unknown>[]);
  });

  const patientsService = {
    findById: jest.fn().mockResolvedValue(patientDto),
    findOwn: jest.fn().mockResolvedValue(patientDto),
  } as unknown as PatientsService;
  const auditService = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  const jwtService = { sign: jest.fn().mockReturnValue('token'), verify: jest.fn() };
  const storage: jest.Mocked<DocumentStorageProvider> = {
    save: jest.fn().mockResolvedValue(undefined),
    read: jest.fn().mockResolvedValue({ pipe: jest.fn() }),
    delete: jest.fn().mockResolvedValue(undefined),
  };

  const service = new DocumentsService(
    prisma as unknown as PrismaService,
    jwtService as never,
    patientsService,
    auditService,
    storage,
  );

  return { service, prisma, patientsService, auditService, jwtService, storage };
}

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'report.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    size: 1024,
    buffer: Buffer.from('fake-pdf'),
    destination: '',
    filename: '',
    path: '',
    stream: undefined as never,
    ...overrides,
  };
}

describe('DocumentsService', () => {
  describe('create', () => {
    it('writes the file and creates a document row, then records a document.created audit event', async () => {
      const { service, prisma, auditService, storage } = makeService();
      await service.create(
        'clinic-a',
        'user-fd-1',
        { patientId: 'patient-1', category: 'LAB_REPORT' },
        makeFile(),
      );

      expect((storage as unknown as { save: jest.Mock }).save).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Buffer),
      );
      expect((prisma.document as { create: jest.Mock }).create).toHaveBeenCalled();
      expect((auditService as unknown as { record: jest.Mock }).record).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'Document', action: 'document.created' }),
      );
    });

    it('deletes the just-saved file via the storage provider if the DB write fails', async () => {
      const { service, prisma, storage } = makeService();
      (prisma.document as { create: jest.Mock }).create.mockRejectedValueOnce(new Error('db down'));
      await expect(
        service.create(
          'clinic-a',
          'user-fd-1',
          { patientId: 'patient-1', category: 'LAB_REPORT' },
          makeFile(),
        ),
      ).rejects.toThrow('db down');
      expect((storage as unknown as { delete: jest.Mock }).delete).toHaveBeenCalledWith(
        expect.any(String),
      );
    });

    it('rejects a disallowed mime type', async () => {
      const { service } = makeService();
      await expect(
        service.create(
          'clinic-a',
          'user-fd-1',
          { patientId: 'patient-1', category: 'LAB_REPORT' },
          makeFile({ mimetype: 'application/zip', originalname: 'archive.zip' }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a filename extension that does not match the declared mime type', async () => {
      const { service } = makeService();
      await expect(
        service.create(
          'clinic-a',
          'user-fd-1',
          { patientId: 'patient-1', category: 'LAB_REPORT' },
          makeFile({ mimetype: 'application/pdf', originalname: 'report.png' }),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('ownership scoping', () => {
    it('findById returns metadata (never storageKey) for a staff-scoped read', async () => {
      const { service } = makeService();
      const result = await service.findById('clinic-a', 'doc-1');
      expect(result).not.toHaveProperty('storageKey');
      expect(result.patientName).toBe('Grace Hopper');
    });

    it('404s (never leaking existence) for a patient-scoped read of someone else’s document', async () => {
      const { service } = makeService();
      await expect(
        service.findById('clinic-a', 'doc-1', { patientId: 'someone-else' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('allows a patient-scoped read of their own document', async () => {
      const { service } = makeService();
      const result = await service.findById('clinic-a', 'doc-1', { patientId: 'patient-1' });
      expect(result.id).toBe('doc-1');
    });

    it('404s when the document is soft-deleted (not returned by findFirst with deletedAt: null)', async () => {
      const { service, prisma } = makeService();
      (prisma.document as { findFirst: jest.Mock }).findFirst.mockResolvedValue(null);
      await expect(service.findById('clinic-a', 'doc-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('secure content download', () => {
    it('rejects a garbage token', async () => {
      const { service, jwtService } = makeService();
      jwtService.verify.mockImplementation(() => {
        throw new Error('bad token');
      });
      await expect(service.streamContentFromToken('doc-1', 'garbage')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a token minted for a different document id', async () => {
      const { service, jwtService } = makeService();
      jwtService.verify.mockReturnValue({
        purpose: 'document-content',
        id: 'doc-2',
        clinicId: 'clinic-a',
      });
      await expect(service.streamContentFromToken('doc-1', 'token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('streams the file for a valid token', async () => {
      const { service, jwtService, storage } = makeService();
      jwtService.verify.mockReturnValue({
        purpose: 'document-content',
        id: 'doc-1',
        clinicId: 'clinic-a',
      });
      const result = await service.streamContentFromToken('doc-1', 'token');
      expect(result.fileName).toBe('report.pdf');
      expect(result.mimeType).toBe('application/pdf');
      expect((storage as unknown as { read: jest.Mock }).read).toHaveBeenCalledWith(
        baseDocument.storageKey,
      );
    });
  });

  describe('softDelete', () => {
    it('sets deletedAt and records a document.deleted audit event', async () => {
      const { service, prisma, auditService } = makeService();
      await service.softDelete('clinic-a', 'doc-1', 'user-admin-1');
      expect((prisma.document as { updateMany: jest.Mock }).updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'doc-1', clinicId: 'clinic-a' },
          data: { deletedAt: expect.any(Date) as Date },
        }),
      );
      expect((auditService as unknown as { record: jest.Mock }).record).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'Document', action: 'document.deleted' }),
      );
    });
  });
});
