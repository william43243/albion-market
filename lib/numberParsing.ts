export type ParsedNumber = { value: number; valid: boolean; ambiguous: boolean };

/** Parse French/English numeric input without silently changing separators. */
export function parseUserNumber(raw: string, integer = false): ParsedNumber {
  const text = raw.trim().replace(/\u00a0/g, ' ');
  if (!text) return { value: 0, valid: false, ambiguous: false };
  if (/[^0-9 .,]/.test(text) || (text.includes('.') && text.includes(',') && /[.,][0-9]{1,2}$/.test(text) === false)) return { value: 0, valid: false, ambiguous: true };
  const comma = text.lastIndexOf(','); const dot = text.lastIndexOf('.');
  let normalized = text.replace(/\s/g, '');
  if (comma >= 0 && dot >= 0) {
    const decimal = Math.max(comma, dot);
    const fraction = normalized.length - decimal - 1;
    if (fraction !== 1 && fraction !== 2) return { value: 0, valid: false, ambiguous: true };
    normalized = normalized.slice(0, decimal).replace(/[.,]/g, '') + '.' + normalized.slice(decimal + 1);
  } else if (comma >= 0) {
    const fraction = normalized.length - comma - 1;
    normalized = fraction > 0 && fraction <= 2 ? normalized.replace(',', '.') : normalized.replace(',', '');
  } else if (dot >= 0) {
    const fraction = normalized.length - dot - 1;
    if (fraction > 0 && fraction <= 2) normalized = normalized;
    else normalized = normalized.replace('.', '');
  }
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) return { value: 0, valid: false, ambiguous: integer && value % 1 !== 0 };
  return { value, valid: true, ambiguous: false };
}
