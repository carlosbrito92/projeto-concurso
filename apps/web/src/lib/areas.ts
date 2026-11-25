/**
 * Áreas dos concursos (agrupam o seletor). O banco guarda só o identificador (`concurso.area`, slug);
 * o rótulo e a ordem ficam aqui. Área nova no banco sem rótulo aqui aparece com o nome derivado do slug.
 */
export const AREAS: ReadonlyArray<{ id: string; nome: string }> = [
  { id: "seguranca-publica", nome: "Segurança pública" },
  { id: "justica", nome: "Tribunais e Justiça" },
  { id: "fiscal", nome: "Fiscal e tributária" },
  { id: "administrativa", nome: "Administração pública" },
  { id: "controle-financas", nome: "Controle e finanças" },
  { id: "tecnologia", nome: "Tecnologia da informação" },
  { id: "saude", nome: "Saúde" },
  { id: "educacao", nome: "Educação" },
  { id: "outras", nome: "Outras áreas" },
];

export function nomeDaArea(id: string): string {
  const conhecida = AREAS.find((a) => a.id === id);
  if (conhecida) return conhecida.nome;
  const t = id.replace(/-/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Outras áreas";
}

/** Posição na lista (conhecidas primeiro, na ordem acima; desconhecidas depois, por nome; "outras" por último entre as conhecidas). */
export function ordemDaArea(id: string): number {
  const i = AREAS.findIndex((a) => a.id === id);
  return i === -1 ? AREAS.length : i;
}
