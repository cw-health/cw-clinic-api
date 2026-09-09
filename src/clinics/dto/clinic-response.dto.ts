import type { ClinicAdminResponseDto } from './clinic-admin-response.dto';

/**
 * Tenant-facing clinic-profile response (`GET`/`PATCH /clinics/me`) — the
 * same shape as `ClinicAdminResponseDto` (Super Admin's clinic-registry
 * view). A clinic's own profile isn't a smaller/differently-shaped view of
 * itself, so this is a type alias rather than a second, drifting DTO —
 * `ClinicsService.getOwnClinic`/`updateOwnClinic` map through the same
 * `toClinicAdminResponseDto` the Super Admin controller uses.
 */
export type ClinicResponseDto = ClinicAdminResponseDto;
