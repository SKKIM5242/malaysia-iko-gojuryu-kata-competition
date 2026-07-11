import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Malaysia IKO Goju-ryu Kata Competition",
    template: "%s — Malaysia IKO Goju-ryu Kata Competition",
  },
  description:
    "Official platform of the Malaysia IKO Goju-ryu Kata competition — event info, announcements, participant list, and online registration.",
  openGraph: {
    title: "Malaysia IKO Goju-ryu Kata Competition",
    description:
      "Event info, announcements, confirmed participants, and online registration for the Malaysia IKO Goju-ryu Kata competition.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-100 text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
