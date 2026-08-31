import type { Metadata, Viewport } from "next";
import {
  JetBrains_Mono,
  Noto_Sans_Thai_Looped,
  Plus_Jakarta_Sans,
} from "next/font/google";
import "./globals.css";

// Two design faces — rounded humanist sans and engineering mono — plus one Thai
// companion that only ever renders Thai codepoints. No serif anywhere.
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--fnt-jakarta",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--fnt-mono",
  display: "swap",
});

const thai = Noto_Sans_Thai_Looped({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--fnt-thai",
  display: "swap",
});

export const metadata: Metadata = {
  title: "คลังและต้นทุน · ร้านแว่น",
  description: "ดัชนีสินค้า สต็อกคงเหลือ และต้นทุน FIFO สำหรับเลนส์ กรอบ และคอนแทคเลนส์",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${jakarta.variable} ${mono.variable} ${thai.variable}`}>
      <body>{children}</body>
    </html>
  );
}
