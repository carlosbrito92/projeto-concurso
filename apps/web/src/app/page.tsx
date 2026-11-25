import Link from "next/link";
import type { Relatorio } from "@concurso/engine";
import { Pagina } from "@/components/Pagina";
import { RelatorioView } from "@/components/RelatorioView";
import exemplo from "@/lib/exemplo-relatorio.json";

export default function Inicio() {
  return (
    <Pagina>
      <section className="secao pilha" aria-labelledby="hero">
        <h1 id="hero" className="hero-titulo">Simulados do seu edital, com o relatório do que estudar primeiro</h1>
        <p style={{ fontSize: "var(--t-lg)" }}>
          Escolha o concurso, resolva um simulado e veja em quais assuntos do edital você perde mais pontos. Cada resposta melhora o relatório.
        </p>
        <pre className="ascii-bloco" role="img" aria-label="Fluxo: edital, simulado, correção, relatório">{"edital ──> simulado ──> correção ──> relatório\n  70q       sua prova    no servidor    onde focar"}</pre>
        <div className="linha">
          <Link href="/sign-up" className="btn btn-primario">Criar conta e fazer um simulado</Link>
          <a href="#exemplo" className="btn btn-fantasma">Ver um relatório de exemplo</a>
        </div>
      </section>

      <section className="secao" aria-labelledby="como">
        <h2 id="como" className="titulo-sec" style={{ marginBottom: "var(--e5)" }}>Como funciona</h2>
        <ol className="passos">
          <li><span>Você escolhe o concurso e a quantidade de questões, ou treina uma disciplina só.</span></li>
          <li><span>O simulado sai na proporção que o edital cobra de cada disciplina e evita repetir questões que você já viu.</span></li>
          <li><span>A correção acontece no servidor. O gabarito só aparece depois que você finaliza.</span></li>
          <li><span>O relatório cruza seus erros com o peso de cada disciplina e lista os assuntos do edital a estudar primeiro.</span></li>
        </ol>
      </section>

      <section className="secao" aria-labelledby="questoes">
        <h2 id="questoes" className="titulo-sec" style={{ marginBottom: "var(--e4)" }}>Sobre as questões</h2>
        <p>
          Questão de prova antiga pode citar lei que já mudou. Por isso cada questão mostra o ano da prova e, quando for o caso, um aviso de vigência para você conferir a fonte atual antes de aceitar a resposta.
        </p>
        <p>Gabarito ainda não confirmado como definitivo também é sinalizado na questão e no relatório.</p>
      </section>

      <section className="secao" id="exemplo" aria-labelledby="ex-titulo">
        <h2 id="ex-titulo" className="titulo-sec" style={{ marginBottom: "var(--e3)" }}>Um relatório de verdade</h2>
        <p className="suave">Exemplo gerado pelo mesmo motor do produto, com um aluno fictício que fez 3 simulados de 20 questões e questões fictícias sobre o edital da Polícia Civil de MG (2024).</p>
        <div className="exemplo">
          <RelatorioView r={exemplo as unknown as Relatorio} titulo="Panorama de 3 simulados" mostrarErros={false} />
        </div>
      </section>
    </Pagina>
  );
}
