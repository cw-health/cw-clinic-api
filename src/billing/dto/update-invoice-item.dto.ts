import { PartialType } from '@nestjs/swagger';
import { CreateInvoiceItemDto } from './create-invoice-item.dto';

/** Draft-only, same fields as create — see invoices.service.ts's assertDraft. */
export class UpdateInvoiceItemDto extends PartialType(CreateInvoiceItemDto) {}
