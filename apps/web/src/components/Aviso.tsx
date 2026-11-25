import type { Aviso as AvisoTipo } from "@concurso/engine";

const classe = { info: "aviso-info", atencao: "aviso-atencao", alerta: "aviso-alerta" } as const;

export function Aviso({ aviso }: { aviso: Pick<AvisoTipo, "nivel" | "texto"> }) {
  return (
    <div className={`aviso ${classe[aviso.nivel]}`} role={aviso.nivel === "info" ? undefined : "note"}>
      <span>{aviso.texto}</span>
    </div>
  );
}
