import { Injectable } from '@nestjs/common';
import { ClinicsService } from '../clinics/clinics.service';
import type { PaginatedResult } from '../common/dto/pagination-query.dto';
import { DoctorsService } from '../doctors/doctors.service';
import { PatientsService } from '../patients/patients.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CurrentPlanLimits } from '../subscriptions/subscription-mapping.util';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import type { ClinicUsageSummaryDto, UsageResourceDto } from './dto/clinic-usage-response.dto';
import type { QueryUsageDto } from './dto/query-usage.dto';
import type { UsageResourceKey } from './usage-resource-keys';

/**
 * Roles a `ClinicMembership` can hold that are neither "doctor" nor
 * "patient" — the population `Plan.maxStaff` is meant to cap (SA-09,
 * docs/SUPER_ADMIN_ARCHITECTURE.md §6.15).
 */
const NON_STAFF_ROLE_NAMES = ['Doctor', 'Patient'];

/**
 * Clinic Usage & Limits (SA-09): compares each clinic's real, currently-
 * queryable resource counts (doctors/staff/patients) against its plan's
 * limits. Deliberately computed live via a handful of indexed aggregate
 * queries rather than a periodic `ClinicUsageSnapshot` table + scheduled
 * job — the architecture doc (§6.15) floats a snapshot for this, but that's
 * infrastructure this MVP doesn't need yet: the overview reads the small,
 * global subscriptions-with-plan table once and takes at most three
 * `groupBy` aggregates (one per resource) regardless of clinic count, and
 * the per-clinic detail view takes three single-row `count()`s — neither
 * is a full-table scan repeated per request per clinic. Add a snapshot
 * later only if this stops being fast enough at real scale (matches the
 * codebase's existing bias against premature optimization, CLAUDE.md #10).
 */
@Injectable()
export class UsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clinicsService: ClinicsService,
    private readonly doctorsService: DoctorsService,
    private readonly patientsService: PatientsService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  private async staffCount(clinicId: string): Promise<number> {
    return this.prisma.clinicMembership.count({
      where: { clinicId, status: 'ACTIVE', role: { name: { notIn: NON_STAFF_ROLE_NAMES } } },
    });
  }

  private async staffCountsGrouped(clinicIds: string[]): Promise<Map<string, number>> {
    if (clinicIds.length === 0) return new Map();
    const rows = await this.prisma.clinicMembership.groupBy({
      by: ['clinicId'],
      where: {
        clinicId: { in: clinicIds },
        status: 'ACTIVE',
        role: { name: { notIn: NON_STAFF_ROLE_NAMES } },
      },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.clinicId, row._count._all]));
  }

  private buildResource(
    resource: UsageResourceKey,
    currentUsage: number,
    limit: number | null,
  ): UsageResourceDto {
    const overLimit = limit != null && currentUsage > limit;
    const utilizationPercent =
      limit == null
        ? null
        : limit === 0
          ? currentUsage > 0
            ? 100
            : 0
          : Math.round((currentUsage / limit) * 1000) / 10;
    return { resource, currentUsage, limit, utilizationPercent, overLimit };
  }

  private buildSummary(
    clinicId: string,
    clinicName: string | null,
    planLimits: Pick<
      CurrentPlanLimits,
      'planId' | 'planName' | 'subscriptionStatus' | 'maxDoctors' | 'maxStaff' | 'maxPatients'
    > | null,
    counts: { doctors: number; staff: number; patients: number },
    asOf: Date,
  ): ClinicUsageSummaryDto {
    const resources = [
      this.buildResource('DOCTORS', counts.doctors, planLimits?.maxDoctors ?? null),
      this.buildResource('STAFF', counts.staff, planLimits?.maxStaff ?? null),
      this.buildResource('PATIENTS', counts.patients, planLimits?.maxPatients ?? null),
    ];
    return {
      clinicId,
      clinicName,
      planId: planLimits?.planId ?? null,
      planName: planLimits?.planName ?? null,
      subscriptionStatus: planLimits?.subscriptionStatus ?? null,
      resources,
      overLimitAny: resources.some((resource) => resource.overLimit),
      asOf,
    };
  }

  /** Per-clinic usage detail (SA-09) — addressed by `:clinicId`, e.g. a clinic-detail "Usage" tab. */
  async getClinicUsage(clinicId: string): Promise<ClinicUsageSummaryDto> {
    const clinic = await this.clinicsService.getClinicById(clinicId);
    const [planLimits, doctors, patients, staff] = await Promise.all([
      this.subscriptionsService.getCurrentPlanLimits(clinicId),
      this.doctorsService.countActive(clinicId),
      this.patientsService.countActive(clinicId),
      this.staffCount(clinicId),
    ]);
    return this.buildSummary(
      clinicId,
      clinic.name,
      planLimits,
      { doctors, patients, staff },
      new Date(),
    );
  }

  /**
   * Cross-clinic usage overview (SA-09). Scoped to clinics that currently
   * have a subscription — a clinic with no plan has no limit to compare
   * against, so it has nothing meaningful to show here (it still shows up
   * normally in Clinic Management). `overLimitOnly`/sort operate over the
   * full filtered set before paginating, since "which clinics are over
   * limit" is inherently a whole-set question, not a page-at-a-time one.
   */
  async getOverview(query: QueryUsageDto): Promise<PaginatedResult<ClinicUsageSummaryDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const sortBy = query.sortBy ?? 'utilization';
    const sortOrder = query.sortOrder ?? 'desc';

    const planLimitsList = await this.subscriptionsService.listAllCurrentPlanLimits({
      planId: query.planId,
      search: query.search,
    });
    const clinicIds = planLimitsList.map((row) => row.clinicId);

    const [doctorCounts, patientCounts, staffCounts] = await Promise.all([
      this.doctorsService.countActiveGroupedByClinic(clinicIds),
      this.patientsService.countActiveGroupedByClinic(clinicIds),
      this.staffCountsGrouped(clinicIds),
    ]);

    const asOf = new Date();
    let summaries = planLimitsList.map((row) =>
      this.buildSummary(
        row.clinicId,
        row.clinicName,
        row,
        {
          doctors: doctorCounts.get(row.clinicId) ?? 0,
          patients: patientCounts.get(row.clinicId) ?? 0,
          staff: staffCounts.get(row.clinicId) ?? 0,
        },
        asOf,
      ),
    );

    if (query.overLimitOnly) {
      summaries = summaries.filter((summary) => summary.overLimitAny);
    }

    const direction = sortOrder === 'asc' ? 1 : -1;
    summaries.sort((a, b) => {
      if (sortBy === 'clinicName') {
        return direction * (a.clinicName ?? '').localeCompare(b.clinicName ?? '');
      }
      const worst = (summary: ClinicUsageSummaryDto) =>
        Math.max(...summary.resources.map((resource) => resource.utilizationPercent ?? -1));
      return direction * (worst(a) - worst(b));
    });

    const total = summaries.length;
    const start = (page - 1) * pageSize;
    return { data: summaries.slice(start, start + pageSize), meta: { total, page, pageSize } };
  }
}
