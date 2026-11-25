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

// As cores do Clerk vêm dos mesmos tokens do app (claro/escuro), para o cartão de login acompanhar o tema do aparelho.
const aparenciaClerk = {
  variables: {
    colorPrimary: "var(--primario)",
    colorTextOnPrimaryBackground: "var(--primario-texto)",
    colorBackground: "var(--superficie)",
    colorText: "var(--texto)",
    colorTextSecondary: "var(--texto-suave)",
    colorInputBackground: "var(--fundo)",
    colorInputText: "var(--texto)",
    colorNeutral: "var(--texto)",
    colorDanger: "var(--perigo)",
    fontFamily: "ui-monospace, Menlo, Consolas, monospace",
    borderRadius: "0px",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const corpo = (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
  return modoDemo() ? corpo : <ClerkProvider appearance={aparenciaClerk}>{corpo}</ClerkProvider>;
}
