"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const ROLE_LABELS: Record<string, string> = {
  participant: "Participant",
  school: "School / Dojo",
  sensei: "Sensei / Coach",
  referee: "Referee / Judge",
  audience: "Audience / Spectator",
  customer_support: "Participant Support",
  organizer: "Organizer",
  admin: "Admin",
};

/** Only renders once signed in with more than one held role (profiles.roles)
 * — switching updates profiles.role, the single column every access-control
 * check in the app already reads, so a switch takes effect everywhere with
 * no other page needing to know about it. */
export default function RoleSwitcher() {
  const router = useRouter();
  const [role, setRole] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    async function load(userId: string | undefined) {
      if (!userId) {
        if (mounted) {
          setRole(null);
          setRoles([]);
        }
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("role, roles")
        .eq("user_id", userId)
        .maybeSingle();
      if (!mounted) return;
      setRole(data?.role ?? null);
      setRoles(Array.isArray(data?.roles) ? data.roles : []);
    }

    supabase.auth.getSession().then(({ data }) => load(data.session?.user.id));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      void load(session?.user.id);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function switchTo(target: string) {
    if (target === role) {
      setOpen(false);
      return;
    }
    setPending(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("switch_active_role", { p_role: target });
    setPending(false);
    setOpen(false);
    if (!error) {
      setRole(target);
      router.refresh();
    }
  }

  if (!role || roles.length < 2) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        className="ml-1 rounded border border-white/30 px-3 py-1.5 text-sm font-semibold hover:bg-neutral-800 disabled:opacity-60"
      >
        Viewing as: {ROLE_LABELS[role] ?? role} ▾
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-md border border-neutral-200 bg-white py-1 text-sm text-neutral-800 shadow-lg">
          {roles.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => switchTo(r)}
              className={`block w-full px-3 py-2 text-left hover:bg-neutral-100 ${r === role ? "font-semibold text-red-700" : ""}`}
            >
              {ROLE_LABELS[r] ?? r}
              {r === role && " (current)"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
