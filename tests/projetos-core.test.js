const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../projetos-core.js');

test('tamanhoPorHoras: faixas', () => {
  assert.equal(C.tamanhoPorHoras(0), null);
  assert.equal(C.tamanhoPorHoras(null), null);
  assert.equal(C.tamanhoPorHoras(20), 'P');
  assert.equal(C.tamanhoPorHoras(20.5), 'M');
  assert.equal(C.tamanhoPorHoras(80), 'M');
  assert.equal(C.tamanhoPorHoras(200), 'G');
  assert.equal(C.tamanhoPorHoras(201), 'GG');
});

test('horasEsforco: etapas > total > tamanho', () => {
  const p = { esforco_total_h: 30, esforco_tamanho: 'GG' };
  assert.deepEqual(C.horasEsforco(p, [{ horas_estimadas: 15 }, { horas_estimadas: '35' }]), { horas: 50, origem: 'etapas' });
  assert.deepEqual(C.horasEsforco(p, [{ horas_estimadas: 0 }]), { horas: 30, origem: 'total' });
  assert.deepEqual(C.horasEsforco({ esforco_tamanho: 'G' }, []), { horas: null, origem: 'tamanho' });
  assert.deepEqual(C.horasEsforco({}, []), { horas: null, origem: null });
});

test('calcPrioridade: valor ÷ fator com 1 casa', () => {
  const p = { nota_impacto: 5, nota_urgencia: 4, nota_alinhamento: 3, esforco_total_h: 50 };
  assert.deepEqual(C.calcPrioridade(p, []), { valor: 12, horas: 50, tamanho: 'M', fator: 3, prioridade: 4 });
  const q = { nota_impacto: 2, nota_urgencia: 2, nota_alinhamento: 1, esforco_tamanho: 'G' };
  assert.equal(C.calcPrioridade(q, []).prioridade, 0.7);
});

test('calcPrioridade: nula sem as 3 notas ou sem esforço', () => {
  assert.equal(C.calcPrioridade({ nota_impacto: 5, nota_urgencia: 5, esforco_total_h: 10 }, []).prioridade, null);
  assert.equal(C.calcPrioridade({ nota_impacto: 5, nota_urgencia: 5, nota_alinhamento: 5 }, []).prioridade, null);
  assert.equal(C.calcPrioridade({ nota_impacto: 5, nota_urgencia: 5, nota_alinhamento: 5 }, []).valor, 15);
});

test('compararBacklog: legal primeiro, depois prioridade, nulas no fim, empate por criação', () => {
  const itens = [
    { id: 'a', prioridade: 2, criado_em: '2026-01-02' },
    { id: 'b', prioridade: null, criado_em: '2026-01-01' },
    { id: 'c', prioridade: 0.5, legal: true, criado_em: '2026-01-03' },
    { id: 'd', prioridade: 5, criado_em: '2026-01-04' },
    { id: 'e', prioridade: 2, criado_em: '2026-01-01' },
  ];
  assert.deepEqual(itens.sort(C.compararBacklog).map(x => x.id), ['c', 'd', 'e', 'a', 'b']);
});

test('primeiraEtapa: menor ordem, ativa e não pulada', () => {
  const etapas = [
    { id: 'e3', ordem: 3 }, { id: 'e1', ordem: 1, ativo: false }, { id: 'e2', ordem: 2 }, { id: 'e4', ordem: 4 },
  ];
  assert.equal(C.primeiraEtapa(etapas, []), 'e2');
  assert.equal(C.primeiraEtapa(etapas, [{ etapa_id: 'e2', pulada: true }]), 'e3');
  assert.equal(C.primeiraEtapa([], []), null);
});

test('gatilhosDaOS', () => {
  assert.deepEqual(C.gatilhosDaOS({}, { projetoId: null, status: 'andamento' }), []);
  assert.deepEqual(C.gatilhosDaOS({}, { projetoId: 'p', status: 'afazer' }), ['os_vinculada']);
  assert.deepEqual(C.gatilhosDaOS({ projetoId: 'x', status: 'andamento' }, { projetoId: 'p', status: 'andamento' }), ['os_vinculada', 'os_andamento']);
  assert.deepEqual(C.gatilhosDaOS({ projetoId: 'p', status: 'afazer' }, { projetoId: 'p', status: 'andamento' }), ['os_andamento']);
  assert.deepEqual(C.gatilhosDaOS({ projetoId: 'p', status: 'concluido' }, { projetoId: 'p', status: 'afazer' }), ['os_reaberta']);
  assert.deepEqual(C.gatilhosDaOS({ projetoId: 'p', status: 'concluido' }, { projetoId: 'p', status: 'andamento' }), ['os_andamento', 'os_reaberta']);
  assert.deepEqual(C.gatilhosDaOS({ projetoId: 'p', status: 'andamento' }, { projetoId: 'p', status: 'concluido' }), []);
});

test('proximoStatusAuto', () => {
  assert.equal(C.proximoStatusAuto('aprovada', 'os_andamento'), 'execucao');
  assert.equal(C.proximoStatusAuto('aprovada', 'os_vinculada'), null);
  assert.equal(C.proximoStatusAuto('concluida', 'os_vinculada'), 'execucao');
  assert.equal(C.proximoStatusAuto('concluida', 'os_reaberta'), 'execucao');
  assert.equal(C.proximoStatusAuto('concluida', 'os_andamento'), null);
  // Pausada nunca sai sozinha da pausa
  assert.equal(C.proximoStatusAuto('pausada', 'os_andamento'), null);
  assert.equal(C.proximoStatusAuto('pausada', 'os_reaberta'), null);
  assert.equal(C.proximoStatusAuto('execucao', 'os_andamento'), null);
});

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

// Timestamps com fuso explícito -03:00 para não depender do fuso da máquina nos cálculos de dias
const ev = (tipo, para, papel, quando, de) => ({ tipo, para, papel_id: papel, criado_em: quando, de: de || null });

test('intervalosEtapa e tempoPorPapel com retorno e conclusão', () => {
  const eventos = [
    ev('status', 'execucao', null, '2026-01-01T12:00:00-03:00', 'aprovada'),
    ev('etapa', 'esp', 'analista', '2026-01-01T12:00:00-03:00'),
    ev('etapa', 'dev', 'dev', '2026-01-03T12:00:00-03:00'),
    ev('etapa', 'val', 'testador', '2026-01-08T12:00:00-03:00'),
    ev('retorno', 'dev', 'dev', '2026-01-09T12:00:00-03:00'),
    ev('status', 'concluida', null, '2026-01-11T12:00:00-03:00', 'execucao'),
  ];
  const ints = C.intervalosEtapa(eventos);
  assert.equal(ints.length, 4);
  assert.equal(ints[3].retorno, true);
  assert.equal(ints[3].fim, '2026-01-11T12:00:00-03:00');
  const t = C.tempoPorPapel(eventos, '2026-02-01T12:00:00-03:00');
  assert.deepEqual(t, { dias: { analista: 2, dev: 7, testador: 1 }, retornos: 1 });
});

test('tempoPorPapel: etapa atual conta até agora; pausa não fecha', () => {
  const eventos = [
    ev('etapa', 'esp', 'cliente', '2026-01-01T12:00:00-03:00'),
    ev('status', 'pausada', null, '2026-01-02T12:00:00-03:00', 'execucao'),
  ];
  assert.deepEqual(C.tempoPorPapel(eventos, '2026-01-04T00:00:00-03:00'), { dias: { cliente: 2.5 }, retornos: 0 });
  assert.equal(C.diasNaEtapaAtual(eventos, '2026-01-04T00:00:00-03:00'), 2);
  assert.equal(C.diasNaEtapaAtual([], '2026-01-04T00:00:00-03:00'), null);
});

test('etapaNaData: dia local e última etapa do dia vence', () => {
  // 22h em -03:00 = 01h UTC do dia seguinte; deve contar no dia local
  const eventos = [
    ev('etapa', 'esp', 'a', '2026-01-01T09:00:00-03:00'),
    ev('etapa', 'dev', 'd', '2026-01-05T22:00:00-03:00'),
    ev('etapa', 'val', 't', '2026-01-07T09:00:00-03:00'),
    ev('etapa', 'imp', 'a', '2026-01-07T15:00:00-03:00'),
  ];
  const ints = C.intervalosEtapa(eventos);
  const local = ts => C.dataLocal(ts);
  // Usa as datas locais calculadas pelo próprio módulo, para o teste valer em qualquer fuso
  assert.equal(C.etapaNaData(ints, local('2026-01-03T12:00:00-03:00')), 'esp');
  assert.equal(C.etapaNaData(ints, local('2026-01-05T22:00:00-03:00')), 'dev');
  assert.equal(C.etapaNaData(ints, local('2026-01-07T15:00:00-03:00')), 'imp');
  assert.equal(C.etapaNaData(ints, '2025-12-31'), null);
});

test('horasPorEtapa: tipo de atividade > data > sem etapa', () => {
  const etapas = [
    { id: 'esp', tipos_atividade: ['9'] },
    { id: 'dev', tipos_atividade: ['10'] },
    { id: 'old', ativo: false, tipos_atividade: ['11'] },
  ];
  const eventos = [
    ev('etapa', 'esp', 'a', '2026-01-05T12:00:00-03:00'),
    ev('etapa', 'dev', 'd', '2026-01-10T12:00:00-03:00'),
  ];
  const linhas = [
    { data: '2026-01-12', activity_type_id: '9', horas: 2 },   // tipo ligado a esp, mesmo estando em dev
    { data: '2026-01-06', activity_type_id: 10, horas: '3' },  // número × string
    { data: '2026-01-06', activity_type_id: null, horas: 1.5 },// sem tipo → pela data → esp
    { data: '2026-01-11', activity_type_id: '77', horas: 1 },  // tipo não ligado → pela data → dev
    { data: '2026-01-11', activity_type_id: '11', horas: 1 },  // tipo de etapa desativada → pela data → dev
    { data: '2026-01-01', activity_type_id: null, horas: 4 },  // antes da 1ª etapa → sem etapa
  ];
  assert.deepEqual(C.horasPorEtapa(linhas, eventos, etapas), {
    porEtapa: { esp: 3.5, dev: 5 }, semEtapa: 4, total: 12.5,
  });
});

test('horasPorEtapa: vazio', () => {
  assert.deepEqual(C.horasPorEtapa([], [], []), { porEtapa: {}, semEtapa: 0, total: 0 });
});

test('gatilhosDaOS: vincular OS já concluída não reabre projeto (paridade com o banco)', () => {
  assert.deepEqual(C.gatilhosDaOS({}, { projetoId: 'p', status: 'concluido' }), []);
  assert.deepEqual(C.gatilhosDaOS({ projetoId: 'x', status: 'concluido' }, { projetoId: 'p', status: 'concluido' }), []);
});

test('sugestoesPorPai: agrupa OSs soltas pelo pai do Redmine', () => {
  const oss = [
    { id: 'a', paiRedmine: '4521', status: 'andamento' },
    { id: 'b', paiRedmine: 4521, status: 'concluido' },
    { id: 'c', paiRedmine: '4521', status: 'afazer' },
    { id: 'd', paiRedmine: '4610', status: 'afazer' },                 // pai com 1 OS só: não sugere
    { id: 'e', paiRedmine: '4521', projetoId: 'px' },                  // já tem projeto
    { id: 'f', paiRedmine: '4521', projetoDesvinculado: true },        // soltou à mão
    { id: 'g', paiRedmine: '' },                                       // sem pai
    { id: 'h', paiRedmine: '4388', status: 'afazer' },                 // pai de projeto que aceita OS
    { id: 'i', paiRedmine: '4700', status: 'afazer' }, { id: 'j', paiRedmine: '4700' }, // pai de ideia ainda não aprovada
    { id: 'k', paiRedmine: '4800' }, { id: 'l', paiRedmine: '4800' },  // pai de projeto cancelado: volta a sugerir
    { id: 'm', paiRedmine: '4900' }, { id: 'n', paiRedmine: '4900' }   // ignorado
  ];
  const projetos = [
    { id: 'p1', pai_redmine: '4388', status: 'plano' },
    { id: 'p2', pai_redmine: '4700', status: 'triagem' },
    { id: 'p3', pai_redmine: '4800', status: 'descartada' }
  ];
  const s = C.sugestoesPorPai(oss, projetos, { '4900': true });
  assert.deepEqual(s.map(x => x.pai), ['4521', '4800', '4388']);
  assert.deepEqual(s[0], { pai: '4521', projetoId: null, osIds: ['a', 'b', 'c'], andamento: 1, concluidas: 1 });
  assert.equal(s[1].projetoId, null);
  assert.deepEqual(s[2], { pai: '4388', projetoId: 'p1', osIds: ['h'], andamento: 0, concluidas: 0 });
  assert.deepEqual(C.sugestoesPorPai([], [], null), []);
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
