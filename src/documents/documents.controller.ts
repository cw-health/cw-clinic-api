import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { RequireAnyPermission } from '../auth/decorators/require-any-permission.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Tenant } from '../auth/decorators/tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/guards/tenant.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { requireClinicId } from '../common/require-clinic-id.util';
import { PatientsService } from '../patients/patients.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { QueryDocumentsDto, QueryOwnDocumentsDto } from './dto/query-documents.dto';
import { DocumentsService, type DocumentOwnershipScope } from './documents.service';
import { ALLOWED_MIME_TYPES, MAX_DOCUMENT_SIZE_BYTES } from './document-storage.util';

@ApiTags('documents')
@ApiBearerAuth()
@Controller({ path: 'documents', version: '1' })
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly patientsService: PatientsService,
  ) {}

  @Post()
  @RequirePermissions('documents:create')
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
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateDocumentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('A file is required');
    const clinicId = requireClinicId(tenant);
    return this.documentsService.create(clinicId, user.sub, dto, file);
  }

  @Get()
  @RequirePermissions('documents:read')
  async findAll(@Tenant() tenant: TenantContext, @Query() query: QueryDocumentsDto) {
    const clinicId = requireClinicId(tenant);
    return this.documentsService.findAll(clinicId, query);
  }

  // Declared ahead of the ':id' routes below so Nest doesn't match "me" as an :id param.
  @Get('me')
  @RequirePermissions('documents:read-own')
  async findOwn(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryOwnDocumentsDto,
  ) {
    const clinicId = requireClinicId(tenant);
    const ownPatient = await this.patientsService.findOwn(clinicId, user.sub);
    return this.documentsService.findOwnForPatient(clinicId, ownPatient.id, query);
  }

  @Get(':id')
  @RequireAnyPermission('documents:read', 'documents:read-own')
  async findById(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveReadScope(clinicId, user);
    return this.documentsService.findById(clinicId, id, scope);
  }

  /** Mints a short-lived token for the public content route below — see document-download-token.interface.ts. */
  @Post(':id/download-token')
  @RequireAnyPermission('documents:read', 'documents:read-own')
  async issueDownloadToken(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveReadScope(clinicId, user);
    return this.documentsService.issueDownloadToken(clinicId, id, scope);
  }

  /**
   * Public: authorization is the signed, single-purpose, short-lived token
   * itself — mirrors the invoice/prescription PDF routes. No bearer auth
   * here: the mobile client opens this URL via Linking.openURL() without
   * attaching an Authorization header (docs/SECURITY.md §9).
   */
  @Public()
  @Get(':id/content')
  async downloadContent(@Param('id') id: string, @Query('token') token: string) {
    const { stream, fileName, mimeType } = await this.documentsService.streamContentFromToken(
      id,
      token,
    );
    return new StreamableFile(stream, {
      type: mimeType,
      disposition: `attachment; filename="${fileName}"`,
    });
  }

  @Delete(':id')
  @RequirePermissions('documents:delete')
  async remove(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    const clinicId = requireClinicId(tenant);
    await this.documentsService.softDelete(clinicId, id, user.sub);
  }

  /** Shared by GET /:id and the download-token route, reachable by staff (documents:read) or the owning patient (documents:read-own). */
  private async resolveReadScope(
    clinicId: string,
    user: JwtPayload,
  ): Promise<DocumentOwnershipScope | undefined> {
    if (user.permissions.includes('documents:read')) return undefined;
    const own = await this.patientsService.findOwn(clinicId, user.sub);
    return { patientId: own.id };
  }
}
