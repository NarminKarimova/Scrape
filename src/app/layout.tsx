import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Market Comparison Dashboard",
  description: "Next.js frontend for Bina.az, Markets, and Turbo.az analytics",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
