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
            <h2 className="mb-1 font-bold text-neutral-900">1. Who This Applies To</h2>
            <p>
              These terms apply to anyone creating a Kata Arena account — Participants, Referees /
              Judges, and Admin / Organizer / Participant Support staff — to submit, judge, or manage
              kata recordings for this competition.
            </p>
          </section>
          <section>
            <h2 className="mb-1 font-bold text-neutral-900">2. Faulty Participant Data</h2>
            <p>
              Example: If a participant&apos;s Latest Belt Rank and certificate do not match, the
              participant will be disqualified and will have to register again with matching data.
            </p>
          </section>
          <section>
            <h2 className="mb-1 font-bold text-neutral-900">3. Recording &amp; Submission</h2>
            <p>
              Participants may record and re-record their kata up to the attempt limit shown in the
              recorder. Once submitted, a recording is final and cannot be replaced. By submitting,
              you confirm the recording is your own performance, filmed by you or someone you
              authorized, and you grant the organizer the right to store, play back, and judge it
              within Kata Arena.
            </p>
          </section>
          <section>
            <h2 className="mb-1 font-bold text-neutral-900">4. Judging</h2>
            <p>
              Each recording is scored by a panel of Referees / Judges assigned by the organizer
              (typically 3, 5, or 7 per recording). Where 5 or more judges score a recording, the
              highest and lowest scores are dropped and the remaining scores are averaged for the
              final result. Referees may only view and score recordings assigned to them, and
              scoring decisions are final.
            </p>
          </section>
          <section>
            <h2 className="mb-1 font-bold text-neutral-900">5. Visibility</h2>
            <p>
              Every submitted recording is visible to every signed-in Kata Arena account as soon as
              it is submitted, listed by kata event in submission order. A recording shows a green
              status with its total score once every assigned judge has scored it, or a red
              &quot;Disqualified&quot; status if any one judge gave a Total Score of 0 — no score is
              shown for a disqualified entry. Referees / Judges see only their own individual score
              per recording; Admin / Organizer / Participant Support see every judge&apos;s individual
              score. Official winners and standings are announced separately — see{" "}
              <a href="/winners" className="font-semibold text-red-700 underline underline-offset-2">
                Winners
              </a>
              .
            </p>
          </section>
          <section>
            <h2 className="mb-1 font-bold text-neutral-900">6. Payments</h2>
            <p>
              Once payment for a registration or deposit is made, no refund will be given if a
              participant does not attend or later decides not to participate.
            </p>
          </section>
          <section>
            <h2 className="mb-1 font-bold text-neutral-900">7. Conduct</h2>
            <p>
              Accounts are personal and may not be shared. The organizer may suspend or remove any
              account for abusive conduct, attempted score manipulation, or submission of
              recordings that are not a genuine, unedited performance.
            </p>
          </section>
          <section>
            <h2 className="mb-1 font-bold text-neutral-900">8. Contact on this competition</h2>
            <p>
              <strong>Telegram:</strong> Please join the Telegram group for your registration
              category as directed by the organizer — the link is in your confirmation email. It&apos;s
              where you&apos;ll find the latest announcements, chat with other participants, ask the
              organizer questions, or get help from Participant Support.
            </p>
            <p className="mt-2">
              This is an international competition — please read every announcement covering the
              rules and regulations.
            </p>
            <p className="mt-2">
              Your patience and cooperation — and any help you can offer fellow participants or the
              organizer — is greatly appreciated.
            </p>
          </section>
          <p className="border-t border-neutral-200 pt-6 italic text-neutral-600">
            Lastly, the organizer would like to wish all types of participants of this Malaysia
            Open Kata Competition — All the best… may everything go well and smoothly.
            <br />
            Thank you for your participation and trust.
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
