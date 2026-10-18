import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { wrapToolResult } from "../prompt";

/**
 * Evaluates arithmetic safely, with no eval(). It handles + - * / % ^ ( ),
 * decimals and a leading minus, and follows the usual precedence:
 *
 *   expression = term (("+" | "-") term)*
 *   term       = unary (("*" | "/" | "%") unary)*
 *   unary      = "-" unary | power
 *   power      = primary ("^" unary)?        (so 2^3^2 = 2^9)
 *   primary    = number | "(" expression ")"
 *
 * Each rule below is one function that reads tokens left to right.
 */
// Examples: evaluate("3 * (2 + 1)") returns 9;  evaluate("2 ^ 3 ^ 2") returns 512;
//           evaluate("0.1 + 0.2") returns 0.3;   evaluate("1 / 0") throws Error("Division by zero.")
export function evaluate(text: string): number {
  // Split into numbers and symbols, e.g. "3*(2+1)" -> [3, "*", "(", 2, "+", 1, ")"].
  const tokens: Array<number | string> = [];
  for (const match of text.matchAll(/\s*(\d+\.?\d*|\.\d+|[-+*/%^()]|\S)/g)) {
    const piece = match[1];
    if (/^(\d|\.\d)/.test(piece)) tokens.push(Number(piece));
    else if (/^[-+*/%^()]$/.test(piece)) tokens.push(piece);
    else throw new Error(`Unsupported character "${piece}". Use numbers and + - * / % ^ ( ) only.`);
  }

  let position = 0;
  // Example return: the token at the current position, WITHOUT moving on. For [3, "*", 2] at the start it returns 3.
  // At the end of the expression it returns undefined.
  const peek = () => tokens[position];
  // Example return: the token at the current position, THEN moves on. Called three times on [3, "*", 2] it returns 3, then "*", then 2.
  const next = () => tokens[position++];

  // Example: for "1 + 2 * 3" this returns 7 (it adds and subtracts the terms).
  function expression(): number {
    let value = term();
    while (peek() === "+" || peek() === "-") {
      const operator = next();
      const right = term();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  // Example: for the part "2 * 3" this returns 6 (it multiplies, divides and takes remainders).
  function term(): number {
    let value = unary();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const operator = next();
      const right = unary();
      if (operator !== "*" && right === 0) throw new Error("Division by zero.");
      value = operator === "*" ? value * right : operator === "/" ? value / right : value % right;
    }
    return value;
  }

  // Example: for "-4" this returns -4; for "+4" it returns 4; for "4" it returns whatever power() gives, 4.
  function unary(): number {
    if (peek() === "-") {
      next();
      return -unary();
    }
    if (peek() === "+") {
      next();
      return unary();
    }
    return power();
  }

  // Example: for "2 ^ 3" this returns 8; for a lone "5" it returns 5.
  function power(): number {
    const base = primary();
    if (peek() !== "^") return base;
    next();
    return Math.pow(base, unary());
  }

  // Example: for the token 7 this returns 7; for "( 1 + 2 )" it returns 3.
  // It throws on something that cannot start a value, e.g. Error(Unexpected ")").
  function primary(): number {
    const token = next();
    if (typeof token === "number") return token;
    if (token === "(") {
      const value = expression();
      if (next() !== ")") throw new Error('Missing closing ")".');
      return value;
    }
    throw new Error(token === undefined ? "The expression ended too early." : `Unexpected "${token}".`);
  }

  const result = expression();
  if (position < tokens.length) throw new Error(`Unexpected "${tokens[position]}".`);
  if (!Number.isFinite(result)) throw new Error("The result is not a finite number.");

  return Number(result.toPrecision(12)); // hide floating-point noise: 0.1 + 0.2 -> 0.3
}

export const calculate = tool(
  // Example return, for { expression: "3 * 5 + 2" }: the text the model reads,
  //   <tool_result tool="calculate" untrusted="true">
  //   3 * 5 + 2 = 17
  //   </tool_result>
  // A bad expression such as "1 / 0" throws instead, and ToolNode turns that into an error message.
  async ({ expression }) => {
    // Throwing is fine: LangGraph's ToolNode turns an error into a message the model can read.
    return wrapToolResult("calculate", `${expression} = ${evaluate(expression)}`);
  },
  {
    name: "calculate",
    description:
      "Evaluate an arithmetic expression exactly. Supports numbers, + - * / % (remainder), ^ (power) and parentheses. " +
      "Use it for any calculation instead of doing the math yourself, e.g. '(3 * 5) + 2'. " +
      "Numbers only: no units, variables, percent signs or commas. Not for searching documents.",
    schema: z.object({
      expression: z.string().min(1).max(200).describe("The arithmetic expression, e.g. '(120 - 15) / 3'."),
    }),
    verboseParsingErrors: true, // if the model sends bad arguments, tell it which field is wrong
  }
);
