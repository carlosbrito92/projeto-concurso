#!/usr/bin/env python3
"""Caderno de prova (2 colunas) em PDF -> Markdown fiel, coluna por coluna.

Uso: python3 -I pipeline/prova_para_md.py <prova.pdf> <saida.md> [--inicio "TEXTO DA 1ª PÁGINA DE QUESTÕES"]

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

TOPO, RODAPE = 50, 785  # sobrescritos por --topo / --rodape
IMAGEM_MIN = 20  # ignora imagens menores que isso (filetes, ícones, máscaras)


def calha(pg):
    """Posição x da calha (espaço vazio vertical) entre as colunas, ou None se não houver.
    Procura o maior vão sem palavras entre 30% e 70% da largura; exige texto dos dois lados."""
    ws = [w for w in pg.extract_words() if TOPO < w["top"] < RODAPE]
    if not ws:
        return None
    ocupado = [False] * (int(pg.width) + 2)
    for w in ws:
        for x in range(int(w["x0"]), int(w["x1"]) + 1):
            ocupado[x] = True
    lo, hi = int(pg.width * 0.3), int(pg.width * 0.7)
    melhor, atual, ini = (0, None), 0, None
    for x in range(lo, hi):
        if not ocupado[x]:
            if atual == 0:
                ini = x
            atual += 1
            if atual > melhor[0]:
                melhor = (atual, ini + atual / 2)
        else:
            atual = 0
    if melhor[0] < 6:
        return None
    x = melhor[1]
    esq = sum(1 for w in ws if w["x1"] <= x)
    dir_ = sum(1 for w in ws if w["x0"] >= x)
    return x if esq >= 15 and dir_ >= 15 else None


def colunas(pg):
    """Duas colunas (E, D) separadas pela calha real, ou coluna única (U)."""
    x = calha(pg)
    if x is None:
        return (("U", (0, 0, pg.width, pg.height)),)
    return (("E", (0, 0, x, pg.height)), ("D", (x, 0, pg.width, pg.height)))


def converter(pdf_path: str, inicio: str = "MÓDULO I") -> tuple[str, dict]:
    partes, info = [], {"imagens": [], "paginas_instrucoes": [], "paginas_descartadas": [], "decorativas": []}
    with pdfplumber.open(pdf_path) as pdf:
        freq = {}
        for pg in pdf.pages:
            for im in pg.images:
                k = tuple(round(im[c]) for c in ("x0", "top", "x1", "bottom"))
                freq.setdefault(k, set()).add(pg.page_number)
        decorativas = {k for k, v in freq.items() if len(v) >= 3}
        info["decorativas"] = sorted(decorativas)
        comecou = False
        for n, pg in enumerate(pdf.pages, 1):
            if not comecou:
                txt = pg.extract_text() or ""
                if inicio not in txt:
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
                    if tuple(round(im[c]) for c in ("x0", "top", "x1", "bottom")) in decorativas:
                        continue
                    bbox = f"{round(im['x0'])},{round(im['top'])},{round(im['x1'])},{round(im['bottom'])}"
                    itens.append((im["top"], f"<!-- IMAGEM p.{n} col.{nome} bbox={bbox} -->"))
                    info["imagens"].append((n, nome, bbox))
                itens.sort(key=lambda x: x[0])
                corpo = "\n".join(t for _, t in itens if t)
                partes.append(f"<!-- p.{n} col.{nome} -->\n{corpo}")
    return "\n\n".join(partes) + "\n", info


def main() -> int:
    args = sys.argv[1:]
    inicio = "MÓDULO I"
    global TOPO, RODAPE
    for flag in ("--topo", "--rodape"):
        if flag in args:
            k = args.index(flag)
            if flag == "--topo":
                TOPO = float(args[k + 1])
            else:
                RODAPE = float(args[k + 1])
            del args[k:k + 2]
    if "--inicio" in args:
        k = args.index("--inicio")
        inicio = args[k + 1]
        del args[k:k + 2]
    if len(args) != 2:
        print(__doc__)
        return 2
    sys.argv = [sys.argv[0]] + args
    md, info = converter(sys.argv[1], inicio)
    with open(sys.argv[2], "w", encoding="utf-8") as f:
        f.write(md)
    print(f"-> {sys.argv[2]}")
    print(f"páginas de instruções ignoradas: {info['paginas_instrucoes']}")
    print(f"páginas descartadas (sem conteúdo de prova): {info['paginas_descartadas']}")
    dec = info["decorativas"]
    print(f"imagens decorativas ignoradas (mesma posição em >=3 páginas): {len(dec)}" + (f" (ex.: {dec[:3]})" if dec else ""))
    print(f"imagens marcadas: {len(info['imagens'])}")
    for p, c, b in info["imagens"]:
        print(f"  p.{p} col.{c} bbox={b}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
