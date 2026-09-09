import { Injectable } from '@nestjs/common';
import { AppointmentsService } from '../appointments/appointments.service';
import { InvoicesService } from '../billing/invoices.service';
import { PaymentsService } from '../billing/payments.service';
import type { PaginatedResult } from '../common/dto/pagination-query.dto';
import { ConsultationsService } from '../consultations/consultations.service';
import { DocumentsService } from '../documents/documents.service';
import { PatientsService } from '../patients/patients.service';
import { PrescriptionsService } from '../prescriptions/prescriptions.service';
import type { PatientTimelineEntryDto } from './dto/patient-timeline-entry.dto';
import type { QueryPatientTimelineDto } from './dto/query-patient-timeline.dto';

/**
 * How many of each source's most recent rows are pulled into the merge
 * before it's sorted/paginated as one unified list — bounded so one
 * long-history source (e.g. years of appointments) can't force loading a
 * patient's entire record just to render page 1. Adequate for a single
 * patient's realistic history size; a patient with more than this many
 * events of one type in range will only see the most recent
 * `SOURCE_FETCH_LIMIT` of that type reflected in the merged timeline — a
 * documented simplification, not a silent data loss (the type-specific
 * screens, e.g. `/appointments?patientId=`, remain the complete list).
 */
const SOURCE_FETCH_LIMIT = 50;

@Injectable()
export class PatientTimelineService {
  constructor(
    private readonly patientsService: PatientsService,
    private readonly appointmentsService: AppointmentsService,
    private readonly consultationsService: ConsultationsService,
    private readonly prescriptionsService: PrescriptionsService,
    private readonly invoicesService: InvoicesService,
    private readonly paymentsService: PaymentsService,
    private readonly documentsService: DocumentsService,
  ) {}

  /**
   * Aggregates existing appointments/consultations/prescriptions/invoices/
   * payments/documents for one patient into one sorted, paginated list —
   * stores nothing new, duplicates no data. Each source is only fetched if
   * the caller holds its read permission and (when `query.type` is set)
   * matches the requested type; a caller missing every relevant permission
   * simply gets an empty timeline rather than a 403, mirroring how the
   * admin app's own patient-detail page already conditionally renders each
   * section today.
   */
  async getTimeline(
    clinicId: string,
    patientId: string,
    grantedPermissions: readonly string[],
    query: QueryPatientTimelineDto,
  ): Promise<PaginatedResult<PatientTimelineEntryDto>> {
    await this.patientsService.findById(clinicId, patientId); // 404s if not found/wrong tenant

    const granted = new Set(grantedPermissions);
    const wants = (type: PatientTimelineEntryDto['type']) => !query.type || query.type === type;
    const dateFrom = query.dateFrom ? new Date(query.dateFrom) : undefined;
    const dateTo = query.dateTo ? new Date(query.dateTo) : undefined;
    const sourceQuery = { page: 1, pageSize: SOURCE_FETCH_LIMIT };
    const none: Promise<PatientTimelineEntryDto[]> = Promise.resolve([]);

    const entryGroups = await Promise.all([
      granted.has('appointments:read') && wants('APPOINTMENT')
        ? this.appointmentsService
            .findAll(clinicId, {
              ...sourceQuery,
              patientId,
              dateFrom: query.dateFrom,
              dateTo: query.dateTo,
            })
            .then((r) => r.data.map(appointmentToEntry))
        : none,

      granted.has('consultations:read') && wants('CONSULTATION')
        ? this.consultationsService
            .findAll(clinicId, { ...sourceQuery, patientId })
            .then((r) => r.data.map(consultationToEntry))
        : none,

      granted.has('prescriptions:read') && wants('PRESCRIPTION')
        ? this.prescriptionsService
            .findAll(clinicId, { ...sourceQuery, patientId })
            .then((r) => r.data.map(prescriptionToEntry))
        : none,

      granted.has('billing:read') && wants('INVOICE')
        ? this.invoicesService
            .findAll(clinicId, { ...sourceQuery, patientId })
            .then((r) => r.data.map(invoiceToEntry))
        : none,

      granted.has('payments:read') && wants('PAYMENT')
        ? this.paymentsService
            .findOwnForPatient(clinicId, patientId, sourceQuery)
            .then((r) => r.data.map(paymentToEntry))
        : none,

      granted.has('documents:read') && wants('DOCUMENT')
        ? this.documentsService
            .findAll(clinicId, { ...sourceQuery, patientId })
            .then((r) => r.data.map((d) => documentToEntry(d, patientId)))
        : none,
    ]);

    let entries = entryGroups.flat();
    if (dateFrom) entries = entries.filter((e) => e.occurredAt >= dateFrom);
    if (dateTo) entries = entries.filter((e) => e.occurredAt < dateTo);
    entries.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const start = (page - 1) * pageSize;
    const data = entries.slice(start, start + pageSize);

    return { data, meta: { total: entries.length, page, pageSize } };
  }
}

function appointmentToEntry(a: {
  id: string;
  startsAt: Date;
  doctorName: string;
  status: string;
  reasonForVisit: string | null;
}): PatientTimelineEntryDto {
  return {
    type: 'APPOINTMENT',
    id: a.id,
    occurredAt: a.startsAt,
    title: `Appointment with Dr. ${a.doctorName}`,
    summary: a.reasonForVisit,
    status: a.status,
    link: `/appointments/${a.id}`,
  };
}

function consultationToEntry(c: {
  id: string;
  createdAt: Date;
  doctorName: string;
  status: string;
  diagnosis: string | null;
}): PatientTimelineEntryDto {
  return {
    type: 'CONSULTATION',
    id: c.id,
    occurredAt: c.createdAt,
    title: `Consultation with Dr. ${c.doctorName}`,
    summary: c.diagnosis,
    status: c.status,
    link: `/consultations/${c.id}`,
  };
}

function prescriptionToEntry(p: {
  id: string;
  createdAt: Date;
  doctorName: string;
  status: string;
  items: { medicineName: string }[];
}): PatientTimelineEntryDto {
  return {
    type: 'PRESCRIPTION',
    id: p.id,
    occurredAt: p.createdAt,
    title: `Prescription from Dr. ${p.doctorName}`,
    summary: p.items.map((i) => i.medicineName).join(', ') || null,
    status: p.status,
    link: `/prescriptions/${p.id}`,
  };
}

function invoiceToEntry(i: {
  id: string;
  createdAt: Date;
  invoiceNumber: string | null;
  status: string;
  totalAmount: string;
}): PatientTimelineEntryDto {
  return {
    type: 'INVOICE',
    id: i.id,
    occurredAt: i.createdAt,
    title: i.invoiceNumber ? `Invoice ${i.invoiceNumber}` : 'Invoice (draft)',
    summary: `Total ${i.totalAmount}`,
    status: i.status,
    // The admin app's invoice detail route is /billing/:id, not /invoices/:id.
    link: `/billing/${i.id}`,
  };
}

function paymentToEntry(p: {
  id: string;
  invoiceId: string;
  createdAt: Date;
  amount: string;
  method: string;
  status: string;
  receiptNumber: string | null;
}): PatientTimelineEntryDto {
  return {
    type: 'PAYMENT',
    id: p.id,
    occurredAt: p.createdAt,
    title: p.receiptNumber ? `Payment (${p.receiptNumber})` : 'Payment',
    summary: `${p.amount} via ${p.method}`,
    status: p.status,
    // No standalone payment detail page in the admin app — link to its invoice instead.
    link: `/billing/${p.invoiceId}`,
  };
}

function documentToEntry(
  d: { id: string; createdAt: Date; fileName: string; category: string },
  patientId: string,
): PatientTimelineEntryDto {
  return {
    type: 'DOCUMENT',
    id: d.id,
    occurredAt: d.createdAt,
    title: d.fileName,
    summary: d.category,
    status: null,
    // No standalone document detail page in the admin app — link to the
    // patient record, whose Documents panel lists it.
    link: `/patients/${patientId}`,
  };
}
