/** Shared helper text shown above every bank-details section — explains the
 * Malaysian-local vs. international account number distinction. Previously
 * duplicated as a two-line label prefix on the IBAN field itself, which made
 * that field's label taller than "Bank name"'s and threw the two inputs out
 * of alignment; living here as its own line keeps both labels one line tall
 * so the inputs sit in the same row. */
export default function BankDetailsNote() {
  return (
    <p className="mt-1 text-xs text-neutral-500">
      For Malaysian accounts, enter your local bank account number below. For accounts outside
      Malaysia, provide your IBAN, SWIFT code, BIC, BBAN, or ACH number — if you&apos;re unsure,
      call your bank to check first, so there&apos;s no delay receiving any reward or commission.
    </p>
  );
}
