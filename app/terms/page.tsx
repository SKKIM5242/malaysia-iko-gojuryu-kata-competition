import { SiteFooter, SiteHeader } from "@/components/ui";

export const metadata = { title: "Terms & Conditions" };

export default function TermsPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Kata Arena — Terms &amp; Conditions</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Malaysia Open IKO Goju-ryu Karate-do Kata Competition — organised by IKO GOJU-RYU
          KARATE-DO MALAYSIA SDN BHD.
        </p>
        <div className="mt-8 space-y-6 text-sm leading-relaxed text-neutral-700">
          <section>
            <h2 className="mb-1 font-bold text-neutral-900">1. Who this applies to</h2>
            <p>
              These terms apply to anyone creating a Kata Arena account — Participants, Referees /
              Judges, and Admin / Organizer / Customer Support staff — to submit, judge, or manage
              kata recordings for this competition.
            </p>
          </section>
          <section>
            <h2 className="mb-1 font-bold text-neutral-900">2. Recording &amp; submission</h2>
            <p>
              Participants may record and re-record their kata up to the attempt limit shown in the
              recorder. Once submitted, a recording is final and cannot be replaced. By submitting,
              you confirm the recording is your own performance, filmed by you or someone you
              authorised, and you grant the organiser the right to store, play back, and judge it
              within Kata Arena.
            </p>
          </section>
          <section>
            <h2 className="mb-1 font-bold text-neutral-900">3. Judging</h2>
            <p>
              Each recording is scored by a panel of Referees / Judges assigned by the organiser
              (typically 3, 5, or 7 per recording). Where 5 or more judges score a recording, the
              highest and lowest scores are dropped and the remaining scores are averaged for the
              final result. Referees may only view and score recordings assigned to them, and
              scoring decisions are final.
            </p>
          </section>
          <section>
            <h2 className="mb-1 font-bold text-neutral-900">4. Visibility</h2>
            <p>
              Before a competition&apos;s registration deadline, a Participant can view only their own
              submitted recording. After the deadline, all Participants&apos; recordings and final
              scores for that competition become visible to signed-in Participants within Kata
              Arena. Referees / Judges and Admin / Organizer / Customer Support see the recordings
              assigned or made visible to their role at any time.
            </p>
          </section>
          <section>
            <h2 className="mb-1 font-bold text-neutral-900">5. Payments</h2>
            <p>
              Once payment for a registration or deposit is made, no refund will be given if a
              participant does not attend or later decides not to participate.
            </p>
          </section>
          <section>
            <h2 className="mb-1 font-bold text-neutral-900">6. Conduct</h2>
            <p>
              Accounts are personal and may not be shared. The organiser may suspend or remove any
              account for abusive conduct, attempted score manipulation, or submission of
              recordings that are not a genuine, unedited performance.
            </p>
          </section>
          <section>
            <h2 className="mb-1 font-bold text-neutral-900">7. Contact</h2>
            <p>
              Questions about these terms can be sent to the organiser at{" "}
              <a href="mailto:kimsiewkiew@gmail.com" className="font-semibold text-red-700 underline underline-offset-2">
                kimsiewkiew@gmail.com
              </a>.
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
