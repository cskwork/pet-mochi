/**
 * Hatch-day anniversaries (PRD §27.5, REQ-110).
 *
 * Yearly: month+day of `createdAt` → full celebration, deduped per year via a
 * durable memory row. Monthly: same day-of-month → small heart burst, session
 * flag only. Pets created on day 29–31 simply skip months without that day —
 * documented, acceptable.
 */

export type HatchdayStatus = {
  yearly: boolean;
  monthly: boolean;
  ageYears: number;
  ageMonths: number;
};

export const HATCHDAY_MEMORY_MARKER = "hatch-day";
export const HATCHDAY_MEMORY_TYPE = "relationship";

export function hatchdayStatus(createdAtIso: string, now: Date): HatchdayStatus {
  const created = new Date(createdAtIso);
  if (Number.isNaN(created.getTime())) {
    return { yearly: false, monthly: false, ageYears: 0, ageMonths: 0 };
  }

  const sameDay = now.getDate() === created.getDate();
  const sameMonth = now.getMonth() === created.getMonth();
  const ageYears = now.getFullYear() - created.getFullYear();
  const ageMonths =
    ageYears * 12 + (now.getMonth() - created.getMonth());

  const yearly = sameDay && sameMonth && ageYears >= 1;
  const monthly = sameDay && !yearly && ageMonths >= 1;
  return { yearly, monthly, ageYears, ageMonths };
}

/** True when a hatch-day memory already exists for the current year. Filters
 *  on type + marker so a chat-extracted memory that merely *mentions*
 *  "hatch-day" can't suppress the real celebration. */
export function hasCelebratedHatchdayThisYear(
  memories: readonly { type: string; content: string; createdAt: string }[],
  now: Date,
): boolean {
  const year = String(now.getFullYear());
  return memories.some(
    (m) =>
      m.type === HATCHDAY_MEMORY_TYPE &&
      m.content.includes(HATCHDAY_MEMORY_MARKER) &&
      m.createdAt.startsWith(year),
  );
}

export function hatchdayMemoryContent(ageYears: number): string {
  const unit = ageYears === 1 ? "year" : "years";
  return `${HATCHDAY_MEMORY_MARKER}! ${ageYears} ${unit} together 🎉`;
}

export function hatchdayBubble(petName: string, ageYears: number): string {
  const unit = ageYears === 1 ? "year" : "years";
  return `${petName}: our hatch-day!! ${ageYears} ${unit} of us 🎉♡`;
}
