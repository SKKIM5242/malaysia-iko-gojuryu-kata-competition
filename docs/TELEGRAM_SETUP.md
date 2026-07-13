# Telegram community group — setup guide

The site can show a **"Join Telegram Group"** button on payment-success pages,
but the group itself has to be created by you inside the Telegram app —
no bot or API can create a group on your behalf (Telegram groups are tied to
a verified phone-number account). This takes about 5 minutes.

## 1. Create the group

1. In Telegram (phone or desktop, signed in as **@realSKKIM9**), tap **New Group**.
2. Add at least one other member (Telegram requires one to finish creation —
   you can remove them after, or just add your co-organiser).
3. Name it exactly: **MY Open Kata Competition by IKO GOJU-RYU KARATE-DO MALAYSIA SDN BHD**
4. After creating it, open **Group Settings → Edit → Group Type** and convert
   it to a **Public Group** (or keep it private — either works, but public
   groups get a shareable `t.me/yourname` link, which is simpler to wire in).

## 2. Turn on Topics (forum mode)

1. **Group Settings → Edit → Topics** → toggle **ON**.
2. This turns the single chat into separate sections. Create one topic per
   item below (tap **+** at the bottom of the topic list):
   - 📢 **Announcements**
   - 🌐 **Open Networking Introduction**
   - 🏆 **Winners**
   - 🧑‍🎓 **Participants**
   - 🏫 **Schools / Dojo**
   - 🥋 **Sensei / Coach**
   - ⚖️ **Referees / Judges**
   - 👥 **Audience**
   - 🛠️ **Admin / Organizer / Staff**

## 3. Make Announcements and Winners owner-only

Open each of those two topics → **⋮ (More) → Edit Topic** (or long-press the
topic in the list) → look for a posting-permission toggle (wording varies by
Telegram app version, e.g. "Only admins can send messages in this topic").
If your Telegram version doesn't offer a per-topic toggle yet, the reliable
fallback is to make **Announcements** and **Winners** separate **Channels**
instead of topics — channels are always broadcast-only (only admins post,
everyone else reads), and you can link them from the group description.

## 4. About per-category access

Telegram doesn't let you hide topics from specific members — once someone
joins the group they can see every topic. So "access as per registration
category" in practice means: **the site sends each visitor a link straight
to their own topic** (Participants, Schools, Senseis, Audience), while they
can still browse the rest of the group like anyone else. Referees/Judges and
Admin/Organizer/Staff get the plain group link, since they're meant to see
everything anyway.

If you want *true* access restriction per category (not just "which topic
you land on first"), the only way is separate groups per category — happy to
wire that up instead if you'd prefer it, just say so.

## 5. Get the links and give them to Claude

1. **Group link**: Group Settings → **Invite Link** (or, for a public group,
   it's `https://t.me/yourgroupusername`).
2. **Topic links** (optional, for direct-to-topic buttons): long-press a
   topic name in the topic list → **Copy Link**. It looks like
   `https://t.me/yourgroupusername/123` — the number `123` at the end is the
   topic ID you need.

Paste the group link (and topic IDs, if you set them up) here, or add them
directly as environment variables in Vercel:

```
TELEGRAM_GROUP_URL=https://t.me/yourgroupusername
TELEGRAM_TOPIC_PARTICIPANT=<topic id>
TELEGRAM_TOPIC_SCHOOL=<topic id>
TELEGRAM_TOPIC_SENSEI=<topic id>
TELEGRAM_TOPIC_AUDIENCE=<topic id>
```

Once set, the "Join Telegram Group" button lights up automatically — no code
changes needed.
