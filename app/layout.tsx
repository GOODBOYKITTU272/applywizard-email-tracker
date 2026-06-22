import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ApplyWizard Email Tracker",
  description: "Track and classify client emails.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
