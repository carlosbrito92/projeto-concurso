#!/usr/bin/env python3
"""Prova (MD por coluna) + gabarito oficial -> questoes.json (schema v3).

Uso: python3 -I pipeline/prova_para_json.py <pasta-da-prova>

Lê   <pasta>/meta.json (disciplinas, títulos, cabeçalho do gabarito), <pasta>/01-md/prova-*.md,
     <pasta>/00-origem/gabarito*.pdf e, SE existir, concursos/<concursoSlug>/02-json/edital.json
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
RE_MARCA = re.compile(r"^<!-- p\.(\d+) col\.([EDU]) -->$")
RE_IMAGEM = re.compile(r"^<!-- IMAGEM p\.(\d+) col\.([EDU]) bbox=([\d,]+) -->$")
RE_ALT = re.compile(r"^\(([A-E])\)\s*(.*)$")
RE_NUM = re.compile(r"^\d{1,2}$")
RE_NUM_INLINE = re.compile(r"^(\d{1,2})\.\s+(.*)$")
RE_TEXTO_COMPART = [
    re.compile(r"^Textos? para as questões (\d+) (?:a|e) (\d+)$"),            # FGV (MA)
    re.compile(r"^TEXTO\s*\d*\s*:.*questões de (\d+) (?:a|e) (\d+)\.?$"),     # FUMARC
]
RE_QUESTAO = re.compile(r"^QUESTÃO\s+(\d{1,2})$")
VISUAL = re.compile(r"\b(charge|gráfico|figura|tirinha|cartaz|infográfico|mapa)\b", re.I)
FORMATACAO = re.compile(r"sublinhad|grifad|destacad|em negrito|negrito|itálic|em itálico|trecho em", re.I)
LINHA_TABELA = re.compile(r"^\S+(\s+[\d.,%]+){2,}$|^(\S+\s+){1,3}[\d.,]+\s+[\d.,]+$")

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


def parse_prova(md: str, titulos, modulos, marcador_fim, inline=False, n_alt=5, estilo=None):
    """titulos: [(linhas_do_titulo, chave)] na ordem da prova.
    inline: o número da questão vem no começo do enunciado ("01. Observe...").
    estilo "questao": marcador em linha própria "QUESTÃO 04". n_alt: nº de alternativas (A-D = 4).
    Textos compartilhados ("Texto para as questões 09 a 12") ficam num bloco `apoio` e são
    anexados a cada questão da faixa. Retorna (questoes, ordem_disciplinas, discursiva)."""
    linhas = list(ler_linhas(md))
    qs, atual, disc, apoio = [], None, None, None
    ordem_disc, i, esperado, discursiva = [], 0, 1, []

    def coletando_apoio():
        return apoio is not None and not apoio["iniciada"]

    while i < len(linhas):
        item = linhas[i]
        if item[0] == "IMG":
            alvo = apoio if coletando_apoio() else atual
            if alvo is not None:
                alvo["imagens"].append({"pagina": item[1], "coluna": item[2], "bbox": item[3]})
            i += 1
            continue
        pag, col, t = item
        pronta = atual is None or len(atual["alts"]) == n_alt
        if marcador_fim and t == marcador_fim and atual is not None and len(atual["alts"]) == n_alt:
            discursiva = [x[2] for x in linhas[i:] if x[0] != "IMG"]
            break
        achou = False
        for seq in modulos:
            if casar(linhas, i, seq):
                i += len(seq)
                achou = True
                break
        if achou:
            continue
        for seq, chave in titulos:
            if casar(linhas, i, seq):
                disc = chave
                ordem_disc.append(chave)
                i += len(seq)
                achou = True
                break
        if achou:
            continue
        m = next((r.match(t) for r in RE_TEXTO_COMPART if r.match(t)), None)
        if m and pronta:
            apoio = {"de": int(m.group(1)), "ate": int(m.group(2)), "linhas": [], "imagens": [], "iniciada": False}
            i += 1
            continue
        inicio = None
        if pronta:
            if estilo == "questao":
                mq = RE_QUESTAO.match(t)
                if mq and int(mq.group(1)) == esperado:
                    inicio = ""
            elif inline:
                mi = RE_NUM_INLINE.match(t)
                if mi and int(mi.group(1)) == esperado:
                    inicio = mi.group(2)
            elif RE_NUM.match(t) and int(t) == esperado:
                inicio = ""
        if inicio is not None:
            atual = {"numero": esperado, "pagina": pag, "coluna": col, "disc": disc,
                     "enun": [inicio] if inicio else [], "alts": [], "imagens": [], "apoio": None}
            if apoio is not None and apoio["de"] <= esperado <= apoio["ate"]:
                atual["apoio"] = apoio
                apoio["iniciada"] = True
                if esperado == apoio["ate"]:
                    apoio = None
            qs.append(atual)
            esperado += 1
            i += 1
            continue
        if coletando_apoio():
            apoio["linhas"].append(t)
        elif atual is not None:
            m2 = RE_ALT.match(t)
            if m2 and len(atual["alts"]) < n_alt and m2.group(1) == "ABCDE"[len(atual["alts"])]:
                atual["alts"].append([m2.group(2)])
            elif atual["alts"]:
                atual["alts"][-1].append(t)
            else:
                atual["enun"].append(t)
        i += 1
    return qs, ordem_disc, discursiva


def norm_espaco(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("\u2013", "-").replace("\u2014", "-")).strip().lower()


def parse_gabarito_pares(pdf_path: Path, pagina: int, total: int):
    """Formato 'n – L' em colunas (1 página por cargo/tipo); trata texto duplicado com dedupe_chars."""
    with pdfplumber.open(pdf_path) as pdf:
        txt = pdf.pages[pagina - 1].dedupe_chars(tolerance=1).extract_text() or ""
    pares = re.findall(r"(?<!\d)(\d{1,2})\s*[\u2013\-\u2010]\s*([A-E*])(?![A-Za-z])", txt)
    d = {int(n): l for n, l in pares}
    if len(pares) != len(d):
        return None, "gabarito: número de questão repetido na página"
    if sorted(d) != list(range(1, total + 1)):
        return None, f"gabarito da página {pagina} incompleto: {len(d)} de {total}"
    return d, None


def parse_gabarito_espaco(pdf_path: Path, pagina: int, total: int, n_alt: int):
    """Formato 'NN L NN L ...' (FUMARC): pares número/letra separados por espaço, em colunas."""
    letras = "ABCDE"[:n_alt] + "*"
    with pdfplumber.open(pdf_path) as pdf:
        toks = (pdf.pages[pagina - 1].extract_text() or "").split()
    d, dup = {}, False
    for a, b in zip(toks, toks[1:]):
        if re.fullmatch(r"\d{2}", a) and b in tuple(letras):
            if int(a) in d:
                dup = True
            d[int(a)] = b
    if dup:
        return None, "gabarito: número de questão repetido"
    if sorted(d) != list(range(1, total + 1)):
        return None, f"gabarito incompleto: {len(d)} de {total}"
    return d, None


def parse_gabarito(pdf_path: Path, cabecalho: str, total: int):
    """Lê o bloco que começa na linha `cabecalho`: pares de linhas (números / letras)."""
    with pdfplumber.open(pdf_path) as pdf:
        linhas = [l for p in pdf.pages for l in (p.extract_text() or "").splitlines()]
    alvo = norm_espaco(cabecalho)
    idx = [k for k, l in enumerate(linhas) if norm_espaco(l) == alvo]
    if len(idx) != 1:
        return None, f"cabeçalho '{cabecalho}' encontrado {len(idx)} vez(es) no gabarito"
    nums, letras, k = [], [], idx[0] + 1
    while k + 1 < len(linhas) and len(nums) < total:
        a, b = linhas[k].split(), linhas[k + 1].split()
        if a and all(x.isdigit() for x in a) and b and all(re.fullmatch(r"[A-E*]", x) for x in b) and len(a) == len(b):
            nums += [int(x) for x in a]
            letras += b
            k += 2
        else:
            k += 1
    if nums != list(range(1, total + 1)):
        return None, f"gabarito de '{cabecalho}' incompleto: {len(nums)} de {total}"
    return dict(zip(nums, letras)), None


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    pasta = Path(sys.argv[1]).resolve()
    meta = json.loads((pasta / "meta.json").read_text(encoding="utf-8"))
    md = (pasta / "01-md" / meta["fonte"]["md"]).read_text(encoding="utf-8")
    erros, avisos = [], []

    # edital é opcional: com ele, contagens e nomes são conferidos; sem ele, só o que a prova diz
    ed_path = RAIZ / "conteudo" / "concursos" / meta["concursoSlug"] / "02-json" / "edital.json"
    edital = json.loads(ed_path.read_text(encoding="utf-8")) if ed_path.exists() else None
    if edital is None:
        avisos.append(f"sem edital.json de '{meta['concursoSlug']}': contagem por disciplina NÃO conferida contra o edital")

    sha = {}
    for chave in ("prova", "gabarito"):
        arq = pasta / "00-origem" / meta["fonte"][chave]["pdf"]
        sha[chave] = hashlib.sha256(arq.read_bytes()).hexdigest() if arq.exists() else meta["fonte"][chave]["sha256"]
        if sha[chave] != meta["fonte"][chave]["sha256"]:
            erros.append(f"sha256 de {chave} difere do meta.json")

    discs = meta["disciplinas"]  # [{titulo:[linhas], nome, id?}]
    titulos = [(d["titulo"], k) for k, d in enumerate(discs)]
    qs, ordem, discursiva = parse_prova(md, titulos, meta.get("modulos", []), meta.get("marcadorFim"),
                                        inline=meta.get("numeracao") == "inline",
                                        n_alt=meta.get("alternativas", 5), estilo=meta.get("numeracao"))
    if not meta.get("fimEhDiscursiva", True):  # marcador de fim é só contracapa/folha de respostas
        discursiva = []
    total = meta["totalQuestoes"]
    n_alt = meta.get("alternativas", 5)
    if len(qs) != total:
        erros.append(f"{len(qs)} questões extraídas, esperado {total}")
    if ordem != list(range(len(discs))):
        erros.append(f"títulos de disciplina reconhecidos {ordem}, esperado {list(range(len(discs)))}")
    por_disc = {}
    for q in qs:
        por_disc[q["disc"]] = por_disc.get(q["disc"], 0) + 1
    def ids_de(d):
        return d.get("ids") or ([d["id"]] if d.get("id") else [])

    if edital:
        por_id = {d["id"]: d for d in edital["disciplinas"]}
        usados = set()
        for k, d in enumerate(discs):
            ids = ids_de(d)
            if not ids or any(i not in por_id for i in ids):
                erros.append(f"disciplina '{d['nome']}' sem id(s) válido(s) no edital: {ids}")
                continue
            usados |= set(ids)
            qe = [por_id[i]["questoes"] for i in ids]
            if all(x is not None for x in qe) and por_disc.get(k, 0) != sum(qe):
                erros.append(f"{'+'.join(ids)} {d['nome']}: prova tem {por_disc.get(k, 0)} questões, edital prevê {sum(qe)}")
        for g in edital.get("grupos", []):
            gids = set(g["disciplinas"])
            soma = sum(por_disc.get(k, 0) for k, d in enumerate(discs) if ids_de(d) and set(ids_de(d)) <= gids)
            if soma != g["questoes"]:
                erros.append(f"grupo '{g['nome']}': prova tem {soma} questões, edital prevê {g['questoes']}")
        for i, d in por_id.items():
            if i not in usados:
                avisos.append(f"disciplina do edital {i} ({d['nome']}) sem correspondente na prova")

    gcfg = meta["fonte"]["gabarito"]
    gpdf = pasta / "00-origem" / gcfg["pdf"]
    if gcfg.get("formato") == "pares":
        g, err = parse_gabarito_pares(gpdf, gcfg["pagina"], total)
    elif gcfg.get("formato") == "pares_espaco":
        g, err = parse_gabarito_espaco(gpdf, gcfg.get("pagina", 1), total, n_alt)
    else:
        g, err = parse_gabarito(gpdf, gcfg["cabecalho"], total)
    definitivo = gcfg.get("situacao", "definitivo") == "definitivo"
    if err:
        erros.append(err)
        g = {}

    cls_p = pasta / "02-json" / "classificacao.json"
    cls = json.loads(cls_p.read_text(encoding="utf-8"))["questoes"] if cls_p.exists() else {}
    itens_ed = {i["id"]: i for d_ in (edital["disciplinas"] if edital else []) for i in d_["itens"]}

    def trilha(item_id):
        out_, atual_, guard_ = [], item_id, 0
        while atual_ and atual_ in itens_ed and guard_ < 12:
            out_.append(atual_)
            atual_, guard_ = itens_ed[atual_]["pai"], guard_ + 1
        return list(reversed(out_))

    out, pend_total = [], {}
    for q in qs:
        n = q["numero"]
        if len(q["alts"]) != n_alt:
            erros.append(f"Q{n}: {len(q['alts'])} alternativas (esperado {n_alt})")
            continue
        alts = [re.sub(r"\s+", " ", " ".join(a)).strip() for a in q["alts"]]
        alt_imagem = any(not a for a in alts)  # alternativas que são ícones/figuras
        alts = [a or "[alternativa em imagem]" for a in alts]
        enun = juntar(q["enun"])
        pend = []
        if q["imagens"] or alt_imagem:
            pend.append("imagem")
        if FORMATACAO.search(enun):
            pend.append("formatacao")
        if any(LINHA_TABELA.match(l) for l in q["enun"]):
            pend.append("tabela")
        if not q["imagens"] and not q["apoio"] and VISUAL.search(enun):
            pend.append("imagem")  # gráfico/charge pode ser vetor e não aparecer como imagem
        if q["apoio"] and q["apoio"]["imagens"]:
            pend.append("imagem")
        if not definitivo:
            pend.append("gabarito_preliminar")
        if meta.get("vigenciaSuspeita"):
            pend.append("verificar_vigencia")
        pend.append("classificar_assunto")
        pend = list(dict.fromkeys(pend))
        letra = g.get(n)
        anulada = letra == "*"
        d = discs[q["disc"]]
        classif = {"disciplina": d["nome"], "assunto": None}
        if d.get("ids") and len(d["ids"]) > 1:
            classif["disciplinaIds"] = d["ids"]
        elif ids_de(d):
            classif["disciplinaId"] = ids_de(d)[0]
        rid = f"Q{meta['codigoProva']:02d}{n:04d}"
        cl_q = cls.get(rid)
        if cl_q:
            classif["classificacaoStatus"] = cl_q["status"]
            classif["classificacaoMetodo"] = cl_q.get("metodo")
            classif["classificacaoScore"] = cl_q.get("score")
            if cl_q.get("editalItemId") in itens_ed:
                it_ = itens_ed[cl_q["editalItemId"]]
                classif["editalItemId"] = it_["id"]
                classif["editalItem"] = it_["numero"]
                classif["assunto"] = it_["texto"].strip().rstrip(".;:").strip()
                classif["editalItemTrilha"] = trilha(it_["id"])
            pend = [x for x in pend if x != "classificar_assunto"]
            if cl_q["status"] == "sugerida":
                pend.append("confirmar_assunto")
            elif cl_q["status"] == "indeterminada":
                pend.append("classificar_assunto")
        reg = {
            "id": rid,
            "schemaVersion": "3.0",
            "tipo": "MultiplaEscolha",
            "enunciado": enun,
            "alternativas": alts,
            "classificacao": classif,
            "concurso": meta["concurso"],
            "origem": {"tipo": "prova_real", "pdfSha256": sha["prova"], "pagina": q["pagina"],
                       "questaoNumero": n, "provaSlug": meta["slug"], "caderno": meta["caderno"]["rotulo"]},
            "direitos": {"status": "pendente_juridico", "nota": f"Questão de prova real da {meta['concurso']['banca']}; não publicar sem liberação jurídica."},
            "revisao": {"status": "automatico", "por": None, "em": None},
            "gabaritoOficial": definitivo,
            "anulada": anulada,
            "status": "rascunho",
            "pendencias": pend,
        }
        if not anulada and letra:
            reg["correta"] = "ABCDE".index(letra)
        imgs = list(q["imagens"]) + (q["apoio"]["imagens"] if q["apoio"] else [])
        if imgs:
            reg["imagens"] = imgs
        if q["apoio"] and q["apoio"]["linhas"]:
            reg["textoApoio"] = juntar(q["apoio"]["linhas"])
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

    dj = pasta / "02-json"
    (dj / "questoes.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (dj / "gabarito.json").write_text(json.dumps({
        "schemaVersion": "1.0", "situacao": gcfg.get("situacao", "definitivo"),
        "fonte": {"arquivo": gcfg["pdf"], "sha256": sha["gabarito"], "cabecalho": gcfg.get("cabecalho"), "pagina": gcfg.get("pagina")},
        "respostas": {str(k): v for k, v in sorted(g.items())}}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if discursiva:
        (dj / "discursiva.md").write_text("\n".join(discursiva) + "\n", encoding="utf-8")

    dist = {l: sum(1 for r in out if "correta" in r and "ABCDE"[r["correta"]] == l) for l in "ABCDE"}
    anul = ", ".join(f"Q{r['origem']['questaoNumero']}" for r in out if r["anulada"]) or "nenhuma"
    rel = [f"# Relatório de extração — {meta['slug']}", "",
           f"- Questões: {len(out)} | anuladas: {n_anuladas} ({anul})",
           f"- Distribuição do gabarito: " + ", ".join(f"{k}={v}" for k, v in dist.items()),
           f"- Pendências para revisão humana: {pend_total}",
           f"- Questão discursiva: {'presente (fora do banco de questões)' if discursiva else 'não há'}"]
    if not definitivo:
        rel.append(f"- AVISO: gabarito '{gcfg.get('situacao')}' não confirmado como DEFINITIVO; respostas e anulações podem ter mudado após os recursos")
    if meta.get("vigenciaSuspeita"):
        rel.append("- AVISO: prova antiga; conferir a vigência da legislação antes de ativar qualquer questão jurídica")
    rel += [f"- AVISO: {a}" for a in avisos]
    rel += ["", "## Por disciplina (observado na prova)", ""]
    for k, d in enumerate(discs):
        faixa = [q["numero"] for q in qs if q["disc"] == k]
        prev = ""
        if edital and ids_de(d):
            qe = [x["questoes"] for x in edital["disciplinas"] if x["id"] in ids_de(d)]
            prev = f" | edital: {sum(qe) if all(v is not None for v in qe) else 'só no grupo'}"
        rel.append(f"- {d['nome']}: {len(faixa)} questões (Q{faixa[0]}–Q{faixa[-1]}){prev}")
    for pn in ("imagem", "formatacao", "tabela"):
        nums = [r["origem"]["questaoNumero"] for r in out if pn in r["pendencias"]]
        rel += ["", f"## Revisar ({pn}): " + (", ".join(f"Q{n}" for n in nums) or "nenhuma")]
    (dj / "relatorio.md").write_text("\n".join(rel) + "\n", encoding="utf-8")
    print("OK:", len(out), "questões,", n_anuladas, "anulada(s) |", "gabarito:", dist, "| pendências:", pend_total)
    for a in avisos:
        print("AVISO:", a)
    return 0


if __name__ == "__main__":
    sys.exit(main())
