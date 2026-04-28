/**
 * Calendar YYYY-MM-DD in the user's local timezone.
 * Avoid `Date#toISOString().slice(0, 10)` for dates — it uses UTC and can shift
 * the calendar day vs local `setDate` / `getDay` (e.g. "next Monday" becomes Sunday or Tuesday).
 */
export function formatLocalISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Next calendar Monday (strictly after today if today is Monday). Local dates. */
export function nextMonday() {
  const d = new Date();
  const dow = d.getDay(); // 0 Sun .. 6 Sat
  const diff = (8 - dow) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return formatLocalISODate(d);
}
