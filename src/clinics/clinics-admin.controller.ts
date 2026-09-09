import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ALLOWED_MIME_TYPES, MAX_DOCUMENT_SIZE_BYTES } from '../documents/document-storage.util';
import { ClinicsService } from './clinics.service';
import { AdminUpdateClinicDto } from './dto/admin-update-clinic.dto';
import { CreateClinicDocumentDto } from './dto/create-clinic-document.dto';
import { CreateClinicDto } from './dto/create-clinic.dto';
import { CreatePrimaryAdminDto } from './dto/create-primary-admin.dto';
import { QueryClinicsDto } from './dto/query-clinics.dto';
import { SetWorkingHoursDto } from './dto/set-working-hours.dto';

/**
 * Super Admin's clinic-registry CRUD (SA-03, extended SA-03.1 for
 * onboarding: legal/registration profile, primary administrator,
 * registration documents, admin-facing working hours) — new controller in
 * the existing `clinics` module, reusing `ClinicsService`, per
 * docs/SUPER_ADMIN_ARCHITECTURE.md §9 (module-boundary rule applied to
 * Super Admin itself: reuse the service, don't duplicate `Clinic` writes
 * in a second controller's persistence path). Distinct from
 * `ClinicsController`, which only ever acts on the caller's own clinic.
 */
@ApiTags('super-admin-clinics')
@ApiBearerAuth()
@Controller({ path: 'super-admin/clinics', version: '1' })
export class ClinicsAdminController {
  constructor(private readonly clinicsService: ClinicsService) {}

  @Post()
  @RequirePermissions('super-admin:clinics-create')
  async create(@Body() dto: CreateClinicDto, @CurrentUser() user: JwtPayload) {
    return this.clinicsService.createClinic(dto, user.sub);
  }

  @Get()
  @RequirePermissions('super-admin:clinics-read')
  async list(@Query() query: QueryClinicsDto) {
    return this.clinicsService.listClinics(query);
  }

  @Get(':id')
  @RequirePermissions('super-admin:clinics-read')
  async findOne(@Param('id') id: string) {
    return this.clinicsService.getClinicById(id);
  }

  @Patch(':id')
  @RequirePermissions('super-admin:clinics-update')
  async update(
    @Param('id') id: string,
    @Body() dto: AdminUpdateClinicDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.clinicsService.updateClinicAdmin(id, dto, user.sub);
  }

  @Post(':id/activate')
  @RequirePermissions('super-admin:clinics-activate')
  async activate(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.clinicsService.activateClinic(id, user.sub);
  }

  @Post(':id/suspend')
  @RequirePermissions('super-admin:clinics-suspend')
  async suspend(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.clinicsService.suspendClinic(id, user.sub);
  }

  @Post(':id/archive')
  @RequirePermissions('super-admin:clinics-archive')
  async archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.clinicsService.archiveClinic(id, user.sub);
  }

  /**
   * Assigns a primary administrator to a clinic created without one (or
   * one still missing it) — the deferred half of `CreateClinicDto`'s
   * optional nested `primaryAdmin` (SA-03.1). Reuses `super-admin:clinics-
   * update` rather than a new permission key: this is squarely a clinic-
   * profile-completion action, not a distinct capability.
   */
  @Post(':id/primary-admin')
  @RequirePermissions('super-admin:clinics-update')
  async assignPrimaryAdmin(
    @Param('id') id: string,
    @Body() dto: CreatePrimaryAdminDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.clinicsService.assignPrimaryAdmin(id, dto, user.sub);
  }

  /**
   * Admin-facing working hours (SA-03.1) — reuses the exact same
   * `ClinicWorkingHours` model/service methods `ClinicsController` exposes
   * at `/clinics/me/working-hours` for clinic-staff self-service; this is
   * the same data, just addressed by `:id` for Super Admin instead of the
   * caller's own tenant context. No duplicated scheduling logic.
   */
  @Get(':id/working-hours')
  @RequirePermissions('super-admin:clinics-read')
  async getWorkingHours(@Param('id') id: string) {
    return this.clinicsService.getWorkingHours(id);
  }

  @Put(':id/working-hours')
  @RequirePermissions('super-admin:clinics-update')
  async setWorkingHours(
    @Param('id') id: string,
    @Body() dto: SetWorkingHoursDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.clinicsService.setWorkingHours(id, dto, user.sub);
  }

  // ---- Clinic registration documents (SA-03.1) ----

  @Post(':id/documents')
  @RequirePermissions('super-admin:clinics-update')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_DOCUMENT_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!Object.prototype.hasOwnProperty.call(ALLOWED_MIME_TYPES, file.mimetype)) {
          callback(new BadRequestException(`Unsupported file type: ${file.mimetype}`), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  async uploadDocument(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateClinicDocumentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('A file is required');
    return this.clinicsService.uploadClinicDocument(id, user.sub, dto, file);
  }

  @Get(':id/documents')
  @RequirePermissions('super-admin:clinics-read')
  async listDocuments(@Param('id') id: string) {
    return this.clinicsService.listClinicDocuments(id);
  }

  @Get(':id/documents/:documentId/content')
  @RequirePermissions('super-admin:clinics-read')
  async downloadDocument(@Param('id') id: string, @Param('documentId') documentId: string) {
    const { stream, fileName, mimeType } = await this.clinicsService.getClinicDocumentContent(
      id,
      documentId,
    );
    return new StreamableFile(stream, {
      type: mimeType,
      disposition: `attachment; filename="${fileName}"`,
    });
  }

  @Delete(':id/documents/:documentId')
  @RequirePermissions('super-admin:clinics-update')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDocument(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.clinicsService.deleteClinicDocument(id, documentId, user.sub);
  }
}
