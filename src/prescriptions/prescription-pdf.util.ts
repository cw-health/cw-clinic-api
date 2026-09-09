import PDFDocument from 'pdfkit';
import type { PrescriptionResponseDto } from './dto/prescription-response.dto';

/**
 * Renders a finalized (or superseded) prescription to a PDF byte buffer,
 * on demand — no file is ever written to disk (see prescriptions.service.ts
 * "secure download/access mechanism"). pdfkit is a pure-JS, dependency-light
 * renderer: no headless browser / native binary, in keeping with
 * CLAUDE.md rule 9 ("no new dependency without justification").
 */
export function renderPrescriptionPdf(
  prescription: PrescriptionResponseDto,
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
    doc.fontSize(14).text('Prescription', { align: 'center' });
    doc.moveDown(1);

    doc.fontSize(10);
    doc.text(`Prescription ID: ${prescription.id}`);
    doc.text(`Version: ${prescription.version}${prescription.amendsId ? ' (amendment)' : ''}`);
    doc.text(`Status: ${prescription.status}`);
    doc.text(
      `Date: ${(prescription.finalizedAt ?? prescription.createdAt).toISOString().slice(0, 10)}`,
    );
    doc.moveDown(0.5);
    doc.text(`Doctor: ${prescription.doctorName}`);
    doc.text(`Patient: ${prescription.patientName}`);
    doc.moveDown(1);

    doc.fontSize(12).text('Medicines', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10);
    for (const [index, item] of prescription.items.entries()) {
      doc.font('Helvetica-Bold').text(`${index + 1}. ${item.medicineName} — ${item.dosage}`);
      doc
        .font('Helvetica')
        .text(`   ${item.frequency}, ${item.duration}${item.route ? `, ${item.route}` : ''}`);
      if (item.instructions) {
        doc.text(`   Instructions: ${item.instructions}`);
      }
      doc.moveDown(0.4);
    }

    if (prescription.notes) {
      doc.moveDown(0.5);
      doc.fontSize(12).text('Notes', { underline: true });
      doc.fontSize(10).text(prescription.notes);
    }

    doc.moveDown(2);
    doc.fontSize(8).fillColor('gray').text('This is a system-generated document.', {
      align: 'center',
    });

    doc.end();
  });
}
