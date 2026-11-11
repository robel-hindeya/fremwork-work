/**
 * Evaluates the arithmetic the AI asks for: + - * / parentheses, decimals, exponents (1e3)
 * and percentages (5% is 0.05). Commas and $ signs are ignored. Throws on anything else.
 * A small recursive-descent parser, so model output is never evaluated as code.
 */
export function calculate(expression: string): number {
  const input = String(expression).replace(/[,$\s]/g, '');
  if (input.length > 500) throw new Error('Expression is too long.');
  let pos = 0;

  const fail = (): never => {
    throw new Error(`Can't calculate "${String(expression).slice(0, 100)}".`);
  };

  const sum = (): number => {
    let value = product();
    while (input[pos] === '+' || input[pos] === '-') value = input[pos++] === '+' ? value + product() : value - product();
    return value;
  };

  const product = (): number => {
    let value = unary();
    while (input[pos] === '*' || input[pos] === '/') value = input[pos++] === '*' ? value * unary() : value / unary();
    return value;
  };

  const unary = (): number => {
    if (input[pos] === '-') return pos++, -unary();
    if (input[pos] === '+') return pos++, unary();
    let value = atom();
    while (input[pos] === '%') pos++, (value /= 100);
    return value;
  };

  const atom = (): number => {
    if (input[pos] === '(') {
      pos++;
      const value = sum();
      if (input[pos++] !== ')') fail();
      return value;
    }
    const number = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(input.slice(pos))?.[0] ?? fail();
    pos += number.length;
    return Number(number);
  };

  const result = sum();
  if (pos !== input.length || !Number.isFinite(result)) fail();
  return result;
}
