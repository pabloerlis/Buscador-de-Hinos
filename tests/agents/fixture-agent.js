'use strict';
const {makeRuntime,norm}=require('./runtime');
// Estrofes e distractores originais: a resposta correta depende da LETRA INTEIRA.
const scenarios=[
  {query:'Filho Pródigo',positive:'Caminho de regresso',negative:'Um filho canta',
   good:'Deixei a casa de meu pai e parti sozinho.\nVi meu caminho se perder distante do meu lar.\n\nVivi longe e reconheci minha culpa.\nArrependido, resolvi regressar para casa.\n\nVoltei para meu pai, que me recebeu com um abraço.\nFui perdoado e encontrei misericórdia.',
   bad:'Um filho ergue um cântico de festa.\nSeu pai acompanha a melodia.\n\nNa igreja cantamos em unidade.\nNão deixaremos de exaltar o Senhor.\n\nA voz do coral anuncia alegria.\nCantaremos para sempre com amor.'},
  {query:'Mulher fluxo de sangue',positive:'O toque e a cura',negative:'O sangue remidor',
   good:'Havia muitos anos uma mulher sofria de enfermidade.\nPor longo tempo a doença a enfraqueceu.\n\nEntre a multidão, em fé, ela tocou as vestes de Jesus.\nCria que um só toque lhe traria cura.\n\nA enfermidade cessou naquele instante.\nJesus a chamou de filha e anunciou que sua fé a salvou.',
   bad:'O sangue de Jesus na cruz nos purifica.\nSua graça e redenção nos tornam livres.\n\nContemplamos o sacrifício do Cordeiro.\nPerdão e salvação chegam à nossa casa.\n\nPelo sangue remidor temos vida.\nAdoramos o Salvador eternamente.'},
  {query:'Tempestade Acalmada',positive:'A bonança no mar',negative:'Vento de festa',
   good:'Estávamos no barco enquanto o mar se agitava.\nAs ondas e o vento fizeram grande tempestade.\n\nJesus se levantou e ordenou que o vento se calasse.\nSua palavra trouxe paz às águas revoltas.\n\nQuando o mar ficou tranquilo vimos seu poder.\nEm meio ao medo aprendemos a confiar nele.',
   bad:'O vento suave acompanha a festa.\nAs ondas da praia brilham pela manhã.\n\nAgradecemos a criação do Senhor.\nO dia sereno nos convida ao louvor.\n\nHá harmonia e alegria na nossa terra.\nCantamos juntos por mais um amanhecer.'},
  {query:'Ovelha Perdida',positive:'O pastor me encontrou',negative:'O rebanho reunido',
   good:'Como ovelha perdida me afastei do aprisco.\nAndei só pelos montes sem encontrar caminho.\n\nMeu pastor saiu a procurar o que estava perdido.\nOuvi sua voz chamando por mim no deserto.\n\nEle me encontrou, me tomou nos braços.\nVoltei ao redil em segurança e descanso.',
   bad:'O pastor cuida com carinho do rebanho.\nTodas as ovelhas repousam no campo.\n\nCantamos juntos na congregação.\nA igreja vive em paz e comunhão.\n\nO Senhor nos alimenta com bondade.\nSomos gratos por seu cuidado cotidiano.'},
  {query:'cruz e perdão',positive:'No madeiro fui salvo',negative:'Louvor ao perdão',
   good:'No monte do Calvário contemplei a cruz.\nJesus entregou sua vida em sacrifício.\n\nPor minhas culpas pediu misericórdia.\nSeu sangue trouxe remissão e perdão.\n\nHoje sigo liberto da condenação.\nAgradeço a salvação do Salvador.',
   bad:'Pedi perdão ao amigo que ofendi.\nNossa amizade voltou a florescer.\n\nAgora somos alegres e unidos.\nCaminhamos juntos em paz e gratidão.\n\nAo Senhor louvamos com alegria.\nSua bondade nos inspira a viver.'},
  {query:'oração e consolo',positive:'Consolo ao clamar',negative:'Oração de gratidão',
   good:'Na angústia dobrei meus joelhos em oração.\nMeu clamor subiu ao céu entre lágrimas.\n\nAflito e triste busquei teu consolo.\nO Senhor ouviu a minha súplica.\n\nAgora descansa meu coração ferido.\nTua presença trouxe paz ao meu sofrimento.',
   bad:'Pela manhã levanto uma oração.\nAgradeço pela vida e pelo alimento.\n\nMeu coração celebra tua bondade.\nHá alegria na reunião da família.\n\nCom amigos canto pela provisão.\nLevo gratidão ao teu altar, Senhor.'},
  {query:'perseverança e confiança',positive:'Até o fim confiarei',negative:'Confiança sem perseverar',
   good:'Ainda que a caminhada seja longa, perseverarei.\nNão desistirei da promessa recebida.\n\nMesmo cansado eu confio no Senhor.\nEm teu amparo encontro segurança.\n\nSeguirei firme até o fim de meus dias.\nA minha esperança descansa em Deus.',
   bad:'Minha confiança está no cuidado divino.\nEm ti encontro refúgio e proteção.\n\nAgora canto sobre a paz recebida.\nMeu coração se alegra com teus dons.\n\nAgradeço por tua bondade eterna.\nEu descanso na presença do Senhor.'},
  {query:'volta de Jesus e vigilância',positive:'Vigiar até que venha',negative:'Lâmpadas da cidade',
   good:'Jesus prometeu voltar para buscar sua igreja.\nMaranata, aguardamos sua vinda.\n\nVigiamos com as lâmpadas acesas.\nEstaremos preparados para receber o noivo.\n\nAté aquele dia guardamos a promessa.\nEm santidade esperamos o Salvador.',
   bad:'As lâmpadas brilham na rua da cidade.\nA noite chegou com alegria e festa.\n\nNossa família caminha em unidade.\nCantamos para agradecer a vida.\n\nA manhã virá com novo alento.\nO Senhor sustenta nossos passos.'}
];
const mk=(id,title,lyrics)=>({title:String(id).padStart(3,'0')+' - '+title,content:lyrics});
async function run(){
  const api=makeRuntime();
  const songs=[];
  for(let i=0;i<scenarios.length;i++){
    songs.push(mk(i*2+1,scenarios[i].positive,scenarios[i].good));
    songs.push(mk(i*2+2,scenarios[i].negative,scenarios[i].bad));
  }
  const imported=await api.request('/api/import',{data:[{name:'Coletânea 2018',songs}]});
  const checks=[],warnings=[];
  checks.push({name:'Importação de 16 letras completas em três estrofes',pass:imported.count===16,details:'hinos='+imported.count});
  for(let i=0;i<scenarios.length;i++){
    const s=scenarios[i],id=2*i+1,decoyId=id+1;
    const detail=await api.request('/api/hymns/'+id);
    const hasFull=norm(detail.lyrics)===norm(s.good)&&detail.lyrics.split(/\n\s*\n/).length>=3;
    checks.push({name:'Letra integral preservada: '+s.query,pass:hasFull});
    const ranked=await api.request('/api/search',{query:s.query,settings:{pageSize:10},_forRecommendations:true});
    const order=ranked._fullRanked.map(x=>x.id);
    const position=order.indexOf(id)+1,decoy=order.indexOf(decoyId)+1;
    checks.push({name:'Hino contextual recuperado: '+s.query,pass:position>0&&position<=10,
      details:'posição='+position+'; distrator='+decoy});
    const top=ranked.results.find(x=>x.id===id);
    if(top&&top.snippet){
      const piece=top.snippet.replace(/\s*\/\s*/g,' ');
      const source=norm(detail.lyrics);
      const contained=source.includes(norm(piece).replace(/\s+/g,' '))||norm(piece).split(' ').filter(t=>t.length>3).every(t=>source.includes(t));
      checks.push({name:'Trecho rastreável na letra: '+s.query,pass:contained});
    }
    if(decoy>0&&position>0&&decoy<position)
      warnings.push('Distrator acima da letra narrativa em '+s.query+' (posição '+decoy+' contra '+position+').');
  }
  return {agent:'agente-casos-integrais',scenarioCount:scenarios.length,checks,warnings,passed:checks.every(c=>c.pass)};
}
module.exports={run};
if(require.main===module)run().then(r=>{console.log(JSON.stringify(r,null,2));if(!r.passed)process.exitCode=1;}).catch(e=>{console.error(e);process.exitCode=1;});
