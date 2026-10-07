import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stride Assistant",
  description: "Ask Stride Footwear about products, orders and returns.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1f6f5c" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
