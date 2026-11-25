#!/usr/bin/env python3
"""Perfil estatístico de banca a partir das provas reais extraídas.

Uso: python3 -I pipeline/perfil_banca.py            (gera todas as bancas encontradas)
     python3 -I pipeline/perfil_banca.py FGV        (só uma)

Lê   conteudo/provas/*/meta.json e */02-json/questoes.json
Grava conteudo/bancas/<banca>.json (validado por schemas/banca.schema.json)

Só MEDIDAS: nenhum trecho de enunciado ou alternativa é copiado para o perfil (direito autoral),
e estatísticas de bancas diferentes nunca são misturadas. Questões anuladas ficam fora das medidas
de gabarito. Alternativas em imagem ("[alternativa em imagem]") ficam fora das medidas de tamanho.
"""
import json
import re
import statistics as st
import sys
from collections import Counter
from pathlib import Path

import jsonschema

RAIZ = Path(__file__).resolve().parent.parent
PLACEHOLDER = "[alternativa em imagem]"

# polaridade do comando da questão (o que se pede); só olha as 2 últimas linhas do enunciado.
# "não" solto em caso narrativo NÃO conta; só "NÃO" em caixa alta, "não é correto..." ou termos explícitos.
RE_NEG_TERMO = re.compile(r"INCORRET|EXCETO|inadequad|incorret", re.I)
RE_NEG_NAO_CAIXA_ALTA = re.compile(r"\bNÃO\b")
RE_NEG_NAO_E = re.compile(r"\bnão (?:é|está|são|estão|se pode)\s+(?:corret|adequad|verdad|admitid|possível)", re.I)
RE_NEG_ASSINALE = re.compile(r"assinale[^.]{0,80}\b(?:falsa|falso|errada|errado)\b", re.I)
RE_ASSERT_TOKEN = re.compile(r"(?:^|(?<=\s))(I|II|III|IV|V|VI)\s?[.\-–)]\s+(?=\S)")


def pede_negativa(enun: str) -> bool:
    fim = " ".join(enun.splitlines()[-2:])
    return bool(RE_NEG_TERMO.search(fim) or RE_NEG_NAO_CAIXA_ALTA.search(fim) or RE_NEG_NAO_E.search(fim) or RE_NEG_ASSINALE.search(fim))


def tem_assertivas(enun: str) -> bool:
    return {"I", "II"} <= set(RE_ASSERT_TOKEN.findall(enun))


RE_RELACIONE = re.compile(r"\b(relacione|assinale a (?:sequência|opção que apresenta a sequência)|numere|ordene)\b", re.I)
RE_NORMA = re.compile(r"\b(art\.|artigos?|Lei\b|Lei n|Súmula|Decreto|Constituição|CPP|CP\b|CF/88|§)", re.I)
RE_TODAS = re.compile(r"\b(todas as (?:anteriores|alternativas|opções)|nenhuma das (?:anteriores|alternativas|opções))\b", re.I)
RE_ROMANO = re.compile(r"\b(?:VI|IV|V|III|II|I)\b")
PALAVRAS_COMBINACAO = {"apenas", "somente", "e", "são", "sao", "está", "esta", "estão", "estao", "corretas", "correta", "certas", "certa",
                       "as", "os", "afirmativas", "afirmativa", "frases", "frase", "itens", "item", "se", "todas", "ou", "nenhuma", "verdadeiras", "estiver", "estiverem", "esteja", "estejam", "incorreta", "incorretas", "falsa", "falsas", "errada", "erradas"}


def eh_combinacao(alt: str) -> bool:
    """Alternativa que só combina assertivas numeradas: 'I, apenas.', 'Apenas II e III', 'se apenas as frases I e II estão corretas'."""
    if len(alt) > 90 or not RE_ROMANO.search(alt):
        return False
    resto = RE_ROMANO.sub(" ", alt)
    palavras = re.findall(r"[A-Za-zÀ-ú]+", resto)
    return all(p.lower() in PALAVRAS_COMBINACAO for p in palavras)


def pct(a, b):
    return round(a / b, 4) if b else None


def resumo(valores):
    v = sorted(valores)
    if not v:
        return None
    q = st.quantiles(v, n=10, method="inclusive") if len(v) >= 2 else [v[0]] * 9
    return {"n": len(v), "media": round(st.mean(v), 1), "mediana": round(st.median(v), 1),
            "p10": round(q[0], 1), "p90": round(q[8], 1), "min": v[0], "max": v[-1]}


def ultimo_trecho(enun: str) -> str:
    linhas = [l for l in enun.splitlines() if l.strip()]
    return linhas[-1].strip() if linhas else ""


def medir(questoes, provas):
    ativas = [q for q in questoes if not q["anulada"]]
    n, na = len(questoes), len(ativas)
    nalt = Counter(len(q["alternativas"]) for q in questoes)
    letras = "ABCDE"
    gab = Counter(letras[q["correta"]] for q in ativas)
    por_prova = {}
    for pv, qs in provas.items():
        c = Counter(letras[q["correta"]] for q in qs if not q["anulada"])
        por_prova[pv] = {l: c.get(l, 0) for l in letras if l in "ABCDE"[: max(len(x["alternativas"]) for x in qs)]}

    enun_len = [len(q["enunciado"]) for q in questoes]
    enun_pal = [len(q["enunciado"].split()) for q in questoes]
    alt_len, alt_media_q = [], []
    mais_longa, avaliaveis, empate = 0, 0, 0
    for q in ativas:
        al = [a for a in q["alternativas"] if a != PLACEHOLDER]
        if len(al) != len(q["alternativas"]):
            continue
        L = [len(a) for a in al]
        alt_len += L
        alt_media_q.append(st.mean(L))
        avaliaveis += 1
        mx = max(L)
        if L.count(mx) > 1:
            empate += 1
        elif L.index(mx) == q["correta"]:
            mais_longa += 1

    neg = sum(1 for q in questoes if pede_negativa(q["enunciado"]))
    assert_q = sum(1 for q in questoes if tem_assertivas(q["enunciado"]))
    relac = sum(1 for q in questoes if RE_RELACIONE.search(q["enunciado"]))
    fecha_pergunta = sum(1 for q in questoes if q["enunciado"].rstrip().endswith("?"))
    fecha_dois_pontos = sum(1 for q in questoes if q["enunciado"].rstrip().endswith(":"))
    fecha_ponto = sum(1 for q in questoes if q["enunciado"].rstrip().endswith("."))
    fecha_sem_pont = sum(1 for q in questoes if q["enunciado"].rstrip()[-1:].isalpha())  # completar frase
    cita_norma = sum(1 for q in questoes if RE_NORMA.search(q["enunciado"] + " " + " ".join(q["alternativas"])))
    todas = sum(1 for q in questoes if any(RE_TODAS.search(a) for a in q["alternativas"]))
    alt_assert = sum(1 for q in questoes if sum(1 for a in q["alternativas"] if eh_combinacao(a.strip())) >= 2)
    apoio = sum(1 for q in questoes if q.get("textoApoio"))
    imagem = sum(1 for q in questoes if "imagem" in q.get("pendencias", []))

    disc = Counter(q["classificacao"]["disciplina"] for q in questoes)
    disc_por_prova = {pv: dict(Counter(q["classificacao"]["disciplina"] for q in qs)) for pv, qs in provas.items()}
    len_por_disc = {}
    for d in disc:
        v = [len(q["enunciado"]) for q in questoes if q["classificacao"]["disciplina"] == d]
        len_por_disc[d] = round(st.mean(v), 1)

    nalt_moda = nalt.most_common(1)[0][0]
    return {
        "questoes": {"total": n, "anuladas": n - na, "taxaAnuladas": pct(n - na, n),
                     "alternativasPorQuestao": {str(k): v for k, v in sorted(nalt.items())}},
        "gabarito": {"baseadoEm": na, "distribuicao": {l: gab.get(l, 0) for l in letras[:nalt_moda]},
                     "proporcao": {l: pct(gab.get(l, 0), na) for l in letras[:nalt_moda]},
                     "porProva": por_prova, "acaso": round(1 / nalt_moda, 4)},
        "enunciado": {"caracteres": resumo(enun_len), "palavras": resumo(enun_pal),
                      "comTextoCompartilhado": pct(apoio, n),
                      "nota": "textoApoio só é separado quando o caderno declara texto compartilhado; nas demais questões o texto está dentro do enunciado"},
        "alternativas": {"caracteres": resumo(alt_len), "mediaPorQuestao": resumo(alt_media_q),
                         "corretaEhMaisLonga": {"proporcao": pct(mais_longa, avaliaveis), "empateNoMaior": pct(empate, avaliaveis),
                                                "baseadoEm": avaliaveis, "acaso": round(1 / nalt_moda, 4)},
                         "comAlternativaEmImagem": pct(sum(1 for q in questoes if PLACEHOLDER in q["alternativas"]), n)},
        "comando": {"pedeIncorretaOuExceto": pct(neg, n), "assertivasNumeradas": pct(assert_q, n),
                    "alternativasDeCombinacao": pct(alt_assert, n), "relacioneOuSequencia": pct(relac, n),
                    "terminaEmPergunta": pct(fecha_pergunta, n), "terminaEmDoisPontos": pct(fecha_dois_pontos, n),
                    "terminaEmPonto": pct(fecha_ponto, n), "terminaSemPontuacaoCompletarFrase": pct(fecha_sem_pont, n),
                    "citaNormaOuArtigo": pct(cita_norma, n), "alternativaTodasOuNenhuma": pct(todas, n),
                    "dependeDeImagem": pct(imagem, n)},
        "disciplinas": {"questoesPorDisciplina": dict(disc), "porProva": disc_por_prova, "tamanhoMedioEnunciado": len_por_disc},
    }


def main() -> int:
    alvo = sys.argv[1].upper() if len(sys.argv) > 1 else None
    grupos = {}
    for meta_p in sorted((RAIZ / "conteudo" / "provas").glob("*/meta.json")):
        meta = json.loads(meta_p.read_text(encoding="utf-8"))
        qj = meta_p.parent / "02-json" / "questoes.json"
        if not qj.exists():
            print(f"(sem questoes.json: {meta['slug']}, ignorada)")
            continue
        banca = meta["concurso"]["banca"].upper()
        if alvo and banca != alvo:
            continue
        g = grupos.setdefault(banca, {"meta": [], "provas": {}, "questoes": []})
        qs = json.loads(qj.read_text(encoding="utf-8"))
        g["meta"].append(meta)
        g["provas"][meta["slug"]] = qs
        g["questoes"] += qs
    if not grupos:
        print("nenhuma prova encontrada")
        return 1
    schema = json.loads((RAIZ / "schemas" / "banca.schema.json").read_text(encoding="utf-8"))
    (RAIZ / "conteudo" / "bancas").mkdir(exist_ok=True)
    erros = 0
    for banca, g in grupos.items():
        provas = g["provas"]
        m = medir(g["questoes"], provas)
        n_provas = len(provas)
        perfil = {
            "schemaVersion": "1.0",
            "banca": banca,
            "amostra": {
                "provas": [{"slug": mt["slug"], "orgao": mt["concurso"]["orgao"], "ano": mt["concurso"]["ano"],
                            "cargo": mt["concurso"]["cargo"], "questoes": len(provas[mt["slug"]]),
                            "alternativas": mt.get("alternativas", 5),
                            "gabarito": mt["fonte"]["gabarito"].get("situacao", "definitivo")} for mt in g["meta"]],
                "totalQuestoes": len(g["questoes"]),
                "confianca": "baixa" if n_provas < 3 else "media",
                "aviso": ("Amostra de " + str(n_provas) + " prova(s), todas de cargos policiais; use as medidas como tendência, não como regra. "
                          "Gabaritos preliminares/não confirmados podem ter mudado após recursos."),
            },
            "medidas": m,
            "origem": "calculado por pipeline/perfil_banca.py a partir de conteudo/provas/*/02-json/questoes.json; nenhum trecho de questão é copiado",
        }
        try:
            jsonschema.validate(perfil, schema)
        except jsonschema.ValidationError as e:
            print(f"ERRO ({banca}): {e.message} em {list(e.absolute_path)}")
            erros += 1
            continue
        out = RAIZ / "conteudo" / "bancas" / f"{banca.lower()}.json"
        out.write_text(json.dumps(perfil, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        gab = m["gabarito"]["proporcao"]
        print(f"{banca}: {n_provas} prova(s), {m['questoes']['total']} questões -> {out.relative_to(RAIZ)}")
        print(f"  gabarito {gab} | enunciado mediana {m['enunciado']['caracteres']['mediana']} car | "
              f"comando negativo {m['comando']['pedeIncorretaOuExceto']} | assertivas {m['comando']['assertivasNumeradas']} | "
              f"correta mais longa {m['alternativas']['corretaEhMaisLonga']['proporcao']} (acaso {m['alternativas']['corretaEhMaisLonga']['acaso']})")
    return 1 if erros else 0


if __name__ == "__main__":
    sys.exit(main())
