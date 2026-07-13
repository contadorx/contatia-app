import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Contatia — produtize suas vendas",
  description:
    "A máquina de prospecção do seu time: cadência multicanal, fila diária e pipeline. Você produtiza o processo comercial — do primeiro toque ao negócio fechado.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
