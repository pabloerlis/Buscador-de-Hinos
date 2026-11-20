#!/usr/bin/env python3
"""Catálogo curado de aliases narrativos em português; suplemento, não limite de cobertura."""
import json
from pathlib import Path
# (título, referência, termos alternativos, temas da ontologia semântica)
STORIES = [
('Mulher do fluxo de sangue','Marcos 5:25-34','mulher fluxo de sangue|mulher do fluxo de sangue|mulher hemorrágica|mulher que tocou em jesus|mulher que tocou as vestes de jesus|cura da mulher hemorrágica|mulher enferma há doze anos','fe|cura|confianca|graca'),
('Filho pródigo','Lucas 15:11-32','filho pródigo|filho prodigo|filho perdido|retorno do filho pródigo|filho que voltou para o pai|volta à casa do pai','arrependimento|perdao|graca|renovacao'),
('Ovelha perdida','Lucas 15:3-7','ovelha perdida|parábola da ovelha perdida|pastor procura a ovelha','salvacao|amor|graca'),
('Bom samaritano','Lucas 10:25-37','bom samaritano|parábola do bom samaritano|homem ferido na estrada','amor|servico|graca'),
('Jesus acalma a tempestade','Marcos 4:35-41','jesus acalma tempestade|tempestade no mar da galileia|barco em meio à tempestade|jesus repreende o vento','fe|paz|confianca|protecao'),
('Multiplicação dos pães','João 6:1-14','multiplicação dos pães|cinco pães e dois peixes|jesus alimenta a multidão','graca|gratidao|confianca'),
('Jesus anda sobre as águas','Mateus 14:22-33','jesus anda sobre as águas|pedro anda sobre as águas|pedro afundou no mar|caminhando sobre as águas','fe|confianca|protecao'),
('Ressurreição de Lázaro','João 11:1-44','ressurreição de lázaro|jesus ressuscita lázaro|lázaro sai do sepulcro','fe|ressurreicao|vida_eterna'),
('Cego Bartimeu','Marcos 10:46-52','cego bartimeu|cura de bartimeu|bartimeu clama jesus|filho de davi tem misericórdia','fe|cura|oracao'),
('Cego de nascença','João 9:1-41','cego de nascença|cura do cego de nascença|cego de nascimento|barro nos olhos do cego','cura|fe|direcao'),
('Paralítico de Cafarnaum','Marcos 2:1-12','paralítico de cafarnaum|paralitico descido pelo telhado|amigos carregam o paralítico|paralítico pelo telhado','cura|fe|perdao'),
('Dez leprosos','Lucas 17:11-19','cura dos dez leprosos|dez leprosos|leproso agradecido|um leproso voltou para agradecer','cura|gratidao|fe'),
('Mulher samaritana','João 4:1-42','mulher samaritana|jesus e a samaritana|mulher no poço de jacó|água viva no poço','salvacao|fe|graca|evangelizacao'),
('Zaqueu','Lucas 19:1-10','zaqueu na árvore|zaqueu cobrador de impostos|zaqueu sobe no sicômoro|jesus na casa de zaqueu','arrependimento|salvacao|renovacao'),
('Nicodemos','João 3:1-21','nicodemos visita jesus|jesus e nicodemos|novo nascimento nicodemos|nascer de novo nicodemos','salvacao|fe|renovacao'),
('Jairo e sua filha','Marcos 5:21-43','filha de jairo|jesus ressuscita a filha de jairo|menina de jairo|talita cumi','fe|cura|ressurreicao'),
('Viúva de Naim','Lucas 7:11-17','viúva de naim|filho da viúva de naim|ressurreição do jovem de naim','ressurreicao|graca|consolo'),
('Jó em sofrimento','Jó 1:1-22','sofrimento de jó|história de jó|provações de jó|paciência de jó','tribulacao|perseveranca|fe'),
('Daniel na cova dos leões','Daniel 6:1-28','daniel na cova dos leões|daniel com os leões|livramento de daniel','fe|protecao|oracao'),
('Três jovens na fornalha','Daniel 3:1-30','fornalha ardente|três jovens na fornalha|sad raque mesa que abede nego|sadraque mesaque e abede nego','fe|protecao|vitoria'),
('Davi e Golias','1 Samuel 17:1-58','davi e golias|luta de davi contra golias|gigante golias','fe|confianca|vitoria'),
('José vendido pelos irmãos','Gênesis 37:1-36','josé vendido pelos irmãos|josé do egito|josé sonhador|história de josé do egito','confianca|perdao|direcao'),
('Travessia do Mar Vermelho','Êxodo 14:1-31','travessia do mar vermelho|mar vermelho se abriu|moisés abre o mar vermelho','protecao|fe|vitoria'),
('Maná no deserto','Êxodo 16:1-36','maná no deserto|pão do céu no deserto|israel alimentado no deserto','confianca|gratidao|protecao'),
('Queda dos muros de Jericó','Josué 6:1-27','muros de jericó|queda de jericó|sete voltas em jericó','fe|obediencia|vitoria'),
('Jonas e o grande peixe','Jonas 1:1-17','jonas e a baleia|jonas e o grande peixe|jonas no ventre do peixe','arrependimento|obediencia|graca'),
('Noé e a arca','Gênesis 6:9-22','arca de noé|dilúvio e arca de noé|noé constrói a arca','fe|obediencia|protecao'),
('Abraão e Isaque','Gênesis 22:1-19','sacrifício de isaque|abraão oferece isaque|abraão e isaque no monte','fe|obediencia|confianca'),
('Escada de Jacó','Gênesis 28:10-22','escada de jacó|sonho de jacó com anjos|visão da escada de jacó','confianca|fe|direcao'),
('Elias no Monte Carmelo','1 Reis 18:20-40','elias no monte carmelo|fogo do céu monte carmelo|elias e profetas de baal','fe|oracao|vitoria'),
('Elias e a viúva de Sarepta','1 Reis 17:8-24','viúva de sarepta|elias e o azeite e farinha|viúva alimenta elias','confianca|graca|fe'),
('Pentecostes','Atos 2:1-41','dia de pentecostes|descida do espírito santo|línguas de fogo pentecostes','espirito_santo|evangelizacao|igreja'),
('Conversão de Saulo','Atos 9:1-22','conversão de saulo|saulo caminho de damasco|paulo encontra jesus na estrada','salvacao|renovacao|graca'),
('Pedro libertado da prisão','Atos 12:1-19','pedro libertado da prisão|anjo liberta pedro da prisão|pedro sai das cadeias','protecao|oracao|fe'),
('Paulo e Silas na prisão','Atos 16:16-40','paulo e silas na prisão|louvor de paulo e silas|terremoto na prisão filipense','louvor|fe|vitoria'),
('Estêvão apedrejado','Atos 7:54-60','estevão apedrejado|martírio de estevão|estevão primeiro mártir','fe|perdao|perseveranca'),
('A última ceia','Lucas 22:14-23','última ceia de jesus|jesus institui a ceia|pão e cálice na última ceia','ceia|cruz|comunhao'),
('Jesus no Getsêmani','Mateus 26:36-46','jesus no getsêmani|oração de jesus no jardim|jesus suando sangue no jardim','oracao|obediencia|cruz'),
('Jesus no Calvário','Lucas 23:26-49','crucificação de jesus|jesus no calvário|jesus morre na cruz|morte do senhor jesus','cruz|perdao|salvacao'),
('Ressurreição de Jesus','Mateus 28:1-10','ressurreição de jesus|jesus ressuscitou|sepulcro vazio de jesus','ressurreicao|vida_eterna|vitoria'),
('Jesus e os discípulos de Emaús','Lucas 24:13-35','discípulos de emaús|caminho de emaús|jesus na estrada de emaús','fe|consolo|biblia'),
('Grande comissão','Mateus 28:16-20','grande comissão|ide por todo o mundo e pregai|ide e fazei discípulos','missao|evangelizacao|obediencia'),
('Parábola do semeador','Mateus 13:1-23','parábola do semeador|semeador saiu a semear|sementes em diferentes terrenos','biblia|fe|perseveranca'),
('Dez virgens','Mateus 25:1-13','parábola das dez virgens|cinco virgens prudentes|dez virgens e o noivo','volta_jesus|vigilancia|fe'),
('Talentos','Mateus 25:14-30','parábola dos talentos|servos e talentos|homem esconde talento na terra','servico|obediencia|vigilancia'),
('Ovelhas e bodes','Mateus 25:31-46','ovelhas e bodes|separação de ovelhas e bodes|juízo das nações','amor|servico|vida_eterna'),
('Transfiguração de Jesus','Mateus 17:1-13','transfiguração de jesus|jesus no monte da transfiguração|moisés e elias com jesus','adoracao|fe|gloria'),
('Cristo e a mulher adúltera','João 8:1-11','mulher adúltera|mulher pega em adultério|quem não tem pecado atire a primeira pedra','perdao|graca|arrependimento'),
]

if __name__=='__main__':
 rows=[]
 for name,ref,aliases,topics in STORIES:
  items=[x.strip() for x in aliases.split('|')]
  # typo/trick aliases intentionally avoided if empty
  rows.append({'id':name.lower().replace(' ','_'), 'label':name,'reference':ref,'aliases':items,'topics':[t for t in topics.split('|') if t!='gloria']})
 p=Path('app/src/main/assets/bible-narratives.json');p.parent.mkdir(parents=True,exist_ok=True)
 p.write_text(json.dumps({'schema_version':1,'narratives':rows},ensure_ascii=False,indent=2),encoding='utf8')
 print('Narrativas curadas:',len(rows))
