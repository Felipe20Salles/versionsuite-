// projetos-core.js — regras puras do Backlog de Projetos (sem DOM, sem Supabase).
// No browser vira window.ProjCore; no Node é carregado por require() nos testes.
(function(root){
  var FATOR={P:1,M:3,G:7,GG:15};

  function num(v){var n=parseFloat(v);return isNaN(n)?null:n}

  function tamanhoPorHoras(h){
    h=num(h);if(h===null||h<=0)return null;
    if(h<=20)return'P';if(h<=80)return'M';if(h<=200)return'G';return'GG';
  }

  // Ordem de preferência: soma das horas por etapa > total livre > só o tamanho
  function horasEsforco(p,configs){
    var soma=(configs||[]).reduce(function(a,c){return a+(num(c.horas_estimadas)||0)},0);
    if(soma>0)return{horas:soma,origem:'etapas'};
    var tot=num(p.esforco_total_h);
    if(tot!==null&&tot>0)return{horas:tot,origem:'total'};
    return{horas:null,origem:p.esforco_tamanho?'tamanho':null};
  }

  function calcPrioridade(p,configs){
    var notas=[p.nota_impacto,p.nota_urgencia,p.nota_alinhamento].map(num);
    var completas=notas.every(function(n){return n!==null&&n>=1&&n<=5});
    var valor=completas?notas[0]+notas[1]+notas[2]:null;
    var esf=horasEsforco(p,configs);
    var tamanho=esf.horas!==null?tamanhoPorHoras(esf.horas):(FATOR[p.esforco_tamanho]?p.esforco_tamanho:null);
    var fator=tamanho?FATOR[tamanho]:null;
    var prioridade=(valor!==null&&fator)?Math.round(valor/fator*10)/10:null;
    return{valor:valor,horas:esf.horas,tamanho:tamanho,fator:fator,prioridade:prioridade};
  }

  // Legal sempre no topo; depois prioridade (desc), sem nota no fim; empate pela criação
  function compararBacklog(a,b){
    if(!!a.legal!==!!b.legal)return a.legal?-1:1;
    var pa=a.prioridade==null?null:+a.prioridade,pb=b.prioridade==null?null:+b.prioridade;
    if(pa===null&&pb!==null)return 1;
    if(pb===null&&pa!==null)return -1;
    if(pa!==pb)return pb-pa;
    return String(a.criado_em||'').localeCompare(String(b.criado_em||''));
  }

  var ACEITA_OS=['aprovada','execucao','pausada','concluida'];
  function aceitaOS(status){return ACEITA_OS.indexOf(status)>-1}

  function primeiraEtapa(etapas,configs){
    var puladas={};
    (configs||[]).forEach(function(c){if(c.pulada)puladas[c.etapa_id]=true});
    var ativas=(etapas||[]).filter(function(e){return e.ativo!==false&&!puladas[e.id]})
      .sort(function(a,b){return a.ordem-b.ordem});
    return ativas.length?ativas[0].id:null;
  }

  // Que mudanças na OS podem mexer no status do projeto dela
  function gatilhosDaOS(antes,depois){
    var g=[];
    if(!depois||!depois.projetoId)return g;
    var a=antes||{};
    if(a.projetoId!==depois.projetoId){
      g.push('os_vinculada');
      if(depois.status==='andamento')g.push('os_andamento');
      return g;
    }
    if(a.status!=='andamento'&&depois.status==='andamento')g.push('os_andamento');
    if(a.status==='concluido'&&depois.status!=='concluido')g.push('os_reaberta');
    return g;
  }

  function proximoStatusAuto(status,gatilho){
    if(status==='aprovada'&&gatilho==='os_andamento')return'execucao';
    if(status==='concluida'&&(gatilho==='os_vinculada'||gatilho==='os_reaberta'))return'execucao';
    return null;
  }

  // O pai do Redmine só vincula OS sem projeto e que não foi desvinculada à mão
  function vinculoPorPai(os,projetos){
    if(!os||os.projetoId||os.projetoDesvinculado||!os.paiRedmine)return null;
    var pai=String(os.paiRedmine);
    var p=(projetos||[]).find(function(x){return x.pai_redmine&&String(x.pai_redmine)===pai&&aceitaOS(x.status)});
    return p?p.id:null;
  }

  var api={
    FATOR:FATOR,tamanhoPorHoras:tamanhoPorHoras,horasEsforco:horasEsforco,
    calcPrioridade:calcPrioridade,compararBacklog:compararBacklog,
    ACEITA_OS:ACEITA_OS,aceitaOS:aceitaOS,primeiraEtapa:primeiraEtapa,
    gatilhosDaOS:gatilhosDaOS,proximoStatusAuto:proximoStatusAuto,vinculoPorPai:vinculoPorPai
  };
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ProjCore=api;
})(typeof window!=='undefined'?window:this);
