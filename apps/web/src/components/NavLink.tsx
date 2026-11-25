"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const atual = usePathname();
  const ativo = atual === href || atual.startsWith(href + "/");
  return (
    <Link href={href} aria-current={ativo ? "page" : undefined}>
      {children}
    </Link>
  );
}
