import { repoAdmin } from "@/lib/admin";
import { FormPublicarRegistro } from "@/components/FormPublicarRegistro";
import { ListaRegistro } from "@/components/ListaRegistro";

export const metadata = { title: "Registro de alterações (admin)" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const { repo } = await repoAdmin();
  const itens = await repo.listarRegistro(100);
  return (
    <div className="pilha">
      <FormPublicarRegistro />
      <h2 className="titulo-sec">Publicadas</h2>
      {itens.length === 0 ? <p className="suave">Nenhuma entrada ainda. A primeira que você publicar aparece aqui e em Novidades.</p> : <ListaRegistro itens={itens} />}
    </div>
  );
}
