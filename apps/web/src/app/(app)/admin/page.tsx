import Link from "next/link";
import { repoAdmin } from "@/lib/admin";
import { FormResolverReporte } from "@/components/FormResolverReporte";
import { ROTULO_MOTIVO } from "@/lib/tipos";

export const metadata = { title: "Reportes abertos" };
export const dynamic = "force-dynamic";

const data = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const resumo = (t: string, n = 320) => (t.length > n ? `${t.slice(0, n).trimEnd()}...` : t);

export default async function Page() {
  const { repo } = await repoAdmin();
  const reportes = await repo.listarReportes("abertos");
  if (reportes.length === 0) {
    return (
      <section className="painel pilha-p">
        <h2 className="titulo-sec">Nenhum reporte aberto</h2>
        <p>Quando um aluno apontar um problema numa questão, ele aparece aqui.</p>
        <div><Link className="btn" href="/admin/questoes">Ver o banco de questões</Link></div>
      </section>
    );
  }
  return (
    <div className="pilha">
      <p className="suave" style={{ margin: 0 }}>Mais antigos primeiro. Você não edita a questão por aqui: ou mantém com uma justificativa, ou retira. Correções de texto seguem pelo pipeline.</p>
      {reportes.map((r) => (
        <article key={r.id} className="painel pilha-p" aria-labelledby={`rep-${r.id}`}>
          <div className="linha entre">
            <h2 id={`rep-${r.id}`} style={{ fontSize: "var(--t-lg)", margin: 0 }}>
              {r.questaoId}{r.questao?.numeroNaProva ? ` (Q${r.questao.numeroNaProva})` : ""}
            </h2>
            <small className="suave">{data(r.criadoEm)}</small>
          </div>
          {r.questao && <small className="suave">{[r.questao.banca, r.questao.ano, r.questao.disciplina, `situação: ${r.questao.status}`].filter(Boolean).join(" · ")}</small>}
          <p style={{ margin: 0 }}><strong>[!] {ROTULO_MOTIVO[r.motivo]}</strong></p>
          {r.texto ? <blockquote className="texto-apoio" style={{ margin: 0 }}>{r.texto}</blockquote> : <small className="suave">(sem detalhes)</small>}
          {r.questao && (
            <details>
              <summary>Ver o enunciado</summary>
              <p className="enunciado" style={{ marginTop: "var(--e3)" }}>{resumo(r.questao.enunciado, 900)}</p>
            </details>
          )}
          <div><Link href={`/admin/questoes?busca=${encodeURIComponent(r.questaoId)}`}>Abrir no banco de questões (com alternativas e gabarito)</Link></div>
          <FormResolverReporte id={r.id} />
        </article>
      ))}
    </div>
  );
}
