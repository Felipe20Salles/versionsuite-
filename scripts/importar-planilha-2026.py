#!/usr/bin/env python
"""Carga única da planilha 2026.xlsx (aba "Análise de viabilidade") para as demandas do Plano.

Uso: python scripts/importar-planilha-2026.py <caminho.xlsx> <workspace_id> > carga.sql
Rodar o SQL gerado no SQL Editor como postgres. Pode ser rodado de novo sem duplicar
(deduplica por workspace_id + pai_redmine). Resumo no stderr. carga.sql não vai para o git.
"""
import sys, re, uuid, json, datetime, collections
import openpyxl

TECNICA = {"Não temos nenhuma limitação": 3, "Temos um pouco de limitação": 2,
           "Somos bastante limitados": 1, "Somos totalmente limitados": 0}
ESTRATEGIA = {"Nenhuma estratégia envolvida": 0, "Pouca estratégia envolvida": 1,
              "Bastante estratégia envolvida": 2, "Totalmente estratégico": 3}
VALOR = {"Não há impacto": 0, "Baixo impacto": 1, "Médio impacto": 2, "Alto impacto": 3}
CLIENTES = {"Pouco ou baixo": 0, "Médio": 1, "Alto": 2, "Muito alto": 3}
SITUACAO = {"AGUARDANDO ANÁLISE": "triagem", "AGUARDANDO COMITÊ": "pauta", "APROVADO": "plano",
            "STAND BY": "adiada", "NÃO APROVADO": "descartada"}
# colunas de horas: 23 Análise, 24 Desenvolvimento, 25 Teste, 26 Implantação
PAPEL_HORAS = {23: "Analista", 24: "Desenvolvedor", 25: "Testador", 26: "Analista"}
PAPEIS = ["Analista", "Desenvolvedor", "Testador"]


def horas(v):
    if v in (None, ""):
        return 0.0
    if isinstance(v, datetime.timedelta):
        return round(v.total_seconds() / 3600, 1)
    if isinstance(v, (int, float)):
        return round(v * 24, 1)
    return 0.0


def lit(v):
    """Literal SQL de texto (aspas simples dobradas) ou null."""
    if v is None or v == "":
        return "null"
    return "'" + str(v).replace("\x00", "").replace("'", "''") + "'"


def num(v):
    return "null" if v is None else repr(v)


def texto_id(v):
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


def main():
    if len(sys.argv) != 3:
        sys.exit("Uso: importar-planilha-2026.py <caminho.xlsx> <workspace_id>")
    caminho = sys.argv[1]
    try:
        ws_id = str(uuid.UUID(sys.argv[2]))
    except ValueError:
        sys.exit("workspace_id inválido (esperado UUID): " + sys.argv[2])

    wb = openpyxl.load_workbook(caminho, data_only=True, read_only=False)
    ws = wb["Análise de viabilidade"]

    demandas = []
    for r in range(5, ws.max_row + 1):
        g = lambda c: ws.cell(r, c).value
        if not g(2):
            continue
        pai = texto_id(g(2))
        titulo = re.sub(r"^\[[^\]]*\]\s*-?\s*", "", str(g(3) or "")).strip() or pai
        solicitante = str(g(21) or "").split("|")[0].strip().title() or "Interno"
        posicao = g(16)
        posicao = posicao if isinstance(posicao, (int, float)) and not isinstance(posicao, bool) and posicao > 0 else None
        decidido = g(19)
        if isinstance(decidido, (datetime.datetime, datetime.date)):
            decidido = decidido.isoformat()
        else:
            decidido = None
        por_papel = collections.OrderedDict()
        for col, papel in PAPEL_HORAS.items():
            h = horas(g(col))
            if h > 0:
                por_papel[papel] = round(por_papel.get(papel, 0) + h, 1)
        demandas.append(dict(
            pai=pai, titulo=titulo, produto=g(5) or "WMS", solicitante=solicitante,
            crit=[TECNICA.get(g(6)), ESTRATEGIA.get(g(8)), VALOR.get(g(10)), CLIENTES.get(g(12))],
            posicao=posicao, obs=g(18), decidido=decidido,
            status=SITUACAO.get(g(20), "triagem"), horas=por_papel))

    out = []
    w = out.append
    w("-- Carga única da planilha 2026.xlsx (gerada por scripts/importar-planilha-2026.py)")
    w("-- Rodar como postgres no SQL Editor. Pode rodar de novo: não duplica (workspace_id + pai_redmine).")
    w("do $carga$")
    w("declare")
    w("  ws constant uuid := %s;" % lit(ws_id) + "")
    for p in PAPEIS:
        w("  p_%s uuid;" % p.lower())
    w("begin")
    for p in PAPEIS:
        w("  select id into p_%s from projeto_papeis where workspace_id = ws and nome = %s order by ordem, id limit 1;" % (p.lower(), lit(p)))
        w("  if p_%s is null then raise exception 'Papel \"%s\" não encontrado no workspace %%', ws; end if;" % (p.lower(), p))
    for d in demandas:
        hp = "'[]'::jsonb"
        if d["horas"]:
            partes = ["jsonb_build_object('papel_id', p_%s, 'horas', %s)" % (papel.lower(), num(h))
                      for papel, h in d["horas"].items()]
            hp = "jsonb_build_array(%s)" % ", ".join(partes)
        crit = "null" if all(c is None for c in d["crit"]) else \
            "array[%s]::smallint[]" % ", ".join("null" if c is None else str(c) for c in d["crit"])
        decidido = "null" if d["decidido"] is None else "%s::timestamptz" % lit(d["decidido"])
        w("  insert into projetos (workspace_id, titulo, status, crit, posicao, produto, solicitante,")
        w("      horas_papeis, horas_origem, horas_redmine, decisao_obs, decidido_em, pai_redmine, sugerido_por)")
        w("  select ws, %s, %s, %s, %s, %s, %s," % (lit(d["titulo"]), lit(d["status"]), crit, num(d["posicao"]), lit(d["produto"]), lit(d["solicitante"])))
        w("      h.v, 'redmine', h.v, %s, %s, %s, null" % (lit(d["obs"]), decidido, lit(d["pai"])))
        w("  from (select %s as v) h" % hp)
        w("  where not exists (select 1 from projetos x where x.workspace_id = ws and x.pai_redmine = %s)" % lit(d["pai"]))
        w("  on conflict do nothing;")
    w("end;")
    w("$carga$;")
    sys.stdout.buffer.write(("\n".join(out) + "\n").encode("utf-8"))

    cont = collections.Counter(d["status"] for d in demandas)
    h_plano = sum(sum(d["horas"].values()) for d in demandas if d["status"] == "plano")
    print("%d demandas · triagem %d · pauta %d · plano %d · adiada %d · descartada %d · %dh no plano" % (
        len(demandas), cont["triagem"], cont["pauta"], cont["plano"], cont["adiada"], cont["descartada"],
        round(h_plano)), file=sys.stderr)


if __name__ == "__main__":
    main()
