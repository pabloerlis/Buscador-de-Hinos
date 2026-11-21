'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const {makeRuntime,norm}=require('./runtime');
// Juiz independente da pontuação do app. Só usa a letra COMPLETA, nunca título,
// snippet, tags, porcentagem ou justificativa do motor como prova semântica.
const cases=[
 {query:'Filho Pródigo',groups:[['deixei','parti','longe','afastei','perdido','mundo'],['voltei','voltar','retornei','regressei','regressar','retorno'],['pai','casa','perdao','perdoado','acolheu','abraco','misericordia']]},
 {query:'Lucas 15:11-32',groups:[['deixei','parti','longe','perdido'],['voltei','retornei','regressei'],['pai','casa','perdao','acolheu']]},
 {query:'Mulher fluxo de sangue',groups:[['mulher','enferma','doente','sangramento','sangue'],['toque','tocou','vestes','manto','roupas'],['curou','cura','sarou','salvou','fe']]},
 {query:'Marcos 5:25-34',groups:[['mulher','enferma','sangue','doenca'],['tocou','toque','vestes','manto'],['curou','cura','sarou','salvou','fe']]},
 {query:'Ovelha Perdida',groups:[['ovelha','ovelhas','rebanho'],['perdida','perdeu','desgarrou','deserto'],['pastor','encontrou','resgatou','aprisco','redil']]},
 {query:'Tempestade Acalmada',groups:[['tempestade','mar','ondas','barco'],['vento','ondas','mar','tempestade'],['acalmou','acalma','calou','bonanca','silencio','paz']]},
 {query:'cura e oração',groups:[['cura','curar','curou','enfermidade','doenca','ferida'],['oracao','orar','clamar','clamor','suplicar','joelhos']]},
 {query:'oração e consolo',groups:[['oracao','orar','clamar','clamor','joelhos'],['consolo','consolar','lagrimas','aflicao','sofrimento','dor']]},
 {query:'gratidão e esperança',groups:[['gratidao','agradeco','agradecer','grato','gracas'],['esperanca','espero','promessa','aguardo','porvir']]},
 {query:'cruz e perdão',groups:[['cruz','calvario','madeiro','sacrificio'],['perdao','perdoou','perdoado','remissao','redencao']]},
 {query:'perseverança e confiança',groups:[['perseverar','perseveranca','persistir','desistir','permaneco','ate o fim'],['confianca','confio','confiar','amparo','refugio','sustento']]},
 {query:'volta de Jesus e vigilância',groups:[['voltarei','voltara','volta de jesus','vinda','maranata','arrebatamento'],['vigiar','vigiamos','vigilancia','lampadas','preparados']]},
 {query:'salvação pela graça',groups:[['salvacao','salvo','salvar','redencao','resgate'],['graca','favor','misericordia']]},
 {query:'serviço e comunhão',groups:[['servir','servico','obra','trabalho','missao'],['comunhao','unidade','unidos','irmaos','corpo de cristo']]},
 {query:'consolo na tristeza',groups:[['consolo','consolar','conforto','amparo'],['tristeza','aflicao','dor','lagrimas','angustia']]},
 {query:'arrependimento e perdão',groups:[['arrependido','arrependimento','pecado','culpa','confesso'],['perdao','perdoou','perdoado','misericordia']]},
 {query:'paz em meio ao medo',groups:[['paz','tranquilo','descanso','serenidade'],['medo','temor','ansiedade','aflicao','angustia']]},
 {query:'Salmo 23',groups:[['pastor','ovelhas','rebanho'],['vale','verdes pastos','aguas','cajado','descanso']]},
 {query:'João 3:16',groups:[['amou','amor','mundo'],['filho','vida eterna','salvacao','crer']]},
 {query:'Mulher Samaritana',groups:[['poco','samaritana','mulher'],['agua viva','sede','beber','fonte']]},
 {query:'Filho Pródigo com gratidão',groups:[['deixei','parti','longe','perdido'],['voltei','regressei','retornei'],['pai','perdao','acolheu'],['gratidao','gracas','agradecer','grato']]},
 {query:'estou cansado de esperar, mas ainda confio em Deus',groups:[['esperar','cansado','perseverar','persistir','promessa'],['confio','confianca','confiar','amparo','refugio']]}
];
function groupsFor(text,groups){
  const all=' '+norm(text)+' ';
  return groups.map(terms=>terms.filter(term=>all.includes(' '+norm(term)+' ')));
}
const isStrong=hits=>hits.filter(h=>h.length>0).length>=2;
const wordCount=text=>(norm(text).match(/\b[a-z0-9]+\b/g)||[]).length;
async function run(catalogFile){
  if(!fs.existsSync(catalogFile))throw Error('Coletânea real não encontrada: '+catalogFile);
  const bytes=fs.readFileSync(catalogFile),corpus=JSON.parse(bytes.toString('utf8'));
  const sourceHash=crypto.createHash('sha256').update(bytes).digest('hex');
  const groups=corpus.filter(x=>/^(Coletânea|CIA|Avulsos) 2018$/.test(x.name));
  const rawCount=groups.reduce((n,x)=>n+x.songs.length,0);
  const api=makeRuntime(),imported=await api.request('/api/import',{data:corpus});
  const checks=[],warnings=[],audits=[],details=[];
  checks.push({name:'Fonte integral: três coletâneas 2018',pass:groups.length===3&&rawCount>=1500,details:'grupos='+groups.length+'; brutos='+rawCount});
  checks.push({name:'Importação real preserva volume',pass:imported.count>=1500&&imported.count<=rawCount,details:'únicos='+imported.count+'; duplicatas='+imported.duplicates});
  for(let id=1;id<=imported.count;id++){
    const h=await api.request('/api/hymns/'+id);
    details.push({id,number:h.number,title:h.title,lyrics:h.lyrics,chars:h.lyrics.length,
      words:wordCount(h.lyrics),stanzas:h.lyrics.split(/\n\s*\n/).filter(Boolean).length});
  }
  const empty=details.filter(h=>h.words<8);
  checks.push({name:'100% dos registros examinados pelo agente em texto integral',pass:details.length===imported.count&&details.every(h=>h.lyrics),
    details:'letras_lidas='+details.length+'; curtas='+empty.length});
  // Casos curados do usuário: título catalogado e posição recuperada, jamais inferida.
  const prodigal=details.find(h=>norm(h.title)==='um dia eu quis te deixar' && Number(h.number)===286);
  checks.push({name:'Caso real: nº 286 existe e foi importado',pass:Boolean(prodigal),details:prodigal?'id='+prodigal.id:'não localizado'});
  for(const test of cases){
    const ranks=await api.request('/api/search',{query:test.query,settings:{pageSize:10},_forRecommendations:true});
    const top=ranks._fullRanked.slice(0,10);
    const adjudicated=top.map((hit,i)=>{
      const hymn=details[hit.id-1],hits=groupsFor(hymn.lyrics,test.groups);
      return {pos:i+1,id:hit.id,number:hit.number,title:hit.title,score:hit.relevance_percent,
        evidenceGroups:hits.map(h=>h.slice(0,3)),lexicalStatus:isStrong(hits)?'apoio lexical em letra integral':'revisão semântica necessária'};
    });
    const fullStrong=details.filter(h=>isStrong(groupsFor(h.lyrics,test.groups)));
    const topIds=new Set(top.map(x=>x.id));
    const nonRecovered=fullStrong.filter(h=>!topIds.has(h.id)).slice(0,5).map(h=>({id:h.id,number:h.number,title:h.title}));
    const review=adjudicated.filter(h=>h.lexicalStatus!=='apoio lexical em letra integral');
    if(review.length)warnings.push(test.query+': '+review.length+'/10 resultados sem dois grupos de indícios textuais; revisar significado completo.');
    const topResult=top.slice(0,5);
    for(const row of topResult){
      const full=details[row.id-1],card=ranks.results.find(x=>x.id===row.id);
      if(!full||!card){checks.push({name:'Resultado ausente na leitura integral: '+test.query,pass:false});continue;}
      // O texto de evidência deve ser rastreável, sem aceitar trecho de outro hino.
      const words=norm(card.snippet||'').split(' ').filter(x=>x.length>=5);
      const supported=words.length>0 && words.filter(w=>norm(full.lyrics).includes(w)).length>=Math.min(words.length,3);
      checks.push({name:'Trecho e letra do mesmo hino: '+test.query+' #'+row.id,pass:supported});
    }
    audits.push({query:test.query,total:ranks.total,top10:adjudicated,
      proxyStrongTop5:adjudicated.slice(0,5).filter(h=>h.lexicalStatus==='apoio lexical em letra integral').length,
      strongCandidatesFullCatalog:fullStrong.length,strongNotTop10:nonRecovered});
  }
  if(prodigal){
    const row=audits.find(a=>a.query==='Filho Pródigo');
    const position=row.top10.findIndex(h=>h.id===prodigal.id);
    checks.push({name:'Regressão exigida: nº 286 entre os dez primeiros para Filho Pródigo',pass:position>=0,
      details:position>=0?'posição='+(position+1):'não apareceu no top 10'});
    const exact=await api.request('/api/search',{query:'Hino 286',settings:{pageSize:10}});
    checks.push({name:'Consulta numérica do hino 286',pass:exact.results.some(h=>h.id===prodigal.id)});
  }
  // Regressões de narrativas verificadas por leitura da letra completa.
  // O alvo do caso de Marcos 5 relata a multidão, o toque e a mulher curada;
  // não confundir o episódio com alusões gerais ao sangue de Cristo.
  for(const [query,number,allowedPosition] of [
    ['Filho Pródigo','286',3],['Lucas 15:11-32','286',5],
    ['Mulher fluxo de sangue','261',3],['Marcos 5:25-34','261',3]
  ]){
    const a=audits.find(x=>x.query===query);
    const place=a?.top10.findIndex(hit=>hit.number===number)??-1;
    checks.push({name:'Narrativa prioritária pela letra inteira: '+query+' → hino '+number,
      pass:place>=0&&place<allowedPosition,
      details:'posição='+(place+1)+'; esperado top '+allowedPosition});
  }
  for(const query of ['Mulher fluxo de sangue','Marcos 5:25-34']){
    const a=audits.find(x=>x.query===query);
    const place261=a?.top10.findIndex(hit=>hit.number==='261')??-1;
    const placeGeneric=a?.top10.findIndex(hit=>hit.number==='614')??-1;
    checks.push({name:'Narrativa de cura deve superar hino sobre expiação: '+query,
      pass:place261>=0&&(placeGeneric<0||place261<placeGeneric),
      details:'hino261='+(place261+1)+'; hino614='+(placeGeneric+1)});
  }
  // Compara recomendações em cascata com o texto integral do hino de referência.
  const anchors=[prodigal?.id,details[0]?.id,details.find(h=>norm(h.title)==='vem o prodigo')?.id].filter(Boolean);
  const recommendations=[];
  for(const id of [...new Set(anchors)]){
    const response=await api.request('/api/recommend',{hymn_id:id,settings:{recCount:10,recContext:false}});
    const h=details[id-1];
    const evaluated=response.results.map(r=>({id:r.id,title:r.title,compatibility:r.compatibility_percent,
      sharedVocabulary:commonTokens(h.lyrics,details[r.id-1].lyrics)}));
    recommendations.push({anchor:{id,title:h.title},evaluated});
    checks.push({name:'Recomendação em cascata sem referências inválidas: '+h.title,
      pass:response.results.every(r=>r.id!==id&&Boolean(details[r.id-1]?.lyrics))});
  }
  return {agent:'agente-auditoria-catalogo-real',catalogSha256:sourceHash,rawCount,
    importedCount:imported.count,checkedEntireLyrics:details.length,cases:cases.length,
    checks,warnings,audits,recommendations,passed:checks.every(c=>c.pass)};
}
function commonTokens(a,b){
  const stop=new Set('a o os as de do da e em para com por que meu minha seu sua deus senhor jesus cristo amor vida'.split(' '));
  const tokens=x=>new Set(norm(x).split(' ').filter(t=>t.length>=5&&!stop.has(t)));
  const first=tokens(a),second=tokens(b);return [...first].filter(t=>second.has(t)).slice(0,8);
}
module.exports={run};
if(require.main===module)run(process.argv[2]||'.tmp/catalog-2018.json')
  .then(r=>{console.log(JSON.stringify({agent:r.agent,checks:r.checks.length,passed:r.passed,warnings:r.warnings.length},null,2));if(!r.passed)process.exitCode=1;})
  .catch(e=>{console.error(e);process.exitCode=1;});
