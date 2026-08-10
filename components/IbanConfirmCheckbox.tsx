/** Required tick box next to every IBAN/bank account field, so the person
 * submitting it actively confirms they've double-checked it -- wrong
 * account numbers are the single most common cause of delayed reward /
 * commission payouts.
 *
 * defaultChecked lets an EDIT form (as opposed to a brand-new
 * registration) start this pre-ticked when the record already has a bank
 * account number on file -- it was already confirmed once; without this,
 * every edit save (even one touching an unrelated field) was silently
 * blocked by this box's own `required` until the admin re-ticked it,
 * which read exactly like "my edit didn't save / data went missing." */
export default function IbanConfirmCheckbox({ id, defaultChecked }: { id: string; defaultChecked?: boolean }) {
  return (
    <label htmlFor={id} className="mt-2 flex items-start gap-2 text-xs text-neutral-600">
      <input id={id} name={id} type="checkbox" required defaultChecked={defaultChecked} className="mt-0.5" />
      I have double-checked that the IBAN / account number above is correct.
    </label>
  );
}
