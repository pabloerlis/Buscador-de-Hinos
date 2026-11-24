'use strict';
const VectorIndex=(()=>{
  let database=null,active=false,error='',generation=0;
  const ID='harrier-600m-q4f16';
  function nativeReady(){
    try{return JSON.parse(window.NativeHarrierPackage?.status()||'{}').ready===true;}
    catch(e){return false;}
  }
  function clear(){generation++;database=null;active=false;error='';}
  async function configure(hymns){
    const run=++generation;active=false;
    if(!nativeReady()){database=null;error='Modelo não validado';return status();}
    try{
      const read=async p=>{const r=await fetch(p,{cache:'no-store'});if(!r.ok)throw Error('Índice local indisponível');return r;};
      const [m,i]=await Promise.all([read('/harrier/manifest.json'),read('/harrier/index.json')]);
      const db=await HarrierIndex.open(await m.json(),await i.text());
      await db.attach(hymns);
      if(run!==generation)return status();
      if(!nativeReady())throw Error('Modelo desativado durante indexação');
      database=db;active=true;error=db.status().count<hymns.length?'Alguns hinos ainda não possuem vetores.':'';
    }catch(e){if(run===generation){database=null;active=false;error=e.message;}}
    return status();
  }
  function status(){
    if(!active||!database||!nativeReady())return {ready:false,count:0,source_count:0,error,model:ID,dimension:1024};
    return {...database.status(),model:ID,error};
  }
  function checkQuery(v){return status().ready&&database.checkQuery(v);}
  function topForQuery(v,limit){return checkQuery(v)?database.topForQuery(v,limit):[];}
  function topForHymn(id,limit){return status().ready?database.topForHymn(id,limit):[];}
  // Provisional bounded cosine scaling, not a probability.
  function percent(sim){return Math.max(0,Math.min(100,Math.round((sim-.35)/.45*100)));}
  function points(sim,mode){
    if(!Number.isFinite(sim)||sim<.45)return 0;
    return Math.min(24,Math.max(0,(sim-.40)*60))*(mode==='strong'?1.4:1);
  }
  return {configure,clear,status,checkQuery,topForQuery,topForHymn,percent,points};
})();
