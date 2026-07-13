import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Malaysia Open Karate-do Kata Competition - Goju-ryu or IKO Goju-ryu Version Only",
    template: "%s — Malaysia Open Karate-do Kata Competition - Goju-ryu or IKO Goju-ryu Version Only",
  },
  description:
    "Malaysia Open Karate-do Kata Competition - Goju-ryu or IKO Goju-ryu Version Only. Specially for all Goju-ryu Karateka to compete globally without leaving their beloved Country. Organiser: IKO GOJU-RYU KARATE-DO MALAYSIA SDN BHD.",
  openGraph: {
    title: "Malaysia Open Karate-do Kata Competition - Goju-ryu or IKO Goju-ryu Version Only",
    description:
      "Specially for all Goju-ryu Karateka to compete globally without leaving their beloved Country. Organiser: IKO GOJU-RYU KARATE-DO MALAYSIA SDN BHD.",
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
