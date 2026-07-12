import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Malaysia Open — IKO Goju-ryu Karate-do — Kata Competition — Goju-ryu Version Only",
    template: "%s — Malaysia Open — IKO Goju-ryu Karate-do — Kata Competition — Goju-ryu Version Only",
  },
  description:
    "Official platform of the Malaysia Open — IKO Goju-ryu Karate-do Kata Competition by IKO GOJU-RYU KARATE-DO MALAYSIA SDN BHD — event info, announcements, participant list, and online registration.",
  openGraph: {
    title: "Malaysia Open — IKO Goju-ryu Karate-do — Kata Competition — Goju-ryu Version Only",
    description:
      "Event info, announcements, confirmed participants, and online registration. Organiser: IKO GOJU-RYU KARATE-DO MALAYSIA SDN BHD.",
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
