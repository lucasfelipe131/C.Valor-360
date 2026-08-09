import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VALOR 360 · Inteligência Agronômica",
  description:
    "Ambiente técnico integrado para capturar, interpretar e transformar dados agronômicos em decisões de campo.",
  applicationName: "VALOR 360",
  icons: {
    icon: "/favicon.svg",
    apple: "/manual-do-agronomo-simbolo.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "VALOR 360",
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
