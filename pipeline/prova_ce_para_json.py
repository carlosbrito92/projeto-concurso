#!/usr/bin/env python3
"""Prova de itens CERTO/ERRADO (Quadrix, Cebraspe...) em PDF -> Markdown + questoes.json (schema v3).

Uso: python3 -I pipeline/prova_ce_para_json.py conteudo/provas/<slug>

Lê  <pasta>/meta.json, <pasta>/00-origem/<prova>.pdf e <pasta>/02-json/gabarito.json (ver gabarito_imagem.py)
Grava <pasta>/01-md/<prova>.md (texto fiel, não vai ao Git), <pasta>/02-json/questoes.json e relatorio.md.
Sai com código != 0 se algo estiver inconsistente (CLAUDE.md).

Como a prova é lida (PDF de 2 colunas com textos-base e comandos no meio das colunas):
  - cada item começa com o número na margem da coluna; as linhas seguintes são recuadas (~20 pt);
  - linha encostada na margem e SEM número depois de um item abre um novo grupo (texto de apoio + comando "julgue os itens de A a B");
  - todos os itens do grupo recebem esse texto de apoio; um "Texto para os itens de A a B" de largura total vale para o intervalo;
  - o que não dá para ler com confiança (fórmulas e sobrescritos, tabelas) é MARCADO (pendências `formatacao`/`tabela`):
    a questão não vai ao aluno pela política padrão até um humano conferir. Nunca se preenche o que não foi lido.
"""
import hashlib
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import jsonschema

RAIZ = Path(__file__).resolve().parent.parent
XH = "{http://www.w3.org/1999/xhtml}"
REGRA = re.compile(r"^_{8,}$")
RASCUNHO = re.compile(r"^(RASCUNHO|www\.pciconcursos\.com\.br)$", re.I)
CABECALHO_RODAPE_Y = (26.0, 808.0)
MARGEM_ESQ, MARGEM_DIR, TOLERANCIA, RECUO_MIN, RECUO_MAX = 36.0, 311.9, 7.0, 12.0, 28.0  # continuação de item: ~+20 pt; recuo de parágrafo do texto-base: ~+35 pt
BASE_TEXTO = re.compile(r"^Texto para os itens de (\d+) a (\d+)")
COMANDO = re.compile(r"itens?\s+(?:de\s+)?(\d+)\s*(?:a|e)\s*(\d+)", re.I)
COMANDO_UNICO = re.compile(r"\bo item\s+(\d+)\b", re.I)


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def paginas_bbox(pdf: Path):
    """[(pagina, [linha])] com linha = dict(x0, x1, y0, y1, palavras=[(x0, x1, texto)])."""
    xml = subprocess.run(["pdftotext", "-bbox-layout", str(pdf), "-"], capture_output=True, check=True, text=True).stdout
    xml = re.sub(r"<!DOCTYPE[^>]*>", "", xml)
    raiz = ET.fromstring(xml)
    out = []
    for n, pg in enumerate(raiz.iter(XH + "page"), 1):
        linhas = []
        for ln in pg.iter(XH + "line"):
            ps = [(float(w.get("xMin")), float(w.get("xMax")), w.text or "", float(w.get("yMin")), float(w.get("yMax"))) for w in ln.iter(XH + "word")]
            if ps:
                ys = sorted(w[3] for w in ps)
                mediana = ys[len(ys) // 2]
                # sobrescrito/subscrito/fórmula dentro da linha: palavra fora da linha de base (itálico e negrito não deslocam)
                altura = sorted(w[4] - w[3] for w in ps)[len(ps) // 2]
                def ordinal(i):  # "n. º", "1. º": o 'º' sobrescrito é normalizado em juntar(); não conta como fórmula
                    return i > 0 and ps[i][2] in ("o", "a") and re.fullmatch(r"(?:n|N|\d{1,2})\.", ps[i - 1][2]) is not None
                mista = any((abs(w[3] - mediana) >= 1.0 or (w[4] - w[3]) < 0.8 * altura) and not ordinal(i) for i, w in enumerate(ps))
                # símbolos que o PDF não expõe como texto (ícones de tecla, fórmulas em fonte própria): palavra vazia ou caractere privado
                vazio = any((not w[2].strip()) or any(0xE000 <= ord(c) <= 0xF8FF or c == "\ufffd" for c in w[2]) for w in ps)
                linhas.append({"x0": float(ln.get("xMin")), "x1": float(ln.get("xMax")), "y0": float(ln.get("yMin")), "y1": float(ln.get("yMax")), "palavras": ps, "mista": mista, "vazio": vazio})
        out.append((n, linhas))
    return out


def fundir_mesma_linha(linhas):
    """Fragmentos na mesma linha visual (fórmulas, sobrescritos) viram uma linha; `mista` marca deslocamento vertical (fórmula/sobrescrito)."""
    linhas = sorted(linhas, key=lambda l: (l["y0"], l["x0"]))
    out = []
    for l in linhas:
        if out:
            a = out[-1]
            sobre = min(a["y1"], l["y1"]) - max(a["y0"], l["y0"])
            if sobre > 0.4 * min(a["y1"] - a["y0"], l["y1"] - l["y0"]):
                deslocado = abs(a["y0"] - l["y0"]) >= 1.0  # fórmula/sobrescrito: fragmento fora da linha de base (itálico/negrito não desloca)
                a["palavras"] = sorted(a["palavras"] + l["palavras"], key=lambda p: p[0])
                a.update(x0=min(a["x0"], l["x0"]), x1=max(a["x1"], l["x1"]), y0=min(a["y0"], l["y0"]), y1=max(a["y1"], l["y1"]), mista=a["mista"] or l.get("mista", False) or deslocado, vazio=a.get("vazio", False) or l.get("vazio", False))
                continue
        out.append(dict(l))
    return out


def texto_da(l) -> str:
    return " ".join(p[2] for p in l["palavras"]).strip()


def tem_colunas(l) -> bool:
    """Linha de tabela: palavras separadas por vãos largos."""
    ps = l["palavras"]
    return any(ps[i + 1][0] - ps[i][1] > 40 for i in range(len(ps) - 1))


def ler_prova(pdf: Path, total: int, margens=(MARGEM_ESQ, MARGEM_DIR)):
    """Percorre as páginas e devolve (itens, bases, avisos)."""
    paginas = paginas_bbox(pdf)
    itens, bases, avisos = {}, [], []
    esperado = 1
    ctx = []           # linhas (flush-left, sem número) do grupo atual
    atual = None       # item em construção
    em_base = None     # [a, b, linhas] enquanto lê um "Texto para os itens de A a B"

    def fechar():
        nonlocal atual
        if atual is not None:
            itens[atual["n"]] = atual
            atual = None

    for pagina, brutas in paginas:
        uteis = [l for l in brutas if CABECALHO_RODAPE_Y[0] <= l["y0"] <= CABECALHO_RODAPE_Y[1] and not texto_da(l).startswith("pcimarkpci")]
        uteis = [l for l in uteis if not RASCUNHO.match(texto_da(l))]
        # marca-d'água diagonal: fragmento curto cuja caixa é larguíssima (texto girado)
        uteis = [l for l in uteis if (l["x1"] - l["x0"]) <= 20 * max(len(texto_da(l)), 1) or len(texto_da(l)) > 12]
        # zona de texto-base de largura total (página do texto): entre "Texto para os itens de A a B" e a primeira régua larga
        cab = next((l for l in uteis if BASE_TEXTO.match(texto_da(l))), None)
        zona = []
        if cab is not None:
            ordem = sorted(uteis, key=lambda r: r["y0"])
            regua = next((l for l in ordem if l["y0"] > cab["y0"] and REGRA.match(texto_da(l)) and l["x1"] - l["x0"] > 400), None)
            if regua is None:  # sem régua (ex.: Quadrix 2025): o texto-base termina no comando "..., julgue os itens a seguir."
                regua = next((l for l in ordem if l["y0"] > cab["y0"] + 20 and l["x0"] < 60 and re.search(r"julgue", texto_da(l), re.I)), None)
            y_fim = regua["y0"] - (2.0 if not REGRA.match(texto_da(regua)) else 0) if regua else 10**6  # comando e item da outra coluna podem estar na mesma altura
            zona = [l for l in uteis if cab["y0"] < l["y0"] < y_fim]
            uteis = [l for l in uteis if l not in zona]
            m = BASE_TEXTO.match(texto_da(cab))
            em_base = [int(m.group(1)), int(m.group(2)), []]
            for l in fundir_mesma_linha([dict(z) for z in zona]):
                em_base[2].append(l)
            bases.append(em_base)
            em_base = None
            uteis = [l for l in uteis if l is not cab]
        esq = fundir_mesma_linha([l for l in uteis if l["x1"] <= 300])
        dire = fundir_mesma_linha([l for l in uteis if l["x0"] >= 300])
        for coluna, margem in ((esq, margens[0]), (dire, margens[1])):
            for l in coluna:
                tx = texto_da(l)
                if not tx or REGRA.match(tx):
                    continue
                pal = l["palavras"]
                eh_item = (abs(pal[0][0] - margem) <= TOLERANCIA and re.fullmatch(r"\d{1,3}", pal[0][2]) is not None
                           and int(pal[0][2]) == esperado and esperado <= total)
                if eh_item:
                    fechar()
                    resto = " ".join(p[2] for p in pal[1:]).strip()
                    atual = {"n": esperado, "pagina": pagina, "linhas": [resto] if resto else [], "mista": l["mista"], "vazio": l.get("vazio", False), "ctx": list(ctx)}
                    esperado += 1
                elif RECUO_MIN < l["x0"] - margem <= RECUO_MAX and (atual is not None):
                    atual["linhas"].append(tx)
                    atual["mista"] = atual["mista"] or l["mista"]
                    atual["vazio"] = atual["vazio"] or l.get("vazio", False)
                else:
                    if atual is not None:
                        fechar()
                        ctx = []
                    ctx.append(l)
                    if tem_colunas(l):
                        l["tabela"] = True
    fechar()
    return itens, bases, avisos


def juntar(linhas, ctx=False) -> str:
    """Junta linhas quebradas em parágrafos (hífen no fim da linha cola a palavra)."""
    texto = ""
    for ln in linhas:
        ln = ln.strip()
        if not texto:
            texto = ln
        elif texto.endswith("-") and ln[:1].islower():
            texto = texto[:-1] + ln
        else:
            texto += " " + ln
    texto = re.sub(r"\s+", " ", texto).strip()
    # ordinais com o "o" sobrescrito separado pelo PDF: "n. o 6.404" -> "n.º 6.404"; "1. o /4/2023" -> "1.º/4/2023"
    texto = re.sub(r"\b(n|N|\d{1,2})\. ([oa])\b ?(?=[/\d])", lambda m: f"{m.group(1)}.{'º' if m.group(2) == 'o' else 'ª'} " if not m.group(0).endswith("/") else "", texto)
    texto = re.sub(r"\b(n|N|\d{1,2})\. ([oa])\b", lambda m: f"{m.group(1)}.{'º' if m.group(2) == 'o' else 'ª'}", texto)
    return texto.replace(".º /", ".º/")


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    pasta = Path(sys.argv[1]).resolve()
    meta = json.loads((pasta / "meta.json").read_text(encoding="utf-8"))
    erros, avisos = [], []
    total = meta["totalQuestoes"]
    pdf = pasta / "00-origem" / meta["fonte"]["prova"]["pdf"]
    if not pdf.exists():
        print(f"ERRO: PDF da prova ausente: {pdf}")
        return 1
    sha = sha256(pdf)
    if sha != meta["fonte"]["prova"]["sha256"]:
        erros.append("sha256 do PDF da prova difere do meta.json")
    gab = json.loads((pasta / "02-json" / "gabarito.json").read_text(encoding="utf-8"))
    resp = {int(k): v for k, v in gab["respostas"].items()}
    if sorted(resp) != list(range(1, total + 1)):
        erros.append(f"gabarito não cobre exatamente 1..{total}")
    if any(v not in ("C", "E") for v in resp.values()):
        erros.append("gabarito com valor fora de C/E")
    definitivo = gab.get("situacao") == "definitivo"

    itens, bases, _ = ler_prova(pdf, total, tuple(meta.get("margens", (MARGEM_ESQ, MARGEM_DIR))))
    faltam = [n for n in range(1, total + 1) if n not in itens]
    if faltam:
        erros.append(f"itens não encontrados: {faltam[:10]}{'...' if len(faltam) > 10 else ''}")

    # faixas de disciplina (definidas no meta.json a partir dos comandos) e módulos
    faixa_de = {}
    for f in meta["faixas"]:
        for n in range(f["de"], f["ate"] + 1):
            if n in faixa_de:
                erros.append(f"item {n} em duas faixas")
            faixa_de[n] = f
    sem_faixa = [n for n in range(1, total + 1) if n not in faixa_de]
    if sem_faixa:
        erros.append(f"itens sem faixa de disciplina: {sem_faixa[:10]}")
    edital = json.loads((RAIZ / "conteudo" / "concursos" / meta["concursoSlug"] / "02-json" / "edital.json").read_text(encoding="utf-8"))
    disc = {d["id"]: d for d in edital["disciplinas"]}
    edital_prova = edital.get("prova") or {}
    sem_intervalo = []
    for f in meta["faixas"]:
        if f["disciplina"] not in disc:
            erros.append(f"faixa {f['de']}-{f['ate']}: disciplina {f['disciplina']} não existe no edital")

    # contagem por módulo contra o edital (grupos 40/30/50)
    por_modulo = {}
    for n, f in faixa_de.items():
        m = disc[f["disciplina"]]["modulo"] if f["disciplina"] in disc else None
        por_modulo[m] = por_modulo.get(m, 0) + 1
    esperado_mod = {}
    for g in edital.get("grupos", []):
        mods = {disc[i]["modulo"] for i in g["disciplinas"]}
        if len(mods) == 1:
            esperado_mod[mods.pop()] = g["questoes"]
    if por_modulo != esperado_mod:
        erros.append(f"itens por módulo {por_modulo} != edital {esperado_mod}")

    # classificação por assunto (gerada por classificar_questoes.py; o manual tem prioridade lá dentro)
    cj = pasta / "02-json" / "classificacao.json"
    cls = json.loads(cj.read_text(encoding="utf-8"))["questoes"] if cj.exists() else {}
    itens_ed = {i["id"]: i for d in edital["disciplinas"] for i in d["itens"]}

    def trilha(iid):
        t, atual = [], iid
        while atual and len(t) < 12:
            t.insert(0, atual)
            atual = itens_ed[atual]["pai"]
        return t

    out, md = [], [f"<!-- {meta['slug']} | texto fiel da prova (não vai ao Git) -->", ""]
    pend_total, sem_texto = {}, []
    for n in range(1, total + 1):
        it = itens.get(n)
        if not it:
            continue
        enun = juntar(it["linhas"])
        if not enun:
            sem_texto.append(n)
        f = faixa_de.get(n)
        apoio_linhas = []
        for a, b, linhas in bases:
            if a <= n <= b:
                apoio_linhas.append("\n".join(texto_da(l) for l in linhas))
        ctx_txt = juntar([texto_da(l) for l in it["ctx"]])
        pend = ["classificar_assunto"]
        if meta.get("vigenciaSuspeita"):
            pend.append("verificar_vigencia")
        if not definitivo:
            pend.append("gabarito_preliminar")
        if it["mista"] or any(l.get("mista") for l in it["ctx"]):
            pend.append("formatacao")
        if any(l.get("tabela") for l in it["ctx"]):
            pend.append("tabela")
        if it["vazio"] or any(l.get("vazio") for l in it["ctx"]):
            pend.append("imagem")  # símbolo/figura que o PDF não expõe como texto: o texto extraído está incompleto
        # o comando do grupo deve citar o item (confere o agrupamento)
        cits = [(int(a), int(b)) for a, b in COMANDO.findall(ctx_txt)] + [(int(x), int(x)) for x in COMANDO_UNICO.findall(ctx_txt)]
        if cits and not any(a <= n <= b for a, b in cits) and not any(a <= n <= b for a, b, _ in bases):
            avisos.append(f"item {n}: o comando do grupo não cita este item ({cits})")
        if not cits and not any(a <= n <= b for a, b, _ in bases):
            sem_intervalo.append(n)  # provas que só dizem "julgue os itens a seguir" (sem A a B): o agrupamento não se confere por número
        c = resp.get(n)
        d_ = disc.get(f["disciplina"]) if f else None
        classif = {"disciplina": d_["nome"] if d_ else "?", "assunto": None}
        if d_:
            classif["disciplinaId"] = d_["id"]
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
            "id": rid, "schemaVersion": "3.0", "tipo": "CertoErrado", "enunciado": enun,
            "alternativas": ["Certo", "Errado"],
            "classificacao": classif, "concurso": meta["concurso"],
            "origem": {"tipo": "prova_real", "pdfSha256": sha, "pagina": it["pagina"], "questaoNumero": n, "provaSlug": meta["slug"], "caderno": meta["caderno"]["rotulo"]},
            "direitos": {"status": "pendente_juridico", "nota": f"Questão de prova real da {meta['concurso']['banca']}; não publicar sem liberação jurídica."},
            "revisao": {"status": "automatico", "por": None, "em": None},
            "gabaritoOficial": definitivo, "anulada": False, "status": "rascunho", "pendencias": list(dict.fromkeys(pend)),
        }
        apoio = "\n\n".join([x for x in apoio_linhas + [ctx_txt] if x])
        if apoio:
            reg["textoApoio"] = apoio
        if c:
            reg["gabaritoCertoErrado"] = c == "C"
            reg["correta"] = 0 if c == "C" else 1
        for p in reg["pendencias"]:
            pend_total[p] = pend_total.get(p, 0) + 1
        out.append(reg)
        md += [f"<!-- p.{it['pagina']} -->", f"### Item {n} ({f['disciplina'] if f else '?'})", "", *( [apoio, ""] if apoio else []), enun, ""]
    if sem_texto:
        erros.append(f"itens sem texto: {sem_texto}")

    schema = json.loads((RAIZ / "schemas" / "questao.schema.json").read_text(encoding="utf-8"))
    try:
        jsonschema.validate(out, schema)
    except jsonschema.ValidationError as e:
        erros.append(f"schema: {e.message} em {list(e.absolute_path)}")
    if len(out) != total:
        erros.append(f"{len(out)} itens extraídos != {total}")
    if erros:
        print("ERROS:\n - " + "\n - ".join(erros))
        return 1

    (pasta / "01-md").mkdir(exist_ok=True)
    (pasta / "01-md" / meta["fonte"]["md"]).write_text("\n".join(md) + "\n", encoding="utf-8")
    (pasta / "02-json" / "questoes.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    dist = {"C": sum(1 for v in resp.values() if v == "C"), "E": sum(1 for v in resp.values() if v == "E")}
    if sem_intervalo:
        avisos.append(f"{len(sem_intervalo)} itens em grupos cujo comando não traz 'itens de A a B' (agrupamento conferido só pela posição): {sem_intervalo[0]}..{sem_intervalo[-1]}")
    por_disc = {}
    for f in meta["faixas"]:
        por_disc[f["disciplina"]] = por_disc.get(f["disciplina"], 0) + (f["ate"] - f["de"] + 1)
    rel = [f"# Relatório de extração — {meta['slug']}", "",
           f"- Itens: {len(out)} (Certo/Errado) | gabarito: {gab.get('situacao')} | distribuição C={dist['C']} E={dist['E']}",
           f"- Pendências para revisão humana: {pend_total}",
           f"- Itens por módulo (conferido contra o edital): {por_modulo}",
           f"- Pontuação: +1 acerto, −1 erro, 0 em branco (edital {edital_prova.get('fonteItem') or '?'}); gabarito: {gab.get('leitura', {}).get('metodo', 'ver gabarito.json')}"]
    if meta.get("vigenciaSuspeita"):
        rel.append("- AVISO: a legislação pode ter mudado desde a prova; conferir a vigência antes de ativar qualquer item jurídico/normativo")
    if not definitivo:
        rel.append("- AVISO: gabarito PRELIMINAR; pode mudar após os recursos (itens anulados/alterados). Conferir o definitivo antes de liberar")
    rel += [f"- AVISO: {a}" for a in avisos]
    rel += ["", "## Por disciplina (faixas do meta.json)", ""] + [f"- {did} {disc[did]['nome']}: {q} itens" for did, q in por_disc.items()]
    (pasta / "02-json" / "relatorio.md").write_text("\n".join(rel) + "\n", encoding="utf-8")
    print(f"OK: {len(out)} itens | C={dist['C']} E={dist['E']} | por módulo {por_modulo}")
    print(f"  pendências: {pend_total}")
    for a in avisos[:15]:
        print("  aviso:", a)
    if len(avisos) > 15:
        print(f"  (+{len(avisos) - 15} avisos)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
