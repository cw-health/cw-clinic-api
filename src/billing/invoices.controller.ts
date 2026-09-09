import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { RequireAnyPermission } from '../auth/decorators/require-any-permission.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Tenant } from '../auth/decorators/tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../auth/guards/tenant.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { requireClinicId } from '../common/require-clinic-id.util';
import { PatientsService } from '../patients/patients.service';
import { CreateInvoiceItemDto } from './dto/create-invoice-item.dto';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { QueryInvoicesDto } from './dto/query-invoices.dto';
import { RevenueSummaryQueryDto } from './dto/revenue-summary.dto';
import { UpdateInvoiceItemDto } from './dto/update-invoice-item.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { InvoicesService, type BillingOwnershipScope } from './invoices.service';

@ApiTags('billing')
@ApiBearerAuth()
@Controller({ path: 'invoices', version: '1' })
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly patientsService: PatientsService,
  ) {}

  @Post()
  @RequirePermissions('billing:create')
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateInvoiceDto,
  ) {
    const clinicId = requireClinicId(tenant);
    return this.invoicesService.create(clinicId, user.sub, dto);
  }

  @Get()
  @RequirePermissions('billing:read')
  async findAll(@Tenant() tenant: TenantContext, @Query() query: QueryInvoicesDto) {
    const clinicId = requireClinicId(tenant);
    return this.invoicesService.findAll(clinicId, query);
  }

  // Declared ahead of the ':id' routes below so Nest doesn't match "me"/"revenue-summary" as an :id param.
  @Get('me')
  @RequirePermissions('billing:read-own')
  async findOwn(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryInvoicesDto,
  ) {
    const clinicId = requireClinicId(tenant);
    const ownPatient = await this.patientsService.findOwn(clinicId, user.sub);
    return this.invoicesService.findOwnForPatient(clinicId, ownPatient.id, query);
  }

  @Get('revenue-summary')
  @RequirePermissions('reports:financial')
  async revenueSummary(@Tenant() tenant: TenantContext, @Query() query: RevenueSummaryQueryDto) {
    const clinicId = requireClinicId(tenant);
    return this.invoicesService.revenueSummary(clinicId, query);
  }

  @Get(':id')
  @RequireAnyPermission('billing:read', 'billing:read-own')
  async findById(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveReadScope(clinicId, user);
    return this.invoicesService.findById(clinicId, id, scope);
  }

  @Patch(':id')
  @RequirePermissions('billing:update')
  async update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    const clinicId = requireClinicId(tenant);
    return this.invoicesService.update(clinicId, id, dto, user.sub);
  }

  @Post(':id/items')
  @RequirePermissions('billing:update')
  async addItem(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: CreateInvoiceItemDto,
  ) {
    const clinicId = requireClinicId(tenant);
    return this.invoicesService.addItem(clinicId, id, dto);
  }

  @Patch(':id/items/:itemId')
  @RequirePermissions('billing:update')
  async updateItem(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateInvoiceItemDto,
  ) {
    const clinicId = requireClinicId(tenant);
    return this.invoicesService.updateItem(clinicId, id, itemId, dto);
  }

  @Delete(':id/items/:itemId')
  @RequirePermissions('billing:update')
  async removeItem(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    const clinicId = requireClinicId(tenant);
    return this.invoicesService.removeItem(clinicId, id, itemId);
  }

  @Post(':id/issue')
  @RequirePermissions('billing:update')
  async issue(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    const clinicId = requireClinicId(tenant);
    return this.invoicesService.issue(clinicId, id, user.sub);
  }

  @Post(':id/void')
  @RequirePermissions('billing:update')
  async void(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    const clinicId = requireClinicId(tenant);
    return this.invoicesService.void(clinicId, id, user.sub);
  }

  /** Mints a short-lived token for the public PDF route below — see billing-download-token.interface.ts. */
  @Post(':id/download-token')
  @RequireAnyPermission('billing:read', 'billing:read-own')
  async issueDownloadToken(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveReadScope(clinicId, user);
    return this.invoicesService.issueDownloadToken(clinicId, id, scope);
  }

  /** Public: authorization is the signed, single-purpose, short-lived token itself — see prescriptions.controller.ts's identical rationale. */
  @Public()
  @Get(':id/pdf')
  @Header('Content-Type', 'application/pdf')
  async downloadPdf(
    @Param('id') id: string,
    @Query('token') token: string,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.invoicesService.generatePdfFromToken(id, token);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `inline; filename="${filename}"`,
    });
  }

  /** Shared by GET /:id and the download-token route, reachable by staff (billing:read) or the owning patient (billing:read-own). */
  private async resolveReadScope(
    clinicId: string,
    user: JwtPayload,
  ): Promise<BillingOwnershipScope | undefined> {
    if (user.permissions.includes('billing:read')) return undefined;
    const own = await this.patientsService.findOwn(clinicId, user.sub);
    return { patientId: own.id };
  }
}
