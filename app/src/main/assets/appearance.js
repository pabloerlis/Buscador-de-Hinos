'use strict';
// All values are allowlisted. No arbitrary CSS is accepted from storage.
const Appearance=(()=>{
  const key='hinos-appearance-v1';
  const palettes={
    emerald:{name:'Esmeralda',colors:['#174b3d','#28785e','#d9b67d'],light:['#edf5ef','#e3efe5','#cbded0','#1b513f','#4c6958'],dark:['#101e1a','#253d32','#3a5145','#a4e0bd','#adccb8']},
    ocean:{name:'Oceano',colors:['#163b66','#28649b','#9fd5ed'],light:['#edf3fa','#e0edf9','#c8d9ee','#214f82','#4c657f'],dark:['#101c2b','#22384f','#3c536d','#a6d4ff','#b2c9e4']},
    amethyst:{name:'Ametista',colors:['#4b306f','#7953a5','#dfbaf3'],light:['#f4eff9','#eee4f7','#e0d2ee','#67428c','#6c5a83'],dark:['#21172c','#38294a','#554263','#dfbdff','#cfbdda']},
    amber:{name:'Âmbar',colors:['#70401d','#a4612c','#e8bd76'],light:['#faf3e7','#f5e8d4','#e8d5b9','#825021','#78644c'],dark:['#251b12','#40301e','#5d4831','#ffd39b','#dbc3a0']},
    graphite:{name:'Grafite',colors:['#293544','#526477','#b6c9da'],light:['#f0f3f6','#e5ebf0','#d3dde5','#34495d','#596b7b'],dark:['#171c23','#2c3641','#465462','#c4d9ed','#b4c3d2']}
  };
  const defaults={palette:'emerald',mode:'system',motion:'slide',speed:'normal'};
  const speeds={fast:150,normal:250,slow:390};
  function sanitize(raw){
    return {palette:Object.hasOwn(palettes,raw?.palette)?raw.palette:defaults.palette,
      mode:['light','dark','system'].includes(raw?.mode)?raw.mode:defaults.mode,
      motion:['slide','zoom','fade','none'].includes(raw?.motion)?raw.motion:defaults.motion,
      speed:Object.hasOwn(speeds,raw?.speed)?raw.speed:defaults.speed};
  }
  let prefs=defaults;
  try{prefs=sanitize(JSON.parse(localStorage.getItem(key)||'{}'));}catch(_){}
  const media=typeof matchMedia==='function'?matchMedia('(prefers-color-scheme: dark)'):null;
  const reduced=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):null;
  function dark(){return prefs.mode==='dark'||(prefs.mode==='system'&&media?.matches===true);}
  function duration(){return prefs.motion==='none'||reduced?.matches?0:speeds[prefs.speed];}
  function apply(){
    const p=palettes[prefs.palette], isDark=dark(), tones=isDark?p.dark:p.light;
    const root=document.documentElement;
    root.dataset.palette=prefs.palette;root.dataset.theme=isDark?'dark':'light';root.dataset.motion=prefs.motion;
    const variables={'--header-a':p.colors[0],'--header-b':p.colors[1],'--gold':p.colors[2],
      '--ivory':tones[0],'--pale':tones[1],'--line':tones[2],'--green':tones[3],'--green2':tones[3],'--muted':tones[4],
      '--ink':isDark?'#edf2f5':'#202c36','--paper':isDark?'#202831':'#ffffff','--action':p.colors[0],
      '--focus':tones[3],'--motion-ms':duration()+'ms','--shadow':isDark?'0 4px 16px #00000026':'0 4px 15px #172d4110'};
    for(const [name,value] of Object.entries(variables))root.style.setProperty(name,value);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',p.colors[0]);
    try{window.NativeHinos?.appearanceBars?.(p.colors[0],tones[0],isDark);}catch(_){}
  }
  function update(raw){
    prefs=sanitize({...prefs,...raw});apply();
    try{localStorage.setItem(key,JSON.stringify(prefs));}catch(_){}
    render();
  }
  function render(){
    const panel=document.getElementById('appearance-layer');if(!panel)return;
    for(const button of panel.querySelectorAll('[data-appearance]')){
      button.setAttribute('aria-pressed',String(prefs[button.dataset.appearance]===button.dataset.value));
    }
  }
  function init(){
    const list=document.getElementById('appearance-palettes');
    if(list&&!list.children.length){
      for(const [id,p] of Object.entries(palettes)){
        const button=document.createElement('button');button.type='button';button.className='palette-option';
        button.dataset.appearance='palette';button.dataset.value=id;
        const sample=document.createElement('span');sample.className='palette-sample';
        for(const color of p.colors){const swatch=document.createElement('i');swatch.style.backgroundColor=color;sample.append(swatch);}
        const name=document.createElement('strong');name.textContent=p.name;
        const mark=document.createElement('span');mark.className='palette-check';mark.setAttribute('aria-hidden','true');mark.textContent='✓';
        button.append(sample,name,mark);list.append(button);
      }
    }
    document.getElementById('appearance-layer')?.addEventListener('click',event=>{
      const button=event.target.closest('[data-appearance]');
      if(button)update({[button.dataset.appearance]:button.dataset.value});
    });
    document.getElementById('appearance-reset')?.addEventListener('click',()=>update(defaults));
    document.getElementById('appearance-preview')?.addEventListener('click',()=>{
      const sample=document.getElementById('appearance-demo');
      if(!sample)return;
      sample.classList.remove('animate-demo');void sample.offsetWidth;sample.classList.add('animate-demo');
    });
    render();
  }
  media?.addEventListener?.('change',apply);reduced?.addEventListener?.('change',apply);
  apply();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
  return {sanitize,duration,update,settings:()=>({...prefs})};
})();
