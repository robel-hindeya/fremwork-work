import type { AnswerBlock } from '@fremwork/types';

const MAX_TEXT = 20000;
const cell = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : String(v ?? '').slice(0, 500));
const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : '');

/** Keeps only well-formed answer blocks from model output; anything else becomes plain text. */
export function sanitizeBlock(raw: any): AnswerBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  switch (raw.type) {
    case 'text':
      return str(raw.text) ? { type: 'text', text: str(raw.text) } : null;
    case 'table': {
      if (!Array.isArray(raw.head) || !Array.isArray(raw.rows)) return null;
      const block: AnswerBlock = {
        type: 'table',
        head: raw.head.slice(0, 20).map((h: unknown) => String(h ?? '').slice(0, 200)),
        rows: raw.rows.slice(0, 200).filter(Array.isArray).map((r: unknown[]) => r.slice(0, 20).map(cell)),
      };
      if (Array.isArray(raw.foot)) block.foot = raw.foot.slice(0, 20).map(cell);
      return block;
    }
    case 'calc':
      return str(raw.working) || str(raw.result) ? { type: 'calc', working: str(raw.working), result: String(raw.result ?? '').slice(0, 500) } : null;
    case 'recommendation': {
      const items = Array.isArray(raw.items) ? raw.items.map((i: unknown) => String(i ?? '').slice(0, 2000)).filter(Boolean).slice(0, 20) : [];
      return items.length ? { type: 'recommendation', items } : null;
    }
    case 'chart': {
      if (!Array.isArray(raw.labels) || !Array.isArray(raw.series)) return null;
      return {
        type: 'chart',
        title: String(raw.title ?? '').slice(0, 200),
        kind: raw.kind === 'bar' ? 'bar' : 'line',
        labels: raw.labels.slice(0, 60).map((l: unknown) => String(l ?? '').slice(0, 50)),
        series: raw.series.slice(0, 8).map((s: any) => ({
          name: String(s?.name ?? '').slice(0, 100),
          values: Array.isArray(s?.values) ? s.values.slice(0, 60).map((v: unknown) => Number(v) || 0) : [],
          color: /^#[0-9a-f]{3,8}$/i.test(String(s?.color)) ? s.color : '#4f46e5',
        })),
      };
    }
    default:
      return null;
  }
}

/**
 * Turns the model's final answer into typed blocks. Models are asked for a JSON array of blocks;
 * when they answer in Markdown instead, tables and a "Recommendations" list are lifted out.
 * `calcBlocks` (from calculate tool calls) are added when the answer has no calc block of its own.
 */
export function parseAnswer(text: string, calcBlocks: AnswerBlock[] = []): AnswerBlock[] {
  let clean = text.trim();
  const fenced = clean.match(/```(?:json)?\s*(\[[\s\S]*\])\s*```/);
  if (fenced) clean = fenced[1].trim();

  if (clean.startsWith('[')) {
    try {
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed)) {
        const blocks = parsed.map(sanitizeBlock).filter((b): b is AnswerBlock => b !== null);
        if (blocks.length) return blocks.some((b) => b.type === 'calc') ? blocks : [...calcBlocks, ...blocks];
      }
    } catch {
      /* not JSON: fall through to Markdown */
    }
  }

  const blocks: AnswerBlock[] = [...calcBlocks];
  const narrative: string[] = [];
  const table: string[] = [];
  const recs: string[] = [];
  let inTable = false;
  let inRecs = false;

  for (const line of text.split('\n')) {
    const t = line.trim();
    if (/^(?:#{1,4}\s*)?\**recommendations?\**:?$/i.test(t)) {
      inRecs = true;
      inTable = false;
      continue;
    }
    if (inRecs) {
      if (t) recs.push(t.replace(/^(?:[-*•]|\d+\.)\s*/, ''));
      continue;
    }
    if (t.startsWith('|') && t.endsWith('|') && (inTable || table.length === 0)) {
      inTable = true;
      table.push(t);
    } else {
      if (inTable && t === '') inTable = false;
      else narrative.push(line);
    }
  }

  const narrativeText = narrative.join('\n').trim();
  if (narrativeText) blocks.push({ type: 'text', text: narrativeText.slice(0, MAX_TEXT) });

  if (table.length >= 2) {
    const parseRow = (r: string) => r.split('|').slice(1, -1).map((c) => c.trim());
    const head = parseRow(table[0]);
    const body = table.slice(1).filter((r) => !/^[|\s:-]+$/.test(r)).map(parseRow);
    if (head.length && body.length) blocks.push({ type: 'table', head, rows: body });
  }
  if (recs.length) blocks.push({ type: 'recommendation', items: recs });
  return blocks;
}

const mdCell = (v: unknown) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** Markdown for storing an answer, so the same conversation reads well in the web workspace too. */
export function blocksToMarkdown(blocks: AnswerBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'text':
          return b.text;
        case 'table': {
          const lines = [`| ${b.head.map(mdCell).join(' | ')} |`, `| ${b.head.map(() => '---').join(' | ')} |`, ...b.rows.map((r) => `| ${r.map(mdCell).join(' | ')} |`)];
          if (b.foot) lines.push(`| ${b.foot.map(mdCell).join(' | ')} |`);
          return lines.join('\n');
        }
        case 'calc':
          return `\`\`\`\n${b.working}\n= ${b.result}\n\`\`\``;
        case 'recommendation':
          return `**Recommendations**\n${b.items.map((i) => `- ${i}`).join('\n')}`;
        case 'chart':
          return `**${b.title}**\n${b.series.map((s) => `- ${s.name}: ${s.values.join(', ')}`).join('\n')}`;
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n\n');
}
