import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "Recebify | Gestão de cobranças",
  description: "Organize cobranças, vencimentos e pagamentos em um só lugar.",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Nonce-bearing CSP requires request-time rendering, including not-found pages.
  await connection();
  return (
    <html lang="pt-BR">
      <body className="bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
