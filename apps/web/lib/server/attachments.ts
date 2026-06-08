import 'server-only';

import type { ClaudeContentBlock } from '~/lib/server/ai';

/**
 * Routes an uploaded chat attachment to the correct Anthropic content block.
 * Text-native files become TEXT blocks; Excel/Word are parsed server-side into
 * text; PDFs go as document blocks; images stay as image blocks. Unsupported
 * types return a friendly error instead of a 400 from the API.
 */

export type Attachment = { data: string; mediaType: string; name: string };

export type AttachmentResult =
  | { ok: true; blocks: ClaudeContentBlock[]; isImage: boolean; note?: string }
  | { ok: false; error: string };

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_TEXT_CHARS = 100_000; // keep the request well under the token limit
const MAX_CSV_LINES = 800;

const IMAGE_TYPES = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);
const TEXT_TYPES = new Set(['csv', 'tsv', 'txt', 'md', 'log', 'json']);

function ext(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

function truncateText(text: string, isTabular: boolean): { text: string; note?: string } {
  let note: string | undefined;
  let out = text;
  if (isTabular) {
    const lines = out.split(/\r?\n/);
    if (lines.length > MAX_CSV_LINES) {
      out = lines.slice(0, MAX_CSV_LINES).join('\n');
      note = `Showing the first ${MAX_CSV_LINES} rows of ${lines.length}.`;
    }
  }
  if (out.length > MAX_TEXT_CHARS) {
    out = out.slice(0, MAX_TEXT_CHARS);
    note = (note ? note + ' ' : '') + 'Content truncated to fit the request.';
  }
  return { text: out, note };
}

function textBlock(name: string, body: string, note?: string): ClaudeContentBlock {
  const header = `Here is the uploaded file \`${name}\`${note ? ` (${note})` : ''}:\n\n`;
  return { type: 'text', text: header + body };
}

export async function buildAttachmentBlocks(
  att: Attachment,
): Promise<AttachmentResult> {
  const buf = Buffer.from(att.data, 'base64');
  if (buf.length > MAX_BYTES) {
    return {
      ok: false,
      error: `That file is ${(buf.length / 1024 / 1024).toFixed(1)}MB — please keep uploads under 5MB.`,
    };
  }

  const e = ext(att.name);
  const mt = (att.mediaType || '').toLowerCase();

  // --- Images (unchanged path) ---
  if (IMAGE_TYPES.has(e) || mt.startsWith('image/')) {
    return {
      ok: true,
      isImage: true,
      blocks: [
        {
          type: 'image',
          source: { type: 'base64', media_type: att.mediaType, data: att.data },
        },
      ],
    };
  }

  // --- Text-native (already text) ---
  if (TEXT_TYPES.has(e) || mt.startsWith('text/') || mt === 'application/json') {
    const isTabular = e === 'csv' || e === 'tsv' || mt === 'text/csv';
    const { text, note } = truncateText(buf.toString('utf8'), isTabular);
    return { ok: true, isImage: false, blocks: [textBlock(att.name, text, note)], note };
  }

  // --- Excel → CSV text (SheetJS) ---
  if (e === 'xlsx' || e === 'xls' || mt.includes('spreadsheet') || mt.includes('excel')) {
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(buf, { type: 'buffer' });
      const parts: string[] = [];
      for (const sheetName of wb.SheetNames) {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]!);
        if (csv.trim()) parts.push(`## Sheet: ${sheetName}\n${csv}`);
      }
      const { text, note } = truncateText(parts.join('\n\n'), true);
      return { ok: true, isImage: false, blocks: [textBlock(att.name, text, note)], note };
    } catch {
      return { ok: false, error: 'I couldn’t read that Excel file. Try re-saving it as .xlsx or export it as CSV.' };
    }
  }

  // --- Word → raw text (mammoth) ---
  if (e === 'docx' || mt.includes('wordprocessingml') || mt === 'application/msword') {
    try {
      const mammoth = await import('mammoth');
      const { value } = await mammoth.extractRawText({ buffer: buf });
      const { text, note } = truncateText(value, false);
      return { ok: true, isImage: false, blocks: [textBlock(att.name, text, note)], note };
    } catch {
      return { ok: false, error: 'I couldn’t read that Word file. Try saving it as .docx or paste the text directly.' };
    }
  }

  // --- PDF → document block (Anthropic native) ---
  if (e === 'pdf' || mt === 'application/pdf') {
    return {
      ok: true,
      isImage: false,
      blocks: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: att.data },
        },
      ],
    };
  }

  // --- Unsupported ---
  return {
    ok: false,
    error: `I can read CSV, Excel, Word, text, PDF, and images — but not \`.${e || 'that'}\` files. Try exporting it as CSV.`,
  };
}
