import type { Metadata, Viewport } from "next";
import "./globals.css";
import InactivityGuard from "@/components/InactivityGuard";
import AccessibilityToolbar from "@/components/AccessibilityToolbar";
import MobilePageScrollbar from "@/components/MobilePageScrollbar";
import TelegramWebApp from "@/components/TelegramWebApp";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  title: {
    default: "Malaysia Open Virtual Karate-do Kata Competition - Goju-ryu or IKO Goju-ryu Version Only",
    template: "%s — Malaysia Open Virtual Karate-do Kata Competition - Goju-ryu or IKO Goju-ryu Version Only",
  },
  description:
    "Malaysia Open Virtual Karate-do Kata Competition - Goju-ryu or IKO Goju-ryu Version Only. Specially for all Goju-ryu Karateka to compete globally without leaving their beloved Country. Organizer: IKO GOJU-RYU KARATE-DO MALAYSIA SDN BHD.",
  openGraph: {
    title: "Malaysia Open Virtual Karate-do Kata Competition - Goju-ryu or IKO Goju-ryu Version Only",
    description:
      "Specially for all Goju-ryu Karateka to compete globally without leaving their beloved Country. Organizer: IKO GOJU-RYU KARATE-DO MALAYSIA SDN BHD.",
    type: "website",
  },
  // "Add to Home Screen" on iPhone/iPad. Launched from the home-screen icon
  // with this set, Safari runs the site with NO address bar and NO bottom
  // toolbar at all -- which is the only thing on iPhone that actually gives
  // the recorder the full screen height. Everything else (the CSS overlay,
  // the scroll nudge) can only ask Safari to collapse that chrome
  // temporarily; there is no API to hold it down.
  appleWebApp: {
    capable: true,
    title: "Kata Competition",
    // Black-translucent puts the page UNDER the status bar, so the recorder
    // gets the whole display. The recorder already keeps its own controls
    // inside the visual viewport, so nothing lands under the clock.
    statusBarStyle: "black-translucent",
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/logo.jpg",
    apple: "/logo.jpg",
  },
  other: {
    // Next 16 emits the modern `mobile-web-app-capable` for appleWebApp
    // .capable, but iOS only reliably drops its address bar and toolbar for
    // a home-screen launch when the ORIGINAL Apple-prefixed tag is present
    // too. Harmless everywhere else, and the difference between a full
    // screen and Safari's chrome on the exact device this was asked for.
    "apple-mobile-web-app-capable": "yes",
  },
};

// Covers the notch/home-indicator area too, so a home-screen launch fills the
// display edge to edge rather than leaving letterboxed bars.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-100 text-neutral-900 antialiased">
        {children}
        <InactivityGuard />
        <AccessibilityToolbar />
        <MobilePageScrollbar />
        <TelegramWebApp />
      </body>
    </html>
  );
}
