#!/usr/bin/env python3
"""Gabarito Certo/Errado que vem como IMAGEM (tabelas 20 x 6) -> gabarito.json, com conferência.

Uso:
  python3 -I pipeline/gabarito_imagem.py <gabarito.pdf> --pagina 2 --tabela 3 --total 120 \\
      --cargo "401 Analista Contábil" --situacao definitivo --saida conteudo/provas/<slug>/02-json/gabarito.json \\
      [--comparar 2:2 --comparar 3:1 ... --itens-comuns 70] [--observacao "texto"]

Como funciona (sem OCR): extrai a imagem da página (pdfimages), acha as linhas com exatamente 20 glifos e classifica
cada glifo pela FORMA: o "E" tem a barra do meio atravessando a letra; o "C" é aberto ali. A largura do glifo é uma
segunda checagem independente (E estreito, C largo); se discordarem, aborta. Opcionalmente confere que os itens comuns
(ex.: 1 a 70, iguais para todos os cargos de nível superior) são idênticos em outras tabelas da mesma prova.
A leitura continua sujeita a conferência humana contra o PDF (o relatório mostra as linhas lidas).
Requer: poppler (pdfimages), Pillow e numpy.
"""
import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image


def extrair_imagem(pdf: Path, pagina: int, destino: Path) -> Path:
    subprocess.run(["pdfimages", "-png", "-f", str(pagina), "-l", str(pagina), str(pdf), str(destino / "p")], check=True)
    grandes = sorted(destino.glob("p-*.png"), key=lambda f: f.stat().st_size, reverse=True)
    if not grandes:
        raise SystemExit(f"nenhuma imagem na página {pagina}")
    return grandes[0]


def componentes(escuro):
    """Rotulagem 8-conectada simples (sem scipy)."""
    h, w = escuro.shape
    rot = np.zeros((h, w), dtype=np.int32)
    caixas, n = [], 0
    for y in range(h):
        for x in range(w):
            if escuro[y, x] and rot[y, x] == 0:
                n += 1
                pilha = [(y, x)]
                rot[y, x] = n
                y0 = y1 = y
                x0 = x1 = x
                cont = 0
                while pilha:
                    cy, cx = pilha.pop()
                    cont += 1
                    y0, y1, x0, x1 = min(y0, cy), max(y1, cy), min(x0, cx), max(x1, cx)
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            ny, nx = cy + dy, cx + dx
                            if 0 <= ny < h and 0 <= nx < w and escuro[ny, nx] and rot[ny, nx] == 0:
                                rot[ny, nx] = n
                                pilha.append((ny, nx))
                caixas.append((n, y0, y1, x0, x1, cont))
    return caixas


def classificar(gray, c):
    _, y0, y1, x0, x1, _ = c
    crop = gray[y0:y1 + 1, x0:x1 + 1]
    h, w = crop.shape
    meio = crop[int(h * 0.40):int(h * 0.60) + 1, :]
    barra = float((meio < 170).mean(axis=1).max())
    return ("E" if barra > 0.5 else "C"), ("E" if w <= 8 else "C"), barra


def linhas_de_20(imagem: Path):
    gray = np.array(Image.open(imagem).convert("L"))
    escuro = gray < 120
    escuro[:, :40] = False
    escuro[:, 1160:] = False
    cand = [c for c in componentes(escuro) if 8 <= c[2] - c[1] + 1 <= 24 and 5 <= c[4] - c[3] + 1 <= 18 and c[5] >= 12]
    bandas = defaultdict(list)
    for c in cand:
        yc = (c[1] + c[2]) // 2
        k = next((k for k in bandas if abs(k - yc) <= 4), yc)
        bandas[k].append(c)
    linhas = []
    for k in sorted(bandas):
        g = sorted(bandas[k], key=lambda c: c[3])
        if len(g) == 20:
            r = [classificar(gray, c) for c in g]
            if any(a != b for a, b, _ in r):
                raise SystemExit(f"forma e largura discordam na linha y={k}: leitura não confiável")
            linhas.append(("".join(a for a, _, _ in r), k))
    return linhas


def tabela(linhas, indice: int, total: int) -> str:
    por_tab = total // 20
    ini = (indice - 1) * por_tab
    fatia = linhas[ini:ini + por_tab]
    if len(fatia) != por_tab:
        raise SystemExit(f"tabela {indice}: esperadas {por_tab} linhas de 20, achei {len(fatia)} (total de linhas na página: {len(linhas)})")
    return "".join(s for s, _ in fatia)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf")
    ap.add_argument("--pagina", type=int, required=True)
    ap.add_argument("--tabela", type=int, required=True, help="posição da tabela na página (1 = a de cima)")
    ap.add_argument("--total", type=int, default=120)
    ap.add_argument("--cargo", required=True)
    ap.add_argument("--situacao", default="definitivo")
    ap.add_argument("--saida", required=True)
    ap.add_argument("--comparar", action="append", default=[], help="pagina:tabela de outro cargo para conferir os itens comuns")
    ap.add_argument("--itens-comuns", type=int, default=0)
    ap.add_argument("--observacao", default="")
    a = ap.parse_args()
    pdf = Path(a.pdf)
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        cache = {}

        def da_pagina(p):
            if p not in cache:
                cache[p] = linhas_de_20(extrair_imagem(pdf, p, t))
            return cache[p]

        principal = tabela(da_pagina(a.pagina), a.tabela, a.total)
        print(f"{a.cargo}: {len(principal)} respostas lidas")
        for i in range(0, a.total, 20):
            print(f"  {i + 1:3d}-{i + 20:3d}  {principal[i:i + 20]}")
        if a.comparar:
            if not a.itens_comuns:
                raise SystemExit("--comparar exige --itens-comuns")
            for ref in a.comparar:
                p, tb = (int(x) for x in ref.split(":"))
                outra = tabela(da_pagina(p), tb, a.total)
                dif = [i + 1 for i in range(a.itens_comuns) if outra[i] != principal[i]]
                print(f"  itens 1-{a.itens_comuns} iguais à tabela {ref}: {'SIM' if not dif else 'NÃO, difere em ' + str(dif)}")
                if dif:
                    return 1
    gj = {
        "schemaVersion": "1.0", "situacao": a.situacao,
        "fonte": {"arquivo": pdf.name, "sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(), "cabecalho": a.cargo, "pagina": a.pagina},
        "leitura": {"metodo": "imagem: glifos C/E classificados por forma (barra do meio) com checagem de largura; conferir contra o PDF",
                    "conferidoComTabelas": a.comparar, "itensComuns": a.itens_comuns or None, "observacao": a.observacao or None},
        "respostas": {str(i + 1): principal[i] for i in range(a.total)},
    }
    out = Path(a.saida)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(gj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"gravado: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
