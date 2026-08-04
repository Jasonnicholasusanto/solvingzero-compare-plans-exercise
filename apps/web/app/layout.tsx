import type { Metadata } from "next";
import "./globals.css";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { cn } from "@/lib/utils";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-heading", display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "SolvingZero — Compare Plans",
  description: "What this household pays for electricity today, and the cheapest plan they can switch to.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU" className={cn("font-sans", jakarta.variable, inter.variable)}>
      <body>{children}</body>
    </html>
  );
}
