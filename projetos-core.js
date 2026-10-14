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

  var FECHA_ETAPA=['concluida','cancelada','recusada'];
  var DIA_MS=86400000;

  function porData(a,b){return new Date(a.criado_em)-new Date(b.criado_em)}

  function intervalosEtapa(eventos){
    var out=[],aberto=null;
    (eventos||[]).slice().sort(porData).forEach(function(e){
      if(e.tipo==='etapa'||e.tipo==='retorno'){
        if(aberto)aberto.fim=e.criado_em;
        aberto={etapaId:e.para,papelId:e.papel_id||null,inicio:e.criado_em,fim:null,retorno:e.tipo==='retorno'};
        out.push(aberto);
      }else if(e.tipo==='status'&&FECHA_ETAPA.indexOf(e.para)>-1&&aberto){
        aberto.fim=e.criado_em;aberto=null;
      }
    });
    return out;
  }

  function tempoPorPapel(eventos,agora){
    var fimPadrao=agora||new Date().toISOString();
    var ints=intervalosEtapa(eventos),dias={};
    ints.forEach(function(i){
      if(!i.papelId)return;
      var ms=new Date(i.fim||fimPadrao)-new Date(i.inicio);
      dias[i.papelId]=(dias[i.papelId]||0)+Math.max(0,ms)/DIA_MS;
    });
    Object.keys(dias).forEach(function(k){dias[k]=Math.round(dias[k]*10)/10});
    return{dias:dias,retornos:ints.filter(function(i){return i.retorno}).length};
  }

  function diasNaEtapaAtual(eventos,agora){
    var ints=intervalosEtapa(eventos);
    var ult=ints[ints.length-1];
    if(!ult||ult.fim)return null;
    return Math.floor((new Date(agora||new Date().toISOString())-new Date(ult.inicio))/DIA_MS);
  }

  function dataLocal(ts){return new Date(ts).toLocaleDateString('sv')}

  // Etapa em que o projeto estava num dia (data local); se mudou no mesmo dia, vale a última
  function etapaNaData(intervalos,dataISO){
    var achou=null;
    (intervalos||[]).forEach(function(i){
      var ini=dataLocal(i.inicio),fim=i.fim?dataLocal(i.fim):null;
      if(ini<=dataISO&&(fim===null||fim>=dataISO))achou=i.etapaId;
    });
    return achou;
  }

  function r2(n){return Math.round(n*100)/100}

  // Regra C: tipo de atividade ligado a uma etapa ativa; senão, a etapa do dia; senão, "sem etapa"
  function horasPorEtapa(linhas,eventos,etapas){
    var mapa={};
    (etapas||[]).forEach(function(e){
      if(e.ativo===false)return;
      (e.tipos_atividade||[]).forEach(function(t){mapa[String(t)]=e.id});
    });
    var ints=intervalosEtapa(eventos),por={},sem=0,total=0;
    (linhas||[]).forEach(function(l){
      var h=num(l.horas)||0;if(!h)return;
      total+=h;
      var et=(l.activity_type_id!=null&&mapa[String(l.activity_type_id)])||etapaNaData(ints,String(l.data).slice(0,10));
      if(et)por[et]=(por[et]||0)+h;else sem+=h;
    });
    Object.keys(por).forEach(function(k){por[k]=r2(por[k])});
    return{porEtapa:por,semEtapa:r2(sem),total:r2(total)};
  }

  var api={
    horasPorEtapa:horasPorEtapa,
    intervalosEtapa:intervalosEtapa,tempoPorPapel:tempoPorPapel,diasNaEtapaAtual:diasNaEtapaAtual,
    dataLocal:dataLocal,etapaNaData:etapaNaData,
    FATOR:FATOR,tamanhoPorHoras:tamanhoPorHoras,horasEsforco:horasEsforco,
    calcPrioridade:calcPrioridade,compararBacklog:compararBacklog,
    ACEITA_OS:ACEITA_OS,aceitaOS:aceitaOS,primeiraEtapa:primeiraEtapa,
    gatilhosDaOS:gatilhosDaOS,proximoStatusAuto:proximoStatusAuto,vinculoPorPai:vinculoPorPai
  };
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ProjCore=api;
})(typeof window!=='undefined'?window:this);
