import { z } from "zod";
import { defineTool } from "../registry";

export class CalculationError extends Error {}

/**
 * Hand-written arithmetic parser (no eval / Function). Grammar:
 *
 *   expr    = term (("+" | "-") term)*
 *   term    = unary (("*" | "/" | "%") unary)*
 *   unary   = ("+" | "-") unary | power
 *   power   = primary ("^" unary)?        // right-associative: 2^3^2 = 2^9
 *   primary = number | "(" expr ")"
 */
export function evaluateExpression(source: string): number {
  const tokens = tokenize(source);
  let position = 0;

  const peek = () => tokens[position];
  const next = () => tokens[position++];

  function parseExpr(): number {
    let value = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const right = parseTerm();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }

  function parseTerm(): number {
    let value = parseUnary();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = next();
      const right = parseUnary();
      if ((op === "/" || op === "%") && right === 0) {
        throw new CalculationError("Division by zero.");
      }
      value =
        op === "*" ? value * right : op === "/" ? value / right : value % right;
    }
    return value;
  }

  function parseUnary(): number {
    if (peek() === "-") {
      next();
      return -parseUnary();
    }
    if (peek() === "+") {
      next();
      return parseUnary();
    }
    return parsePower();
  }

  function parsePower(): number {
    const base = parsePrimary();
    if (peek() === "^") {
      next();
      return Math.pow(base, parseUnary());
    }
    return base;
  }

  function parsePrimary(): number {
    const token = next();

    if (token === undefined) {
      throw new CalculationError("Unexpected end of expression.");
    }
    if (typeof token === "number") return token;
    if (token === "(") {
      const value = parseExpr();
      if (next() !== ")") throw new CalculationError('Missing closing ")".');
      return value;
    }
    throw new CalculationError(`Unexpected "${token}".`);
  }

  const result = parseExpr();

  if (position < tokens.length) {
    throw new CalculationError(`Unexpected "${tokens[position]}".`);
  }
  if (!Number.isFinite(result)) {
    throw new CalculationError("Result is not a finite number.");
  }

  // Trim floating-point noise (0.1 + 0.2 -> 0.3).
  return Number(result.toPrecision(12));
}

function tokenize(source: string): Array<number | string> {
  const tokens: Array<number | string> = [];
  let i = 0;

  while (i < source.length) {
    const char = source[i];

    if (/\s/.test(char)) {
      i++;
    } else if ("+-*/%^()".includes(char)) {
      tokens.push(char);
      i++;
    } else if (/[0-9.]/.test(char)) {
      const match = /^(?:\d+\.?\d*|\.\d+)/.exec(source.slice(i));
      if (!match) {
        throw new CalculationError(
          `Invalid number near "${source.slice(i, i + 5)}".`
        );
      }
      tokens.push(Number(match[0]));
      i += match[0].length;
    } else {
      throw new CalculationError(
        `Unsupported character "${char}". Only numbers and + - * / % ^ ( ) are allowed.`
      );
    }
  }

  return tokens;
}

export const calculate = defineTool({
  name: "calculate",
  description:
    "Evaluate an arithmetic expression exactly. Supports numbers, + - * / % (remainder), ^ (power) and parentheses. " +
    "Use it for any calculation instead of doing the math yourself, e.g. '(3 * 5) + 2'. " +
    "Numbers only: no units, variables, percent signs or commas. Not for searching documents.",
  inputSchema: z.object({
    expression: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe("The arithmetic expression, e.g. '(120 - 15) / 3'."),
  }),
  async run({ expression }) {
    try {
      const result = evaluateExpression(expression);
      return { content: `${expression} = ${result}`, data: { result } };
    } catch (error) {
      if (error instanceof CalculationError) {
        return { content: `Error: ${error.message}`, isError: true };
      }
      throw error;
    }
  },
});
