import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { wrapToolResult } from "../prompt";

export const getCurrentDatetime = tool(
  // Example: { timezone: "Asia/Kolkata" } returns {"timezone":"Asia/Kolkata","localTime":"2026-10-15 02:00:15","weekday":"Thursday","utc":"…"}
  // An unknown timezone throws.
  async ({ timezone }) => {
    const zone = timezone ?? "UTC";
    const now = new Date();

    try {
      return wrapToolResult(
        "get_current_datetime",
        JSON.stringify({
          timezone: zone,
          localTime: now.toLocaleString("sv-SE", { timeZone: zone }), // e.g. "2026-10-14 20:30:15"
          weekday: now.toLocaleDateString("en-US", { timeZone: zone, weekday: "long" }),
          utc: now.toISOString(),
        })
      );
    } catch {
      throw new Error(`Unknown timezone "${zone}". Use an IANA name such as "UTC" or "Asia/Kolkata".`);
    }
  },
  {
    name: "get_current_datetime",
    description:
      "Get the current date and time, optionally in a given IANA timezone (e.g. 'Asia/Kolkata'). " +
      "Defaults to UTC. Use it for questions about today's date, the weekday, or date arithmetic that depends on 'now'. " +
      "Not for searching documents.",
    schema: z.object({
      timezone: z.string().min(1).max(64).optional().describe("IANA timezone name, e.g. 'Europe/London'. Default: UTC."),
    }),
    verboseParsingErrors: true,
  }
);
