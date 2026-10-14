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
