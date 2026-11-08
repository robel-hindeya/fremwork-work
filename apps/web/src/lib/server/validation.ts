/** Validate manual ledger input before PostgREST can round or coerce it. */
export function transactionError(value: unknown, partial = false): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Invalid transaction.';
  const data = value as Record<string, unknown>;
  for (const key of ['name', 'date', 'amt']) {
    if (!partial && data[key] === undefined) return `Missing transaction ${key}.`;
  }
  for (const key of ['name', 'cat', 'method', 'memo', 'note']) {
    if (data[key] !== undefined && (typeof data[key] !== 'string' || String(data[key]).length > 2000)) return `Invalid transaction ${key}.`;
  }
  if (data.name !== undefined && !String(data.name).trim()) return 'Enter a transaction name.';
  if (data.amt !== undefined) {
    if (typeof data.amt !== 'number' || !Number.isFinite(data.amt) || data.amt === 0 || Math.abs(data.amt) > 1e12
      || Math.abs(data.amt * 100 - Math.round(data.amt * 100)) > 0.001) return 'Enter a nonzero amount with at most two decimal places.';
  }
  if (data.date !== undefined) {
    if (typeof data.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) return 'Enter a valid date.';
    const parsed = new Date(`${data.date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== data.date) return 'Enter a valid date.';
  }
  if (data.status !== undefined && !['Cleared', 'Pending', 'Flagged', 'Failed', 'Reviewed'].includes(String(data.status))) return 'Invalid transaction status.';
  return null;
}
