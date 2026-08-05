/** Generic DD/MM/YYYY date entry for every non-DOB date field across the
 * admin panel (event dates, deadlines, validity windows, filters, etc.) —
 * same component as DateOfBirthField, just re-exported under a neutral
 * name so it doesn't read oddly on a field like "Registration deadline".
 * A native `<input type="date">` shows a locale-dependent format
 * (MM/DD/YYYY on a US-locale browser); this always shows DD/MM/YYYY. */
export { default } from "@/components/DateOfBirthField";
