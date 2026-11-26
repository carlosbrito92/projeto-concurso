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
import urllib.error
from pathlib import Path
from urllib.parse import urlsplit

RAIZ = Path(__file__).resolve().parent.parent
CONCURSOS = RAIZ / "conteudo" / "concursos"
PROVAS = RAIZ / "conteudo" / "provas"
BANCAS = RAIZ / "conteudo" / "bancas"


def ler(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


JSONB = {"amostra", "medidas", "alternativas", "imagens", "fundamentacao", "nota_minima_por_modulo"}  # colunas jsonb (no psycopg vão como texto JSON)


def sql_upsert(tabela: str, pk: list[str], linha: dict) -> tuple[str, dict]:
    cols = list(linha)
    marcas = ", ".join(f"%({c})s" for c in cols)
    # Questão retirada pelo administrador (status 'inativa') nunca volta por recarga de conteúdo.
    sets = ", ".join((f"status = case when public.{tabela}.status = 'inativa' then 'inativa' else excluded.status end" if (tabela == "questao" and c == "status") else f"{c} = excluded.{c}")
                     for c in cols if c not in pk)
    sql = f"insert into public.{tabela} ({', '.join(cols)}) values ({marcas}) on conflict ({', '.join(pk)}) do " + (f"update set {sets}" if sets else "nothing")
    params = {c: (json.dumps(v, ensure_ascii=False) if c in JSONB and isinstance(v, (dict, list)) else v) for c, v in linha.items()}
    return sql, params


def montar() -> tuple[list[dict], dict, list[str]]:
    """Devolve (operações em ordem, contagens, avisos). Operação: {"t","pk","linha"} (upsert) ou {"status","id"}."""
    cmds: list[dict] = []
    cont: dict[str, int] = {}
    avisos: list[str] = []

    def add(tabela, pk, linha):
        cmds.append({"t": tabela, "pk": pk, "linha": linha})
        cont[tabela] = cont.get(tabela, 0) + 1

    # 1) concursos e editais
    concursos = {}
    for ed_p in sorted(CONCURSOS.glob("*/02-json/edital.json")):
        ed = ler(ed_p)
        c, pv = ed["concurso"], ed["prova"]
        slug = c["slug"]
        concursos[slug] = ed
        add("concurso", ["slug"], {"slug": slug, "orgao": c["orgao"], "uf": c["uf"], "area": c.get("area", "outras"), "banca": c["banca"], "cargo": c["cargo"], "edital": c["edital"], "ano": c["ano"],
                                   "vagas": c.get("vagas"), "total_questoes": pv["totalQuestoes"], "alternativas": pv["alternativas"],
                                   "pontos_por_questao": pv["pontosPorQuestao"], "pontos_por_erro": pv.get("pontosPorErro", 0), "nota_minima": pv.get("notaMinimaObjetiva"),
                                   "nota_minima_por_modulo": pv.get("notaMinimaPorModulo"), "data_provavel": pv.get("dataProvavel")})
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
        add("banca_perfil", ["banca"], {"banca": b["banca"], "amostra": b["amostra"], "medidas": b["medidas"]})

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
                     "alternativas": q["alternativas"], "anulada": q["anulada"], "peso": q.get("peso", 1),
                     "grupo_equivalencia": q.get("grupoEquivalencia"), "disciplina_ids": ids, "disciplina_nome": c["disciplina"],
                     "edital_item_id": item, "edital_item_trilha": c.get("editalItemTrilha", []), "assunto": c.get("assunto"),
                     "classificacao_status": c.get("classificacaoStatus"), "classificacao_metodo": c.get("classificacaoMetodo"), "classificacao_score": c.get("classificacaoScore"),
                     "origem_tipo": q["origem"]["tipo"], "banca": q.get("concurso", {}).get("banca"), "ano": q.get("concurso", {}).get("ano"),
                     "direitos_status": q["direitos"]["status"], "revisao_status": q["revisao"]["status"], "revisao_por": q["revisao"].get("por"),
                     "pendencias": q.get("pendencias", []), "gabarito_oficial": q.get("gabaritoOficial", False),
                     "imagens": q["imagens"] if q.get("imagens") else None,
                     "status": "rascunho"}  # sobe como rascunho; o status final só vale depois de o gabarito existir (gatilho do banco)
            add("questao", ["id"], linha)
            add("questao_gabarito", ["questao_id"], {"questao_id": q["id"], "correta": q.get("correta"), "comentario": q.get("comentario"),
                                                    "fundamentacao": q["fundamentacao"] if q.get("fundamentacao") else None})
            if alvo != "rascunho":
                cmds.append({"status": alvo, "id": q["id"]})
    return cmds, cont, avisos


def aplicar_rest(cmds: list[dict], base: str, chave: str) -> None:
    """Grava via PostgREST (chave secreta ignora RLS). Não é transacional: é idempotente, então basta rodar de novo."""
    import urllib.request

    def req(metodo: str, caminho: str, corpo, extra: dict | None = None):
        h = {"apikey": chave, "Content-Type": "application/json", **(extra or {})}
        r = urllib.request.Request(f"{base}/rest/v1/{caminho}", data=json.dumps(corpo, ensure_ascii=False).encode("utf-8"), method=metodo, headers=h)
        try:
            with urllib.request.urlopen(r, timeout=120) as resp:
                resp.read()
        except urllib.error.HTTPError as e:
            raise SystemExit(f"ERRO {e.code} em {metodo} {caminho}: {e.read().decode('utf-8', 'replace')[:500]}")

    # agrupa linhas consecutivas da mesma tabela (a ordem de dependência já vem de montar())
    lote: list[dict] = []
    tab, pk = None, None

    def descarrega():
        nonlocal lote
        for k in range(0, len(lote), 100):
            req("POST", f"{tab}?on_conflict={','.join(pk)}", lote[k:k + 100], {"Prefer": "resolution=merge-duplicates,return=minimal"})
        if lote:
            print(f"  {tab}: {len(lote)}")
        lote = []

    # Questões retiradas pelo administrador (status 'inativa') nunca voltam por recarga de conteúdo.
    inativas = set()
    for k in range(0, 10**6, 1000):
        r = urllib.request.Request(f"{base}/rest/v1/questao?select=id&status=eq.inativa&order=id&limit=1000&offset={k}", headers={"apikey": chave})
        with urllib.request.urlopen(r, timeout=60) as resp:
            lote_ids = [x["id"] for x in json.loads(resp.read())]
        inativas.update(lote_ids)
        if len(lote_ids) < 1000:
            break
    if inativas:
        print(f"  preservando {len(inativas)} questão(ões) retirada(s) pelo administrador")

    status: dict[str, list[str]] = {}
    for c in cmds:
        if "status" in c:
            if c["id"] not in inativas:
                status.setdefault(c["status"], []).append(c["id"])
            continue
        if c["t"] != tab:
            descarrega()
            tab, pk = c["t"], c["pk"]
        if c["t"] == "questao" and c["linha"]["id"] in inativas:
            c = {**c, "linha": {**c["linha"], "status": "inativa"}}
        lote.append(c["linha"])
    descarrega()
    for alvo, ids in status.items():  # só depois de os gabaritos existirem (gatilho do banco)
        for k in range(0, len(ids), 50):
            parte = ",".join(f'"{i}"' for i in ids[k:k + 50])
            req("PATCH", f"questao?id=in.({parte})", {"status": alvo}, {"Prefer": "return=minimal"})
        print(f"  questao -> status {alvo}: {len(ids)}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="grava no banco (DATABASE_URL)")
    ap.add_argument("--rest", action="store_true", help="com --apply: grava pela API REST (SUPABASE_URL + SUPABASE_SECRET_KEY) em vez de psycopg")
    ap.add_argument("--confirmar-host", help="host esperado do DATABASE_URL/SUPABASE_URL; obrigatório com --apply")
    a = ap.parse_args()
    cmds, cont, avisos = montar()
    print("A carregar:", ", ".join(f"{t}={n}" for t, n in cont.items()))
    for av in avisos:
        print("AVISO:", av)
    if not a.apply:
        print("(simulação: nada foi gravado; use --apply para gravar)")
        return 0
    import os

    if a.rest:
        base = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
        chave = os.environ.get("SUPABASE_SECRET_KEY")
        if not base or not chave:
            print("ERRO: defina SUPABASE_URL e SUPABASE_SECRET_KEY")
            return 2
        host = urlsplit(base).hostname
        if a.confirmar_host != host:
            print(f"ERRO: --confirmar-host deve ser exatamente '{host}' (host do SUPABASE_URL). Nada foi gravado.")
            return 2
        aplicar_rest(cmds, base, chave)
        print(f"OK: {len(cmds)} operações aplicadas em {host} (REST; idempotente, repita se algo falhar).")
        return 0

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
            for c in cmds:
                if "status" in c:
                    conn.execute("update public.questao set status = %(s)s where id = %(id)s and status <> 'inativa'", {"s": c["status"], "id": c["id"]})
                else:
                    sql, params = sql_upsert(c["t"], c["pk"], c["linha"])
                    conn.execute(sql, params)
    print(f"OK: {len(cmds)} comandos aplicados em {host} (transação única).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
