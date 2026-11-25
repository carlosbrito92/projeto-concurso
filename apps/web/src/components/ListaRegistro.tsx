import type { RegistroAlteracao } from "@/lib/tipos";
import { ROTULO_TIPO_REGISTRO } from "@/lib/tipos";

const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { dateStyle: "long", timeZone: "America/Sao_Paulo" });

/** Lista somente leitura do registro de alterações, agrupada por dia (mais recentes primeiro). */
export function ListaRegistro({ itens }: { itens: RegistroAlteracao[] }) {
  const grupos: Array<{ dia: string; itens: RegistroAlteracao[] }> = [];
  for (const it of itens) {
    const d = dia(it.criadoEm);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.dia === d) ultimo.itens.push(it);
    else grupos.push({ dia: d, itens: [it] });
  }
  return (
    <div className="pilha">
      {grupos.map((g) => (
        <section key={g.dia} aria-labelledby={`dia-${g.itens[0]?.id}`} className="pilha-p">
          <h2 id={`dia-${g.itens[0]?.id}`} className="titulo-sec" style={{ fontSize: "var(--t-lg)" }}>{g.dia}</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }} className="pilha-p">
            {g.itens.map((it) => (
              <li key={it.id} className="painel pilha-p">
                <p style={{ margin: 0 }}><strong>[{ROTULO_TIPO_REGISTRO[it.tipo]}]</strong> {it.titulo}</p>
                {it.resumo && <p style={{ margin: 0 }} className="suave">{it.resumo}</p>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
