import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ApplyWizard Email Tracker",
  description:
    "A Vercel-ready app that connects to Zoho Mail, classifies client emails with AI, and stores results in Supabase.",
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
