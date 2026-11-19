'use strict';
/* Referências que possuem contexto temático localmente revisável.
 * Não armazena nem inventa a redação dos versículos.
 * Para referências desconhecidas, o usuário deve inserir o texto da passagem.
 */
const BibleContext = (() => {
  const normalize = value => String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  const entries = [
    {label:'Salmo 23',aliases:['salmo 23','salmos 23','sl 23','salmo 23:1','sl 23:1'],theme:'O Senhor como pastor; cuidado, direção, proteção e confiança em Deus'},
    {label:'Salmo 46',aliases:['salmo 46','salmos 46','sl 46'],theme:'Deus como refúgio e fortaleza diante da tribulação'},
    {label:'Salmo 91',aliases:['salmo 91','salmos 91','sl 91'],theme:'Proteção, abrigo, livramento e confiança no Senhor'},
    {label:'Salmo 100',aliases:['salmo 100','salmos 100','sl 100'],theme:'Louvor, alegria, adoração e gratidão a Deus'},
    {label:'Salmo 121',aliases:['salmo 121','salmos 121','sl 121'],theme:'Socorro e cuidado de Deus, proteção e confiança'},
    {label:'Salmo 150',aliases:['salmo 150','salmos 150','sl 150'],theme:'Adoração, louvor e exaltação a Deus'},
    {label:'Isaías 40',aliases:['isaias 40','is 40'],theme:'Esperança, renovação das forças, perseverança e cuidado de Deus'},
    {label:'Isaías 41:10',aliases:['isaias 41:10','is 41:10'],theme:'Não temer, presença de Deus, amparo, força e confiança'},
    {label:'Isaías 53',aliases:['isaias 53','is 53'],theme:'Sofrimento do Servo, cruz, sacrifício, redenção e salvação'},
    {label:'Mateus 5',aliases:['mateus 5','mt 5'],theme:'Bem-aventuranças, humildade, consolo, santificação e justiça'},
    {label:'Mateus 6:25',aliases:['mateus 6:25','mt 6:25'],theme:'Ansiedade, providência divina, cuidado, paz e confiança'},
    {label:'Mateus 11:28',aliases:['mateus 11:28','mt 11:28'],theme:'Descanso em Jesus, alívio das cargas e consolo'},
    {label:'Mateus 28:19',aliases:['mateus 28:19','mt 28:19'],theme:'Evangelização, missão e pregação do evangelho'},
    {label:'João 3:16',aliases:['joao 3:16','jo 3:16'],theme:'Amor de Deus, salvação, fé e vida eterna'},
    {label:'João 14:1',aliases:['joao 14:1','jo 14:1'],theme:'Consolo, confiança em Jesus e esperança na vida eterna'},
    {label:'João 14:6',aliases:['joao 14:6','jo 14:6'],theme:'Jesus como caminho, verdade e vida, fé e salvação'},
    {label:'João 14:26',aliases:['joao 14:26','jo 14:26'],theme:'Espírito Santo, Consolador, direção e ensino'},
    {label:'Romanos 8:28',aliases:['romanos 8:28','rm 8:28'],theme:'Providência de Deus, confiança e esperança nas dificuldades'},
    {label:'Romanos 12:1',aliases:['romanos 12:1','rm 12:1'],theme:'Consagração, santificação, obediência e serviço cristão'},
    {label:'1 Coríntios 11:23',aliases:['1 corintios 11:23','1co 11:23','1 co 11:23'],theme:'Santa Ceia, memorial do sacrifício e comunhão'},
    {label:'1 Coríntios 13',aliases:['1 corintios 13','1co 13','1 co 13'],theme:'Amor, caridade e comunhão fraternal'},
    {label:'2 Coríntios 5:17',aliases:['2 corintios 5:17','2co 5:17','2 co 5:17'],theme:'Nova vida em Cristo, renovação espiritual e salvação'},
    {label:'Efésios 6:10',aliases:['efesios 6:10','ef 6:10'],theme:'Força no Senhor, perseverança e vitória espiritual'},
    {label:'Filipenses 4:6',aliases:['filipenses 4:6','fp 4:6','filipenses 4:7','fp 4:7'],theme:'Oração em lugar de ansiedade, paz de Deus e confiança'},
    {label:'Filipenses 4:13',aliases:['filipenses 4:13','fp 4:13'],theme:'Fortaleza em Cristo, fé e perseverança'},
    {label:'Hebreus 11:1',aliases:['hebreus 11:1','hb 11:1'],theme:'Fé, certeza das promessas e esperança'},
    {label:'Apocalipse 3:20',aliases:['apocalipse 3:20','ap 3:20'],theme:'Chamado de Jesus, arrependimento e comunhão'},
    {label:'Apocalipse 21:4',aliases:['apocalipse 21:4','ap 21:4'],theme:'Consolo, esperança, vida eterna e fim do sofrimento'},
    {label:'Apocalipse 22:20',aliases:['apocalipse 22:20','ap 22:20'],theme:'Volta de Jesus, esperança, vigilância e Maranata'}
  ];
  function lookup(raw){
    const query = normalize(raw);
    for(const entry of entries){
      for(const alias of entry.aliases){
        const term=normalize(alias);
        // Não tratar "Mateus 6:25" como "Mateus 6" sem querer.
        const exp=new RegExp('(?:^|[^a-z0-9])'+term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s*')+'(?=$|[^0-9])');
        if(exp.test(query))return {reference:entry.label,theme:entry.theme};
      }
    }
    return null;
  }
  function looksLikeReference(raw){return /(?:salmo|salmos|\bsl\b|\bis\b|isaias|mateus|\bmt\b|joao|\bjo\b|romanos|\brm\b|corintios|filipenses|\bfp\b|efesios|hebreus|apocalipse|\bap\b)\s*\d{1,3}(?:\s*:\s*\d{1,3})?/i.test(normalize(raw));}
  return {lookup,looksLikeReference,count:entries.length};
})();
