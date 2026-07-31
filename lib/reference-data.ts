/** ISO-4217-ish world currency codes offered across the app's billing
 * forms (Class Billing fee plans/invoices). Not exhaustive — the major
 * currencies plus every one already relevant to this competition's
 * participating countries. */
export const WORLD_CURRENCIES = [
  "MYR", "USD", "SGD", "EUR", "GBP", "JPY", "CNY", "HKD", "TWD", "KRW",
  "INR", "IDR", "THB", "VND", "PHP", "AUD", "NZD", "CAD", "AED", "SAR",
  "ZAR", "BRL", "MXN", "RUB", "TRY", "CHF",
] as const;

/** Language names offered on the "which languages do you speak/read/write"
 * field — kept separate from AccessibilityToolbar's LANGUAGES (which pairs
 * each with a Google Translate code + flag for the translate widget); this
 * one just needs plain names for a person's own language ability. */
export const SPOKEN_LANGUAGES = [
  "English", "Arabic", "Chinese / Mandarin", "Dutch", "French", "German",
  "Hindi", "Indonesian", "Italian", "Japanese", "Korean", "Malay",
  "Persian", "Portuguese", "Russian", "Spanish", "Tamil", "Thai", "Vietnamese",
] as const;

export const EDUCATION_LEVELS = ["Primary", "Secondary", "A-Level", "Tertiary", "Master", "PhD"] as const;

/** World regions for the "which region would you prefer to support" field,
 * per the Energy Institute's world-region grouping (the same 7-region split
 * used across Our World in Data's energy maps) — chosen by the organizer as
 * a familiar, unambiguous way to group support coverage by geography. */
export const SUPPORT_REGIONS = [
  "North America",
  "South and Central America",
  "Europe",
  "Africa",
  "Middle East",
  "CIS (Commonwealth of Independent States)",
  "Asia Pacific",
] as const;

/** World countries for "which country are you currently based at" — plain
 * common names, alphabetical. Deliberately separate from the free-text
 * "home address country" field already on these forms: someone can be
 * currently based somewhere other than their permanent home address. */
export const WORLD_COUNTRIES = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Argentina", "Armenia", "Australia",
  "Austria", "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium",
  "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei",
  "Bulgaria", "Burkina Faso", "Burundi", "Cambodia", "Cameroon", "Canada", "Cape Verde",
  "Central African Republic", "Chad", "Chile", "China", "Colombia", "Comoros", "Congo",
  "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czech Republic", "Democratic Republic of the Congo",
  "Denmark", "Djibouti", "Dominica", "Dominican Republic", "Ecuador", "Egypt", "El Salvador",
  "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia", "Fiji", "Finland", "France",
  "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada", "Guatemala", "Guinea",
  "Guinea-Bissau", "Guyana", "Haiti", "Honduras", "Hong Kong", "Hungary", "Iceland", "India",
  "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy", "Ivory Coast", "Jamaica", "Japan",
  "Jordan", "Kazakhstan", "Kenya", "Kiribati", "Kosovo", "Kuwait", "Kyrgyzstan", "Laos", "Latvia",
  "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg", "Macau",
  "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania",
  "Mauritius", "Mexico", "Micronesia", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco",
  "Mozambique", "Myanmar", "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand", "Nicaragua",
  "Niger", "Nigeria", "North Korea", "North Macedonia", "Norway", "Oman", "Pakistan", "Palau",
  "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland",
  "Portugal", "Qatar", "Romania", "Russia", "Rwanda", "Saint Kitts and Nevis", "Saint Lucia",
  "Saint Vincent and the Grenadines", "Samoa", "San Marino", "Sao Tome and Principe",
  "Saudi Arabia", "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore", "Slovakia",
  "Slovenia", "Solomon Islands", "Somalia", "South Africa", "South Korea", "South Sudan", "Spain",
  "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan",
  "Tanzania", "Thailand", "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia",
  "Turkey", "Turkmenistan", "Tuvalu", "Uganda", "Ukraine", "United Arab Emirates",
  "United Kingdom", "United States", "Uruguay", "Uzbekistan", "Vanuatu", "Vatican City",
  "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe",
] as const;

/** Label and example text for the "how did you hear about us" field, shared
 * by every registration form on both the public site and the admin panel so
 * the two never drift apart. */
export const REFERRAL_LABEL = "Referral / Where did you hear about this competition?";
export const REFERRAL_PLACEHOLDER =
  "e.g. friend's name, social media name, relative name, any event name, or any channel name or competition support name etc.";

/** The account roles stored in `profiles.role` / `profiles.roles`. These are
 * the ONLY values that resolve a Sign-in Access Matrix row to an account, via
 * `sign_in_role_defaults.role_key`.
 *
 * That table's `role` column is a free-text display label the organizer may
 * rename at will on /admin/content. It used to double as the join key, so
 * relabelling the rows ("participant" -> "Participant", "customer_support" ->
 * "Participant_Support") silently detached every row and dropped every role to
 * the hardcoded 250-sign-in fallback — including Admin and Organizer, which
 * must be unlimited. See migration 0093. */
export const PROFILE_ROLE_KEYS = [
  "participant", "school", "sensei", "referee",
  "customer_support", "organizer", "admin", "staff", "audience",
] as const;

export type ProfileRoleKey = (typeof PROFILE_ROLE_KEYS)[number];

/** Human label for a role key, for the Sign-in Access Matrix picker. */
export const PROFILE_ROLE_KEY_LABELS: Record<ProfileRoleKey, string> = {
  participant: "Participant",
  school: "School / Dojo",
  sensei: "Sensei",
  referee: "Referee / Judge",
  customer_support: "Participant Support",
  organizer: "Organizer",
  admin: "Admin",
  staff: "Staff (legacy)",
  audience: "Audience / Spectator",
};
