import { z } from "zod";
import { defineTool } from "../registry";

export function createGetCurrentDatetime(now: () => Date = () => new Date()) {
  return defineTool({
    name: "get_current_datetime",
    description:
      "Get the current date and time, optionally in a given IANA timezone (e.g. 'Asia/Kolkata'). " +
      "Defaults to UTC. Use it for questions about today's date, the weekday, or date arithmetic that depends on 'now'. " +
      "Not for searching documents.",
    inputSchema: z.object({
      timezone: z
        .string()
        .trim()
        .min(1)
        .max(64)
        .optional()
        .describe("IANA timezone name, e.g. 'Europe/London'. Default: UTC."),
    }),
    async run({ timezone }) {
      const zone = timezone ?? "UTC";
      const date = now();

      let parts: Intl.DateTimeFormatPart[];
      try {
        parts = new Intl.DateTimeFormat("en-CA", {
          timeZone: zone,
          weekday: "long",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
        }).formatToParts(date);
      } catch {
        return {
          content: `Error: unknown timezone "${zone}". Use an IANA name such as "UTC" or "Asia/Kolkata".`,
          isError: true,
        };
      }

      const get = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((part) => part.type === type)?.value ?? "";

      return {
        content: JSON.stringify({
          timezone: zone,
          localDate: `${get("year")}-${get("month")}-${get("day")}`,
          localTime: `${get("hour")}:${get("minute")}:${get("second")}`,
          weekday: get("weekday"),
          utcIso: date.toISOString(),
        }),
      };
    },
  });
}

export const getCurrentDatetime = createGetCurrentDatetime();
