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

test('aceitaOS', () => {
  ['aprovada', 'execucao', 'pausada', 'concluida'].forEach(s => assert.equal(C.aceitaOS(s), true));
  ['ideia', 'avaliacao', 'recusada', 'cancelada'].forEach(s => assert.equal(C.aceitaOS(s), false));
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
    { id: 'p1', pai_redmine: '500', status: 'cancelada' },
    { id: 'p2', pai_redmine: '500', status: 'execucao' },
    { id: 'p3', pai_redmine: '600', status: 'ideia' },
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
