#!/usr/bin/env python3
"""Edital em MD -> estrutura do edital em JSON (disciplina -> itens).

Uso: python3 -I pipeline/edital_para_json.py <pasta-do-concurso>

Lê  <pasta>/01-md/edital-*.md e <pasta>/meta.json
Grava <pasta>/02-json/edital.json e valida contra schemas/edital.schema.json.
Sai com código != 0 se algo estiver inconsistente (CLAUDE.md).
"""
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

import jsonschema

RAIZ = Path(__file__).resolve().parent.parent
MARCA_PAGINA = re.compile(r"<!-- p\.(\d+)(?: col\.[EDU])? -->\n+")
# Itens do Anexo sempre têm ao menos 2 níveis (1.1, 3.4.3...); aceita qualquer início de texto
# (maiúscula, minúscula, parêntese), pois há itens como "5.5.2. natureza" e "8.11 (In)visibilidade".
TOKEN_ITEM = re.compile(r'(?<![\w./,])(\d+(?:\.\d+)+)(?:\.?\s+(?=\S)|\.(?=[A-ZÀ-Ú]))')  # aceita '5.6.1.1.Powerpoint' (ponto colado)
# Numeração mista do Anexo (itens "1", "2", "4.1", "4.2", ...): o item é aceito só se seguir a sequência do edital
# (o edital às vezes pula números; aceitamos saltos de até 3) e começar por maiúscula ("de 23 de setembro" não é item).
TOKEN_NUM = re.compile(r'(?<![\w./,º°\d])(\d{1,2}(?:\.\d{1,2})*)(?:\s+(?=[A-ZÀ-Ú(])|\.(?=[A-ZÀ-Ú]))')
CABECALHO_DISC = re.compile(r"^(\d{1,2})\.\s+([A-ZÀ-Ú][A-ZÀ-Ú0-9 ,\-–/ÇÃÕ]+)$", re.M)
# nome normalizado e palavra-chave esperada, na ordem do edital
NOMES = [
    ("Língua Portuguesa", "portugu"), ("Raciocínio Lógico-Matemático", "racioc"),
    ("Informática Básica", "inform"), ("Lei Orgânica da PCMG", "organica"),
    ("Noções de Direito Administrativo", "administrativo"), ("Noções de Direito Constitucional", "constitucional"),
    ("Noções de Direito Penal", "direito penal"), ("Noções de Direito Processual Penal", "processual penal"),
    ("Legislação Penal e Processual Extravagante", "extravagante"), ("Noções de Direitos Humanos", "direitos humanos"),
    ("Noções de Medicina Legal", "medicina"), ("Noções de Criminologia", "crimo"),
]


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s)
    return "".join(c for c in s if unicodedata.category(c) != "Mn").lower()


def chave(numero: str) -> tuple:
    return tuple(int(x) for x in numero.split("."))


def paginas_por_offset(md: str):
    """Remove marcadores <!-- p.N --> e devolve (texto, [(offset, pagina)])."""
    partes, marcas, pos, ultimo = [], [], 0, 0
    for m in MARCA_PAGINA.finditer(md):
        partes.append(md[ultimo:m.start()])
        pos += len(partes[-1])
        marcas.append((pos, int(m.group(1))))
        ultimo = m.end()
    partes.append(md[ultimo:])
    return "".join(partes), marcas


def pagina_em(marcas, offset: int) -> int:
    pag = marcas[0][1]
    for off, p in marcas:
        if off <= offset:
            pag = p
        else:
            break
    return pag


def questoes_da_prova(md: str):
    """Extrai de 4.1.5 as contagens 'NN questões de X', na ordem do edital."""
    i = md.index("4.1.5 A Prova de Conhecimentos Objetiva")
    j = md.index("4.1.6", i)
    bloco = md[i:j]
    total = int(re.search(r"constará de (\d+)", bloco).group(1))
    alts = int(re.search(r"cada uma com (\d+)", bloco).group(1))
    itens = [(int(n), nome.strip()) for n, nome in re.findall(r"(\d+)\s+questões? de ([^.;\n]+)", bloco)]
    return total, alts, itens, bloco


LIMPA_INICIO = re.compile(r"^[^\wÀ-ú]+")
RE_PAG = re.compile(r"^<!-- p\.(\d+)(?: col\.[EDU])? -->$")
RE_IMG = re.compile(r"^<!-- IMAGEM")


def limpo(l: str) -> str:
    """Remove marcadores/bullets (ex.: \\uf034) do começo da linha e espaços."""
    return LIMPA_INICIO.sub("", l.strip()).strip()


def itens_plano(texto: str):
    """Numeração corrida '1. ... 2. ...' (1,2,3... em sequência). Retorna lista ou None."""
    texto = re.sub(r"^I\.\s+", "1. ", texto.strip())  # alguns editais digitam 'I.' no lugar de '1.'
    pos, k, marcas = 0, 1, []
    while True:
        m = re.compile(rf"(?<![\w./,\d]){k}\.\s+(?=\S)").search(texto, pos)
        if not m or (k == 1 and m.start() > 3):
            break
        marcas.append((k, m.start(), m.end()))
        pos, k = m.end(), k + 1
    if len(marcas) < 3:
        return None
    out = []
    for i, (n, ini, fim_tok) in enumerate(marcas):
        fim = marcas[i + 1][1] if i + 1 < len(marcas) else len(texto)
        out.append((str(n), texto[fim_tok:fim].strip(), ini))
    return out


def itens_numerados(texto: str, minimo: int = 1):
    """'1 ... 2 ... 4.1 ... 4.2 ...' (sequência com saltos de até 3). Texto antes do 1º número vira o item '0'. None se nenhum número (cai nas sentenças)."""
    marcas, pilha = [], []
    for m in TOKEN_NUM.finditer(texto):
        comps = [int(x) for x in m.group(1).split(".")]
        k = len(comps)
        if comps[:k - 1] != pilha[:k - 1] or len(pilha) < k - 1:
            continue
        ultimo = pilha[k - 1] if len(pilha) >= k else 0
        if not (ultimo < comps[-1] <= ultimo + 3):
            continue
        pilha = pilha[:k - 1] + [comps[-1]]
        marcas.append((m.group(1), m.start(), m.end()))
    if len(marcas) < minimo:
        return None
    out = []
    prefacio = texto[:marcas[0][1]].strip()
    if prefacio:
        out.append(("0", prefacio, 0))
    for i, (n, ini, fim_tok) in enumerate(marcas):
        fim = marcas[i + 1][1] if i + 1 < len(marcas) else len(texto)
        out.append((n, texto[fim_tok:fim].strip(), ini))
    return out


def itens_sentencas(texto: str):
    partes = re.split(r"(?<=[.;])\s+(?=[A-ZÀ-Ú])", texto.strip())
    return [(str(i + 1), p.strip(), 0) for i, p in enumerate(partes) if p.strip()]


def itens_hier(texto: str, num: int):
    toks = [m for m in TOKEN_ITEM.finditer(texto) if m.group(1).split(".")[0] == str(num)]
    return [(m.group(1), re.sub(r"\s+", " ", texto[m.end():(toks[i + 1].start() if i + 1 < len(toks) else len(texto))]).strip(), m.start())
            for i, m in enumerate(toks)]


def main_cfg(pasta: Path, meta: dict) -> int:
    cfg = meta["anexo"]
    erros, avisos = [], []
    md_path = pasta / "01-md" / meta["fonte"]["md"]
    brutas = md_path.read_text(encoding="utf-8").splitlines()
    # (página, linha) sem marcadores de página/imagem
    pag, linhas = 1, []
    for b in brutas:
        m = RE_PAG.match(b.strip())
        if m:
            pag = int(m.group(1))
            continue
        if not b.strip() or RE_IMG.match(b.strip()):
            continue
        linhas.append((pag, b.strip()))

    def achar(txt, a=0, ocorrencia=1):
        hits = [i for i in range(a, len(linhas)) if limpo(linhas[i][1]) == txt]
        if len(hits) < ocorrencia:
            return None
        return hits[ocorrencia - 1]

    ignorar = tuple(cfg.get("ignorarLinhas", []))
    if cfg.get("regioes"):
        # Mais de um trecho do Anexo (ex.: básicos/complementares e o parágrafo de um cargo); início e fim por PREFIXO da linha.
        fatias = []
        for rg in cfg["regioes"]:
            ini = [i for i in range(len(linhas)) if limpo(linhas[i][1]).startswith(rg["de"])]
            if not ini:
                erros.append(f"início da região não encontrado: {rg['de']!r}")
                continue
            i0 = ini[rg.get("ocorrenciaDe", 1) - 1]
            fim = [i for i in range(i0 + 1, len(linhas)) if limpo(linhas[i][1]).startswith(rg["ate"])] if rg.get("ate") else [len(linhas)]
            if not fim:
                erros.append(f"fim da região não encontrado: {rg['ate']!r}")
                continue
            fatias.append(linhas[i0:fim[0]])
        trechos = [x for f in fatias for x in f]
    else:
        i_de = achar(cfg["de"], 0, cfg.get("ocorrenciaDe", 1))
        if i_de is None:
            erros.append(f"início do anexo não encontrado: {cfg['de']!r}")
            i_de = 0
        i_ate = achar(cfg["ate"], i_de + 1) if cfg.get("ate") else len(linhas)
        if i_ate is None:
            erros.append(f"fim do anexo não encontrado: {cfg['ate']!r}")
            i_ate = len(linhas)
        trechos = linhas[i_de:i_ate]
    corpo = [(p, l) for p, l in trechos
             if not re.fullmatch(r"\d{1,3}", l) and not any(limpo(l).startswith(x) for x in ignorar)]
    if cfg.get("quebrarAntes"):
        # Blocos nomeados no meio do parágrafo ("... complementar. Contabilidade pública: 1 ..."): quebra a linha antes do nome.
        corte = re.compile(r"(?<=[.;:]) (?=(?:" + "|".join(re.escape(m) for m in cfg["quebrarAntes"]) + "))")
        corpo = [(p, parte) for p, l in corpo for parte in corte.split(l)]

    # início de cada disciplina
    starts = []
    for k, d in enumerate(cfg["disciplinas"]):
        idx = [i for i, (_, l) in enumerate(corpo) if limpo(l).startswith(d["inicio"]) and (not starts or i > starts[-1][0])]
        if not idx:
            erros.append(f"{d['nome']}: cabeçalho {d['inicio']!r} não encontrado")
            continue
        starts.append((idx[0], k))
    total = meta["prova"]["totalQuestoes"]
    disciplinas, ids = [], {}
    for pos, (ini, k) in enumerate(starts):
        d = cfg["disciplinas"][k]
        fim = starts[pos + 1][0] if pos + 1 < len(starts) else len(corpo)
        if d.get("ate"):
            f2 = [i for i in range(ini + 1, fim) if limpo(corpo[i][1]).startswith(d["ate"])]
            if f2:
                fim = f2[0]
        bloco = corpo[ini:fim]
        resto = limpo(bloco[0][1])[len(d["inicio"]):].lstrip(": ").strip()
        textos = ([resto] if resto else []) + [l for _, l in bloco[1:]]
        pgs, offs, acum = [], [], 0
        for (p, _), tx in zip(bloco[(0 if resto else 1):], textos):
            pgs.append(p); offs.append(acum); acum += len(tx) + 1
        texto = " ".join(textos)
        bib = None
        for mk in d.get("bibliografia", []):
            mm = re.search(re.escape(mk), texto, re.I)
            if mm:
                bib, texto = texto[mm.start():].strip(), texto[:mm.start()].strip()
                break
        modo = d.get("modo", "auto")
        if modo != "hierarquico":  # parêntese de título ("(COM EXCEÇÃO DOS CARGOS DE LEGISTA)") não é item do programa
            texto = re.sub(r"^\([^)]*\)\s*", "", texto.lstrip())
        num = d.get("numero", k + 1)
        if modo == "hierarquico":
            its, numeracao = itens_hier(texto, num), "edital"
        elif modo == "numerado":
            its, numeracao = itens_numerados(texto), "edital"
            if its is None:
                its, numeracao = itens_sentencas(texto), "sintetica"
        else:
            its = itens_plano(texto) if modo in ("auto", "plano") else None
            numeracao = "edital"
            if its is None:
                its, numeracao = itens_sentencas(texto), "sintetica"
        did = f"D{k + 1:02d}"
        ids[d["nome"]] = did
        itens, vistos = [], set()
        for n_item, tx, off in its:
            tx = re.sub(r"\s+", " ", tx).strip()
            if not tx:
                continue
            if n_item in vistos:
                erros.append(f"{did}: item repetido {n_item}")
            vistos.add(n_item)
            j = max([x for x, o in enumerate(offs) if o <= off] or [0]) if offs else 0
            itens.append({"id": f"{did}:{n_item}", "numero": n_item, "texto": tx, "pai": None, "pagina": pgs[min(j, len(pgs) - 1)] if pgs else bloco[0][0]})
        if modo == "hierarquico" or (modo == "numerado" and numeracao == "edital"):
            nums = {i["numero"] for i in itens}
            for it in itens:
                partes = it["numero"].split(".")
                for n in range(len(partes) - 1, 0, -1):
                    cand = ".".join(partes[:n])
                    if cand in nums:
                        it["pai"] = f"{did}:{cand}"
                        break
        if not itens:
            erros.append(f"{did} {d['nome']}: nenhum item extraído")
        q = d.get("questoes")
        disciplinas.append({
            "id": did, "modulo": d.get("modulo", "basicos"), "numero": num, "tituloLiteral": limpo(bloco[0][1])[:len(d["inicio"])],
            "nome": d["nome"], "questoes": q, "peso": round(q / total, 6) if q is not None and total else None,
            "numeracaoItens": numeracao, "bibliografiaBruta": bib, "itens": itens})
        if numeracao == "sintetica":
            avisos.append(f"{did}: o edital não numera os itens; numeração sintética por frase (granularidade limitada)")

    grupos = []
    for g in cfg.get("grupos", []):
        gids = [ids[n] for n in g["disciplinas"] if n in ids]
        grupos.append({"nome": g["nome"], "questoes": g["questoes"], "disciplinas": gids})
    soma = sum(d["questoes"] for d in disciplinas if d["questoes"] is not None) + sum(g["questoes"] for g in grupos)
    if soma != total:
        erros.append(f"soma das questões do edital ({soma}) != total da prova ({total})")

    pdf = pasta / "00-origem" / meta["fonte"]["pdf"]
    sha = hashlib.sha256(pdf.read_bytes()).hexdigest() if pdf.exists() else meta["fonte"]["sha256"]
    if sha != meta["fonte"]["sha256"]:
        erros.append("sha256 do PDF difere do meta.json")
    paginas = sorted({p for p, _ in corpo})
    saida = {"schemaVersion": "1.2", "concurso": meta["concurso"],
             "prova": {"totalQuestoes": total, "alternativas": meta["prova"]["alternativas"],
                       "pontosPorQuestao": meta["prova"]["pontosPorQuestao"],
                       "notaMinimaObjetiva": meta["prova"].get("notaMinimaObjetiva"),
                       "duracaoMinimaHoras": meta["prova"].get("duracaoMinimaHoras"),
                       "duracaoMaximaHoras": meta["prova"].get("duracaoMaximaHoras"),
                       "dataProvavel": meta["prova"].get("dataProvavel"), "fonteItem": meta["prova"]["fonteItem"],
                       **({"pontosPorErro": meta["prova"]["pontosPorErro"]} if "pontosPorErro" in meta["prova"] else {}),
                       **({"notaMinimaPorModulo": meta["prova"]["notaMinimaPorModulo"]} if "notaMinimaPorModulo" in meta["prova"] else {})},
             "fonte": {"arquivo": meta["fonte"]["pdf"], "sha256": sha, "paginasAnexoConteudo": paginas},
             "disciplinas": disciplinas, "avisos": avisos}
    if grupos:
        saida["grupos"] = grupos
    schema = json.loads((RAIZ / "schemas" / "edital.schema.json").read_text(encoding="utf-8"))
    try:
        jsonschema.validate(saida, schema)
    except jsonschema.ValidationError as e:
        erros.append(f"schema: {e.message} em {list(e.absolute_path)}")
    if erros:
        print("ERROS:\n - " + "\n - ".join(erros))
        return 1
    (pasta / "02-json" / "edital.json").write_text(json.dumps(saida, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"OK: {len(disciplinas)} disciplinas, {sum(len(d['itens']) for d in disciplinas)} itens, {total} questões")
    for d in disciplinas:
        q = "--" if d["questoes"] is None else f"{d['questoes']:>2}"
        print(f"  {d['id']} {d['nome']:<46} {q} q {len(d['itens']):>3} itens ({d['numeracaoItens']}){' +bibliografia' if d['bibliografiaBruta'] else ''}")
    for g in grupos:
        print(f"  grupo: {g['nome']} = {g['questoes']} q ({', '.join(g['disciplinas'])})")
    for a in avisos:
        print("  aviso:", a)
    return 0


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    pasta = Path(sys.argv[1]).resolve()
    meta = json.loads((pasta / "meta.json").read_text(encoding="utf-8"))
    if "anexo" in meta:
        return main_cfg(pasta, meta)
    md_path = pasta / "01-md" / meta["fonte"]["md"]
    md = md_path.read_text(encoding="utf-8")
    erros, avisos = [], []

    # --- prova (item 4.1.5 / 4.1.6 / 4.1.7)
    md_sem, marcas_all = paginas_por_offset(md)
    total, alts, qs, _ = questoes_da_prova(md_sem)
    if sum(n for n, _ in qs) != total:
        erros.append(f"soma das questões por disciplina ({sum(n for n, _ in qs)}) != total ({total})")
    pontos = float(re.search(r"valerá (\d+) \(um\) ponto", md_sem).group(1))
    minimo = float(re.search(r"acerte (\d+) \(trinta e cinco\) pontos", md_sem).group(1))

    # --- Anexo I
    ini = md_sem.index("# ANEXO I\n")
    fim = md_sem.index("# ANEXO II", ini)
    anexo = md_sem[ini:fim]
    base = ini
    pag_ini = pagina_em(marcas_all, ini)
    pag_fim = pagina_em(marcas_all, fim - 1)

    cabecalhos = list(CABECALHO_DISC.finditer(anexo))
    if len(cabecalhos) != len(NOMES):
        erros.append(f"{len(cabecalhos)} disciplinas no Anexo I, esperado {len(NOMES)}")
    mod_basicos = anexo.index("CONHECIMENTOS BÁSICOS")
    mod_especif = anexo.index("CONHECIMENTOS ESPECÍFICOS")

    disciplinas = []
    for k, h in enumerate(cabecalhos):
        fimbloco = cabecalhos[k + 1].start() if k + 1 < len(cabecalhos) else len(anexo)
        corpo_ini = h.end()
        corpo = anexo[corpo_ini:fimbloco]
        if h.start() < mod_especif < fimbloco:  # remove o título do módulo seguinte
            corpo = anexo[corpo_ini:mod_especif]
        modulo = "basicos" if h.start() < mod_especif else "especificos"
        num = int(h.group(1))
        did = f"D{k + 1:02d}"
        nome, palavra = NOMES[k] if k < len(NOMES) else (h.group(2).title(), "")
        q = qs[k][0] if k < len(qs) else 0
        nome_prova = qs[k][1] if k < len(qs) else ""
        if palavra and palavra not in norm(h.group(2) + " " + nome_prova):
            erros.append(f"{did}: '{palavra}' não aparece em '{h.group(2)}' / '{nome_prova}' (ordem do edital mudou?)")

        itens, vistos = [], {}
        toks = []
        for tk in TOKEN_ITEM.finditer(corpo):
            if tk.group(1).split(".")[0] != str(num):  # ex.: versão de software "LibreOffice 7.1.6."
                ctx = re.sub(r"\s+", " ", corpo[max(0, tk.start() - 25):tk.end() + 15])
                avisos.append(f"{did}: token '{tk.group(1)}' ignorado (não é item da disciplina): ...{ctx}...")
                continue
            toks.append(tk)
        for t_i, t in enumerate(toks):
            fim_t = toks[t_i + 1].start() if t_i + 1 < len(toks) else len(corpo)
            numero = t.group(1)
            texto = re.sub(r"\s+", " ", corpo[t.end():fim_t]).strip()
            if numero in vistos:
                erros.append(f"{did}: número de item repetido {numero}")
            vistos[numero] = True
            off = base + corpo_ini + t.start()
            itens.append({"numero": numero, "texto": texto, "pagina": pagina_em(marcas_all, off)})

        numeros = set(vistos)
        anterior = None
        for it in itens:
            partes = it["numero"].split(".")
            if anterior and chave(it["numero"]) <= chave(anterior):
                erros.append(f"{did}: item {it['numero']} fora de ordem (após {anterior})")
            anterior = it["numero"]
            pai = None
            for n in range(len(partes) - 1, 0, -1):
                cand = ".".join(partes[:n])
                if cand in numeros:
                    pai = f"{did}:{cand}"
                    break
            if partes[0] != str(num):
                erros.append(f"{did}: item {it['numero']} não pertence à disciplina {num}")
            it["id"] = f"{did}:{it['numero']}"
            it["pai"] = pai
        # lacunas na numeração do próprio edital (informativo)
        irmaos = {}
        for it in itens:
            irmaos.setdefault(it["pai"], []).append(it["numero"])
        for pai, nums in irmaos.items():
            ult = [int(n.split(".")[-1]) for n in nums]
            faltam = sorted(set(range(min(ult), max(ult) + 1)) - set(ult))
            if faltam:
                avisos.append(f"{did}: numeração do edital pula {faltam} sob {pai or 'raiz'} (como no original)")
        if not itens:
            erros.append(f"{did}: nenhum item extraído")
        disciplinas.append({
            "id": did, "modulo": modulo, "numero": num, "tituloLiteral": h.group(2).strip(),
            "nome": nome, "questoes": q, "peso": round(q / total, 6) if total else 0,
            "itens": [{k2: it[k2] for k2 in ("id", "numero", "texto", "pai", "pagina")} for it in itens],
        })
        if norm(h.group(2)) != norm(nome).upper().lower() and "crimonologia" in norm(h.group(2)):
            avisos.append(f"{did}: título literal do edital tem erro de grafia ('{h.group(2)}'); mantido em tituloLiteral")

    pdf = pasta / "00-origem" / meta["fonte"]["pdf"]
    sha = hashlib.sha256(pdf.read_bytes()).hexdigest() if pdf.exists() else meta["fonte"]["sha256"]
    if sha != meta["fonte"]["sha256"]:
        erros.append("sha256 do PDF difere do meta.json")

    saida = {
        "schemaVersion": "1.2",
        "concurso": meta["concurso"],
        "prova": {
            "totalQuestoes": total, "alternativas": alts, "pontosPorQuestao": pontos,
            "notaMinimaObjetiva": minimo, **meta["prova"], "fonteItem": "4.1.5",
        },
        "fonte": {"arquivo": meta["fonte"]["pdf"], "sha256": sha,
                  "paginasAnexoConteudo": list(range(pag_ini, pag_fim + 1))},
        "disciplinas": disciplinas,
        "avisos": avisos,
    }
    schema = json.loads((RAIZ / "schemas" / "edital.schema.json").read_text(encoding="utf-8"))
    try:
        jsonschema.validate(saida, schema)
    except jsonschema.ValidationError as e:
        erros.append(f"schema: {e.message} em {list(e.absolute_path)}")

    if erros:
        print("ERROS:\n - " + "\n - ".join(erros))
        return 1
    destino = pasta / "02-json" / "edital.json"
    destino.write_text(json.dumps(saida, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    n_itens = sum(len(d["itens"]) for d in disciplinas)
    print(f"OK: {len(disciplinas)} disciplinas, {n_itens} itens, {total} questões -> {destino}")
    for d in disciplinas:
        print(f"  {d['id']} {d['nome']:<44} {d['questoes']:>2} q  {len(d['itens']):>3} itens")
    for a in avisos:
        print("  aviso:", a)
    return 0


if __name__ == "__main__":
    sys.exit(main())
