import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Malaysia IKO Goju-ryu Kata Competition",
  description:
    "Official platform of the Malaysia IKO Goju-ryu Kata competition — event info, announcements, participant list, and online registration.",
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
