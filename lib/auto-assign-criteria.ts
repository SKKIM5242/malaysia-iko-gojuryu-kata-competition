/** The auto-assign algorithm's actual rules (see autoAssignReferees() in
 * app/actions/admin.ts), spelled out as documentation -- shown (and
 * editable) on the Judging page under Referee Workload. Editing the rows
 * seeded from this list only updates what's DISPLAYED; it doesn't change
 * the algorithm's real behavior. */
export const DEFAULT_AUTO_ASSIGN_CRITERIA: Array<{ title: string; description: string }> = [
  {
    title: "Eligible pool",
    description:
      "Approved referees (Referees page) with a linked login. A referee whose login isn't linked yet can't be assigned.",
  },
  {
    title: "Only fills empty slots",
    description:
      "Existing assignments are never touched -- auto-assign only tops up a recording up to its Judges-per-recording target.",
  },
  {
    title: "Load balancing",
    description: "The least-loaded eligible referee (fewest current assignments across the whole competition) is always picked first.",
  },
  { title: "Tie-break", description: "If multiple referees are equally least-loaded, one is picked at random." },
  {
    title: "Video processing order",
    description: "Recordings are processed in random order each run, so a referee shortage doesn't always starve the same videos.",
  },
  { title: "Notification", description: "Each newly-assigned referee is notified automatically by email and Telegram." },
];
