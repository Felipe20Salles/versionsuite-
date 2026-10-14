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
