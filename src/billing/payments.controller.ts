import { Body, Controller, Get, Header, Param, Post, Query, StreamableFile } from '@nestjs/common';
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
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CreateRefundDto } from './dto/create-refund.dto';
import { QueryPaymentsDto } from './dto/query-payments.dto';
import type { BillingOwnershipScope } from './invoices.service';
import { PaymentsService } from './payments.service';

@ApiTags('billing')
@ApiBearerAuth()
@Controller({ path: 'payments', version: '1' })
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly patientsService: PatientsService,
  ) {}

  @Post()
  @RequirePermissions('payments:create')
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePaymentDto,
  ) {
    const clinicId = requireClinicId(tenant);
    return this.paymentsService.create(clinicId, user.sub, dto);
  }

  @Get()
  @RequirePermissions('payments:read')
  async findAll(@Tenant() tenant: TenantContext, @Query() query: QueryPaymentsDto) {
    const clinicId = requireClinicId(tenant);
    return this.paymentsService.findAll(clinicId, query);
  }

  // Declared ahead of ':id' so Nest doesn't match "me" as an :id param.
  @Get('me')
  @RequirePermissions('billing:read-own')
  async findOwn(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryPaymentsDto,
  ) {
    const clinicId = requireClinicId(tenant);
    const ownPatient = await this.patientsService.findOwn(clinicId, user.sub);
    return this.paymentsService.findOwnForPatient(clinicId, ownPatient.id, query);
  }

  @Get(':id')
  @RequireAnyPermission('payments:read', 'billing:read-own')
  async findById(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveReadScope(clinicId, user);
    return this.paymentsService.findById(clinicId, id, scope);
  }

  @Post(':id/refund')
  @RequirePermissions('billing:refund')
  async refund(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateRefundDto,
  ) {
    const clinicId = requireClinicId(tenant);
    return this.paymentsService.refund(clinicId, id, dto, user.sub);
  }

  /** Mints a short-lived token for the public receipt PDF route below. */
  @Post(':id/receipt-token')
  @RequireAnyPermission('payments:read', 'billing:read-own')
  async issueReceiptToken(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    const clinicId = requireClinicId(tenant);
    const scope = await this.resolveReadScope(clinicId, user);
    return this.paymentsService.issueReceiptToken(clinicId, id, scope);
  }

  /** Public: authorization is the signed, single-purpose, short-lived token itself. */
  @Public()
  @Get(':id/receipt')
  @Header('Content-Type', 'application/pdf')
  async downloadReceipt(
    @Param('id') id: string,
    @Query('token') token: string,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.paymentsService.generateReceiptPdfFromToken(id, token);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `inline; filename="${filename}"`,
    });
  }

  private async resolveReadScope(
    clinicId: string,
    user: JwtPayload,
  ): Promise<BillingOwnershipScope | undefined> {
    if (user.permissions.includes('payments:read')) return undefined;
    const own = await this.patientsService.findOwn(clinicId, user.sub);
    return { patientId: own.id };
  }
}
