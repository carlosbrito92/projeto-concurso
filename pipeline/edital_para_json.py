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
MARCA_PAGINA = re.compile(r"<!-- p\.(\d+) -->\n\n")
# Itens do Anexo sempre têm ao menos 2 níveis (1.1, 3.4.3...); aceita qualquer início de texto
# (maiúscula, minúscula, parêntese), pois há itens como "5.5.2. natureza" e "8.11 (In)visibilidade".
TOKEN_ITEM = re.compile(r'(?<![\w./,])(\d+(?:\.\d+)+)\.?\s+(?=\S)')
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


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    pasta = Path(sys.argv[1]).resolve()
    meta = json.loads((pasta / "meta.json").read_text(encoding="utf-8"))
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
        "schemaVersion": "1.0",
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
