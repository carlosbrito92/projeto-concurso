#!/usr/bin/env python3
"""PDF -> Markdown fiel, com marcação de página.

Uso: python3 -I pipeline/pdf_para_md.py <pdf> <saida.md>

Regras (CLAUDE.md): não resume, não reescreve. Preserva a numeração dos itens,
marca cada página com <!-- p.N --> (N = índice da página no PDF, base 1) e
sinaliza páginas com possível tabela para revisão manual.
Requer `pdftotext` (poppler-utils).
"""
import re
import subprocess
import sys

NOVO_PARAGRAFO = re.compile(
    r"^\s*("
    r"\d+(\.\d+)*\.?(\s|$)"   # 1.1.4 / 4.1.5 (número pode vir sozinho na linha)
    r"|[a-z]\)\s"                 # a) b)
    r"|[IVX]+\s*[-–.]\s"          # I - II.
    r"|ANEXO\b"
    r"|Módulo\b"
    r"|CONHECIMENTOS\b"
    r")"
)
TITULO_SECAO = re.compile(r"^(\d{1,2})\s+([A-ZÀ-Ú][A-ZÀ-Ú0-9 ,/\-–ÇÃÕ’'“”\"()]+)$")
SO_NUMERO = re.compile(r"^\s*\d{1,3}\s*$")


def pdftotext(pdf: str, layout: bool) -> list[str]:
    cmd = ["pdftotext"] + (["-layout"] if layout else []) + [pdf, "-"]
    out = subprocess.run(cmd, check=True, capture_output=True, text=True).stdout
    paginas = out.split("\f")
    if paginas and not paginas[-1].strip():
        paginas.pop()
    return paginas


def possivel_tabela(pagina_layout: str) -> bool:
    linhas = [l for l in pagina_layout.splitlines() if re.search(r"\S {3,}\S.* {3,}\S", l)]
    return len(linhas) >= 3


def pagina_para_md(texto: str) -> str:
    linhas = [l.rstrip() for l in texto.splitlines()]
    while linhas and not linhas[-1].strip():
        linhas.pop()
    if linhas and SO_NUMERO.match(linhas[-1]):  # rodapé com nº de página
        linhas.pop()
    paragrafos: list[str] = []
    atual = ""
    for l in linhas:
        s = l.strip()
        if not s:
            if atual:
                paragrafos.append(atual)
                atual = ""
            continue
        titulo_caixa_alta = s.isupper() and len(s) < 80 and len(s) > 3
        if atual and (NOVO_PARAGRAFO.match(s) or titulo_caixa_alta or (atual.isupper() and len(atual) < 80)):
            paragrafos.append(atual)
            atual = s
        elif atual:
            atual += " " + s
        else:
            atual = s
    if atual:
        paragrafos.append(atual)
    saida = []
    for p in paragrafos:
        if p.startswith("ANEXO"):
            saida.append(f"# {p}")
        elif TITULO_SECAO.match(p):
            saida.append(f"## {p}")
        else:
            saida.append(p)
    return "\n\n".join(saida)


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    pdf, saida = sys.argv[1], sys.argv[2]
    plano = pdftotext(pdf, layout=False)
    layout = pdftotext(pdf, layout=True)
    partes, tabelas, vazias = [], [], []
    for i, texto in enumerate(plano, 1):
        corpo = pagina_para_md(texto)
        if not corpo.strip():
            vazias.append(i)
        if i - 1 < len(layout) and possivel_tabela(layout[i - 1]):
            tabelas.append(i)
        partes.append(f"<!-- p.{i} -->\n\n{corpo}")
    with open(saida, "w", encoding="utf-8") as f:
        f.write("\n\n".join(partes) + "\n")
    print(f"{len(plano)} páginas -> {saida}")
    print(f"páginas sem texto (possível imagem/escaneada): {vazias or 'nenhuma'}")
    print(f"páginas com possível tabela (revisar manualmente): {tabelas or 'nenhuma'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
