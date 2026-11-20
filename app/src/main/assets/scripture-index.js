'use strict';
/* Referências bíblicas e texto offline sob CC BY 4.0 BR.
 * A base compactada é gerada da Bíblia Livre por scripts/build_scripture_index.py.
 * Não cria relações teológicas automaticamente; apenas fornece texto verificável.
 */
const ScriptureIndex = (() => {
  const normalize = s => String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const rawBooks = [
    ['Gen','Gênesis','gn','genesis'],['Exod','Êxodo','ex','exodo'],['Lev','Levítico','lv','levitico'],['Num','Números','nm','numeros'],['Deut','Deuteronômio','dt','deuteronomio'],
    ['Josh','Josué','js','josue'],['Judg','Juízes','jz','juizes'],['Ruth','Rute','rt','rute'],
    ['1Sam','1 Samuel','1sm','1 samuel'],['2Sam','2 Samuel','2sm','2 samuel'],['1Kgs','1 Reis','1rs','1 reis'],['2Kgs','2 Reis','2rs','2 reis'],
    ['1Chr','1 Crônicas','1cr','1 cronicas'],['2Chr','2 Crônicas','2cr','2 cronicas'],['Ezra','Esdras','ed','esdras'],['Neh','Neemias','ne','neemias'],['Esth','Ester','et','ester'],
    ['Job','Jó','job'],['Ps','Salmo','sl','salmos','salmo'],['Prov','Provérbios','pv','proverbios'],['Eccl','Eclesiastes','ec','eclesiastes'],['Song','Cantares','ct','cantares'],
    ['Isa','Isaías','is','isaias'],['Jer','Jeremias','jr','jeremias'],['Lam','Lamentações','lm','lamentacoes'],['Ezek','Ezequiel','ez','ezequiel'],['Dan','Daniel','dn','daniel'],
    ['Hos','Oseias','os','oseias'],['Joel','Joel','jl','joel'],['Amos','Amós','am','amos'],['Obad','Obadias','ob','obadias'],['Jonah','Jonas','jn','jonas'],
    ['Mic','Miqueias','mq','miqueias'],['Nah','Naum','na','naum'],['Hab','Habacuque','hc','habacuque'],['Zeph','Sofonias','sf','sofonias'],['Hag','Ageu','ag','ageu'],
    ['Zech','Zacarias','zc','zacarias'],['Mal','Malaquias','ml','malaquias'],
    ['Matt','Mateus','mt','mateus'],['Mark','Marcos','mc','marcos'],['Luke','Lucas','lc','lucas'],['John','João','jo','joao'],
    ['Acts','Atos','at','atos'],['Rom','Romanos','rm','romanos'],['1Cor','1 Coríntios','1co','1 co','1 corintios'],['2Cor','2 Coríntios','2co','2 co','2 corintios'],
    ['Gal','Gálatas','gl','galatas'],['Eph','Efésios','ef','efesios'],['Phil','Filipenses','fp','filipenses'],['Col','Colossenses','cl','colossenses'],
    ['1Thess','1 Tessalonicenses','1ts','1 tessalonicenses'],['2Thess','2 Tessalonicenses','2ts','2 tessalonicenses'],
    ['1Tim','1 Timóteo','1tm','1 timoteo'],['2Tim','2 Timóteo','2tm','2 timoteo'],['Titus','Tito','tt','tito'],['Phlm','Filemom','fm','filemom'],
    ['Heb','Hebreus','hb','hebreus'],['Jas','Tiago','tg','tiago'],['1Pet','1 Pedro','1pe','1 pedro'],['2Pet','2 Pedro','2pe','2 pedro'],
    ['1John','1 João','1jo','1 joao'],['2John','2 João','2jo','2 joao'],['3John','3 João','3jo','3 joao'],['Jude','Judas','jd','judas'],['Rev','Apocalipse','ap','apocalipse']
  ];
  const bookAliases = rawBooks.flatMap(([id,label,...alias]) =>
    [label,...alias].map(a=>({id,label,alias:normalize(a)})))
    .sort((a,b)=>b.alias.length-a.alias.length);
  function parse(query) {
    const q=normalize(query);
    let best=null;
    for(const a of bookAliases){
      // 'Jo' em português identifica João; Jó só com acento explícito.
      if(a.id==='Job'&&a.alias==='jo'&&!/(?:^|[^a-zA-Z])jó\s+\d/i.test(String(query)))continue;
      if(a.id==='John'&&a.alias==='jo'&&/(?:^|[^a-zA-Z])jó\s+\d/i.test(String(query)))continue;
      const pattern=new RegExp('(^|[^a-z0-9])('+escape(a.alias).replace(/\\\s+/g,'\\s*')+')\\.?\\s+(\\d{1,3})(?:\\s*:\\s*(\\d{1,3})(?:\\s*[-–]\\s*(\\d{1,3}))?)?(?=$|[^a-z0-9])','i');
      const m=pattern.exec(q);
      if(!m)continue;
      const chapter=Number(m[3]),from=m[4]?Number(m[4]):null,to=m[5]?Number(m[5]):from;
      if(chapter<1||chapter>150||(from!==null&&(from<1||from>176||to<from||to>176)))continue;
      const found={id:a.id,label:a.label,chapter,from,to,start:m.index+m[1].length,end:m.index+m[0].length,raw:m[0].trim()};
      if(!best||found.start<best.start||found.start===best.start&&found.raw.length>best.raw.length)best=found;
    }
    return best;
  }
  function create(data) {
    if(!data||data.schema_version!==1||data.version!=='almeida-livre'||!data.books||typeof data.books!=='object')throw Error('Base bíblica offline inválida');
    const chapters=data.books;
    function lookup(query,limit=28) {
      const ref=parse(query);if(!ref)return null;
      const chapter=chapters[ref.id]?.[String(ref.chapter)];
      if(!Array.isArray(chapter))return null;
      const max=Math.max(1,Math.min(32,Number(limit)||28));
      const start=ref.from??1;
      const end=ref.to??chapter.length-1;
      const rows=[];
      for(let n=start;n<=end&&rows.length<max;n++)if(typeof chapter[n]==='string'&&chapter[n].trim())rows.push({number:n,text:chapter[n].trim()});
      if(!rows.length)return null;
      const display=`${ref.label} ${ref.chapter}${ref.from?':'+ref.from+(ref.to!==ref.from?'-'+ref.to:''):''}`;
      const matched=normalize(query);
      return {reference:display,book:ref.id,chapter:ref.chapter,from:start,to:end,
        text:rows.map(r=>r.text).join(' '),verses:rows,partial:rows.length<end-start+1,
        residual:(matched.slice(0,ref.start)+' '+matched.slice(ref.end)).replace(/\s+/g,' ').trim(),
        source:'Bíblia Livre (2018) · CC BY 4.0 Brasil'};
    }
    return {lookup,bookCount:Object.keys(chapters).length,revision:data.revision||'Bíblia Livre',source:data.source||'midvash/bible-data'};
  }
  return {create,parse,normalize};
})();
