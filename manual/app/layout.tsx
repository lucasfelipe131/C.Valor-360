import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./val-embedded-brand.css";

export const metadata: Metadata = {
  title: "VAL · Inteligência Agronômica",
  description:
    "Ambiente técnico integrado para capturar, interpretar e transformar dados agronômicos em decisões de campo.",
  applicationName: "VAL",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "VAL",
  },
};

export const viewport: Viewport = {
  themeColor: "#063c33",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
