import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { addMinutes } from 'date-fns';

/**
 * Shared "clinic-local calendar day" derivation, extracted from
 * AppointmentsService.todayRangeForClinic so the Queue module (which needs
 * the exact same notion of "today" to scope token numbers per calendar
 * day) doesn't reimplement it — see queue.service.ts's `queueDateForClinic`.
 */
export function clinicDayRange(
  timeZone: string,
  at: Date = new Date(),
): { dayStart: Date; dayEnd: Date } {
  const dateStr = formatInTimeZone(at, timeZone, 'yyyy-MM-dd');
  const dayStart = fromZonedTime(`${dateStr}T00:00:00`, timeZone);
  const dayEnd = addMinutes(dayStart, 24 * 60);
  return { dayStart, dayEnd };
}
