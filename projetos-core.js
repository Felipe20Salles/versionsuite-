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

  var ACEITA_OS=['plano','entregue'];
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
      // OS já concluída não reabre o projeto (o banco exige uma OS não concluída)
      if(depois.status!=='concluido')g.push('os_vinculada');
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

  // OSs soltas com o mesmo pai no Redmine viram sugestão: criar projeto (2+ OSs) ou
  // vincular ao projeto que já tem esse pai. Pai de ideia ainda não aprovada não sugere nada.
  var PROJ_ENCERRADO=['descartada'];
  function sugestoesPorPai(oss,projetos,ignorados){
    var grupos={},ordem=[];
    (oss||[]).forEach(function(o){
      if(!o.paiRedmine||o.projetoId||o.projetoDesvinculado)return;
      var pai=String(o.paiRedmine);
      if(ignorados&&ignorados[pai])return;
      if(!grupos[pai]){grupos[pai]=[];ordem.push(pai)}
      grupos[pai].push(o);
    });
    var out=[];
    ordem.forEach(function(pai){
      var g=grupos[pai];
      var p=(projetos||[]).find(function(x){return x.pai_redmine&&String(x.pai_redmine)===pai&&PROJ_ENCERRADO.indexOf(x.status)<0});
      if(p&&!aceitaOS(p.status))return;
      if(!p&&g.length<2)return;
      out.push({pai:pai,projetoId:p?p.id:null,osIds:g.map(function(o){return o.id}),
        andamento:g.filter(function(o){return o.status==='andamento'}).length,
        concluidas:g.filter(function(o){return o.status==='concluido'}).length});
    });
    return out.sort(function(a,b){return b.osIds.length-a.osIds.length});
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

  // ---- Plano: avaliação, estimativa e status ----
  var PLANO_PADRAO={
    criterios:[
      {nome:'Facilidade de execução',pergunta:'Há barreiras para fazer?',opcoes:['Bloqueada','Difícil','Possível','Simples'],peso:1},
      {nome:'Alinhamento estratégico',pergunta:'Contribui com os objetivos?',opcoes:['Nenhum','Pouco','Bastante','Total'],peso:2},
      {nome:'Impacto no negócio',pergunta:'Quanto melhora o resultado?',opcoes:['Nenhum','Baixo','Médio','Alto'],peso:2},
      {nome:'Alcance',pergunta:'Quantos são beneficiados?',opcoes:['Poucos','Alguns','Muitos','Todos'],peso:3}
    ],
    faixas_prioridade:{baixa_ate:8,media_ate:16},
    faixas_esforco:{pequeno_ate:40,medio_ate:120},
    papel_padrao_id:null,
    redmine_sync_em:null
  };

  function configPlano(row){
    var cfg=JSON.parse(JSON.stringify(PLANO_PADRAO));
    if(row)Object.keys(cfg).forEach(function(k){
      if(row[k]!==undefined&&row[k]!==null)cfg[k]=JSON.parse(JSON.stringify(row[k]));
    });
    return cfg;
  }

  function prioridade(crit,criterios){
    if(!crit||!criterios)return null;
    var soma=0;
    for(var i=0;i<criterios.length;i++){
      var n=crit[i];
      if(typeof n!=='number'||isNaN(n))return null;
      soma+=n*criterios[i].peso;
    }
    return soma;
  }

  function faixaPrioridade(valor,faixas){
    if(valor===null||valor===undefined)return null;
    if(valor<=faixas.baixa_ate)return'baixa';
    if(valor<=faixas.media_ate)return'media';
    return'alta';
  }

  function faixaEsforco(horas,faixas){
    if(!(horas>0))return'sem';
    if(horas<=faixas.pequeno_ate)return'pequeno';
    if(horas<=faixas.medio_ate)return'medio';
    return'grande';
  }

  function papeisDoPlano(papeis){
    return(papeis||[]).filter(function(p){return!p.externo&&p.ativo!==false})
      .sort(function(a,b){return a.ordem-b.ordem});
  }

  function papelExterno(papeis,id){
    return(papeis||[]).some(function(p){return p.id===id&&p.externo});
  }

  function horasTotal(horasPapeis,papeis){
    return r1((horasPapeis||[]).reduce(function(a,h){
      return papelExterno(papeis,h.papel_id)?a:a+(num(h.horas)||0);
    },0));
  }

  function horasDoPapel(horasPapeis,papelId){
    var h=(horasPapeis||[]).find(function(x){return x.papel_id===papelId});
    return h?(num(h.horas)||0):0;
  }

  function r1(n){return Math.round(n*10)/10}

  function definirHoras(horasPapeis,papelId,horas){
    var v=num(horas);
    v=(v===null||v<0)?0:r1(v);
    var achou=false;
    var out=(horasPapeis||[]).map(function(h){
      if(h.papel_id!==papelId)return{papel_id:h.papel_id,horas:h.horas};
      achou=true;return{papel_id:papelId,horas:v};
    });
    if(!achou)out.push({papel_id:papelId,horas:v});
    return out;
  }

  function situacaoEstimativa(horasPapeis,papeis){
    var ps=papeisDoPlano(papeis);
    var com=ps.filter(function(p){return horasDoPapel(horasPapeis,p.id)>0}).length;
    if(!com)return'sem';
    return com===ps.length?'completa':'parcial';
  }

  var STATUS=['triagem','pauta','plano','entregue','adiada','descartada'];
  var STATUS_ROTULO={triagem:'Em triagem',pauta:'Em pauta',plano:'No plano',entregue:'Entregue',adiada:'Adiada',descartada:'Descartada'};
  var TRANSICOES={
    pauta:['plano','adiada','descartada'],
    adiada:['plano','adiada','descartada'],
    plano:['entregue','adiada','descartada'],
    entregue:['plano']
  };
  function podeMudarStatus(de,para){
    return(TRANSICOES[de]||[]).indexOf(para)>-1&&de!==para;
  }

  function statusAposCriterios(status,crit){
    if(status!=='triagem')return status;
    var completo=!!crit&&crit.length>=4&&crit.every(function(n){return typeof n==='number'&&!isNaN(n)});
    return completo?'pauta':'triagem';
  }

  function cmpNulo(a,b,desc){
    var na=a===null||a===undefined,nb=b===null||b===undefined;
    if(na&&nb)return 0;
    if(na)return 1;
    if(nb)return -1;
    return desc?b-a:a-b;
  }

  function compararPlano(a,b){
    var c=cmpNulo(a.posicao,b.posicao,false);
    if(c)return c;
    c=cmpNulo(a.prioridade==null?null:+a.prioridade,b.prioridade==null?null:+b.prioridade,true);
    if(c)return c;
    c=cmpNulo(num(a.pai_redmine),num(b.pai_redmine),false);
    if(c)return c;
    return String(a.criado_em||'').localeCompare(String(b.criado_em||''));
  }

  function tituloPlano(versoes){
    var anos=(versoes||[]).filter(function(v){return v.ativa||v.planejada})
      .map(function(v){return parseInt(String(v.data).slice(0,4),10)})
      .filter(function(a){return!isNaN(a)});
    if(!anos.length)return'Plano';
    var min=Math.min.apply(null,anos),max=Math.max.apply(null,anos);
    return min===max?'Plano '+min:'Plano '+min+'/'+String(max).slice(-2);
  }

  /* ---- Plano: cascata, repartição por papel, reordenação ---- */
  function porData(a,b){
    if(a.data==null&&b.data==null)return 0;
    if(a.data==null)return 1;if(b.data==null)return -1;
    return a.data<b.data?-1:a.data>b.data?1:0;
  }
  function distribuirPlano(demandas,versoes,realizado){
    realizado=realizado||{};
    var total=realizado.total||{},porVersao=realizado.porVersao||{};
    var ativas=(versoes||[]).filter(function(v){return v.ativa}).sort(porData);
    var planej=(versoes||[]).filter(function(v){return v.planejada&&!v.ativa}).sort(porData);
    var cols=ativas.concat(planej).map(function(v){
      var rv=0,m=porVersao[v.id]||{},k;
      if(v.ativa)for(k in m)if(m.hasOwnProperty(k))rv+=m[k]||0;
      return {v:v,space:(num(v.capacidade)||0)-rv,items:[],real:rv};
    });
    var act=null,j;
    for(j=0;j<cols.length;j++)if(cols[j].v.ativa){act=cols[j];break}
    var plano=(demandas||[]).filter(function(d){return d.status==='plano'}).sort(compararPlano);
    var sem=[],semHoras=[],previstas={},i=0;
    plano.forEach(function(d){
      previstas[d.id]=[];
      var h=num(d.horas)||0;
      var rv=act?((porVersao[act.v.id]||{})[d.id]||0):0;
      var semEst=!(h>0);
      if(semEst)semHoras.push(d.id);
      var left=semEst?0:Math.max(h-(total[d.id]||0),0),parts=[];
      if(act&&rv>0)parts.push({col:act,h:0,r:rv});
      while(left>0&&i<cols.length){
        var c=cols[i],take=Math.min(left,Math.max(c.space,0));
        if(take>0){
          var ex=null,p;
          for(p=0;p<parts.length;p++)if(parts[p].col===c){ex=parts[p];break}
          if(ex)ex.h+=take;else parts.push({col:c,h:take,r:0});
          c.space-=take;left-=take;
        }
        if(c.space<=1e-4)i++;
      }
      if(left>1e-9)parts.push({col:null,h:left,r:0});
      var partes=parts.filter(function(p){return p.h>0}).length;
      var k=0;
      parts.forEach(function(p){
        var it={id:d.id,horas:p.h,realizado:p.r,parte:k,partes:partes};
        if(p.h>0)k++;
        if(p.col){p.col.items.push(it);previstas[d.id].push(p.col.v.id)}
        else{sem.push({id:d.id,horas:p.h,parte:it.parte,partes:partes});previstas[d.id].push(null)}
      });
    });
    return {
      versoes:cols.map(function(c){
        var cap=num(c.v.capacidade)||0,usado=c.real;
        c.items.forEach(function(it){usado+=it.horas});
        return {id:c.v.id,capacidade:cap,realizado:c.real,usado:usado,livres:Math.max(cap-usado,0),itens:c.items};
      }),
      semVersao:sem,semHoras:semHoras,previstas:previstas
    };
  }
  function restantePorPapel(horasPapeis,realizadoPorPapelTotal,papeisIds){
    var out={};
    (papeisIds||[]).forEach(function(p){
      var s=0;
      (horasPapeis||[]).forEach(function(hp){if(hp.papel_id===p)s+=num(hp.horas)||0});
      out[p]=Math.max(s-((realizadoPorPapelTotal||{})[p]||0),0);
    });
    return out;
  }
  function arred1(n){return Math.round(n*10)/10}
  function repartirPorPapel(itens,restante,realizadoPP,papeisIds,capacidadePorPapel){
    return (papeisIds||[]).map(function(p){
      var cap=(capacidadePorPapel||{})[p]||0,usado=0,real=0,lista=[];
      (itens||[]).forEach(function(it){
        var rest=(restante||{})[it.id]||{},soma=0,q;
        for(q in rest)if(rest.hasOwnProperty(q))soma+=rest[q]||0;
        var h=soma>0?it.horas*(rest[p]||0)/soma:0;
        var r=((realizadoPP||{})[it.id]||{})[p]||0;
        if(h+r<0.05)return;
        lista.push({id:it.id,horas:arred1(h),realizado:arred1(r)});
        usado+=h+r;real+=r;
      });
      usado=arred1(usado);
      return {papelId:p,capacidade:cap,usado:usado,realizado:arred1(real),
        acima:arred1(Math.max(usado-cap,0)),livres:arred1(Math.max(cap-usado,0)),itens:lista};
    });
  }
  function moverPara(ordemIds,id,indice){
    var o=ordemIds.filter(function(x){return x!==id});
    o.splice(Math.max(0,Math.min(indice,o.length)),0,id);
    return o;
  }
  function renumerar(ordemIds,posicaoAtual){
    var out=[];
    ordemIds.forEach(function(id,i){
      if((posicaoAtual||{})[id]!==i+1)out.push({id:id,posicao:i+1});
    });
    return out;
  }
  function indiceDeSoltura(ordemIds,id,idsDoPote,idsAntesDoPote,fracao){
    var o=ordemIds.filter(function(x){return x!==id});
    if(fracao===null||fracao===undefined)return o.length;
    var pote=(idsDoPote||[]).filter(function(x){return x!==id});
    if(!pote.length){
      var a=(idsAntesDoPote||[]).filter(function(x){return x!==id});
      return a.length?o.indexOf(a[a.length-1])+1:0;
    }
    var q=Math.round(fracao*pote.length);
    if(q<pote.length)return o.indexOf(pote[q]);
    return o.indexOf(pote[pote.length-1])+1;
  }
  function repartirTotal(capPorPapel,novoTotal){
    var ks=Object.keys(capPorPapel||{}),soma=0,out={},resto=[],dado=0;
    ks.forEach(function(k){soma+=capPorPapel[k]||0});
    var zero=soma<=0;
    if(zero)soma=ks.length;
    ks.forEach(function(k,i){
      var exato=novoTotal*(zero?1:(capPorPapel[k]||0))/soma,f=Math.floor(exato+1e-9);
      out[k]=f;dado+=f;resto.push({k:k,i:i,r:exato-f});
    });
    resto.sort(function(a,b){return b.r-a.r||a.i-b.i});
    for(var n=0;n<novoTotal-dado&&resto.length;n++)out[resto[n%resto.length].k]++;
    return out;
  }

  var api={
    horasPorEtapa:horasPorEtapa,
    intervalosEtapa:intervalosEtapa,tempoPorPapel:tempoPorPapel,diasNaEtapaAtual:diasNaEtapaAtual,
    dataLocal:dataLocal,etapaNaData:etapaNaData,
    FATOR:FATOR,tamanhoPorHoras:tamanhoPorHoras,horasEsforco:horasEsforco,
    calcPrioridade:calcPrioridade,compararBacklog:compararBacklog,
    ACEITA_OS:ACEITA_OS,aceitaOS:aceitaOS,primeiraEtapa:primeiraEtapa,
    gatilhosDaOS:gatilhosDaOS,proximoStatusAuto:proximoStatusAuto,vinculoPorPai:vinculoPorPai,
    sugestoesPorPai:sugestoesPorPai,
    PLANO_PADRAO:PLANO_PADRAO,configPlano:configPlano,prioridade:prioridade,faixaPrioridade:faixaPrioridade,
    faixaEsforco:faixaEsforco,papeisDoPlano:papeisDoPlano,horasTotal:horasTotal,horasDoPapel:horasDoPapel,
    definirHoras:definirHoras,situacaoEstimativa:situacaoEstimativa,STATUS:STATUS,STATUS_ROTULO:STATUS_ROTULO,
    podeMudarStatus:podeMudarStatus,statusAposCriterios:statusAposCriterios,compararPlano:compararPlano,
    tituloPlano:tituloPlano,
    distribuirPlano:distribuirPlano,restantePorPapel:restantePorPapel,repartirPorPapel:repartirPorPapel,
    moverPara:moverPara,renumerar:renumerar,indiceDeSoltura:indiceDeSoltura,repartirTotal:repartirTotal
  };
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ProjCore=api;
})(typeof window!=='undefined'?window:this);
