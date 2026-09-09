import type { AppointmentsService } from '../appointments/appointments.service';
import type { InvoicesService } from '../billing/invoices.service';
import type { PaymentsService } from '../billing/payments.service';
import type { ConsultationsService } from '../consultations/consultations.service';
import type { DocumentsService } from '../documents/documents.service';
import type { PatientsService } from '../patients/patients.service';
import type { PrescriptionsService } from '../prescriptions/prescriptions.service';
import { PatientTimelineService } from './patient-timeline.service';

const paginated = (data: unknown[]) => ({
  data,
  meta: { total: data.length, page: 1, pageSize: 50 },
});

function makeService() {
  const patientsService = { findById: jest.fn().mockResolvedValue({ id: 'patient-1' }) };
  const appointmentsService = {
    findAll: jest.fn().mockResolvedValue(
      paginated([
        {
          id: 'appt-1',
          startsAt: new Date('2026-01-05T10:00:00Z'),
          doctorName: 'Smith',
          status: 'COMPLETED',
          reasonForVisit: 'Checkup',
        },
      ]),
    ),
  };
  const consultationsService = {
    findAll: jest.fn().mockResolvedValue(
      paginated([
        {
          id: 'cons-1',
          createdAt: new Date('2026-01-05T10:15:00Z'),
          doctorName: 'Smith',
          status: 'COMPLETED',
          diagnosis: 'Flu',
        },
      ]),
    ),
  };
  const prescriptionsService = {
    findAll: jest.fn().mockResolvedValue(
      paginated([
        {
          id: 'rx-1',
          createdAt: new Date('2026-01-05T10:20:00Z'),
          doctorName: 'Smith',
          status: 'FINALIZED',
          items: [{ medicineName: 'Paracetamol' }],
        },
      ]),
    ),
  };
  const invoicesService = {
    findAll: jest.fn().mockResolvedValue(
      paginated([
        {
          id: 'inv-1',
          createdAt: new Date('2026-01-05T10:25:00Z'),
          invoiceNumber: 'INV-1',
          status: 'ISSUED',
          totalAmount: '500.00',
        },
      ]),
    ),
  };
  const paymentsService = {
    findOwnForPatient: jest.fn().mockResolvedValue(
      paginated([
        {
          id: 'pay-1',
          createdAt: new Date('2026-01-05T10:30:00Z'),
          amount: '500.00',
          method: 'CASH',
          status: 'COMPLETED',
          receiptNumber: 'RCPT-1',
        },
      ]),
    ),
  };
  const documentsService = {
    findAll: jest.fn().mockResolvedValue(
      paginated([
        {
          id: 'doc-1',
          createdAt: new Date('2026-01-04T09:00:00Z'),
          fileName: 'lab.pdf',
          category: 'LAB_REPORT',
        },
      ]),
    ),
  };

  const service = new PatientTimelineService(
    patientsService as unknown as PatientsService,
    appointmentsService as unknown as AppointmentsService,
    consultationsService as unknown as ConsultationsService,
    prescriptionsService as unknown as PrescriptionsService,
    invoicesService as unknown as InvoicesService,
    paymentsService as unknown as PaymentsService,
    documentsService as unknown as DocumentsService,
  );

  return {
    service,
    patientsService,
    appointmentsService,
    consultationsService,
    prescriptionsService,
    invoicesService,
    paymentsService,
    documentsService,
  };
}

const ALL_PERMISSIONS = [
  'appointments:read',
  'consultations:read',
  'prescriptions:read',
  'billing:read',
  'payments:read',
  'documents:read',
];

describe('PatientTimelineService', () => {
  it('404s (via PatientsService) for a patient outside the caller clinic', async () => {
    const { service, patientsService } = makeService();
    patientsService.findById.mockRejectedValue(new Error('not found'));

    await expect(service.getTimeline('clinic-a', 'patient-x', ALL_PERMISSIONS, {})).rejects.toThrow(
      'not found',
    );
  });

  it('merges every source, sorted by occurredAt descending', async () => {
    const { service } = makeService();

    const result = await service.getTimeline('clinic-a', 'patient-1', ALL_PERMISSIONS, {});

    expect(result.data.map((e) => e.type)).toEqual([
      'PAYMENT',
      'INVOICE',
      'PRESCRIPTION',
      'CONSULTATION',
      'APPOINTMENT',
      'DOCUMENT',
    ]);
    expect(result.meta.total).toBe(6);
  });

  it('never duplicates data — each entry only projects id/occurredAt/title/summary/status/link', async () => {
    const { service } = makeService();

    const result = await service.getTimeline('clinic-a', 'patient-1', ALL_PERMISSIONS, {});

    for (const entry of result.data) {
      expect(Object.keys(entry).sort()).toEqual(
        ['id', 'link', 'occurredAt', 'status', 'summary', 'title', 'type'].sort(),
      );
    }
  });

  it('omits a source entirely when the caller lacks its read permission (no 403, just fewer entries)', async () => {
    const { service, invoicesService, paymentsService } = makeService();

    const result = await service.getTimeline('clinic-a', 'patient-1', ['appointments:read'], {});

    expect(result.data.map((e) => e.type)).toEqual(['APPOINTMENT']);
    expect(invoicesService.findAll).not.toHaveBeenCalled();
    expect(paymentsService.findOwnForPatient).not.toHaveBeenCalled();
  });

  it('restricts to a single source when query.type is set', async () => {
    const { service, appointmentsService, documentsService } = makeService();

    const result = await service.getTimeline('clinic-a', 'patient-1', ALL_PERMISSIONS, {
      type: 'DOCUMENT',
    });

    expect(result.data.map((e) => e.type)).toEqual(['DOCUMENT']);
    expect(appointmentsService.findAll).not.toHaveBeenCalled();
    expect(documentsService.findAll).toHaveBeenCalled();
  });

  it('paginates the merged, sorted list', async () => {
    const { service } = makeService();

    const result = await service.getTimeline('clinic-a', 'patient-1', ALL_PERMISSIONS, {
      page: 2,
      pageSize: 2,
    });

    expect(result.data).toHaveLength(2);
    expect(result.data.map((e) => e.type)).toEqual(['PRESCRIPTION', 'CONSULTATION']);
    expect(result.meta).toEqual({ total: 6, page: 2, pageSize: 2 });
  });
});
