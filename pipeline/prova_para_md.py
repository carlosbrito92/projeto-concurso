#!/usr/bin/env python3
"""Caderno de prova (2 colunas) em PDF -> Markdown fiel, coluna por coluna.

Uso: python3 -I pipeline/prova_para_md.py <prova.pdf> <saida.md>

- Lê a coluna esquerda e depois a direita de cada página (ordem real de leitura).
- Descarta cabeçalho/rodapé repetidos (faixas superior/inferior da página).
- Marca cada imagem relevante na posição vertical em que aparece:
  <!-- IMAGEM p.2 col.E bbox=43,135,274,367 -->  (questão depende dela: revisão manual)
- Marca páginas/colunas com <!-- p.N col.E|D -->.
Não resume nem reescreve texto. Formatação (sublinhado, negrito, itálico) NÃO é preservada
e é sinalizada à parte pelo parser de questões.
Requer `pdfplumber`.
"""
import sys

import pdfplumber

TOPO, RODAPE = 50, 785
IMAGEM_MIN = 20  # ignora imagens menores que isso (filetes, ícones, máscaras)


def colunas(pg):
    mid = pg.width / 2
    return (("E", (0, 0, mid, pg.height)), ("D", (mid, 0, pg.width, pg.height)))


def converter(pdf_path: str) -> tuple[str, dict]:
    partes, info = [], {"imagens": [], "paginas_instrucoes": [], "paginas_descartadas": []}
    with pdfplumber.open(pdf_path) as pdf:
        comecou = False
        for n, pg in enumerate(pdf.pages, 1):
            if not comecou:
                txt = pg.extract_text() or ""
                if "MÓDULO I" not in txt:
                    info["paginas_instrucoes"].append(n)
                    continue
                comecou = True
            palavras = [w for w in pg.extract_words() if TOPO < w["top"] < RODAPE]
            if len(palavras) <= 3:  # ex.: banner "Realização" no fim do caderno
                info["paginas_descartadas"].append((n, " ".join(w["text"] for w in palavras)))
                continue
            for nome, box in colunas(pg):
                col = pg.crop(box)
                itens = []
                for l in col.extract_text_lines():
                    if TOPO > l["top"] or l["top"] > RODAPE:
                        continue
                    itens.append((l["top"], l["text"].strip()))
                for im in col.images:
                    w, h = im["x1"] - im["x0"], im["bottom"] - im["top"]
                    if w < IMAGEM_MIN or h < IMAGEM_MIN or not (TOPO < im["top"] < RODAPE):
                        continue
                    bbox = f"{round(im['x0'])},{round(im['top'])},{round(im['x1'])},{round(im['bottom'])}"
                    itens.append((im["top"], f"<!-- IMAGEM p.{n} col.{nome} bbox={bbox} -->"))
                    info["imagens"].append((n, nome, bbox))
                itens.sort(key=lambda x: x[0])
                corpo = "\n".join(t for _, t in itens if t)
                partes.append(f"<!-- p.{n} col.{nome} -->\n{corpo}")
    return "\n\n".join(partes) + "\n", info


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    md, info = converter(sys.argv[1])
    with open(sys.argv[2], "w", encoding="utf-8") as f:
        f.write(md)
    print(f"-> {sys.argv[2]}")
    print(f"páginas de instruções ignoradas: {info['paginas_instrucoes']}")
    print(f"páginas descartadas (sem conteúdo de prova): {info['paginas_descartadas']}")
    print(f"imagens marcadas: {len(info['imagens'])}")
    for p, c, b in info["imagens"]:
        print(f"  p.{p} col.{c} bbox={b}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
