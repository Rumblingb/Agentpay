import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';

export interface ReceiptPdfRow {
  label: string;
  value: string;
}

export interface ReceiptPdfSection {
  title: string;
  rows: ReceiptPdfRow[];
}

export interface ReceiptPdfDocument {
  fileStem: string;
  title: string;
  eyebrow?: string;
  statusLabel?: string | null;
  amountText?: string | null;
  subtitle?: string | null;
  generatedAtLabel: string;
  footerNote?: string | null;
  sections: ReceiptPdfSection[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeFileStem(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'ace-receipt';
}

function renderSection(section: ReceiptPdfSection): string {
  const rows = section.rows
    .filter((row) => row.label.trim() && row.value.trim())
    .map((row) => `
      <div class="row">
        <div class="label">${escapeHtml(row.label)}</div>
        <div class="value">${escapeHtml(row.value)}</div>
      </div>
    `)
    .join('');

  if (!rows) return '';

  return `
    <section class="section">
      <div class="section-title">${escapeHtml(section.title)}</div>
      ${rows}
    </section>
  `;
}

function buildReceiptHtml(document: ReceiptPdfDocument): string {
  const sections = document.sections.map(renderSection).filter(Boolean).join('');

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          body {
            margin: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: #f6f7fb;
            color: #0f172a;
          }
          .page {
            padding: 36px 34px 30px;
          }
          .header {
            border-radius: 24px;
            padding: 28px 28px 22px;
            background:
              radial-gradient(circle at top right, rgba(191, 219, 254, 0.42), transparent 36%),
              linear-gradient(135deg, #08101d, #0f223d 54%, #142f55);
            color: #f8fafc;
          }
          .eyebrow {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 2.1px;
            color: rgba(226, 232, 240, 0.74);
            margin-bottom: 10px;
            font-weight: 700;
          }
          .brand {
            font-size: 22px;
            font-weight: 800;
            letter-spacing: 1.8px;
            margin-bottom: 6px;
          }
          .title {
            font-size: 28px;
            line-height: 1.15;
            font-weight: 800;
            margin-bottom: 8px;
          }
          .subtitle {
            font-size: 13px;
            line-height: 1.55;
            color: rgba(226, 232, 240, 0.8);
            margin-bottom: 18px;
          }
          .meta-strip {
            display: table;
            width: 100%;
          }
          .meta-cell {
            display: table-cell;
            vertical-align: top;
            width: 50%;
          }
          .meta-label {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 1.8px;
            color: rgba(191, 219, 254, 0.74);
            margin-bottom: 5px;
            font-weight: 700;
          }
          .meta-value {
            font-size: 18px;
            font-weight: 700;
            color: #f8fafc;
          }
          .meta-value.subtle {
            font-size: 13px;
            line-height: 1.5;
            font-weight: 600;
            color: rgba(226, 232, 240, 0.84);
          }
          .section {
            margin-top: 18px;
            padding: 18px 20px;
            border-radius: 20px;
            border: 1px solid rgba(148, 163, 184, 0.22);
            background: #ffffff;
          }
          .section-title {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 1.7px;
            color: #475569;
            font-weight: 800;
            margin-bottom: 12px;
          }
          .row {
            display: table;
            width: 100%;
            margin-bottom: 10px;
          }
          .row:last-child {
            margin-bottom: 0;
          }
          .label {
            display: table-cell;
            width: 35%;
            font-size: 11px;
            color: #64748b;
            letter-spacing: 0.2px;
            padding-right: 14px;
            vertical-align: top;
          }
          .value {
            display: table-cell;
            width: 65%;
            font-size: 12px;
            line-height: 1.5;
            color: #0f172a;
            font-weight: 600;
            vertical-align: top;
            word-break: break-word;
          }
          .footer {
            margin-top: 16px;
            padding: 14px 4px 0;
            font-size: 11px;
            line-height: 1.6;
            color: #64748b;
          }
        </style>
      </head>
      <body>
        <main class="page">
          <header class="header">
            ${document.eyebrow ? `<div class="eyebrow">${escapeHtml(document.eyebrow)}</div>` : ''}
            <div class="brand">ACE</div>
            <div class="title">${escapeHtml(document.title)}</div>
            ${document.subtitle ? `<div class="subtitle">${escapeHtml(document.subtitle)}</div>` : ''}
            <div class="meta-strip">
              <div class="meta-cell">
                <div class="meta-label">Status</div>
                <div class="meta-value">${escapeHtml(document.statusLabel ?? 'Receipt ready')}</div>
              </div>
              <div class="meta-cell">
                <div class="meta-label">Amount</div>
                <div class="meta-value">${escapeHtml(document.amountText ?? 'Recorded')}</div>
              </div>
            </div>
            <div class="meta-strip" style="margin-top: 14px;">
              <div class="meta-cell" style="width: 100%;">
                <div class="meta-label">Generated</div>
                <div class="meta-value subtle">${escapeHtml(document.generatedAtLabel)}</div>
              </div>
            </div>
          </header>
          ${sections}
          ${document.footerNote ? `<div class="footer">${escapeHtml(document.footerNote)}</div>` : ''}
        </main>
      </body>
    </html>
  `;
}

export async function createReceiptPdf(document: ReceiptPdfDocument): Promise<{ uri: string; fileName: string }> {
  const fileStem = safeFileStem(document.fileStem);
  const printResult = await Print.printToFileAsync({
    html: buildReceiptHtml(document),
  });

  const fileName = `${fileStem}.pdf`;
  const targetUri = `${FileSystem.cacheDirectory ?? ''}${fileName}`;

  if (!targetUri) {
    return { uri: printResult.uri, fileName };
  }

  await FileSystem.deleteAsync(targetUri, { idempotent: true }).catch(() => null);
  await FileSystem.copyAsync({
    from: printResult.uri,
    to: targetUri,
  }).catch(() => null);

  return {
    uri: targetUri || printResult.uri,
    fileName,
  };
}
