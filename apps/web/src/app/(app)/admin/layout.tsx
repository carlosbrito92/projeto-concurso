import { exigirAdmin, repoAdmin } from "@/lib/admin";
import { NavLink } from "@/components/NavLink";

export const metadata = { title: "Administração", robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await exigirAdmin();
  const { repo } = await repoAdmin();
  const abertos = await repo.contagemReportesAbertos();
  return (
    <div className="pilha">
      <div>
        <h1>Administração</h1>
        <nav className="nav" aria-label="Administração" style={{ marginTop: "var(--e3)" }}>
          <NavLink href="/admin">Reportes abertos ({abertos})</NavLink>
          <NavLink href="/admin/questoes">Banco de questões</NavLink>
          <NavLink href="/admin/resolvidos">Resolvidos</NavLink>
        </nav>
      </div>
      {children}
    </div>
  );
}
