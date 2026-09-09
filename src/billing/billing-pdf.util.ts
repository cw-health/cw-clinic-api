import PDFDocument from 'pdfkit';
import type { InvoiceResponseDto } from './dto/invoice-response.dto';
import type { PaymentResponseDto } from './dto/payment-response.dto';

/**
 * Renders an issued invoice to a PDF byte buffer, on demand — same
 * approach as prescriptions/prescription-pdf.util.ts (pdfkit, never
 * written to disk, no new dependency).
 */
export function renderInvoicePdf(invoice: InvoiceResponseDto, clinicName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text(clinicName, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(14).text('Invoice', { align: 'center' });
    doc.moveDown(1);

    doc.fontSize(10);
    doc.text(`Invoice #: ${invoice.invoiceNumber ?? invoice.id}`);
    doc.text(`Status: ${invoice.status}`);
    doc.text(`Date: ${(invoice.issuedAt ?? invoice.createdAt).toISOString().slice(0, 10)}`);
    doc.moveDown(0.5);
    doc.text(`Doctor: ${invoice.doctorName}`);
    doc.text(`Patient: ${invoice.patientName}`);
    doc.moveDown(1);

    doc.fontSize(12).text('Items', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10);
    for (const item of invoice.items) {
      doc.font('Helvetica-Bold').text(`${item.description} (${item.itemType})`);
      doc
        .font('Helvetica')
        .text(
          `   ${item.quantity} x ${item.unitPrice}` +
            `${Number(item.discountAmount) > 0 ? `, discount ${item.discountAmount}` : ''}` +
            `${Number(item.taxRatePercent) > 0 ? `, tax ${item.taxRatePercent}%` : ''}` +
            ` = ${item.lineTotal}`,
        );
      doc.moveDown(0.4);
    }

    doc.moveDown(0.5);
    doc.fontSize(10);
    doc.text(`Subtotal: ${invoice.subtotal}`);
    doc.text(`Discount: ${invoice.discountAmount}`);
    doc.text(`Tax: ${invoice.taxAmount}`);
    doc.font('Helvetica-Bold').text(`Total: ${invoice.totalAmount}`);
    doc.font('Helvetica').text(`Paid: ${invoice.amountPaid}`);
    doc.text(`Balance due: ${invoice.balanceDue}`);

    if (invoice.notes) {
      doc.moveDown(0.5);
      doc.fontSize(12).text('Notes', { underline: true });
      doc.fontSize(10).text(invoice.notes);
    }

    doc.moveDown(2);
    doc.fontSize(8).fillColor('gray').text('This is a system-generated document.', {
      align: 'center',
    });

    doc.end();
  });
}

/** Renders a completed payment as a receipt PDF, on demand — same approach as renderInvoicePdf above. */
export function renderReceiptPdf(
  payment: PaymentResponseDto,
  invoice: InvoiceResponseDto,
  clinicName: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text(clinicName, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(14).text('Payment Receipt', { align: 'center' });
    doc.moveDown(1);

    doc.fontSize(10);
    doc.text(`Receipt #: ${payment.receiptNumber ?? payment.id}`);
    doc.text(`Invoice #: ${invoice.invoiceNumber ?? invoice.id}`);
    doc.text(`Date: ${(payment.paidAt ?? payment.createdAt).toISOString().slice(0, 10)}`);
    doc.moveDown(0.5);
    doc.text(`Patient: ${invoice.patientName}`);
    doc.moveDown(1);

    doc.font('Helvetica-Bold').fontSize(12).text(`Amount paid: ${payment.amount}`);
    doc.font('Helvetica').fontSize(10);
    doc.text(`Method: ${payment.method}`);
    if (payment.providerReference) doc.text(`Reference: ${payment.providerReference}`);

    doc.moveDown(2);
    doc.fontSize(8).fillColor('gray').text('This is a system-generated document.', {
      align: 'center',
    });

    doc.end();
  });
}
