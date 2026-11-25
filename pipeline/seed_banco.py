#!/usr/bin/env python3
"""Carrega o conteúdo (JSON no Git / máquina do autor) para o Postgres do Supabase. Idempotente.

Uso:
    python3 -I pipeline/seed_banco.py                      # padrão: só valida e mostra contagens (não toca em banco)
    DATABASE_URL=postgresql://... python3 -I pipeline/seed_banco.py --apply --confirmar-host <host>

Regras (CLAUDE.md):
  - O JSON é a fonte da verdade; o banco é cópia servida. Rodar de novo atualiza, nunca duplica.
  - Trava de segurança: --apply exige --confirmar-host igual ao host do DATABASE_URL (evita seed no banco errado).
  - Questão entra como está no JSON (direitos, revisão, status). Hoje as reais estão `pendente_juridico` e `rascunho`,
    logo NENHUMA é servida ao aluno. O banco recusa `ativa` sem liberação + revisão + gabarito.
  - O texto das questões reais não está no Git: este script só funciona onde os 02-json/questoes.json existem.
  - Usa psycopg (pip install -r pipeline/requirements-banco.txt) apenas com --apply.
"""
import argparse
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit

RAIZ = Path(__file__).resolve().parent.parent
CONCURSOS = RAIZ / "conteudo" / "concursos"
PROVAS = RAIZ / "conteudo" / "provas"
BANCAS = RAIZ / "conteudo" / "bancas"


def ler(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def upsert(tabela: str, pk: list[str], linha: dict) -> tuple[str, list]:
    cols = list(linha)
    marcas = ", ".join(f"%({c})s" for c in cols)
    sets = ", ".join(f"{c} = excluded.{c}" for c in cols if c not in pk)
    sql = f"insert into public.{tabela} ({', '.join(cols)}) values ({marcas}) on conflict ({', '.join(pk)}) do " + (f"update set {sets}" if sets else "nothing")
    return sql, [linha]


def montar() -> tuple[list[tuple[str, list]], dict, list[str]]:
    """Devolve (comandos em ordem, contagens, avisos). Cada comando é (sql, [parametros])."""
    cmds: list[tuple[str, list]] = []
    cont: dict[str, int] = {}
    avisos: list[str] = []

    def add(tabela, pk, linha):
        cmds.append(upsert(tabela, pk, linha))
        cont[tabela] = cont.get(tabela, 0) + 1

    # 1) concursos e editais
    concursos = {}
    for ed_p in sorted(CONCURSOS.glob("*/02-json/edital.json")):
        ed = ler(ed_p)
        c, pv = ed["concurso"], ed["prova"]
        slug = c["slug"]
        concursos[slug] = ed
        add("concurso", ["slug"], {"slug": slug, "orgao": c["orgao"], "uf": c["uf"], "banca": c["banca"], "cargo": c["cargo"], "edital": c["edital"], "ano": c["ano"],
                                   "vagas": c.get("vagas"), "total_questoes": pv["totalQuestoes"], "alternativas": pv["alternativas"],
                                   "pontos_por_questao": pv["pontosPorQuestao"], "nota_minima": pv.get("notaMinimaObjetiva"), "data_provavel": pv.get("dataProvavel")})
        for d in ed["disciplinas"]:
            add("disciplina", ["concurso_slug", "id"], {"concurso_slug": slug, "id": d["id"], "modulo": d["modulo"], "numero": d["numero"], "titulo_literal": d["tituloLiteral"],
                                                       "nome": d["nome"], "questoes": d["questoes"], "peso": d["peso"], "numeracao_itens": d.get("numeracaoItens"),
                                                       "bibliografia_bruta": d.get("bibliografiaBruta")})
        for g in ed.get("grupos", []):
            add("grupo_edital", ["concurso_slug", "nome"], {"concurso_slug": slug, "nome": g["nome"], "questoes": g["questoes"], "disciplinas": g["disciplinas"]})
        ordem = 0
        for d in ed["disciplinas"]:
            for it in d["itens"]:
                ordem += 1
                add("item_edital", ["concurso_slug", "id"], {"concurso_slug": slug, "id": it["id"], "disciplina_id": d["id"], "numero": it["numero"], "texto": it["texto"],
                                                           "pai": it["pai"], "pagina": it["pagina"], "ordem": ordem})

    # 2) perfis de banca (só estatísticas)
    for bp in sorted(BANCAS.glob("*.json")):
        b = ler(bp)
        add("banca_perfil", ["banca"], {"banca": b["banca"], "amostra": json.dumps(b["amostra"], ensure_ascii=False), "medidas": json.dumps(b["medidas"], ensure_ascii=False)})

    # 3) provas e questões (questões só onde o JSON existe localmente)
    for mp in sorted(PROVAS.glob("*/meta.json")):
        m = ler(mp)
        qj = mp.parent / "02-json" / "questoes.json"
        if m["concursoSlug"] not in concursos:
            avisos.append(f"{m['slug']}: concurso '{m['concursoSlug']}' sem edital.json; prova ignorada")
            continue
        add("prova", ["slug"], {"slug": m["slug"], "concurso_slug": m["concursoSlug"], "banca": m["concurso"]["banca"], "ano": m["concurso"]["ano"],
                                "caderno": m["caderno"]["rotulo"], "total_questoes": m["totalQuestoes"], "alternativas": m.get("alternativas", 5),
                                "gabarito_situacao": m["fonte"]["gabarito"].get("situacao", "definitivo"), "data_aplicacao": m.get("dataAplicacao"),
                                "vigencia_suspeita": bool(m.get("vigenciaSuspeita")), "pdf_sha256": m["fonte"]["prova"]["sha256"]})
        if not qj.exists():
            avisos.append(f"{m['slug']}: questoes.json ausente nesta máquina; só a prova foi carregada")
            continue
        itens_validos = {i["id"] for d in concursos[m["concursoSlug"]]["disciplinas"] for i in d["itens"]}
        for q in ler(qj):
            c = q["classificacao"]
            ids = c.get("disciplinaIds") or ([c["disciplinaId"]] if c.get("disciplinaId") else [])
            item = c.get("editalItemId")
            if item and item not in itens_validos:
                raise SystemExit(f"{q['id']}: item {item} não existe no edital de {m['concursoSlug']}")
            alvo = q["status"]
            linha = {"id": q["id"], "schema_version": q["schemaVersion"], "prova_slug": m["slug"], "concurso_slug": m["concursoSlug"],
                     "numero_na_prova": q["origem"].get("questaoNumero"), "tipo": q["tipo"], "enunciado": q["enunciado"], "texto_apoio": q.get("textoApoio"),
                     "alternativas": json.dumps(q["alternativas"], ensure_ascii=False), "anulada": q["anulada"], "peso": q.get("peso", 1),
                     "grupo_equivalencia": q.get("grupoEquivalencia"), "disciplina_ids": ids, "disciplina_nome": c["disciplina"],
                     "edital_item_id": item, "edital_item_trilha": c.get("editalItemTrilha", []), "assunto": c.get("assunto"),
                     "classificacao_status": c.get("classificacaoStatus"), "classificacao_metodo": c.get("classificacaoMetodo"), "classificacao_score": c.get("classificacaoScore"),
                     "origem_tipo": q["origem"]["tipo"], "banca": q.get("concurso", {}).get("banca"), "ano": q.get("concurso", {}).get("ano"),
                     "direitos_status": q["direitos"]["status"], "revisao_status": q["revisao"]["status"], "revisao_por": q["revisao"].get("por"),
                     "pendencias": q.get("pendencias", []), "gabarito_oficial": q.get("gabaritoOficial", False),
                     "imagens": json.dumps(q["imagens"], ensure_ascii=False) if q.get("imagens") else None,
                     "status": "rascunho"}  # sobe como rascunho; o status final só vale depois de o gabarito existir (gatilho do banco)
            add("questao", ["id"], linha)
            add("questao_gabarito", ["questao_id"], {"questao_id": q["id"], "correta": q.get("correta"), "comentario": q.get("comentario"),
                                                    "fundamentacao": json.dumps(q["fundamentacao"], ensure_ascii=False) if q.get("fundamentacao") else None})
            if alvo != "rascunho":
                cmds.append(("update public.questao set status = %(s)s where id = %(id)s", [{"s": alvo, "id": q["id"]}]))
    return cmds, cont, avisos


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="grava no banco (DATABASE_URL)")
    ap.add_argument("--confirmar-host", help="host esperado do DATABASE_URL; obrigatório com --apply")
    a = ap.parse_args()
    cmds, cont, avisos = montar()
    print("A carregar:", ", ".join(f"{t}={n}" for t, n in cont.items()))
    for av in avisos:
        print("AVISO:", av)
    if not a.apply:
        print("(simulação: nada foi gravado; use --apply para gravar)")
        return 0
    import os

    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERRO: defina DATABASE_URL")
        return 2
    host = urlsplit(url).hostname
    if a.confirmar_host != host:
        print(f"ERRO: --confirmar-host deve ser exatamente '{host}' (host do DATABASE_URL). Nada foi gravado.")
        return 2
    import psycopg

    with psycopg.connect(url) as conn:
        with conn.transaction():
            for sql, params in cmds:
                conn.execute(sql, params[0])
    print(f"OK: {len(cmds)} comandos aplicados em {host} (transação única).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
