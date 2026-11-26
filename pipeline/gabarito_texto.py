#!/usr/bin/env python3
"""Gabarito Certo/Errado em TEXTO (tabelas de 20 colunas, linha de números + linha de letras) -> gabarito.json.

Uso:
  python3 -I pipeline/gabarito_texto.py <gabarito.pdf> --cargo "ANALISTA CONTÁBIL (CÓDIGO 402)" --total 120 \\
      --situacao preliminar --saida conteudo/provas/<slug>/02-json/gabarito.json \\
      [--comparar "ADVOGADO (CÓDIGO 400)" ... --itens-comuns 70] [--observacao "texto"]
Aborta se faltar item, houver número fora de ordem ou letra diferente de C/E. A seção do cargo vai do cabeçalho
informado até o próximo cabeçalho "2.N ...". Os itens comuns (ex.: 1-70) conferem com outros cargos de mesmo nível.
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path


def secoes(texto: str) -> dict:
    partes, atual = {}, None
    for linha in texto.splitlines():
        m = re.match(r"^\s*2\.\d+\s+(.+?)\s*$", linha)
        if m:
            atual = m.group(1)
            partes[atual] = []
        elif atual is not None:
            partes[atual].append(linha)
    return partes


def ler(linhas, total):
    resp, esperado = {}, 1
    i = 0
    while i < len(linhas) - 1:
        nums = re.findall(r"\d+", linhas[i]) if re.fullmatch(r"[\d\s]+", linhas[i].strip() or "x") else None
        if nums and len(nums) == 20:
            letras = linhas[i + 1].split()
            if len(letras) != 20 or any(x not in ("C", "E") for x in letras):
                raise SystemExit(f"linha de letras inválida após {nums}: {letras}")
            for n, l in zip(nums, letras):
                if int(n) != esperado:
                    raise SystemExit(f"item fora de ordem: esperado {esperado}, achei {n}")
                resp[str(esperado)] = l
                esperado += 1
            i += 2
        else:
            i += 1
    if len(resp) != total:
        raise SystemExit(f"esperados {total} itens, li {len(resp)}")
    return resp


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf")
    ap.add_argument("--cargo", required=True)
    ap.add_argument("--total", type=int, default=120)
    ap.add_argument("--situacao", default="definitivo")
    ap.add_argument("--saida", required=True)
    ap.add_argument("--comparar", action="append", default=[])
    ap.add_argument("--itens-comuns", type=int, default=0)
    ap.add_argument("--observacao", default="")
    a = ap.parse_args()
    pdf = Path(a.pdf)
    txt = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], capture_output=True, text=True, check=True).stdout
    sec = secoes(txt)
    if a.cargo not in sec:
        raise SystemExit(f"cargo não encontrado: {a.cargo}. Há: {list(sec)}")
    principal = ler(sec[a.cargo], a.total)
    print(f"{a.cargo}: {len(principal)} respostas lidas")
    for outro in a.comparar:
        if outro not in sec:
            raise SystemExit(f"cargo de comparação não encontrado: {outro}")
        o = ler(sec[outro], a.total)
        dif = [i for i in range(1, a.itens_comuns + 1) if o[str(i)] != principal[str(i)]]
        print(f"  itens 1-{a.itens_comuns} iguais a {outro}: {'SIM' if not dif else 'NÃO, difere em ' + str(dif)}")
        if dif:
            return 1
    gj = {
        "schemaVersion": "1.0", "situacao": a.situacao,
        "fonte": {"arquivo": pdf.name, "sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(), "cabecalho": a.cargo, "pagina": None},
        "leitura": {"metodo": "texto do PDF (pdftotext -layout), tabelas de 20 colunas; numeração 1..N conferida",
                    "conferidoComTabelas": a.comparar, "itensComuns": a.itens_comuns or None, "observacao": a.observacao or None},
        "respostas": principal,
    }
    out = Path(a.saida)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(gj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"gravado: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
