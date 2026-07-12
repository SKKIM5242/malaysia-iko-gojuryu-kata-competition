import { SiteFooter, SiteHeader } from "@/components/ui";
import { SchoolForm } from "@/components/DirectoryForms";

export const dynamic = "force-dynamic";

export const metadata = { title: "Register School / Dojo" };

export default function RegisterSchoolPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">School / Dojo registration</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Register your school or dojo so your sensei and participants can select it during registration.
        </p>
        <div className="mt-8">
          <SchoolForm />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
