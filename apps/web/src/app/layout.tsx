import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { modoDemo } from "@/lib/ambiente";
import { NOME_PRODUTO } from "@/components/Marca";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: `${NOME_PRODUTO}: simulados de concurso com relatório por assunto`, template: `%s | ${NOME_PRODUTO}` },
  description: "Simulados baseados no edital do seu concurso, com correção e relatório que aponta os assuntos em que você mais perde pontos.",
  // Fora de produção (dev/teste) o site não deve aparecer em buscadores.
  robots: process.env.APP_ENV === "producao" ? undefined : { index: false, follow: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, colorScheme: "light dark" };

const aparenciaClerk = {
  variables: { colorPrimary: "#0a0a0a", colorBackground: "#efeeec", colorText: "#0a0a0a", fontFamily: "ui-monospace, Menlo, Consolas, monospace", borderRadius: "0px" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const corpo = (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
  return modoDemo() ? corpo : <ClerkProvider appearance={aparenciaClerk}>{corpo}</ClerkProvider>;
}
