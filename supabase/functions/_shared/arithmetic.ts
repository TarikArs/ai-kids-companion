// Expected answers for simple grade-1 arithmetic, computed in code (never trusted to the model).
// Handles "a op b = ?", "a op ? = c" and "? op b = c" with + - × ÷.


/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits to 0-9, Arabic question mark to ?. */
export function westernDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/؟/g, '?');
}



/**
 * Expected answer of an equation with ONE blank, computed in code:
 * "2750,15 + 475,50 + ? + 1349,07 = 5223,45", "3 + … = 7", "? × 4 = 20", "12 - ? = 5", "6 - 2 = ?".
 * Decimal commas are understood. The blank can be anywhere. Returns null when it cannot be solved safely.
 */
export function expectedAnswer(prompt: string): string | null {
  let s = westernDigits(prompt)
    .toLowerCase()
    .replace(/[−–]/g, '-')
    .replace(/[×x]/g, '*')
    .replace(/÷/g, '/')
    .replace(/(\d),(\d)/g, '$1.$2') // decimal comma
    .replace(/(\d)\s+(?=\d{3}(?!\d))/g, '$1'); // "1 349" thousands space
  // The blank: ?, …, ___, or 2+ dots in a row.
  s = s.replace(/\s+/g, '').replace(/(?:[?…_]|\.(?!\d))+/g, 'X');
  if (s.includes(':') && !/\d:\d/.test(s)) return null;
  s = s.replace(/(\d):(\d)/g, '$1/$2');
  const parts = s.split('=');
  if (parts.length !== 2) return null;
  if ((s.match(/X/g) ?? []).length !== 1) return null;
  if (/[^0-9.+\-*/()=X]/.test(s)) return null;

  const f = (v: number) => {
    const l = evalExpression(parts[0].replace('X', `(${v})`));
    const r = evalExpression(parts[1].replace('X', `(${v})`));
    return l === null || r === null ? null : l - r;
  };
  const f0 = f(0), f1 = f(1), f2 = f(2);
  if (f0 === null || f1 === null || f2 === null) return null;
  const slope = f1 - f0;
  // Only linear in the blank (sums, differences, multiplication by a known number).
  if (Math.abs(slope) < 1e-12 || Math.abs(f2 - f1 - slope) > 1e-9) return null;
  const x = -f0 / slope;
  if (!Number.isFinite(x) || x < 0) return null;
  const rounded = Math.round(x * 100) / 100;
  if (Math.abs(rounded - x) > 1e-6) return null; // school answers have at most 2 decimals
  return formatAnswer(rounded);
}

/** First number in a written answer ("17 voyages" -> 17, "3,5" -> 3.5), or null. */
function firstNumber(s: string): number | null {
  const m = westernDigits(s).replace(/(\d)[\s.](?=\d{3}\b)/g, '$1').match(/-?\d+(?:[.,]\d+)?/);
  return m ? parseFloat(m[0].replace(',', '.')) : null;
}

/** The child's final result: in "120 - 80 + 10 = 300" it is 300 (after the last "="). */
export function finalAnswer(written: string): string {
  const parts = written.split('=');
  return parts.length > 1 && parts[parts.length - 1].trim() ? parts[parts.length - 1] : written;
}

/** Her own calculation is wrong ("120 - 80 + 10 = 300" makes 50): returns what it really makes, else null. */
export function ownCalculationSlip(written: string): { calculation: string; makes: string; wrote: string } | null {
  const parts = written.split('=');
  if (parts.length !== 2) return null;
  const value = evalExpression(parts[0].replace(/(\d),(\d)/g, '$1.$2'));
  const wrote = firstNumber(parts[1]);
  if (value === null || wrote === null || !/[+\-*/×x÷:]/.test(parts[0])) return null;
  if (Math.abs(value - wrote) < 0.005) return null;
  return { calculation: parts[0].trim(), makes: formatAnswer(value), wrote: parts[1].trim() };
}

export const sameAnswer = (a: string, b: string) => {
  a = finalAnswer(a);
  const na = firstNumber(a);
  const nb = firstNumber(b);
  if (na !== null && nb !== null) return Math.abs(na - nb) < 0.005;
  return westernDigits(a).trim().toLowerCase().replace(/\s+/g, '') === westernDigits(b).trim().toLowerCase().replace(/\s+/g, '');
};

/**
 * Safe evaluator for the solution expression the model proposes for a word problem, e.g. "ceil(748/46)".
 * Only numbers, + - * / ( ) and ceil/floor/round. Returns null for anything else.
 */
export function evalExpression(expr: string): number | null {
  const src = westernDigits(expr).toLowerCase().replace(/\s+/g, '').replace(/[×x]/g, '*').replace(/[÷:]/g, '/').replace(/,/g, '.');
  if (!src || !/^[0-9+\-*/().a-z]*$/.test(src)) return null;
  let i = 0;
  const peek = () => src[i];
  const parseExpr = (): number | null => {
    let v = parseTerm();
    while (v !== null && (peek() === '+' || peek() === '-')) {
      const op = src[i++];
      const r = parseTerm();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const parseTerm = (): number | null => {
    let v = parseFactor();
    while (v !== null && (peek() === '*' || peek() === '/')) {
      const op = src[i++];
      const r = parseFactor();
      if (r === null || (op === '/' && r === 0)) return null;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const parseFactor = (): number | null => {
    if (peek() === '-') {
      i++;
      const v = parseFactor();
      return v === null ? null : -v;
    }
    const fn = src.slice(i).match(/^(ceil|floor|round)\(/);
    if (fn) {
      i += fn[0].length;
      const v = parseExpr();
      if (v === null || src[i] !== ')') return null;
      i++;
      return Math[fn[1] as 'ceil' | 'floor' | 'round'](v);
    }
    if (peek() === '(') {
      i++;
      const v = parseExpr();
      if (v === null || src[i] !== ')') return null;
      i++;
      return v;
    }
    const num = src.slice(i).match(/^\d+(?:\.\d+)?/);
    if (!num) return null;
    i += num[0].length;
    return parseFloat(num[0]);
  };
  const v = parseExpr();
  return v !== null && i === src.length && Number.isFinite(v) ? v : null;
}

/** Number as a child would write it: integers plain, else up to 2 decimals. */
export function formatAnswer(n: number): string {
  const r = Math.round(n * 100) / 100;
  return String(r);
}
