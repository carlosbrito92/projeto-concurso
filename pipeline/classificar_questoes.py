#!/usr/bin/env python3
"""Sugere, para cada questão de prova real, o item do edital (assunto) que ela cobre.

Uso: python3 -I pipeline/classificar_questoes.py <pasta-da-prova>

Lê   <prova>/02-json/questoes.json (gerado por prova_para_json.py) e o edital.json do concurso
Grava <prova>/02-json/classificacao.json  (SÓ ids, pontuações e status: pode ir ao Git)
      <prova>/02-json/revisao-classificacao.csv (texto p/ revisão humana; ignorado pelo Git)

Método (auditável, sem IA generativa): TF-IDF sobre o texto dos itens do edital da MESMA disciplina da
questão (item + títulos dos itens-pai). Texto da questão = enunciado (sem o texto de apoio compartilhado,
que é neutro quanto ao assunto) + alternativas. Resultado é SEMPRE uma sugestão:
  status "sugerida"       -> pontuação e margem acima do limiar
  status "indeterminada"  -> o assunto fica null; os candidatos ficam registrados
  status "confirmada"     -> só um humano define; este script NUNCA sobrescreve uma confirmada.
"""
import csv
import json
import math
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
LIMIAR_SCORE = 0.12   # pontuação mínima do melhor candidato
LIMIAR_MARGEM = 0.03  # diferença mínima para o 2º colocado
STOP = set("""a o as os um uma uns umas de do da dos das em no na nos nas por para com sem sob sobre entre ate apos ante
e ou mas se que qual quais quando como onde ao aos a as pelo pela pelos pelas seu sua seus suas este esta estes estas esse essa
esses essas isso isto aquele aquela ja nao nem mais menos muito muita muitos muitas todo toda todos todas outro outra outros outras
ser sao foi era eram sera serao seja sejam esta estao estava tem tinha ha havia pode podem deve devem afirmativa afirmativas
assinale alternativa alternativas opcao opcoes correta correto corretas corretos incorreta incorreto acerca respeito
considerando considere seguinte seguintes apenas somente item itens assim cada sendo ainda entao tambem quanto""".split())


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def stems(texto: str):
    toks = [t for t in re.findall(r"[a-z0-9]{3,}", norm(texto)) if t not in STOP and not t.isdigit()]
    return [t[:6] for t in toks]  # radical aproximado por prefixo (barato e razoável em português)


def vetor(tokens, idf):
    c = Counter(tokens)
    v = {t: (1 + math.log(n)) * idf.get(t, 1.0) for t, n in c.items()}
    norma = math.sqrt(sum(x * x for x in v.values())) or 1.0
    return {t: x / norma for t, x in v.items()}


def cos(a, b):
    if len(a) > len(b):
        a, b = b, a
    return sum(x * b.get(t, 0.0) for t, x in a.items())


def itens_da_disciplina(edital, ids):
    """Itens das disciplinas `ids`, cada um com o texto enriquecido pelos títulos dos pais."""
    por_id = {i["id"]: i for d in edital["disciplinas"] if d["id"] in ids for i in d["itens"]}
    out = []
    for it in por_id.values():
        cadeia, p, guard = [], it["pai"], 0
        while p and p in por_id and guard < 10:
            cadeia.append(por_id[p]["texto"])
            p, guard = por_id[p]["pai"], guard + 1
        filhos = any(x["pai"] == it["id"] for x in por_id.values())
        out.append({"id": it["id"], "numero": it["numero"], "texto": it["texto"], "pai_texto": " ".join(cadeia), "tem_filhos": filhos})
    return out


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    pasta = Path(sys.argv[1]).resolve()
    meta = json.loads((pasta / "meta.json").read_text(encoding="utf-8"))
    edital = json.loads((RAIZ / "conteudo" / "concursos" / meta["concursoSlug"] / "02-json" / "edital.json").read_text(encoding="utf-8"))
    qs = json.loads((pasta / "02-json" / "questoes.json").read_text(encoding="utf-8"))
    dest = pasta / "02-json" / "classificacao.json"
    anterior = json.loads(dest.read_text(encoding="utf-8")) if dest.exists() else {"questoes": {}}
    man_p = pasta / "02-json" / "classificacao-manual.json"
    manual = json.loads(man_p.read_text(encoding="utf-8")) if man_p.exists() else {"metodo": None, "questoes": {}}
    ids_validos = {i["id"] for d in edital["disciplinas"] for i in d["itens"]}
    saida, linhas_csv, resumo = {}, [], Counter()

    for q in qs:
        c = q["classificacao"]
        ids = c.get("disciplinaIds") or ([c["disciplinaId"]] if c.get("disciplinaId") else [])
        ant = anterior["questoes"].get(q["id"])
        if ant and ant.get("status") == "confirmada":
            saida[q["id"]] = ant
            resumo["confirmada (preservada)"] += 1
            continue
        itens = itens_da_disciplina(edital, ids)
        n_q = str(q["origem"]["questaoNumero"])
        docs = [stems(i["texto"]) * 2 + stems(i["pai_texto"]) for i in itens]  # texto do item pesa o dobro do dos pais
        n = len(docs)
        df = Counter(t for d in docs for t in set(d))
        idf = {t: math.log((1 + n) / (1 + k)) + 1 for t, k in df.items()}
        vi = [vetor(d, idf) for d in docs]
        consulta = vetor(stems(q["enunciado"] + " " + " ".join(q["alternativas"])), idf)
        pont = sorted(((cos(consulta, v), k) for k, v in enumerate(vi)), reverse=True)
        top = [(s, itens[k]) for s, k in pont[:3]]
        s1 = top[0][0] if top else 0.0
        s2 = top[1][0] if len(top) > 1 else 0.0
        ok = s1 >= LIMIAR_SCORE and (s1 - s2) >= LIMIAR_MARGEM
        status = "sugerida" if ok else "indeterminada"
        man = manual["questoes"].get(n_q)
        if man:
            if man not in ids_validos or man.split(":")[0] not in ids:
                print(f"ERRO: manual Q{n_q} -> {man} não é item das disciplinas {ids}")
                return 1
            saida[q["id"]] = {"status": "sugerida", "metodo": manual["metodo"], "disciplinaIds": ids, "editalItemId": man,
                              "score": None, "margem": None,
                              "candidatos": [{"id": man, "score": None}] + [{"id": it["id"], "score": round(s, 4)} for s, it in top if it["id"] != man][:2],
                              "lexicalSugeriu": top[0][1]["id"] if top else None}
            resumo["sugerida (manual-ia)"] += 1
            linhas_csv.append([q["id"], q["origem"]["questaoNumero"], c["disciplina"], "manual-ia", "", "", man, " ".join(q["enunciado"].split())[-220:]])
            continue
        saida[q["id"]] = {
            "status": status, "metodo": "tfidf-lexical-v1", "disciplinaIds": ids,
            "editalItemId": top[0][1]["id"] if ok else None,
            "score": round(s1, 4), "margem": round(s1 - s2, 4),
            "candidatos": [{"id": it["id"], "score": round(s, 4)} for s, it in top],
        }
        resumo[status] += 1
        linhas_csv.append([q["id"], q["origem"]["questaoNumero"], c["disciplina"], status, round(s1, 3), round(s1 - s2, 3),
                           " | ".join(f"{it['numero']} {it['texto'][:70]}" for _, it in top),
                           " ".join(q["enunciado"].split())[-220:]])

    dest.write_text(json.dumps({"schemaVersion": "1.0", "prova": meta["slug"], "edital": meta["concursoSlug"],
                                "limiares": {"score": LIMIAR_SCORE, "margem": LIMIAR_MARGEM}, "questoes": saida},
                               ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with open(pasta / "02-json" / "revisao-classificacao.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["questaoId", "numero", "disciplina", "status", "score", "margem", "candidatos (numero texto)", "fim do enunciado"])
        w.writerows(linhas_csv)
    print(f"{meta['slug']}: {dict(resumo)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
