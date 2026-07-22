import {
  getOpenCompetitions,
  getCategories,
  getSchools,
  getSenseis,
  isCompetitionOpen,
  schemaReady,
} from "@/lib/data";
import { EmptyState, SetupNotice, SiteFooter, SiteHeader } from "@/components/ui";
import BulkRegisterForm from "@/components/BulkRegisterForm";
import CsvBulkForm from "@/components/CsvBulkForm";
import BulkUploadGate from "@/components/BulkUploadGate";
import { kataBases } from "@/lib/division";

export const dynamic = "force-dynamic";
// CSV uploads with thousands of rows need more than the default 10s
export const maxDuration = 60;

export const metadata = { title: "Bulk registration (Sensei / Coach)" };

export default async function BulkRegisterPage() {
  const ready = await schemaReady();
  if (!ready) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-6xl px-4 py-10"><SetupNotice /></main>
        <SiteFooter />
      </>
    );
  }

  const openCompetitions = (await getOpenCompetitions()).filter(isCompetitionOpen);

  const [categories, schools, senseis] = openCompetitions.length > 0
    ? await Promise.all([getCategories(openCompetitions[0].id), getSchools(), getSenseis()])
    : [[], [], []];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Bulk Registration — Sensei / Coach</h1>
        <p className="mt-1 text-sm text-neutral-500">
          One enquiry covers every open registration tier — declare how many participants and
          events you need per tier, pay the combined bill, then upload.
        </p>
        <div className="mt-8">
          {openCompetitions.length === 0 ? (
            <EmptyState>There is no competition to register for right now.</EmptyState>
          ) : (
            <>
              <div className="mb-6 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                Only an already-registered <strong>School / Dojo</strong> and <strong>Sensei / Coach</strong>{" "}
                may bulk-upload participants — if either isn&apos;t registered yet, do that first via{" "}
                <a href="/register/school" className="underline">Register School / Dojo</a> and{" "}
                <a href="/register/sensei" className="underline">Register Sensei / Coach</a>.
              </div>

              <BulkUploadGate
                competitions={openCompetitions}
                schools={schools}
                senseis={senseis}
              />

              <section className="mb-10 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold">Step 2, Option A — Excel / CSV Upload (Up To 10,000 Pax)</h2>
                <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-neutral-600">
                  <li>
                    <a href="/bulk-registration-template.csv" download className="font-semibold text-red-700 underline underline-offset-2">
                      Download the CSV template
                    </a>{" "}
                    (opens in Excel).
                  </li>
                  <li>
                    Process the CSV template by Select column A (by highlighting the column A) – go
                    to main menu select -Data - then at sub-menu center find &quot;Text to
                    column&quot; – click on Text to column – A window – Convert Text to Column
                    Wizard will appear - choose Delimited button then click Next button at bottom
                    of the window – Tick Comma (others don&apos;t tick) – Click Next again – Chose
                    &quot;General&quot; at column data format – Click the finish button at bottom
                    right. Wa lah ! you get the Excel file to enter the participants data according
                    to 2 samples.
                  </li>
                  <li>
                    Fill one row per participant start from the 4th row - follow the sample format
                    (address no comma) — keep the header row and key in dates as DD/MM/YYYY - kata
                    event must match one of the kata event names (Please copy from listing of{" "}
                    <a href="/kata-categories" className="font-semibold underline underline-offset-2">Kata Categories</a>{" "}
                    at home page).
                  </li>
                  <li>After finish fill in all participants - Delete the 2 samples given -2nd &amp; 3rd row.</li>
                  <li>
                    Save the Excel file at a location – file folder – create a file name - choose –
                    save as type – Excel Template – Click Save (for your own reference)
                  </li>
                  <li>
                    Again - Save the Excel file at a location – file folder – create a file name -
                    choose – save as type – CSV (Comma delimited)– Click Save (this file is for you
                    to upload).
                  </li>
                  <li>
                    Upload the file by going back to the Bulk Registration page – Click the red
                    button of - Upload CSV and register participants - find the file location you
                    save – choose the folder or file - click open – it will upload itself.
                  </li>
                </ol>
                <div className="mt-4">
                  <CsvBulkForm competitions={openCompetitions} schools={schools} senseis={senseis} />
                </div>
              </section>

              <section>
                <h2 className="text-lg font-bold">Step 2, Option B — Fill The Table On Screen</h2>
                <div className="mt-2 mb-4 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
                  Fill one row per participant — like a spreadsheet. Your{" "}
                  <a href="/register/school" className="font-semibold underline underline-offset-2">School / Dojo</a>{" "}
                  and{" "}
                  <a href="/register/sensei" className="font-semibold underline underline-offset-2">Sensei / Coach</a>{" "}
                  must already be registered — select the tier you paid for and them once at the
                  top; they apply to every row. All fields marked * are required, including each
                  participant&apos;s bank details for prize payouts. Each student may register for a{" "}
                  <strong>maximum of 3 kata categories</strong> — add one row per kata.
                </div>
                <BulkRegisterForm
                  competitions={openCompetitions}
                  kataBases={kataBases(categories)}
                  schools={schools}
                  senseis={senseis}
                />
              </section>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
