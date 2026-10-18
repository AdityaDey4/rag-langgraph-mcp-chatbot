import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { wrapToolResult } from "../prompt";

// A safe calculator (no eval). Each grammar rule below is one function:
//   expression = term (("+" | "-") term)*
//   term       = unary (("*" | "/" | "%") unary)*
//   unary      = "-" unary | power
//   power      = primary ("^" unary)?
//   primary    = number | "(" expression ")"
// Example: evaluate("3 * (2 + 1)") returns 9; evaluate("2 ^ 3 ^ 2") returns 512; evaluate("1 / 0") throws "Division by zero."
export function evaluate(text: string): number {
  // "3*(2+1)" becomes [3, "*", "(", 2, "+", 1, ")"]
  const tokens: Array<number | string> = [];
  for (const match of text.matchAll(/\s*(\d+\.?\d*|\.\d+|[-+*/%^()]|\S)/g)) {
    const piece = match[1];
    if (/^(\d|\.\d)/.test(piece)) tokens.push(Number(piece));
    else if (/^[-+*/%^()]$/.test(piece)) tokens.push(piece);
    else throw new Error(`Unsupported character "${piece}". Use numbers and + - * / % ^ ( ) only.`);
  }

  let position = 0;
  // Example: on [3, "*", 2] at the start, peek() returns 3 and stays put
  const peek = () => tokens[position];
  // Example: on [3, "*", 2], three calls to next() return 3, "*", 2
  const next = () => tokens[position++];

  // Example: "1 + 2 * 3" returns 7
  function expression(): number {
    let value = term();
    while (peek() === "+" || peek() === "-") {
      const operator = next();
      const right = term();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  // Example: "2 * 3" returns 6
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

  // Example: "-4" returns -4; "4" returns 4
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

  // Example: "2 ^ 3" returns 8; "5" returns 5
  function power(): number {
    const base = primary();
    if (peek() !== "^") return base;
    next();
    return Math.pow(base, unary());
  }

  // Example: the token 7 returns 7; "( 1 + 2 )" returns 3
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

  return Number(result.toPrecision(12)); // hides floating-point noise: 0.1 + 0.2 gives 0.3
}

export const calculate = tool(
  // Example: { expression: "3 * 5 + 2" } returns '<tool_result tool="calculate" untrusted="true">\n3 * 5 + 2 = 17\n</tool_result>'
  // A bad expression throws, and ToolNode turns the error into a message for the model.
  async ({ expression }) => {
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
