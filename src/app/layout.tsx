import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BSIS — Intelligence Dashboard",
  description: "Blue Sky Intelligence System",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
