import Link from "next/link";
import { repoAdmin } from "@/lib/admin";
import { ROTULO_MOTIVO, ROTULO_RESOLUCAO } from "@/lib/tipos";

export const metadata = { title: "Reportes resolvidos" };
export const dynamic = "force-dynamic";

const data = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }) : "");

export default async function Page() {
  const { repo } = await repoAdmin();
  const reportes = await repo.listarReportes("resolvidos");
  if (reportes.length === 0) {
    return (
      <section className="painel pilha-p">
        <h2 className="titulo-sec">Nada resolvido ainda</h2>
        <p>As decisões tomadas nos reportes ficam registradas aqui, com a justificativa.</p>
        <div><Link className="btn" href="/admin">Ver reportes abertos</Link></div>
      </section>
    );
  }
  return (
    <div className="pilha">
      <p className="suave" style={{ margin: 0 }}>Últimos 200, mais recentes primeiro.</p>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr><th scope="col">Resolvido em</th><th scope="col">Questão</th><th scope="col">Motivo</th><th scope="col">Decisão</th><th scope="col">Justificativa</th></tr>
          </thead>
          <tbody>
            {reportes.map((r) => (
              <tr key={r.id}>
                <td>{data(r.resolvidoEm)}</td>
                <td><Link href={`/admin/questoes?busca=${encodeURIComponent(r.questaoId)}`}>{r.questaoId}</Link></td>
                <td>{ROTULO_MOTIVO[r.motivo]}</td>
                <td>{r.resolucao ? ROTULO_RESOLUCAO[r.resolucao] : ""}</td>
                <td>{r.justificativa}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
