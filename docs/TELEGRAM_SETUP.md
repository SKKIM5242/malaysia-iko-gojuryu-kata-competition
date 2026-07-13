# Telegram community groups — setup guide

Live architecture: **five separate Telegram groups**, one per registration
category. Separate groups give genuine per-category access — unlike Topics
inside a single group (which every member can browse regardless of role),
membership in one group has nothing to do with membership in another.

| Category | Group |
|---|---|
| Participants | https://t.me/+mfpuPeHf6gs5Y2Rl |
| School / Dojo & Sensei / Coach (shared) | https://t.me/+JjPOjCHLOzNlMzRl |
| Referees / Judges | https://t.me/+WfAyMh5t9t02N2Rl |
| Audience / Spectators | https://t.me/+15XLZ1AK8nAwNWFl |
| Admin / Organizer / Customer Support | https://t.me/+pCKynJO6wLJmZjhl |

All five are live on the site: each registration/application confirmation
screen shows a **"Join Telegram Group"** button for that category's group.
Approved Referee/Judge and Admin/Organizer/Staff accounts see **all five**
links on their `/account` page — they moderate/judge across the whole
competition, not just one group.

## Topic structure — replicate the Participant group's style in the other four

Inside **each** of the four other groups (School/Sensei, Referees, Audience,
Admin/Staff), create the same three Topics you set up in the Participant
group:

1. **Group Settings → Edit → Topics** → toggle **ON** (if not already).
2. Create three topics (tap **+** in the topic list):
   - 📢 **Announcements**
   - 🌐 **Open Networking Introduction**
   - 🏆 **Winners**
3. For **Announcements** and **Winners** in each group: open the topic →
   **⋮ (More) → Edit Topic** and set posting to **only admins** (wording
   varies by Telegram app version). If your Telegram client doesn't offer a
   per-topic posting toggle, use a linked **Channel** instead for those two
   topics in that group — channels are always broadcast-only.

Repeat identically in all four groups so every category's group has the same
shape: Announcements (owner-only), Open Networking Introduction (everyone),
Winners (owner-only).

## Changing or adding groups later

Update the relevant environment variable in Vercel → Project → Settings →
Environment Variables, then redeploy (or just push any commit — Vercel
redeploys automatically):

```
TELEGRAM_GROUP_PARTICIPANT=https://t.me/+mfpuPeHf6gs5Y2Rl
TELEGRAM_GROUP_SCHOOL=https://t.me/+JjPOjCHLOzNlMzRl
TELEGRAM_GROUP_REFEREE=https://t.me/+WfAyMh5t9t02N2Rl
TELEGRAM_GROUP_AUDIENCE=https://t.me/+15XLZ1AK8nAwNWFl
TELEGRAM_GROUP_STAFF=https://t.me/+pCKynJO6wLJmZjhl
```

Leaving any of these blank makes the corresponding "Join Telegram Group"
button fall back to the phone/email contact instead of linking anywhere
broken.
