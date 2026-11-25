#!/usr/bin/env python3
"""Prova (MD por coluna) + gabarito oficial -> questoes.json (schema v3).

Uso: python3 -I pipeline/prova_para_json.py <pasta-da-prova>

Lê   <pasta>/meta.json, <pasta>/01-md/prova-*.md, <pasta>/00-origem/gabarito*.pdf
     e ../../concursos/<concursoSlug>/02-json/edital.json (para disciplinas e nº de questões)
Grava <pasta>/02-json/{questoes.json,gabarito.json,relatorio.md}

Sai com código != 0 se algo não fechar (nº de questões, 5 alternativas A-E por questão,
sequência 1..N, contagem por disciplina == edital, gabarito completo, anuladas == '*').
Nada é inventado: o que não pôde ser extraído com segurança vira `pendencias`.
"""
import hashlib
import json
import re
import sys
from pathlib import Path

import jsonschema
import pdfplumber

RAIZ = Path(__file__).resolve().parent.parent
RE_MARCA = re.compile(r"^<!-- p\.(\d+) col\.([ED]) -->$")
RE_IMAGEM = re.compile(r"^<!-- IMAGEM p\.(\d+) col\.([ED]) bbox=([\d,]+) -->$")
RE_ALT = re.compile(r"^\(([A-E])\)\s*(.*)$")
RE_NUM = re.compile(r"^\d{1,2}$")
FORMATACAO = re.compile(r"sublinhad|grifad|destacad|em negrito|negrito|itálic|em itálico|trecho em", re.I)
LINHA_TABELA = re.compile(r"^\S+(\s+[\d.,%]+){2,}$|^(\S+\s+){1,3}[\d.,]+\s+[\d.,]+$")

# Cada título de disciplina, como aparece na prova (pode ocupar 2 linhas), -> id no edital
TITULOS = [
    (["Língua Portuguesa"], "D01"), (["Raciocínio Lógico-Matemático"], "D02"),
    (["Informática Básica"], "D03"),
    (["Lei Orgânica da Polícia Civil do Estado de", "Minas Gerais"], "D04"),
    (["Noções de Direito Administrativo"], "D05"), (["Noções de Direito Constitucional"], "D06"),
    (["Noções de Direito Penal"], "D07"), (["Noções de Direito Processual Penal"], "D08"),
    (["Noções de Legislação Penal e", "Processual Extravagante"], "D09"),
    (["Noções de Direitos Humanos"], "D10"), (["Noções de Medicina Legal"], "D11"),
    (["Noções de Criminologia"], "D12"),
]
MODULOS = [["MÓDULO I - CONHECIMENTOS BÁSICOS"], ["MÓDULO II - CONHECIMENTOS", "ESPECÍFICOS"]]


def juntar(linhas: list[str]) -> str:
    """Junta linhas quebradas pelo layout; mantém quebra antes de itens (I., (A), aspas) e após ponto final."""
    saida = ""
    for l in linhas:
        if not saida:
            saida = l
        elif re.search(r"[.:;?!”\"]$", saida) and re.match(r"^(\(|[IVX]+\s*[-–.)]|[A-Z“\"–-])", l) or re.match(r"^([IVX]+\s*[-–.)]|\(\s?\)|\d+\s*[-–.)])\s", l):
            saida += "\n" + l
        else:
            saida += " " + l
    return saida


def ler_linhas(md: str):
    """Gera (pagina, coluna, texto) por linha; imagens viram ('IMG', pagina, coluna, bbox)."""
    pag = col = None
    for bruta in md.splitlines():
        l = bruta.strip()
        if not l:
            continue
        m = RE_MARCA.match(l)
        if m:
            pag, col = int(m.group(1)), m.group(2)
            continue
        m = RE_IMAGEM.match(l)
        if m:
            yield ("IMG", int(m.group(1)), m.group(2), m.group(3))
            continue
        yield (pag, col, l)


def casar(linhas, i, seq):
    """True se as linhas a partir de i são exatamente `seq` (título em 1 ou 2 linhas)."""
    if i + len(seq) > len(linhas):
        return False
    return all(linhas[i + k][0] != "IMG" and linhas[i + k][2] == seq[k] for k in range(len(seq)))


def parse_prova(md: str):
    linhas = list(ler_linhas(md))
    qs, atual, disc = [], None, None
    ordem_disc, i, esperado = [], 0, 1
    while i < len(linhas):
        item = linhas[i]
        if item[0] == "IMG":
            if atual is not None:
                atual["imagens"].append({"pagina": item[1], "coluna": item[2], "bbox": item[3]})
            i += 1
            continue
        pag, col, t = item
        # módulos e disciplinas (só reconhecidos entre questões ou antes da 1ª)
        achou = False
        for seq in MODULOS:
            if casar(linhas, i, seq):
                i += len(seq)
                achou = True
                break
        if achou:
            continue
        for seq, did in TITULOS:
            if casar(linhas, i, seq):
                disc = did
                ordem_disc.append(did)
                i += len(seq)
                achou = True
                break
        if achou:
            continue
        pronta = atual is None or len(atual["alts"]) == 5
        if RE_NUM.match(t) and int(t) == esperado and pronta:
            atual = {"numero": esperado, "pagina": pag, "coluna": col, "disc": disc,
                     "enun": [], "alts": [], "imagens": []}
            qs.append(atual)
            esperado += 1
        elif atual is not None:
            m = RE_ALT.match(t)
            if m and len(atual["alts"]) < 5 and m.group(1) == "ABCDE"[len(atual["alts"])]:
                atual["alts"].append([m.group(2)])
            elif atual["alts"]:
                atual["alts"][-1].append(t)
            else:
                atual["enun"].append(t)
        i += 1
    return qs, ordem_disc


def parse_gabarito(pdf_path: Path):
    """Devolve {tipo: {numero: letra|'*'}} a partir das linhas 'números' / 'letras' do PDF."""
    with pdfplumber.open(pdf_path) as pdf:
        texto = "\n".join((p.extract_text() or "") for p in pdf.pages)
    blocos = re.split(r"Prova Tipo\s+(\d+)", texto)
    res = {}
    for k in range(1, len(blocos), 2):
        tipo, corpo = int(blocos[k]), blocos[k + 1]
        nums, letras = [], []
        linhas = [l.split() for l in corpo.splitlines() if l.strip()]
        for j, toks in enumerate(linhas):
            if all(t.isdigit() for t in toks) and j + 1 < len(linhas) and all(re.fullmatch(r"[A-E*]", t) for t in linhas[j + 1]):
                nums += [int(t) for t in toks]
                letras += linhas[j + 1]
        res[tipo] = dict(zip(nums, letras)) if len(nums) == len(letras) else {}
    return res


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    pasta = Path(sys.argv[1]).resolve()
    meta = json.loads((pasta / "meta.json").read_text(encoding="utf-8"))
    edital = json.loads((RAIZ / "conteudo" / "concursos" / meta["concursoSlug"] / "02-json" / "edital.json").read_text(encoding="utf-8"))
    md = (pasta / "01-md" / meta["fonte"]["md"]).read_text(encoding="utf-8")
    erros, avisos = [], []

    # --- integridade dos PDFs de origem
    sha = {}
    for chave in ("prova", "gabarito"):
        arq = pasta / "00-origem" / meta["fonte"][chave]["pdf"]
        sha[chave] = hashlib.sha256(arq.read_bytes()).hexdigest() if arq.exists() else meta["fonte"][chave]["sha256"]
        if sha[chave] != meta["fonte"][chave]["sha256"]:
            erros.append(f"sha256 de {chave} difere do meta.json")

    qs, ordem_disc = parse_prova(md)
    total = meta["totalQuestoes"]
    if len(qs) != total:
        erros.append(f"{len(qs)} questões extraídas, esperado {total}")
    if ordem_disc != [d["id"] for d in edital["disciplinas"]]:
        erros.append(f"ordem de disciplinas na prova {ordem_disc} difere do edital")
    por_disc = {}
    for q in qs:
        por_disc[q["disc"]] = por_disc.get(q["disc"], 0) + 1
    for d in edital["disciplinas"]:
        if por_disc.get(d["id"], 0) != d["questoes"]:
            erros.append(f"{d['id']} {d['nome']}: prova tem {por_disc.get(d['id'], 0)} questões, edital prevê {d['questoes']}")
    nomes = {d["id"]: d["nome"] for d in edital["disciplinas"]}

    gab = parse_gabarito(pasta / "00-origem" / meta["fonte"]["gabarito"]["pdf"])
    tipo = meta["caderno"]["tipo"]
    if tipo not in gab or sorted(gab[tipo]) != list(range(1, total + 1)):
        erros.append(f"gabarito do Tipo {tipo} incompleto ou não encontrado")
    g = gab.get(tipo, {})

    out, pend_total = [], {}
    for q in qs:
        n = q["numero"]
        if len(q["alts"]) != 5:
            erros.append(f"Q{n}: {len(q['alts'])} alternativas")
            continue
        alts = [re.sub(r"\s+", " ", " ".join(a)).strip() for a in q["alts"]]
        enun = juntar(q["enun"])
        pend = []
        if q["imagens"]:
            pend.append("imagem")
        if FORMATACAO.search(enun):
            pend.append("formatacao")
        if any(LINHA_TABELA.match(l) for l in q["enun"]):
            pend.append("tabela")
        pend.append("classificar_assunto")
        letra = g.get(n)
        anulada = letra == "*"
        if letra is None:
            erros.append(f"Q{n}: sem gabarito")
        reg = {
            "id": f"Q{meta['codigoProva']:02d}{n:04d}",
            "schemaVersion": "3.0",
            "tipo": "MultiplaEscolha",
            "enunciado": enun,
            "alternativas": alts,
            "classificacao": {"disciplina": nomes.get(q["disc"], ""), "disciplinaId": q["disc"], "assunto": None},
            "concurso": meta["concurso"],
            "origem": {"tipo": "prova_real", "pdfSha256": sha["prova"], "pagina": q["pagina"],
                       "questaoNumero": n, "provaSlug": meta["slug"], "caderno": meta["caderno"]["rotulo"]},
            "direitos": {"status": "pendente_juridico", "nota": "Questão de prova real da FGV; não publicar sem liberação jurídica."},
            "revisao": {"status": "automatico", "por": None, "em": None},
            "gabaritoOficial": True,
            "anulada": anulada,
            "status": "rascunho",
            "pendencias": pend,
        }
        if not anulada and letra:
            reg["correta"] = "ABCDE".index(letra)
        if q["imagens"]:
            reg["imagens"] = q["imagens"]
        for p in pend:
            pend_total[p] = pend_total.get(p, 0) + 1
        out.append(reg)

    n_anuladas = sum(1 for v in g.values() if v == "*")
    if n_anuladas != sum(1 for r in out if r["anulada"]):
        erros.append("anuladas no gabarito != anuladas nas questões")

    schema = json.loads((RAIZ / "schemas" / "questao.schema.json").read_text(encoding="utf-8"))
    try:
        jsonschema.validate(out, schema)
    except jsonschema.ValidationError as e:
        erros.append(f"schema: {e.message} em {list(e.absolute_path)}")

    if erros:
        print("ERROS:\n - " + "\n - ".join(erros))
        return 1

    (pasta / "02-json" / "questoes.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (pasta / "02-json" / "gabarito.json").write_text(json.dumps({
        "schemaVersion": "1.0", "fonte": {"arquivo": meta["fonte"]["gabarito"]["pdf"], "sha256": sha["gabarito"]},
        "tipos": {str(t): {str(k): v for k, v in sorted(m.items())} for t, m in gab.items()},
        "tipoUsado": tipo}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    dist = {l: sum(1 for r in out if "correta" in r and "ABCDE"[r["correta"]] == l) for l in "ABCDE"}
    rel = [f"# Relatório de extração — {meta['slug']}", "",
           f"- Questões: {len(out)} | anuladas: {n_anuladas} (Q{', Q'.join(str(r['origem']['questaoNumero']) for r in out if r['anulada'])})",
           f"- Distribuição do gabarito (Tipo {tipo}): " + ", ".join(f"{k}={v}" for k, v in dist.items()),
           f"- Pendências para revisão humana: {pend_total}", "", "## Por disciplina", ""]
    for d in edital["disciplinas"]:
        rel.append(f"- {d['id']} {d['nome']}: {por_disc.get(d['id'], 0)} questões (edital: {d['questoes']})")
    for p in ("imagem", "formatacao", "tabela"):
        nums = [r["origem"]["questaoNumero"] for r in out if p in r["pendencias"]]
        rel += ["", f"## Revisar ({p}): " + (", ".join(f"Q{n}" for n in nums) or "nenhuma")]
    (pasta / "02-json" / "relatorio.md").write_text("\n".join(rel) + "\n", encoding="utf-8")
    print("OK:", len(out), "questões,", n_anuladas, "anulada(s)")
    print("gabarito:", dist, "| pendências:", pend_total)
    return 0


if __name__ == "__main__":
    sys.exit(main())
