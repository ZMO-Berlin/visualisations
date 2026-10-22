# Places named in titles and abstracts

Written by `place_mentions.py` from the output of Claude Haiku 5.5 agents. 1979 records read; 2716 mentions of 518 distinct names, 467 resolved to Wikidata (210 through the gazetteer). 113 records name no gazetteer place but have a resolved mention.

Correct a decision in `place_mentions.json` → `names` (set `id`, and `"how": "review"`), then run `--report` again.

## Resolved by Wikidata search

Check these: the search found one confident candidate, which may still be a namesake.

| Name | Type | Country given | Mentions | Wikidata | Description | Region |
|---|---|---|---:|---|---|---|
| russian empire | historical state |  | 19 | [Q34266](https://www.wikidata.org/wiki/Q34266) Russian Empire | former empire in Eurasia and North America (1721–1917) | europe-elsewhere |
| iraqi kurdistan | region | iraq | 13 | [Q66711956](https://www.wikidata.org/wiki/Q66711956) Iraqi Kurdistan | Kurdish-inhabited region in Iraq | middle-east |
| sub saharan africa | world region |  | 7 | [Q132959](https://www.wikidata.org/wiki/Q132959) sub-Saharan Africa | area of the continent of Africa that lies south of the Sahara Desert | transregional |
| tranquebar | town | india | 7 | [Q732594](https://www.wikidata.org/wiki/Q732594) Tharangambadi | town | south-asia |
| west germany | historical state | germany | 7 | [Q713750](https://www.wikidata.org/wiki/Q713750) West Germany | Federal Republic of Germany in the period between its formation on 23 May 1949 and German reunification on 3 October 1990 | europe-elsewhere |
| thessaloniki | city | greece | 5 | [Q17151](https://www.wikidata.org/wiki/Q17151) Thessaloniki | city in Macedonia, Greece | europe-elsewhere |
| arab gulf states | world region |  | 4 | [Q2218629](https://www.wikidata.org/wiki/Q2218629) Arab states of the Persian Gulf | Arab states of the Persian Gulf region (no coordinate) | middle-east |
| crimea | peninsula | ukraine | 4 | [Q7835](https://www.wikidata.org/wiki/Q7835) Crimea | Eastern European peninsula, in the Black Sea and Sea of Azov, disputed between Ukraine (de jure) and Russia (de facto) | europe-elsewhere |
| southern red sea region | region |  | 4 | [Q27928](https://www.wikidata.org/wiki/Q27928) Southern Red Sea Region | region of Eritrea | east-southern-africa |
| arab gulf | world region |  | 3 | [Q2218629](https://www.wikidata.org/wiki/Q2218629) Arab states of the Persian Gulf | Arab states of the Persian Gulf region (no coordinate) | middle-east |
| australia | country | australia | 3 | [Q408](https://www.wikidata.org/wiki/Q408) Australia | country | europe-elsewhere |
| baltistan | region | pakistan | 3 | [Q805804](https://www.wikidata.org/wiki/Q805804) Baltistan | region in Pakistan | south-asia |
| belgium | country | belgium | 3 | [Q31](https://www.wikidata.org/wiki/Q31) Belgium | country in western Europe | europe-elsewhere |
| bougouni | town | mali | 3 | [Q848574](https://www.wikidata.org/wiki/Q848574) Bougouni | commune of Mali | west-central-africa |
| british india | historical state |  | 3 | [Q129286](https://www.wikidata.org/wiki/Q129286) British Raj | British colonial rule on the Indian subcontinent (1858–1947) | south-asia |
| eastern mediterranean | world region |  | 3 | [Q3301962](https://www.wikidata.org/wiki/Q3301962) Eastern Mediterranean | region that is geographically located to the east of the Mediterranean Sea (no coordinate) | transregional |
| european union | other |  | 3 | [Q458](https://www.wikidata.org/wiki/Q458) European Union | political and economic union of 27 European states | europe-elsewhere |
| eyup | neighbourhood | turkey | 3 | [Q673073](https://www.wikidata.org/wiki/Q673073) Eyüpsultan | district of İstanbul, northwestern Turkey | middle-east |
| north caucasus | region | russia | 3 | [Q37736](https://www.wikidata.org/wiki/Q37736) North Caucasus | subregion in Eastern Europe | europe-elsewhere |
| peshawar | city | pakistan | 3 | [Q1113311](https://www.wikidata.org/wiki/Q1113311) Peshawar | capital of Khyber Pakhtunkhwa Province, Pakistan | south-asia |
| south india | region | india | 3 | [Q542146](https://www.wikidata.org/wiki/Q542146) South India | geographic region in India | south-asia |
| southeast europe | world region |  | 3 | [Q263686](https://www.wikidata.org/wiki/Q263686) Southeastern Europe | geographic region | europe-elsewhere |
| western indian ocean | ocean |  | 3 | [Q1239](https://www.wikidata.org/wiki/Q1239) Indian Ocean | ocean bounded by Africa, Asia, Australia, and Antarctica | gazetteer |
| zossen | town | germany | 3 | [Q226884](https://www.wikidata.org/wiki/Q226884) Zossen | municipality in Teltow-Fläming district, Brandenburg state, Germany | europe-elsewhere |
| abbasid caliphate | historical state |  | 2 | [Q12536](https://www.wikidata.org/wiki/Q12536) Abbasid Caliphate | third Islamic caliphate (750–1258) | middle-east |
| abuja | city | nigeria | 2 | [Q3787](https://www.wikidata.org/wiki/Q3787) Abuja | capital city of Nigeria | west-central-africa |
| americas | world region |  | 2 | [Q828](https://www.wikidata.org/wiki/Q828) Americas | North America and South America taken together as a single continent or landmass | europe-elsewhere |
| arab east | world region |  | 2 | [Q503282](https://www.wikidata.org/wiki/Q503282) Mashriq | Eastern part of the Arab world | middle-east |
| austria | country | austria | 2 | [Q40](https://www.wikidata.org/wiki/Q40) Austria | country in Central Europe | europe-elsewhere |
| balochistan | region |  | 2 | [Q163239](https://www.wikidata.org/wiki/Q163239) Balochistan | province of Islamic Republic of Pakistan | south-asia |
| bombay presidency | province | india | 2 | [Q891827](https://www.wikidata.org/wiki/Q891827) Bombay Presidency | administrative unit in British India | south-asia |
| deoband | town | india | 2 | [Q1017658](https://www.wikidata.org/wiki/Q1017658) Deoband | town and a municipality in Saharanpur district in the state of Uttar Pradesh, India | south-asia |
| dersim | region | turkey | 2 | [Q4728314](https://www.wikidata.org/wiki/Q4728314) Dersim | historic region in present-day Tunceli province, Turkey (no coordinate) | middle-east |
| dresden | city | germany | 2 | [Q1731](https://www.wikidata.org/wiki/Q1731) Dresden | capital city of the Free State of Saxony in Germany | europe-elsewhere |
| eastern india | region | india | 2 | [Q1151572](https://www.wikidata.org/wiki/Q1151572) East India | geographic region, group of eastern Indian states | south-asia |
| frankfurt am main | city | germany | 2 | [Q1794](https://www.wikidata.org/wiki/Q1794) Frankfurt | most populated city of Hesse, Germany | europe-elsewhere |
| global north | world region |  | 2 | [Q97365082](https://www.wikidata.org/wiki/Q97365082) Global North | term used in transnational and postcolonial studies to refer to developed countries (no coordinate) | transregional |
| gulf region | world region |  | 2 | [Q2218629](https://www.wikidata.org/wiki/Q2218629) Arab states of the Persian Gulf | Arab states of the Persian Gulf region (no coordinate) | middle-east |
| hashemite kingdom of the hejaz | historical state | saudi arabia | 2 | [Q956357](https://www.wikidata.org/wiki/Q956357) Kingdom of Hejaz | former country | middle-east |
| jamalpur | town | india | 2 | [Q2734136](https://www.wikidata.org/wiki/Q2734136) Jamalpur | city and municipality in Munger, Bihar | south-asia |
| kenyan coast | coast | kenya | 2 | [Q185371](https://www.wikidata.org/wiki/Q185371) Coast Province | former province of Kenya | east-southern-africa |
| khuzestan | province | iran | 2 | [Q241119](https://www.wikidata.org/wiki/Q241119) Khuzestan Province | province of Iran | middle-east |
| kurd dagh | region | syria | 2 | [Q950873](https://www.wikidata.org/wiki/Q950873) Kurd-Dagh | upland area in Syria and Turkey | middle-east |
| kuwait city | city | kuwait | 2 | [Q35178](https://www.wikidata.org/wiki/Q35178) Kuwait City | capital of Kuwait | middle-east |
| madras | city | india | 2 | [Q1352](https://www.wikidata.org/wiki/Q1352) Chennai | city and state capital of Tamil Nadu, India | south-asia |
| maharashtra | province | india | 2 | [Q1191](https://www.wikidata.org/wiki/Q1191) Maharashtra | state in the western and central peninsular region of India | south-asia |
| maharashtra | region | india | 2 | [Q1191](https://www.wikidata.org/wiki/Q1191) Maharashtra | state in the western and central peninsular region of India | south-asia |
| mailuu suu | town | kyrgyzstan | 2 | [Q1355846](https://www.wikidata.org/wiki/Q1355846) Mailuu-Suu | city | central-asia-caucasus |
| malabar | region | india | 2 | [Q1534252](https://www.wikidata.org/wiki/Q1534252) Malabar | region of Kerala | south-asia |
| medina of tunis | neighbourhood | tunisia | 2 | [Q3106527](https://www.wikidata.org/wiki/Q3106527) Medina of Tunis | Old city of Tunis, Tunisia | north-africa |
| meerut | city | india | 2 | [Q200237](https://www.wikidata.org/wiki/Q200237) Meerut | metropolitan city in Uttar Pradesh, India | south-asia |
| middle volga | region | russia | 2 | [Q1634214](https://www.wikidata.org/wiki/Q1634214) Volga Region | geographic region | europe-elsewhere |
| nazi germany | historical state | germany | 2 | [Q7318](https://www.wikidata.org/wiki/Q7318) Nazi Germany | Germany from 1933 to 1945 while under control of the Nazi Party | europe-elsewhere |
| northern nigeria | region | nigeria | 2 | [Q7058792](https://www.wikidata.org/wiki/Q7058792) Northern Nigeria | geographical region of Nigeria (no coordinate) | west-central-africa |
| northwest africa | world region |  | 2 | [Q135581356](https://www.wikidata.org/wiki/Q135581356) Northwest Africa | western part of northern Africa (no coordinate) | north-africa |
| odienne | town | ivory coast | 2 | [Q506811](https://www.wikidata.org/wiki/Q506811) Odienné | city of côte d'ivoire | west-central-africa |
| paris | city | france | 2 | [Q90](https://www.wikidata.org/wiki/Q90) Paris | capital and most populous city in France | europe-elsewhere |
| post soviet space | world region |  | 2 | [Q302045](https://www.wikidata.org/wiki/Q302045) Post-Soviet states | states established following the disestablishment of the Soviet Union (no coordinate) | transregional |
| skardu | town | pakistan | 2 | [Q976955](https://www.wikidata.org/wiki/Q976955) Skardu | city in Gilgit-Baltistan, Pakistan | south-asia |
| sokoto caliphate | historical state |  | 2 | [Q600524](https://www.wikidata.org/wiki/Q600524) Sokoto Caliphate | independent Islamic Caliphate, in West Africa from 1804 to 1903 | west-central-africa |
| switzerland | country | switzerland | 2 | [Q39](https://www.wikidata.org/wiki/Q39) Switzerland | country in Central Europe | europe-elsewhere |
| tell halaf | other | syria | 2 | [Q2142541](https://www.wikidata.org/wiki/Q2142541) Tell Halaf | archaeological site in Syria | middle-east |
| venice | city | italy | 2 | [Q641](https://www.wikidata.org/wiki/Q641) Venice | capital city of Veneto, Italy | europe-elsewhere |
| wunsdorf | village | germany | 2 | [Q1566135](https://www.wikidata.org/wiki/Q1566135) Wünsdorf | borough of Zossen municipality in Teltow-Fläming district, Brandenburg state, Germany | europe-elsewhere |
| yerevan | city | armenia | 2 | [Q1953](https://www.wikidata.org/wiki/Q1953) Yerevan | capital and largest city of Armenia | central-asia-caucasus |
| yusufeli | town | turkey | 2 | [Q1027153](https://www.wikidata.org/wiki/Q1027153) Yusufeli | town and district in Artvin Province, Turkey | middle-east |
| abeche | town | chad | 1 | [Q242587](https://www.wikidata.org/wiki/Q242587) Abéché | city in Ouaddaï Region, Chad | west-central-africa |
| abidjan | city | ivory coast | 1 | [Q1515](https://www.wikidata.org/wiki/Q1515) Abidjan | major city and economic capital of Côte d'Ivoire | west-central-africa |
| abkhazia | region | georgia | 1 | [Q23334](https://www.wikidata.org/wiki/Q23334) Abkhazia | historical-geographic region in the South Caucasus, now a disputed territory | central-asia-caucasus |
| abomey calavi | city | benin | 1 | [Q2473939](https://www.wikidata.org/wiki/Q2473939) Abomey-Calavi | commune and city in Atlantique Department, Benin | west-central-africa |
| adana | city | turkey | 1 | [Q38545](https://www.wikidata.org/wiki/Q38545) Adana | central district and city in Adana Province, Turkey | middle-east |
| afrin | region | syria | 1 | [Q302268](https://www.wikidata.org/wiki/Q302268) Afrin | City and District in Syria | middle-east |
| al ahsa | region | saudi arabia | 1 | [Q311341](https://www.wikidata.org/wiki/Q311341) Al-Ahsa Oasis | Oasis historical region in eastern Saudi Arabia | middle-east |
| al mahalla al kubra | city | egypt | 1 | [Q312723](https://www.wikidata.org/wiki/Q312723) El Mahalla El Kubra | City in Egypt | north-africa |
| amasya | city | turkey | 1 | [Q170532](https://www.wikidata.org/wiki/Q170532) Amasya | central district and city in Amasya Province, Turkey | middle-east |
| amu darya | river |  | 1 | [Q8493](https://www.wikidata.org/wiki/Q8493) Amu Darya | major river in Central Asia | transregional |
| ancient greece | historical state |  | 1 | [Q11772](https://www.wikidata.org/wiki/Q11772) Ancient Greece | Greek civilization from 1200 BC to 600 AD | europe-elsewhere |
| ankara | city | turkey | 1 | [Q3640](https://www.wikidata.org/wiki/Q3640) Ankara | capital of Turkey | middle-east |
| arabian sea | sea |  | 1 | [Q58705](https://www.wikidata.org/wiki/Q58705) Arabian Sea | marginal sea of the northern Indian Ocean | south-asia |
| argentina | country | argentina | 1 | [Q414](https://www.wikidata.org/wiki/Q414) Argentina | country in South America | europe-elsewhere |
| asante | region | ghana | 1 | [Q398417](https://www.wikidata.org/wiki/Q398417) Ashanti Region | administrative region in Ghana | west-central-africa |
| assam | province | india | 1 | [Q1164](https://www.wikidata.org/wiki/Q1164) Assam | Indian state | south-asia |
| atakora mountains | mountain range |  | 1 | [Q581452](https://www.wikidata.org/wiki/Q581452) Togo Mountains | mountain range in Africa | west-central-africa |
| atlantic ocean | ocean |  | 1 | [Q97](https://www.wikidata.org/wiki/Q97) Atlantic Ocean | ocean between Europe, Africa and the Americas | transregional |
| azaadville | neighbourhood | south africa | 1 | [Q48814712](https://www.wikidata.org/wiki/Q48814712) Azaadville | place in Gauteng, South Africa | east-southern-africa |
| azamgarh | city | india | 1 | [Q526757](https://www.wikidata.org/wiki/Q526757) Azamgarh | city in Azamgarh district, Uttar Pradesh, India | south-asia |
| badakhshan | province | afghanistan | 1 | [Q32056](https://www.wikidata.org/wiki/Q32056) Badakhshan | historic region comprising parts of what is now northeastern Afghanistan and southeastern Tajikistan | central-asia-caucasus |
| balkan route | other |  | 1 | [Q21051459](https://www.wikidata.org/wiki/Q21051459) Balkan Route | transit routes across the Balkan Peninsula (no coordinate) | europe-elsewhere |
| barbary states | historical state |  | 1 | [Q501768](https://www.wikidata.org/wiki/Q501768) Barbary Coast | name used to designate the territory of the Barbary and going from Libya to Morocco (no coordinate) | north-africa |
| bengal delta | region |  | 1 | [Q1163759](https://www.wikidata.org/wiki/Q1163759) Ganges Delta | river delta | south-asia |
| bethlehem | city | palestine | 1 | [Q5776](https://www.wikidata.org/wiki/Q5776) Bethlehem | city in the West Bank, Palestine | middle-east |
| borkou | region | chad | 1 | [Q1139666](https://www.wikidata.org/wiki/Q1139666) Borkou | region of Chad | west-central-africa |
| brakna | region | mauritania | 1 | [Q12632](https://www.wikidata.org/wiki/Q12632) Brakna | region of Mauritania | north-africa |
| brasilia | city | brazil | 1 | [Q2844](https://www.wikidata.org/wiki/Q2844) Brasília | federal capital of Brazil | europe-elsewhere |
| british empire | historical state |  | 1 | [Q8680](https://www.wikidata.org/wiki/Q8680) British Empire | overseas possessions of England and later the United Kingdom (1607–1997) | transregional |
| burundi | country | burundi | 1 | [Q967](https://www.wikidata.org/wiki/Q967) Burundi | sovereign state in Africa | east-southern-africa |
| byzantine empire | historical state |  | 1 | [Q12544](https://www.wikidata.org/wiki/Q12544) Byzantine Empire | Roman Empire during Late Antiquity and the Middle Ages | transregional |
| cambodia | country | cambodia | 1 | [Q424](https://www.wikidata.org/wiki/Q424) Cambodia | country in Southeast Asia | east-asia |
| cape town | city | south africa | 1 | [Q5465](https://www.wikidata.org/wiki/Q5465) Cape Town | city in the Western Cape, South Africa | east-southern-africa |
| central africa | world region |  | 1 | [Q27433](https://www.wikidata.org/wiki/Q27433) Central Africa | core region of the African continent | west-central-africa |
| china seas | sea |  | 1 | [Q398805](https://www.wikidata.org/wiki/Q398805) China Seas | series of marginal seas in the western Pacific Ocean (no coordinate) | east-asia |
| chornobyl | town | ukraine | 1 | [Q129677](https://www.wikidata.org/wiki/Q129677) Chernobyl | partially abandoned city in Kyiv Oblast, Ukraine | europe-elsewhere |
| chota nagpur | region | india | 1 | [Q1881042](https://www.wikidata.org/wiki/Q1881042) Chota Nagpur Plateau | Plateau of India | south-asia |
| colombia | country | colombia | 1 | [Q739](https://www.wikidata.org/wiki/Q739) Colombia | country in South America | europe-elsewhere |
| coruh valley | valley | turkey | 1 | [Q70970](https://www.wikidata.org/wiki/Q70970) Çoruh | river in Georgia and Turkey | transregional |
| crete | island | greece | 1 | [Q34374](https://www.wikidata.org/wiki/Q34374) Crete | island of Greece | europe-elsewhere |
| curonian spit | peninsula |  | 1 | [Q5595](https://www.wikidata.org/wiki/Q5595) Curonian Spit | dune spit in Lithuania and Russia | europe-elsewhere |
| czechoslovakia | historical state |  | 1 | [Q33946](https://www.wikidata.org/wiki/Q33946) Czechoslovakia | country in Central Europe (1918–1992) | europe-elsewhere |
| deccan | region | india | 1 | [Q169966](https://www.wikidata.org/wiki/Q169966) Deccan Plateau | large plateau in India | south-asia |
| dezful | city | iran | 1 | [Q605142](https://www.wikidata.org/wiki/Q605142) Dezful | city in Khuzestan Province, Iran | middle-east |
| dharavi | neighbourhood | india | 1 | [Q649632](https://www.wikidata.org/wiki/Q649632) Dharavi | neighbourhood and slum in Mumbai, India | south-asia |
| dieppe | town | france | 1 | [Q183557](https://www.wikidata.org/wiki/Q183557) Dieppe | commune in Seine-Maritime, Normandy, France | europe-elsewhere |
| diffa | town | niger | 1 | [Q990527](https://www.wikidata.org/wiki/Q990527) Diffa | urban commune in Niger | west-central-africa |
| dubai sport city | neighbourhood | united arab emirates | 1 | [Q910493](https://www.wikidata.org/wiki/Q910493) Dubai Sports City | multi-venue sports complex in Dubai, United Arab Emirates | middle-east |
| duhok | city | iraq | 1 | [Q152831](https://www.wikidata.org/wiki/Q152831) Duhok | City in Kurdistan Region, Iraq | middle-east |
| duhok | province | iraq | 1 | [Q152831](https://www.wikidata.org/wiki/Q152831) Duhok | City in Kurdistan Region, Iraq | middle-east |
| east indies | world region |  | 1 | [Q213137](https://www.wikidata.org/wiki/Q213137) East Indies | region encompassing Southeast and South Asia | transregional |
| east jerusalem | region |  | 1 | [Q212938](https://www.wikidata.org/wiki/Q212938) East Jerusalem | Eastern part of Jerusalem, in dispute between Israel and the Palestinian Arabs since 1967 | middle-east |
| east prussia | province |  | 1 | [Q103801](https://www.wikidata.org/wiki/Q103801) East Prussia | province of Prussia | europe-elsewhere |
| eastern province | province | saudi arabia | 1 | [Q953508](https://www.wikidata.org/wiki/Q953508) Eastern Province | province of Saudi Arabia | middle-east |
| emirate of bukhara | historical state | uzbekistan | 1 | [Q746558](https://www.wikidata.org/wiki/Q746558) Emirate of Bukhara | 1785–1920 state in Central Asia | central-asia-caucasus |
| euphrates | river |  | 1 | [Q34589](https://www.wikidata.org/wiki/Q34589) Euphrates | river in Asia | middle-east |
| euro mediterranean region | world region |  | 1 | [Q16896634](https://www.wikidata.org/wiki/Q16896634) Euro-Mediterranean region | region encompassing all the European countries and the countries on the Mediterranean Rim (no coordinate) | transregional |
| faya | town | chad | 1 | [Q516769](https://www.wikidata.org/wiki/Q516769) Faya-Largeau | place in Borkou, Chad | west-central-africa |
| fezzan | region | libya | 1 | [Q188258](https://www.wikidata.org/wiki/Q188258) Fezzan | historic region and former province of Libya | north-africa |
| flanders | region | belgium | 1 | [Q9337](https://www.wikidata.org/wiki/Q9337) Flemish Region | federal region of Belgium | europe-elsewhere |
| french empire | historical state |  | 1 | [Q179023](https://www.wikidata.org/wiki/Q179023) French colonial empire | set of territories that were under French rule primarily from the 17th century to the late 1960s | europe-elsewhere |
| french mandate | historical state |  | 1 | [Q139708](https://www.wikidata.org/wiki/Q139708) French Mandate for Syria and the Lebanon | League of Nations mandate of France in the Middle East (1923–1946) | middle-east |
| french sudan | historical state | mali | 1 | [Q508014](https://www.wikidata.org/wiki/Q508014) French Sudan | French colonial territory in West Africa from 1880 to 1960, now Mali | west-central-africa |
| galata | neighbourhood | turkey | 1 | [Q501817](https://www.wikidata.org/wiki/Q501817) Galata | neighbourhood of Beyoğlu on the North side of the Golden Horn, often referred to as Pera in the past | middle-east |
| gambia valley | valley | gambia | 1 | [Q160819](https://www.wikidata.org/wiki/Q160819) Gambia River | river in West Africa | west-central-africa |
| ganges | river |  | 1 | [Q5089](https://www.wikidata.org/wiki/Q5089) Ganges | major river in India | south-asia |
| ganges | river | india | 1 | [Q5089](https://www.wikidata.org/wiki/Q5089) Ganges | major river in India | south-asia |
| gaza strip | region | palestine | 1 | [Q39760](https://www.wikidata.org/wiki/Q39760) Gaza Strip | self-governing Palestinian territory next to Egypt and Israel | middle-east |
| gaziantep | city | turkey | 1 | [Q93338](https://www.wikidata.org/wiki/Q93338) Gaziantep | city in Turkey | middle-east |
| german speaking countries | world region |  | 1 | [Q125851615](https://www.wikidata.org/wiki/Q125851615) German-speaking world | set of people and organizations around the world who speak German as a native language, or use it as a lingua franca (no coordinate) | europe-elsewhere |
| german speaking world | world region |  | 1 | [Q125851615](https://www.wikidata.org/wiki/Q125851615) German-speaking world | set of people and organizations around the world who speak German as a native language, or use it as a lingua franca (no coordinate) | europe-elsewhere |
| ghadames | town | libya | 1 | [Q192237](https://www.wikidata.org/wiki/Q192237) Ghadames | oasis | north-africa |
| gilgit baltistan | region | pakistan | 1 | [Q200697](https://www.wikidata.org/wiki/Q200697) Gilgit-Baltistan | Territory administered by Pakistan | south-asia |
| golan heights | region | syria | 1 | [Q83210](https://www.wikidata.org/wiki/Q83210) Golan Heights | Syrian territory occupied by Israel, annexed in 1981 | middle-east |
| grassfields | region | cameroon | 1 | [Q1627312](https://www.wikidata.org/wiki/Q1627312) Western High Plateau | mountainous area in Cameroon | west-central-africa |
| habsburg monarchy | historical state |  | 1 | [Q153136](https://www.wikidata.org/wiki/Q153136) Habsburg monarchy | monarchy in Europe (1282–1918) | europe-elsewhere |
| haifa | city | israel | 1 | [Q41621](https://www.wikidata.org/wiki/Q41621) Haifa | third-largest city in Israel | middle-east |
| halle | city | germany | 1 | [Q2814](https://www.wikidata.org/wiki/Q2814) Halle (Saale) | city in the German state of Saxony-Anhalt | europe-elsewhere |
| hattusa | city | turkey | 1 | [Q181007](https://www.wikidata.org/wiki/Q181007) Hattusa | capital of Hittite empire | middle-east |
| himalayas | mountain range |  | 1 | [Q5451](https://www.wikidata.org/wiki/Q5451) Himalayas | mountain range in Asia | transregional |
| hindi heartland | region | india | 1 | [Q3522980](https://www.wikidata.org/wiki/Q3522980) Hindi Belt | linguistic and cultural region in India where Hindi dialects are spoken and Hindi is used as a common inter-community lingua franca/second language (no coordinate) | south-asia |
| iberia | world region |  | 1 | [Q12837](https://www.wikidata.org/wiki/Q12837) Iberian Peninsula | peninsula located in the extreme southwest of Europe | europe-elsewhere |
| igboland | region | nigeria | 1 | [Q14234624](https://www.wikidata.org/wiki/Q14234624) Southeast Nigeria | region in Nigeria | west-central-africa |
| indian himalayas | region | india | 1 | [Q5451](https://www.wikidata.org/wiki/Q5451) Himalayas | mountain range in Asia | transregional |
| inner tian shan | mountain range | china | 1 | [Q5474](https://www.wikidata.org/wiki/Q5474) Tianshan Mountains | Asian mountain range separating northwest China from Central Asia and Russia | transregional |
| jabal akroum | region | lebanon | 1 | [Q12204698](https://www.wikidata.org/wiki/Q12204698) Jabal Akroum | a region in Lebanon | middle-east |
| jakarta | city | indonesia | 1 | [Q3630](https://www.wikidata.org/wiki/Q3630) Jakarta | capital and largest city of Indonesia | east-asia |
| jalal abad province | province | kyrgyzstan | 1 | [Q487640](https://www.wikidata.org/wiki/Q487640) Jalal-Abad Region | region of South Kyrgyzstan | central-asia-caucasus |
| jewish quarter | neighbourhood | israel | 1 | [Q1186403](https://www.wikidata.org/wiki/Q1186403) Jewish Quarter | part of the Jerusalem Old City | middle-east |
| johannesburg | city | south africa | 1 | [Q34647](https://www.wikidata.org/wiki/Q34647) Johannesburg | largest city in South Africa | east-southern-africa |
| karakoram mountains | mountain range |  | 1 | [Q5469](https://www.wikidata.org/wiki/Q5469) Karakoram | major mountain range spanning the borders between India, Pakistan, and China | transregional |
| kayseri | city | turkey | 1 | [Q48338](https://www.wikidata.org/wiki/Q48338) Kayseri | city in Turkey | middle-east |
| kazan governorate | province | russia | 1 | [Q1425322](https://www.wikidata.org/wiki/Q1425322) Kazan Governorate | governorate of the Russian Empire | europe-elsewhere |
| kenya coast | coast | kenya | 1 | [Q185371](https://www.wikidata.org/wiki/Q185371) Coast Province | former province of Kenya | east-southern-africa |
| kenya colony | historical state | kenya | 1 | [Q2538511](https://www.wikidata.org/wiki/Q2538511) Kenya Colony | former UK possession in Africa between 1920 and 1963 | east-southern-africa |
| khujand | city | tajikistan | 1 | [Q373808](https://www.wikidata.org/wiki/Q373808) Khujand | city in Tajikistan | central-asia-caucasus |
| kinshasa | city | democratic republic of the congo | 1 | [Q3838](https://www.wikidata.org/wiki/Q3838) Kinshasa | capital and the largest city of the Democratic Republic of the Congo having the status of a province | west-central-africa |
| kirghiz soviet socialist republic | historical state | kyrgyzstan | 1 | [Q130276](https://www.wikidata.org/wiki/Q130276) Kirghiz Soviet Socialist Republic | union republic of the Soviet Union | europe-elsewhere |
| konkan coast | coast | india | 1 | [Q1142402](https://www.wikidata.org/wiki/Q1142402) Konkan | region of Southwest India | south-asia |
| kurd dagh | mountain range | syria | 1 | [Q950873](https://www.wikidata.org/wiki/Q950873) Kurd-Dagh | upland area in Syria and Turkey | middle-east |
| kutaisi | city | georgia | 1 | [Q172415](https://www.wikidata.org/wiki/Q172415) Kutaisi | city in Georgia | central-asia-caucasus |
| kırsehir | city | turkey | 1 | [Q208005](https://www.wikidata.org/wiki/Q208005) Kırşehir | central district and city in Kırşehir Province, Turkey | middle-east |
| la marsa | town | tunisia | 1 | [Q27230](https://www.wikidata.org/wiki/Q27230) La Marsa | Tunisian town | north-africa |
| ladakh | region | india | 1 | [Q200667](https://www.wikidata.org/wiki/Q200667) Ladakh | region administered by India as a union territory | south-asia |
| lake asad | lake | syria | 1 | [Q979315](https://www.wikidata.org/wiki/Q979315) Euphrates Lake | reservoir on the Syrian Euphrates | middle-east |
| lake chad | lake |  | 1 | [Q125309](https://www.wikidata.org/wiki/Q125309) Lake Chad | lake in Africa | west-central-africa |
| lake van | lake | turkey | 1 | [Q126307](https://www.wikidata.org/wiki/Q126307) Lake Van | largest lake in Turkey | middle-east |
| lamu island | island | kenya | 1 | [Q783117](https://www.wikidata.org/wiki/Q783117) Lamu Island | island of Kenya | east-southern-africa |
| lamu region | region | kenya | 1 | [Q618573](https://www.wikidata.org/wiki/Q618573) Lamu Archipelago | Kenyan archipelago in the Indian Ocean | east-southern-africa |
| leipzig | city | germany | 1 | [Q2079](https://www.wikidata.org/wiki/Q2079) Leipzig | largest city in Saxony, Germany | europe-elsewhere |
| lenasia | neighbourhood | south africa | 1 | [Q2751060](https://www.wikidata.org/wiki/Q2751060) Lenasia | town in Gauteng, South Africa | east-southern-africa |
| logar province | province | afghanistan | 1 | [Q6667298](https://www.wikidata.org/wiki/Q6667298) Logar Province | province of Afghanistan | south-asia |
| london | city | united kingdom | 1 | [Q84](https://www.wikidata.org/wiki/Q84) London | capital and largest city of England and the United Kingdom | europe-elsewhere |
| madrid | city | spain | 1 | [Q2807](https://www.wikidata.org/wiki/Q2807) Madrid | capital of Spain | europe-elsewhere |
| malay archipelago | world region |  | 1 | [Q208643](https://www.wikidata.org/wiki/Q208643) Malay Archipelago | archipelago between mainland Southeast Asia and Australia | east-asia |
| manankoro | town | mali | 1 | [Q15244460](https://www.wikidata.org/wiki/Q15244460) Manankoro | town in Sikasso Region, Mali | west-central-africa |
| manipur | province | india | 1 | [Q1193](https://www.wikidata.org/wiki/Q1193) Manipur | state in northeastern India | south-asia |
| maputo | city | mozambique | 1 | [Q3889](https://www.wikidata.org/wiki/Q3889) Maputo | capital and chief port of Mozambique | east-southern-africa |
| mark brandenburg | region | germany | 1 | [Q1208](https://www.wikidata.org/wiki/Q1208) Brandenburg | state in North-East of Germany | europe-elsewhere |
| marzahn | neighbourhood | germany | 1 | [Q702521](https://www.wikidata.org/wiki/Q702521) Marzahn | locality of Berlin | europe-elsewhere |
| mauritius | island | mauritius | 1 | [Q1027](https://www.wikidata.org/wiki/Q1027) Mauritius | island sovereign state off of East Africa in the Indian Ocean | east-southern-africa |
| mes aynak | other | afghanistan | 1 | [Q721468](https://www.wikidata.org/wiki/Q721468) Mes Aynak | human settlement | south-asia |
| middle asia | world region |  | 1 | [Q27275](https://www.wikidata.org/wiki/Q27275) Central Asia | subregion of the Asian continent | gazetteer |
| middle east and north africa | world region |  | 1 | [Q984212](https://www.wikidata.org/wiki/Q984212) Middle East and North Africa | Middle East and North Africa region (no coordinate) | transregional |
| milan | city | italy | 1 | [Q490](https://www.wikidata.org/wiki/Q490) Milan | Italian commune and capital city of Lombardy | europe-elsewhere |
| murghab | town | tajikistan | 1 | [Q1018209](https://www.wikidata.org/wiki/Q1018209) Murghob | town in Gorno-Badakhshan, Tajikistan | central-asia-caucasus |
| mwambao coast | coast | kenya | 1 | [Q185371](https://www.wikidata.org/wiki/Q185371) Coast Province | former province of Kenya | east-southern-africa |
| najd | region | saudi arabia | 1 | [Q208154](https://www.wikidata.org/wiki/Q208154) Najd | central region of Arabia | middle-east |
| neom | city | saudi arabia | 1 | [Q42310572](https://www.wikidata.org/wiki/Q42310572) Neom | future destination project in Saudi Arabia | middle-east |
| new julfa | neighbourhood | iran | 1 | [Q1711781](https://www.wikidata.org/wiki/Q1711781) New Julfa | neighborhood in Isfahan, Iran | middle-east |
| new york | city | united states | 1 | [Q60](https://www.wikidata.org/wiki/Q60) New York City | most populous city in the United States | europe-elsewhere |
| new zealand | country | new zealand | 1 | [Q664](https://www.wikidata.org/wiki/Q664) New Zealand | island country in the southwest Pacific Ocean | europe-elsewhere |
| nikolassee | neighbourhood | germany | 1 | [Q576653](https://www.wikidata.org/wiki/Q576653) Nikolassee | locality of Berlin | europe-elsewhere |
| nile | river |  | 1 | [Q3392](https://www.wikidata.org/wiki/Q3392) Nile | major river in northeastern Africa | transregional |
| north america | world region |  | 1 | [Q49](https://www.wikidata.org/wiki/Q49) North America | continent in the Americas | europe-elsewhere |
| north india | region | india | 1 | [Q1058785](https://www.wikidata.org/wiki/Q1058785) North India | group of Northern Indian states | south-asia |
| north west frontier province | province | pakistan | 1 | [Q183314](https://www.wikidata.org/wiki/Q183314) Khyber Pakhtunkhwa | province of Pakistan | south-asia |
| north western europe | world region |  | 1 | [Q1414323](https://www.wikidata.org/wiki/Q1414323) Northwestern Europe | geographical region | europe-elsewhere |
| northeastern africa | world region |  | 1 | [Q7057805](https://www.wikidata.org/wiki/Q7057805) Northeast Africa | or Northeastern Africa or Northern East Africa as it was known in the past (no coordinate) | transregional |
| northern cyprus | region | cyprus | 1 | [Q23681](https://www.wikidata.org/wiki/Q23681) Northern Cyprus | de facto state on the island of Cyprus | middle-east |
| northern kurdistan | region | turkey | 1 | [Q3240533](https://www.wikidata.org/wiki/Q3240533) Turkish Kurdistan | Turkish part of Kurdistan | middle-east |
| odienne | city | ivory coast | 1 | [Q506811](https://www.wikidata.org/wiki/Q506811) Odienné | city of côte d'ivoire | west-central-africa |
| old delhi | neighbourhood | india | 1 | [Q3242297](https://www.wikidata.org/wiki/Q3242297) Old Delhi | walled city of Delhi, India | south-asia |
| ozersk | town | russia | 1 | [Q175802](https://www.wikidata.org/wiki/Q175802) Ozyorsk | town in Chelyabinsk Oblast, Russia | europe-elsewhere |
| pacific ocean | ocean |  | 1 | [Q98](https://www.wikidata.org/wiki/Q98) Pacific Ocean | ocean between Asia, Australia and the Americas | transregional |
| papua | province | indonesia | 1 | [Q5095](https://www.wikidata.org/wiki/Q5095) Papua | province of Indonesia | east-asia |
| porto alegre | city | brazil | 1 | [Q40269](https://www.wikidata.org/wiki/Q40269) Porto Alegre | municipality of Rio Grande do Sul state, Brazil | europe-elsewhere |
| potsdam | city | germany | 1 | [Q1711](https://www.wikidata.org/wiki/Q1711) Potsdam | capital city of the German state of Brandenburg | europe-elsewhere |
| qajar iran | historical state | iran | 1 | [Q63158027](https://www.wikidata.org/wiki/Q63158027) Qajar Iran | country in Western Asia (1789–1925) | middle-east |
| qatif | city | saudi arabia | 1 | [Q12191403](https://www.wikidata.org/wiki/Q12191403) Qatif | city in eastern Saudi Arabia | middle-east |
| raqqa | city | syria | 1 | [Q283368](https://www.wikidata.org/wiki/Q283368) Raqqa | city in Syria | middle-east |
| rome | city | italy | 1 | [Q220](https://www.wikidata.org/wiki/Q220) Rome | capital and largest city of Italy | europe-elsewhere |
| safavid empire | historical state |  | 1 | [Q18234383](https://www.wikidata.org/wiki/Q18234383) Safavid Iran | historical empire that existed between 1501 and 1736 | middle-east |
| saint petersburg | city | russia | 1 | [Q656](https://www.wikidata.org/wiki/Q656) Saint Petersburg | federal city and former capital of Russia | europe-elsewhere |
| santiago | city | chile | 1 | [Q2887](https://www.wikidata.org/wiki/Q2887) Santiago | capital city of Chile | europe-elsewhere |
| sarajevo | city | bosnia and herzegovina | 1 | [Q11194](https://www.wikidata.org/wiki/Q11194) Sarajevo | capital city of Bosnia and Herzegovina | europe-elsewhere |
| sasanian empire | historical state |  | 1 | [Q83891](https://www.wikidata.org/wiki/Q83891) Sasanian Empire | last pre-Islamic Iranian empire (224–651 AD) | middle-east |
| secunderabad | city | india | 1 | [Q1003502](https://www.wikidata.org/wiki/Q1003502) Secunderabad | twin city of Hyderabad, India | south-asia |
| seljuk empire | historical state |  | 1 | [Q3708094](https://www.wikidata.org/wiki/Q3708094) Seljuk Empire | Turco-Persian Sunni Muslim empire (1037–1194) | transregional |
| semey | city | kazakhstan | 1 | [Q61944](https://www.wikidata.org/wiki/Q61944) Semey | city in Eastern Kazakhstan, capital of Abay Region | central-asia-caucasus |
| senegambia | region |  | 1 | [Q3511003](https://www.wikidata.org/wiki/Q3511003) Senegambia | region of West Africa | west-central-africa |
| shaheen bagh | neighbourhood | india | 1 | [Q7461578](https://www.wikidata.org/wiki/Q7461578) Shaheen Bagh | neighbourhood in Delhi, India | south-asia |
| sikkim | region | india | 1 | [Q1505](https://www.wikidata.org/wiki/Q1505) Sikkim | state in northeastern India | south-asia |
| solomon's throne | mountain | kyrgyzstan | 1 | [Q750190](https://www.wikidata.org/wiki/Q750190) Sulaiman-Too | mountain in Osh city, Kyrgyzstan | central-asia-caucasus |
| soqotra | island | yemen | 1 | [Q82859](https://www.wikidata.org/wiki/Q82859) Socotra | main island of Socotra Archipelago in the Guardafui Channel | middle-east |
| soummam valley | valley | algeria | 1 | [Q3491757](https://www.wikidata.org/wiki/Q3491757) Soummam River | river in Algeria | north-africa |
| south sudan | country | south sudan | 1 | [Q958](https://www.wikidata.org/wiki/Q958) South Sudan | country in East Africa | east-southern-africa |
| southeast africa | world region |  | 1 | [Q7569281](https://www.wikidata.org/wiki/Q7569281) Southeast Africa | southeasterly region of the African continent (no coordinate) | east-southern-africa |
| southeast nigeria | region | nigeria | 1 | [Q14234624](https://www.wikidata.org/wiki/Q14234624) Southeast Nigeria | region in Nigeria | west-central-africa |
| southern caucasus | region |  | 1 | [Q200173](https://www.wikidata.org/wiki/Q200173) South Caucasus | geographical region in the vicinity of the southern Caucasus region of Europe | central-asia-caucasus |
| southern europe | world region |  | 1 | [Q27449](https://www.wikidata.org/wiki/Q27449) Southern Europe | southern region of the European continent | europe-elsewhere |
| southern morocco | region | morocco | 1 | [Q135671726](https://www.wikidata.org/wiki/Q135671726) Southern Morocco | region of Morocco (no coordinate) | north-africa |
| taljai | neighbourhood | india | 1 | [Q7679597](https://www.wikidata.org/wiki/Q7679597) Taljai Hills | hills in Pune, Maharashtra | south-asia |
| tamanrasset | city | algeria | 1 | [Q205792](https://www.wikidata.org/wiki/Q205792) Tamanrasset | city and capital of Tamanrasset Province, Algeria | north-africa |
| tamil nadu | region | india | 1 | [Q1445](https://www.wikidata.org/wiki/Q1445) Tamil Nadu | state of India | south-asia |
| tanta | city | egypt | 1 | [Q271771](https://www.wikidata.org/wiki/Q271771) Tanta | city in Egypt | north-africa |
| tarim | town | yemen | 1 | [Q1014010](https://www.wikidata.org/wiki/Q1014010) Tarim | city in Yemen | middle-east |
| the line | city | saudi arabia | 1 | [Q104772074](https://www.wikidata.org/wiki/Q104772074) The Line | linear smart city in Tabuk, Saudi Arabia | middle-east |
| thrace | region |  | 1 | [Q41741](https://www.wikidata.org/wiki/Q41741) Thrace | geographical and historical region in Southeast Europe | transregional |
| togoland | region |  | 1 | [Q161062](https://www.wikidata.org/wiki/Q161062) Togoland | former protectorate of the German colonial empire in West Africa (1884–1914), divided between present-day Ghana and Togo | west-central-africa |
| transjordan | region | jordan | 1 | [Q7834492](https://www.wikidata.org/wiki/Q7834492) Transjordan | region in the Middle East (no coordinate) | middle-east |
| upper gambia river valley | valley |  | 1 | [Q160819](https://www.wikidata.org/wiki/Q160819) Gambia River | river in West Africa | west-central-africa |
| upper river gambia valley | valley | gambia | 1 | [Q160819](https://www.wikidata.org/wiki/Q160819) Gambia River | river in West Africa | west-central-africa |
| vepery | neighbourhood | india | 1 | [Q16902610](https://www.wikidata.org/wiki/Q16902610) Vepery | Village in Chennai District, Tamil Nadu, India | south-asia |
| vichy france | historical state | france | 1 | [Q69808](https://www.wikidata.org/wiki/Q69808) Vichy France | client state of Nazi Germany, administering the Free Zone in southern France and French colonial possessions (1940–1944) | europe-elsewhere |
| volga | river | russia | 1 | [Q626](https://www.wikidata.org/wiki/Q626) Volga | river in Russia; the longest river in Europe | europe-elsewhere |
| west papua | region | indonesia | 1 | [Q5096](https://www.wikidata.org/wiki/Q5096) West Papua | province of Indonesia | east-asia |
| western armenia | region | turkey | 1 | [Q2311567](https://www.wikidata.org/wiki/Q2311567) Western Armenia | a term used for eastern parts of Turkey (formerly the Ottoman Empire) that were part of the historical homeland of Armenians. (no coordinate) | middle-east |
| western europe | world region |  | 1 | [Q27496](https://www.wikidata.org/wiki/Q27496) Western Europe | western part of the European continent | europe-elsewhere |
| western india | region | india | 1 | [Q1151567](https://www.wikidata.org/wiki/Q1151567) West India | geographic region of India | south-asia |
| wunsdorf | town | germany | 1 | [Q1566135](https://www.wikidata.org/wiki/Q1566135) Wünsdorf | borough of Zossen municipality in Teltow-Fläming district, Brandenburg state, Germany | europe-elsewhere |

## Unresolved

No candidate was confident enough; these mentions are not shown.

| Name | Type | Country given | Mentions | Best candidates |
|---|---|---|---:|---|
| northern chad | region | chad | 3 | Q106572235 Northern Chad offensive — rebel offensive in Northern Chad; Q108324270 Northern Chad offensive — Wikimedia disambiguation page |
| northern syria | region | syria | 3 | Q27628424 Turkish occupation of northern Syria — an autonomous region in northern Syria (under the control of the Syrian opposition); Q66817551 Northern Syria Buffer Zone — demilitarized zone in Syria; Q48842570 Northern Syria regional elections, 2017 — elections in Syria |
| southwest mali | region | mali | 3 |  |
| african red sea region | region |  | 2 |  |
| eastern nigeria | region | nigeria | 2 | Q96376925 Eastern Nigeria Marketing Board — The Eastern Nigerian Marketing Board was a statutory monopoly responsible for the purchase and carriage to port of export commodities produced in the Eastern Region of Nigeria.; Q106290556 Eastern Nigeria Information Service — Nigerian publishing house and publishers of Nigerian outlook; Q125609953 Eastern Nigeria International Film Festival —  |
| iran iraq borderlands | region |  | 2 |  |
| non european world | world region |  | 2 |  |
| southern kyrgyzstan | region | kyrgyzstan | 2 |  |
| southern punjab | region | pakistan | 2 | Q72853879 Southern Punjab cricket team — Pakistani first-class cricket team; Q19577941 Southern Punjab cricket team — Domestic cricket team in British India; Q48731298 Southern Punjab Railway —  |
| african red sea coast | coast |  | 1 |  |
| african red sea littoral | region |  | 1 |  |
| alma | village | kyrgyzstan | 1 | Q141973 Alma — city in Quebec, Canada; Q2478924 Alma — city in Bacon County, Georgia, United States; Q4733504 Alma — unincorporated community in Catron County, New Mexico |
| arab provinces | region |  | 1 |  |
| bulak | village | kyrgyzstan | 1 | Q12477643 Bulak — village in Jatibarang District, Indramayu Regency, West Java, Indonesia; Q11011296 Bulak — village in Kendal Regency, Central Java, Indonesia; Q13569504 Bulak — village in Ponorogo Regency, East Java, Indonesia |
| chaalan | neighbourhood | syria | 1 |  |
| deir mar musa (monastery) | other | syria | 1 |  |
| eastern bukhara | region | uzbekistan | 1 |  |
| eastern chad | region | chad | 1 |  |
| eastern turkey | region | turkey | 1 |  |
| eurafrica | world region |  | 1 | Q136482662 Eurafrica: The Untold History of European Integration and Colonialism — ; Q57680275 Eurafrica, the untold history of European integration and colonialism, by Peo Hansen and Stefan Jonsson — ; Q15808784 Eurafrica — idea of strategic partnership between Africa and Europe |
| euro african zone | world region |  | 1 |  |
| former soviet south | region |  | 1 |  |
| gangetic diaras | region | india | 1 |  |
| germyan | region | iraq | 1 |  |
| indonesia's far east | region | indonesia | 1 |  |
| intergel'po | neighbourhood | kyrgyzstan | 1 |  |
| iranian afghan border region | region |  | 1 |  |
| kamarob gorge | valley | tajikistan | 1 |  |
| mande kingdoms | historical state |  | 1 |  |
| mande region | region |  | 1 |  |
| muslim west | world region |  | 1 |  |
| north eastern pakistan | region | pakistan | 1 |  |
| north western benin | region | benin | 1 |  |
| northeastern turkey | region | turkey | 1 |  |
| northern algeria | region | algeria | 1 |  |
| northern horn of africa | region |  | 1 |  |
| northern kyrgyzstan | region | kyrgyzstan | 1 |  |
| northern mali | region | mali | 1 |  |
| northern swahili coast | coast |  | 1 | Q124328561 Northern Swahili Coastal Forests Ecoregion — One Earth Ecoregion |
| orient | world region |  | 1 | Q3461988 Orient — census-designated place in Suffolk County, New York; Q575726 Orient — city in Franklin County, Illinois, United States; Q733583 Orient — former village in Pickaway County, Ohio, United States |
| papua central highlands | region | indonesia | 1 |  |
| south western mali | region | mali | 1 |  |
| southeastern turkey | region | turkey | 1 |  |
| southern libya | region | libya | 1 | Q118906003 Southern Libya offensive —  |
| southern mediterranean | world region |  | 1 | Q136949818 Southern Mediterranean-Type Ecosystems: An Extratropical Marvel — ; Q105420912 Southern Mediterranean Seascape with Boats and Figures at Sunset — painting by Adrien Manglard |
| southern nigeria | region | nigeria | 1 | Q18164391 Southern Nigeria Government Gazette — Government gazette of Southern Nigeria (1907–1913); Q2062030 Southern Nigeria Protectorate — 1900–1914 UK possession in Western Africa; Q7570197 Southern Nigeria Regiment —  |
| southern russia | region | russia | 1 | Q14324291 South European Russia — part of Russia; Q18418566 Southern Russia intervention — 1918 allied intervention in the Russian Civil War; Q2388676 Southern Russian — dialect group of Russian |
| southern tunisia | region | tunisia | 1 | Q67680346 SOUTHERN TUNISIAN FRONT (ACTIVITIES BETWEEN GAFSA AND GABES, N. AFRICA) (NAID 14047) — item in the National Archives and Records Administration's holdings; Q33584864 Southern Tunisia: A still high endemicity area for hepatitis A. — scientific article |
| soviet south | region |  | 1 | Q50886775 Soviet South building — building in Rostov-on-Don, Russia |
| texas | neighbourhood | ivory coast | 1 | Q1439 Texas — state of the United States of America; Q60381099 Texas — 1985 edition; Q916484 Texas — Scottish musical group; alternative rock band |
| third world | world region |  | 1 | Q180194 Third World — category of countries on socio economic base; Q337352 The World Academy of Sciences — merit-based science academy; Q363 World War III — hypothetical global conflict |

## Places without a region

None of their countries is in the gazetteer; add the country there to place them.

None.
