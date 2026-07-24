/** Required tick box next to every IBAN/bank account field, so the person
 * submitting it actively confirms they've double-checked it -- wrong
 * account numbers are the single most common cause of delayed reward /
 * commission payouts. */
export default function IbanConfirmCheckbox({ id }: { id: string }) {
  return (
    <label htmlFor={id} className="mt-2 flex items-start gap-2 text-xs text-neutral-600">
      <input id={id} name={id} type="checkbox" required className="mt-0.5" />
      I have double-checked that the IBAN / account number above is correct.
    </label>
  );
}
