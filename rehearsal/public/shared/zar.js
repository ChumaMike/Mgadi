// PRACTICE BUILD, NOT THE ENTRY.
// South African rand: shown as R 1 234,56 (space thousands, comma decimals).

export function formatZAR(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  const [whole, cents] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '-' : ''}R ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${cents}`;
}

// Accepts what people type: "R70,000", "R 70 000,00", "70000", "70 000.50".
// A comma or dot followed by exactly two digits at the end is the decimal mark.
export function parseZAR(input) {
  let s = String(input ?? '').trim().replace(/^r\s*/i, '').replace(/[\s ]/g, '');
  if (!s) return null;
  let decimals = '';
  const m = s.match(/[.,](\d{2})$/);
  if (m) {
    decimals = m[1];
    s = s.slice(0, -3);
  }
  s = s.replace(/[.,]/g, '');
  if (!/^\d+$/.test(s)) return null;
  return Number(decimals ? `${s}.${decimals}` : s);
}
