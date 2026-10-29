const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../projetos-core.js');

test('vinculoPorPai', () => {
  const projetos = [
    { id: 'p1', pai_redmine: '500', status: 'descartada' },
    { id: 'p2', pai_redmine: '500', status: 'plano' },
    { id: 'p3', pai_redmine: '600', status: 'triagem' },
  ];
  assert.equal(C.vinculoPorPai({ paiRedmine: '500' }, projetos), 'p2');
  assert.equal(C.vinculoPorPai({ paiRedmine: 500 }, projetos), 'p2');
  assert.equal(C.vinculoPorPai({ paiRedmine: '600' }, projetos), null);
  assert.equal(C.vinculoPorPai({ paiRedmine: '500', projetoId: 'px' }, projetos), null);
  assert.equal(C.vinculoPorPai({ paiRedmine: '500', projetoDesvinculado: true }, projetos), null);
  assert.equal(C.vinculoPorPai({ paiRedmine: '' }, projetos), null);
});

test('dataLocal: data no fuso da máquina, formato AAAA-MM-DD', () => {
  const ts = '2026-01-05T12:00:00Z';
  const d = new Date(ts);
  const esperado = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  assert.equal(C.dataLocal(ts), esperado);
});

test('configPlano: sem linha usa o padrão; linha sobrepõe só o que veio', () => {
  const c = C.configPlano(null);
  assert.equal(c.criterios.length, 4);
  assert.deepEqual(c.criterios.map(x => x.peso), [1, 2, 2, 3]);
  assert.deepEqual(c.criterios[0].opcoes, ['Bloqueada', 'Difícil', 'Possível', 'Simples']);
  assert.deepEqual(c.faixas_prioridade, { baixa_ate: 8, media_ate: 16 });
  assert.deepEqual(c.faixas_esforco, { pequeno_ate: 40, medio_ate: 120 });
  const d = C.configPlano({ faixas_esforco: { pequeno_ate: 20, medio_ate: 80 }, criterios: null });
  assert.equal(d.faixas_esforco.pequeno_ate, 20);
  assert.equal(d.criterios.length, 4);
  c.criterios[0].peso = 99;
  assert.equal(C.configPlano(null).criterios[0].peso, 1);
});

test('prioridade: soma pontos × peso; nula se faltar critério', () => {
  const cr = C.PLANO_PADRAO.criterios;
  assert.equal(C.prioridade([3, 3, 3, 3], cr), 24);
  assert.equal(C.prioridade([3, 2, 2, 0], cr), 11);
  assert.equal(C.prioridade([0, 0, 0, 0], cr), 0);
  assert.equal(C.prioridade([3, null, 2, 0], cr), null);
  assert.equal(C.prioridade(null, cr), null);
});

test('faixaPrioridade e faixaEsforco nas bordas', () => {
  const fp = C.PLANO_PADRAO.faixas_prioridade, fe = C.PLANO_PADRAO.faixas_esforco;
  assert.equal(C.faixaPrioridade(8, fp), 'baixa');
  assert.equal(C.faixaPrioridade(9, fp), 'media');
  assert.equal(C.faixaPrioridade(16, fp), 'media');
  assert.equal(C.faixaPrioridade(17, fp), 'alta');
  assert.equal(C.faixaPrioridade(null, fp), null);
  assert.equal(C.faixaEsforco(0, fe), 'sem');
  assert.equal(C.faixaEsforco(40, fe), 'pequeno');
  assert.equal(C.faixaEsforco(40.5, fe), 'medio');
  assert.equal(C.faixaEsforco(120, fe), 'medio');
  assert.equal(C.faixaEsforco(121, fe), 'grande');
});

const PAPEIS = [
  { id: 'an', nome: 'Analista', externo: false, ordem: 1 },
  { id: 'cl', nome: 'Cliente', externo: true, ordem: 2 },
  { id: 'de', nome: 'Desenvolvedor', externo: false, ordem: 3 },
  { id: 'te', nome: 'Testador', externo: false, ordem: 4, ativo: false },
];

test('papeisDoPlano: sem externo nem inativo, por ordem', () => {
  assert.deepEqual(C.papeisDoPlano(PAPEIS).map(p => p.id), ['an', 'de']);
});

test('horasTotal ignora externo; inativo e desconhecido contam', () => {
  const h = [{ papel_id: 'an', horas: 10 }, { papel_id: 'cl', horas: 50 }, { papel_id: 'te', horas: 4 }, { papel_id: 'xx', horas: 1 }];
  assert.equal(C.horasTotal(h, PAPEIS), 15);
  assert.equal(C.horasTotal(null, PAPEIS), 0);
  assert.equal(C.horasDoPapel(h, 'an'), 10);
  assert.equal(C.horasDoPapel(h, 'de'), 0);
});

test('definirHoras: imutável, arredonda e não aceita negativo', () => {
  const h = [{ papel_id: 'an', horas: 10 }];
  const n = C.definirHoras(h, 'de', 7.26);
  assert.deepEqual(n, [{ papel_id: 'an', horas: 10 }, { papel_id: 'de', horas: 7.3 }]);
  assert.deepEqual(h, [{ papel_id: 'an', horas: 10 }]);
  assert.deepEqual(C.definirHoras(h, 'an', -3), [{ papel_id: 'an', horas: 0 }]);
  assert.deepEqual(C.definirHoras(h, 'an', 'x'), [{ papel_id: 'an', horas: 0 }]);
});

test('situacaoEstimativa olha só os papéis do plano', () => {
  assert.equal(C.situacaoEstimativa([], PAPEIS), 'sem');
  assert.equal(C.situacaoEstimativa([{ papel_id: 'an', horas: 5 }], PAPEIS), 'parcial');
  assert.equal(C.situacaoEstimativa([{ papel_id: 'an', horas: 5 }, { papel_id: 'de', horas: 1 }], PAPEIS), 'completa');
});

test('podeMudarStatus e statusAposCriterios', () => {
  assert.equal(C.podeMudarStatus('pauta', 'plano'), true);
  assert.equal(C.podeMudarStatus('adiada', 'descartada'), true);
  assert.equal(C.podeMudarStatus('plano', 'entregue'), true);
  assert.equal(C.podeMudarStatus('plano', 'adiada'), true);
  assert.equal(C.podeMudarStatus('entregue', 'plano'), true);
  assert.equal(C.podeMudarStatus('triagem', 'plano'), false);
  assert.equal(C.podeMudarStatus('descartada', 'plano'), false);
  assert.equal(C.podeMudarStatus('pauta', 'pauta'), false);
  assert.equal(C.statusAposCriterios('triagem', [1, 2, 3, 0]), 'pauta');
  assert.equal(C.statusAposCriterios('triagem', [1, null, 3, 0]), 'triagem');
  assert.equal(C.statusAposCriterios('plano', [1, 2, 3, 0]), 'plano');
});

test('compararPlano: posição, prioridade, pai do Redmine numérico, criação', () => {
  const itens = [
    { id: 'a', posicao: null, prioridade: 20, criado_em: '2026-01-01' },
    { id: 'b', posicao: 2, prioridade: 5, criado_em: '2026-01-01' },
    { id: 'c', posicao: 1, prioridade: 5, criado_em: '2026-01-01' },
    { id: 'd', posicao: 2, prioridade: 9, criado_em: '2026-01-01' },
    { id: 'e', posicao: null, prioridade: 20, pai_redmine: '900', criado_em: '2026-01-01' },
    { id: 'f', posicao: null, prioridade: 20, pai_redmine: '1000', criado_em: '2026-01-01' },
  ];
  assert.deepEqual(itens.sort(C.compararPlano).map(x => x.id), ['c', 'd', 'b', 'e', 'f', 'a']);
});

test('tituloPlano pelos anos das versões ativas e planejadas', () => {
  assert.equal(C.tituloPlano([{ data: '2026-11-10', ativa: true }, { data: '2027-03-01', planejada: true }]), 'Plano 2026/27');
  assert.equal(C.tituloPlano([{ data: '2026-11-10', ativa: true }]), 'Plano 2026');
  assert.equal(C.tituloPlano([{ data: '2025-01-01', ativa: false }]), 'Plano');
});

test('aceitaOS com os status novos', () => {
  assert.equal(C.aceitaOS('plano'), true);
  assert.equal(C.aceitaOS('entregue'), true);
  ['triagem', 'pauta', 'adiada', 'descartada'].forEach(s => assert.equal(C.aceitaOS(s), false));
});

test('STATUS_ROTULO: rótulos exatos', () => {
  assert.deepEqual(C.STATUS_ROTULO, {
    triagem: 'Em triagem', pauta: 'Em pauta', plano: 'No plano',
    adiada: 'Adiada', descartada: 'Descartada', entregue: 'Entregue'
  });
});

const V = (id, cap, extra) => Object.assign({ id, capacidade: cap, data: '2026-1' + id.slice(1) + '-01', planejada: true }, extra);
const D = (id, h, pos, extra) => Object.assign({ id, status: 'plano', posicao: pos, prioridade: null, criado_em: '2026-01-01', horas: h }, extra);
const R0 = { total: {}, porVersao: {} };

test('distribuirPlano: enche em ordem e divide a demanda que não cabe', () => {
  const r = C.distribuirPlano([D('d1', 6, 1), D('d2', 6, 2), D('d3', 10, 3)], [V('v1', 10), V('v2', 10)], R0);
  assert.deepEqual(r.versoes[0].itens.map(i => [i.id, i.horas]), [['d1', 6], ['d2', 4]]);
  assert.deepEqual(r.versoes[1].itens.map(i => [i.id, i.horas]), [['d2', 2], ['d3', 8]]);
  assert.deepEqual(r.semVersao.map(i => [i.id, i.horas]), [['d3', 2]]);
  assert.deepEqual(r.previstas.d2, ['v1', 'v2']);
  assert.deepEqual(r.previstas.d3, ['v2', null]);
  assert.equal(r.versoes[0].itens[1].partes, 2);
  assert.equal(r.versoes[1].itens[0].parte, 1);
  assert.equal(r.versoes[0].livres, 0);
});

test('distribuirPlano: só status plano; sem horas vai para semHoras; encerrada fica fora', () => {
  const r = C.distribuirPlano(
    [D('d1', 5, 1), D('d2', 0, 2), D('d3', 5, 3, { status: 'pauta' })],
    [V('v1', 20), { id: 'vx', capacidade: 99, data: '2026-01-01', ativa: false, planejada: false }], R0);
  assert.equal(r.versoes.length, 1);
  assert.deepEqual(r.versoes[0].itens.map(i => i.id), ['d1']);
  assert.deepEqual(r.semHoras, ['d2']);
  assert.equal(r.versoes[0].livres, 15);
});

test('distribuirPlano: ativa antes da planejada e desconta o realizado da versão', () => {
  const vers = [V('v2', 10), V('v1', 20, { ativa: true, planejada: false, data: '2026-12-31' })];
  const real = { total: { d1: 5 }, porVersao: { v1: { d1: 5, dx: 3 } } };
  const r = C.distribuirPlano([D('d1', 10, 1), D('d2', 20, 2)], vers, real);
  assert.equal(r.versoes[0].id, 'v1');
  assert.equal(r.versoes[0].realizado, 8);
  assert.deepEqual(r.versoes[0].itens.map(i => [i.id, i.horas, i.realizado]), [['d1', 5, 5], ['d2', 7, 0]]);
  assert.equal(r.versoes[0].usado, 20);
  assert.deepEqual(r.versoes[1].itens.map(i => [i.id, i.horas]), [['d2', 10]]);
  assert.deepEqual(r.semVersao.map(i => [i.id, i.horas]), [['d2', 3]]);
});

test('distribuirPlano: realizado acima do estimado ocupa 0 e não fica negativo', () => {
  const vers = [V('v1', 10, { ativa: true, planejada: false })];
  const r = C.distribuirPlano([D('d1', 4, 1), D('d2', 3, 2)], vers, { total: { d1: 6 }, porVersao: { v1: { d1: 6 } } });
  assert.deepEqual(r.versoes[0].itens.map(i => [i.id, i.horas, i.realizado]), [['d1', 0, 6], ['d2', 3, 0]]);
  assert.equal(r.versoes[0].livres, 1);
});

test('distribuirPlano: versão com capacidade 0 passa tudo adiante', () => {
  const r = C.distribuirPlano([D('d1', 5, 1)], [V('v1', 0), V('v2', 10)], R0);
  assert.deepEqual(r.versoes[0].itens, []);
  assert.equal(r.versoes[0].livres, 0);
  assert.deepEqual(r.previstas.d1, ['v2']);
});

test('distribuirPlano: sem posição ordena por prioridade', () => {
  const r = C.distribuirPlano([D('a', 5, null, { prioridade: 3 }), D('b', 5, null, { prioridade: 20 })], [V('v1', 5)], R0);
  assert.deepEqual(r.versoes[0].itens.map(i => i.id), ['b']);
});

test('restantePorPapel e repartirPorPapel', () => {
  assert.deepEqual(C.restantePorPapel([{ papel_id: 'an', horas: 8 }, { papel_id: 'de', horas: 4 }], { an: 2, de: 6 }, ['an', 'de']), { an: 6, de: 0 });
  const out = C.repartirPorPapel(
    [{ id: 'd1', horas: 10, realizado: 2 }, { id: 'd2', horas: 4, realizado: 0 }],
    { d1: { an: 6, de: 4 }, d2: { an: 0, de: 0 } },
    { d1: { an: 2 } },
    ['an', 'de'], { an: 5, de: 10 });
  assert.equal(out[0].papelId, 'an');
  assert.deepEqual(out[0].itens, [{ id: 'd1', horas: 6, realizado: 2 }]);
  assert.equal(out[0].usado, 8);
  assert.equal(out[0].acima, 3);
  assert.equal(out[0].livres, 0);
  assert.deepEqual(out[1].itens, [{ id: 'd1', horas: 4, realizado: 0 }]);
  assert.equal(out[1].acima, 0);
  assert.equal(out[1].livres, 6);
});

test('moverPara, renumerar e indiceDeSoltura', () => {
  assert.deepEqual(C.moverPara(['a', 'b', 'c', 'd'], 'd', 1), ['a', 'd', 'b', 'c']);
  assert.deepEqual(C.renumerar(['a', 'd', 'b', 'c'], { a: 1, b: 2, c: 3, d: 4 }), [{ id: 'd', posicao: 2 }, { id: 'b', posicao: 3 }, { id: 'c', posicao: 4 }]);
  const ordem = ['a', 'b', 'c', 'd', 'e'];
  assert.equal(C.indiceDeSoltura(ordem, 'e', ['b', 'c'], ['a'], 0), 1);
  assert.equal(C.indiceDeSoltura(ordem, 'e', ['b', 'c'], ['a'], 1), 3);
  assert.equal(C.indiceDeSoltura(ordem, 'a', ['c', 'd'], ['a', 'b'], 0.6), 2);
  assert.equal(C.indiceDeSoltura(ordem, 'x', [], ['a', 'b'], 0.5), 2);
  assert.equal(C.indiceDeSoltura(ordem, 'x', [], [], 0.5), 0);
  assert.equal(C.indiceDeSoltura(ordem, 'b', ['c'], ['a'], null), 4);
});

test('repartirTotal mantém a proporção em inteiros', () => {
  assert.deepEqual(C.repartirTotal({ an: 50, de: 80, te: 30 }, 200), { an: 63, de: 100, te: 37 });
  assert.deepEqual(C.repartirTotal({ an: 0, de: 0 }, 11), { an: 6, de: 5 });
  assert.equal(Object.values(C.repartirTotal({ an: 1, de: 1, te: 1 }, 10)).reduce((a, b) => a + b), 10);
});

test('distribuirPlano: sem estimativa mas com realizado na ativa gera item e fica em semHoras', () => {
  const vers = [V('v1', 10, { ativa: true, planejada: false })];
  const r = C.distribuirPlano([D('a', 0, 1), D('b', 5, 2)], vers, { total: { a: 4 }, porVersao: { v1: { a: 4 } } });
  assert.deepEqual(r.versoes[0].itens.map(i => [i.id, i.horas, i.realizado]), [['a', 0, 4], ['b', 5, 0]]);
  assert.deepEqual(r.semHoras, ['a']);
  assert.equal(r.versoes[0].usado, 9);
  assert.equal(r.versoes[0].livres, 1);
});

// ---- Task 3: realizado, Redmine e resumo plano x realizado ----
const PP3 = [
  { id: 'an', externo: false, ordem: 1, tipos_atividade: ['9'], trackers: ['Análise', '4'] },
  { id: 'de', externo: false, ordem: 2, tipos_atividade: ['10'], trackers: ['Desenvolvimento'] },
  { id: 'cl', externo: true, ordem: 3, tipos_atividade: [], trackers: [] },
];

test('agregarRealizado: tipo como número ou string; sem tipo vai para o padrão', () => {
  const r = C.agregarRealizado([
    { projeto_id: 'd1', versao_id: 'v1', activity_type_id: 9, horas: 2 },
    { projeto_id: 'd1', versao_id: 'v1', activity_type_id: '10', horas: 3 },
    { projeto_id: 'd1', versao_id: null, activity_type_id: null, horas: 1 },
    { projeto_id: 'd2', versao_id: 'v1', activity_type_id: '77', horas: '4' },
  ], PP3, 'de');
  assert.deepEqual(r.total, { d1: 6, d2: 4 });
  assert.deepEqual(r.porVersao, { v1: { d1: 5, d2: 4 } });
  assert.deepEqual(r.porPapel.d1, { an: 2, de: 4 });
  assert.deepEqual(r.porVersaoPapel.v1.d1, { an: 2, de: 3 });
  assert.deepEqual(r.versaoPapel.v1, { an: 2, de: 7 });
});

test('papelPadrao cai no primeiro do plano quando não configurado', () => {
  assert.equal(C.papelPadrao(PP3, null), 'an');
  assert.equal(C.papelPadrao(PP3, 'cl'), 'an');
  assert.equal(C.papelPadrao(PP3, 'de'), 'de');
});

test('horasDoRedmine: tracker por nome ou id; sem mapa vai para o padrão', () => {
  const h = C.horasDoRedmine([
    { tracker: { id: 4, name: 'Outro nome' }, estimated_hours: 5 },
    { tracker: { id: 2, name: 'Desenvolvimento' }, estimated_hours: 10 },
    { tracker: { id: 3, name: 'QA' }, estimated_hours: 2 },
    { tracker: { id: 2, name: 'Desenvolvimento' }, estimated_hours: null },
  ], PP3, 'de');
  assert.deepEqual(h, [{ papel_id: 'an', horas: 5 }, { papel_id: 'de', horas: 12 }]);
});

test('camposSync respeita a origem', () => {
  const h = [{ papel_id: 'an', horas: 3 }];
  assert.deepEqual(C.camposSync({ horas_origem: 'redmine' }, h), { horas_redmine: h, horas_papeis: h });
  assert.deepEqual(C.camposSync({ horas_origem: 'vs' }, h), { horas_redmine: h });
});

test('resumoVersao: cumprimento, herdadas e precisão', () => {
  const real = { total: { d1: 12, d2: 3 }, porVersao: { v1: { d1: 10, d2: 3, d9: 50 } } };
  const r = C.resumoVersao('v1',
    [{ projeto_id: 'd1', horas_previstas: 10 }, { projeto_id: 'd2', horas_previstas: 8 }],
    [{ id: 'd1', status: 'entregue', horas: 10 }, { id: 'd2', status: 'plano', horas: 8 }], real);
  assert.deepEqual(r, { temLinhaBase: true, horasPrevistas: 18, horasRealizadas: 13, previstas: 2, entregues: 1,
    herdadas: ['d2'], estimadoEntregues: 10, realizadoEntregues: 12 });
  assert.equal(C.resumoVersao('v2', [], [], real).temLinhaBase, false);
});

test('capacidadeSugerida: média das 3 últimas encerradas', () => {
  const enc = [{ id: 'a', data: '2026-01-01' }, { id: 'b', data: '2026-02-01' }, { id: 'c', data: '2026-03-01' }, { id: 'd', data: '2026-04-01' }];
  const vp = { a: { an: 100 }, b: { an: 10, de: 30 }, c: { an: 20 }, d: { an: 30, de: 31 } };
  assert.deepEqual(C.capacidadeSugerida(enc, vp, ['an', 'de']), { an: 20, de: 20 });
  assert.deepEqual(C.capacidadeSugerida([], vp, ['an']), {});
});

test('configPlano: valores não numéricos caem no padrão', () => {
  const ok = (n) => ({ nome: n, pergunta: 'q', opcoes: ['a', 'b', 'c', 'd'], peso: 2 });
  const c = C.configPlano({
    criterios: [{ nome: 'A', pergunta: 'q', opcoes: ['a', 'b', 'c', 'd'], peso: '"><img>' }, ok('B'), ok('C'), ok('D')],
    faixas_prioridade: { baixa_ate: 'x', media_ate: 16 }
  });
  assert.equal(c.criterios[0].peso, 1);
  assert.equal(c.criterios[1].peso, 2);
  assert.equal(c.faixas_prioridade.baixa_ate, 8);
  assert.equal(c.faixas_prioridade.media_ate, 16);
  assert.equal(c.faixas_esforco.medio_ate, 120);
});
