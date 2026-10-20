export type CountryOption = {
  code: string;
  name: string;
};

export type CurrencyOption = {
  code: string;
  name: string;
};

const COUNTRY_DATA = `
AF|Afghanistan
AX|Aland Islands
AL|Albania
DZ|Algeria
AS|American Samoa
AD|Andorra
AO|Angola
AI|Anguilla
AQ|Antarctica
AG|Antigua and Barbuda
AR|Argentina
AM|Armenia
AW|Aruba
AU|Australia
AT|Austria
AZ|Azerbaijan
BS|Bahamas
BH|Bahrain
BD|Bangladesh
BB|Barbados
BY|Belarus
BE|Belgium
BZ|Belize
BJ|Benin
BM|Bermuda
BT|Bhutan
BO|Bolivia
BQ|Bonaire Sint Eustatius and Saba
BA|Bosnia and Herzegovina
BW|Botswana
BV|Bouvet Island
BR|Brazil
IO|British Indian Ocean Territory
BN|Brunei Darussalam
BG|Bulgaria
BF|Burkina Faso
BI|Burundi
CV|Cabo Verde
KH|Cambodia
CM|Cameroon
CA|Canada
KY|Cayman Islands
CF|Central African Republic
TD|Chad
CL|Chile
CN|China
CX|Christmas Island
CC|Cocos Islands
CO|Colombia
KM|Comoros
CG|Congo
CD|Congo Democratic Republic
CK|Cook Islands
CR|Costa Rica
CI|Cote d'Ivoire
HR|Croatia
CU|Cuba
CW|Curacao
CY|Cyprus
CZ|Czechia
DK|Denmark
DJ|Djibouti
DM|Dominica
DO|Dominican Republic
EC|Ecuador
EG|Egypt
SV|El Salvador
GQ|Equatorial Guinea
ER|Eritrea
EE|Estonia
SZ|Eswatini
ET|Ethiopia
FK|Falkland Islands
FO|Faroe Islands
FJ|Fiji
FI|Finland
FR|France
GF|French Guiana
PF|French Polynesia
TF|French Southern Territories
GA|Gabon
GM|Gambia
GE|Georgia
DE|Germany
GH|Ghana
GI|Gibraltar
GR|Greece
GL|Greenland
GD|Grenada
GP|Guadeloupe
GU|Guam
GT|Guatemala
GG|Guernsey
GN|Guinea
GW|Guinea-Bissau
GY|Guyana
HT|Haiti
HM|Heard Island and McDonald Islands
VA|Holy See
HN|Honduras
HK|Hong Kong
HU|Hungary
IS|Iceland
IN|India
ID|Indonesia
IR|Iran
IQ|Iraq
IE|Ireland
IM|Isle of Man
IL|Israel
IT|Italy
JM|Jamaica
JP|Japan
JE|Jersey
JO|Jordan
KZ|Kazakhstan
KE|Kenya
KI|Kiribati
KP|North Korea
KR|South Korea
KW|Kuwait
KG|Kyrgyzstan
LA|Laos
LV|Latvia
LB|Lebanon
LS|Lesotho
LR|Liberia
LY|Libya
LI|Liechtenstein
LT|Lithuania
LU|Luxembourg
MO|Macao
MK|North Macedonia
MG|Madagascar
MW|Malawi
MY|Malaysia
MV|Maldives
ML|Mali
MT|Malta
MH|Marshall Islands
MQ|Martinique
MR|Mauritania
MU|Mauritius
YT|Mayotte
MX|Mexico
FM|Micronesia
MD|Moldova
MC|Monaco
MN|Mongolia
ME|Montenegro
MS|Montserrat
MA|Morocco
MZ|Mozambique
MM|Myanmar
NA|Namibia
NR|Nauru
NP|Nepal
NL|Netherlands
NC|New Caledonia
NZ|New Zealand
NI|Nicaragua
NE|Niger
NG|Nigeria
NU|Niue
NF|Norfolk Island
MP|Northern Mariana Islands
NO|Norway
OM|Oman
PK|Pakistan
PW|Palau
PS|Palestine
PA|Panama
PG|Papua New Guinea
PY|Paraguay
PE|Peru
PH|Philippines
PN|Pitcairn
PL|Poland
PT|Portugal
PR|Puerto Rico
QA|Qatar
RE|Reunion
RO|Romania
RU|Russian Federation
RW|Rwanda
BL|Saint Barthelemy
SH|Saint Helena Ascension and Tristan da Cunha
KN|Saint Kitts and Nevis
LC|Saint Lucia
MF|Saint Martin
PM|Saint Pierre and Miquelon
VC|Saint Vincent and the Grenadines
WS|Samoa
SM|San Marino
ST|Sao Tome and Principe
SA|Saudi Arabia
SN|Senegal
RS|Serbia
SC|Seychelles
SL|Sierra Leone
SG|Singapore
SX|Sint Maarten
SK|Slovakia
SI|Slovenia
SB|Solomon Islands
SO|Somalia
ZA|South Africa
GS|South Georgia and the South Sandwich Islands
SS|South Sudan
ES|Spain
LK|Sri Lanka
SD|Sudan
SR|Suriname
SJ|Svalbard and Jan Mayen
SE|Sweden
CH|Switzerland
SY|Syrian Arab Republic
TW|Taiwan
TJ|Tajikistan
TZ|Tanzania
TH|Thailand
TL|Timor-Leste
TG|Togo
TK|Tokelau
TO|Tonga
TT|Trinidad and Tobago
TN|Tunisia
TR|Turkey
TM|Turkmenistan
TC|Turks and Caicos Islands
TV|Tuvalu
UG|Uganda
UA|Ukraine
AE|United Arab Emirates
GB|United Kingdom
US|United States
UM|United States Minor Outlying Islands
UY|Uruguay
UZ|Uzbekistan
VU|Vanuatu
VE|Venezuela
VN|Vietnam
VG|Virgin Islands British
VI|Virgin Islands US
WF|Wallis and Futuna
EH|Western Sahara
YE|Yemen
ZM|Zambia
ZW|Zimbabwe
`;

const CURRENCY_DATA = `
AED|United Arab Emirates Dirham
AFN|Afghan Afghani
ALL|Albanian Lek
AMD|Armenian Dram
ANG|Netherlands Antillean Guilder
AOA|Angolan Kwanza
ARS|Argentine Peso
AUD|Australian Dollar
AWG|Aruban Florin
AZN|Azerbaijani Manat
BAM|Bosnia and Herzegovina Convertible Mark
BBD|Barbados Dollar
BDT|Bangladeshi Taka
BGN|Bulgarian Lev
BHD|Bahraini Dinar
BIF|Burundian Franc
BMD|Bermudian Dollar
BND|Brunei Dollar
BOB|Boliviano
BRL|Brazilian Real
BSD|Bahamian Dollar
BTN|Bhutanese Ngultrum
BWP|Botswana Pula
BYN|Belarusian Ruble
BZD|Belize Dollar
CAD|Canadian Dollar
CDF|Congolese Franc
CHF|Swiss Franc
CLP|Chilean Peso
CNY|Chinese Yuan Renminbi
COP|Colombian Peso
CRC|Costa Rican Colon
CUP|Cuban Peso
CVE|Cape Verde Escudo
CZK|Czech Koruna
DJF|Djiboutian Franc
DKK|Danish Krone
DOP|Dominican Peso
DZD|Algerian Dinar
EGP|Egyptian Pound
ERN|Eritrean Nakfa
ETB|Ethiopian Birr
EUR|Euro
FJD|Fiji Dollar
FKP|Falkland Islands Pound
FOK|Faroese Króna
GBP|Pound Sterling
GEL|Georgian Lari
GGP|Guernsey Pound
GHS|Ghanaian Cedi
GIP|Gibraltar Pound
GMD|Gambian Dalasi
GNF|Guinean Franc
GTQ|Guatemalan Quetzal
GYD|Guyanese Dollar
HKD|Hong Kong Dollar
HNL|Honduran Lempira
HRK|Croatian Kuna
HTG|Haitian Gourde
HUF|Hungarian Forint
IDR|Indonesian Rupiah
ILS|Israeli New Shekel
IMP|Isle of Man Pound
INR|Indian Rupee
IQD|Iraqi Dinar
IRR|Iranian Rial
ISK|Icelandic Króna
JEP|Jersey Pound
JMD|Jamaican Dollar
JOD|Jordanian Dinar
JPY|Japanese Yen
KES|Kenyan Shilling
KGS|Kyrgyzstani Som
KHR|Cambodian Riel
KID|Kiribati Dollar
KMF|Comorian Franc
KRW|South Korean Won
KWD|Kuwaiti Dinar
KYD|Cayman Islands Dollar
KZT|Kazakhstani Tenge
LAK|Lao Kip
LBP|Lebanese Pound
LKR|Sri Lanka Rupee
LRD|Liberian Dollar
LSL|Lesotho Loti
LYD|Libyan Dinar
MAD|Moroccan Dirham
MDL|Moldovan Leu
MGA|Malagasy Ariary
MKD|Macedonian Denar
MMK|Myanmar Kyat
MNT|Mongolian Tugrik
MOP|Macanese Pataca
MRU|Mauritanian Ouguiya
MUR|Mauritian Rupee
MVR|Maldivian Rufiyaa
MWK|Malawian Kwacha
MXN|Mexican Peso
MYR|Malaysian Ringgit
MZN|Mozambican Metical
NAD|Namibian Dollar
NGN|Nigerian Naira
NIO|Nicaraguan Córdoba
NOK|Norwegian Krone
NPR|Nepalese Rupee
NZD|New Zealand Dollar
OMR|Omani Rial
PAB|Panamanian Balboa
PEN|Peruvian Sol
PGK|Papua New Guinean Kina
PHP|Philippine Peso
PKR|Pakistani Rupee
PLN|Polish Zloty
PYG|Paraguayan Guaraní
QAR|Qatari Riyal
RON|Romanian Leu
RSD|Serbian Dinar
RUB|Russian Ruble
RWF|Rwandan Franc
SAR|Saudi Riyal
SBD|Solomon Islands Dollar
SCR|Seychellois Rupee
SDG|Sudanese Pound
SEK|Swedish Krona
SGD|Singapore Dollar
SHP|Saint Helena Pound
SLE|Sierra Leonean Leone
SLL|Sierra Leonean Leone (legacy)
SOS|Somali Shilling
SRD|Surinamese Dollar
SSP|South Sudanese Pound
STN|São Tomé and Príncipe Dobra
SYP|Syrian Pound
SZL|Eswatini Lilangeni
THB|Thai Baht
TJS|Tajikistani Somoni
TMT|Turkmenistani Manat
TND|Tunisian Dinar
TOP|Tongan Paʻanga
TRY|Turkish Lira
TTD|Trinidad and Tobago Dollar
TVD|Tuvaluan Dollar
TWD|New Taiwan Dollar
TZS|Tanzanian Shilling
UAH|Ukrainian Hryvnia
UGX|Ugandan Shilling
USD|United States Dollar
UYU|Uruguayan Peso
UZS|Uzbekistan Som
VES|Venezuelan Bolívar
VND|Vietnamese Đồng
VUV|Vanuatu Vatu
WST|Samoan Tala
XAF|Central African CFA Franc
XCD|East Caribbean Dollar
XOF|West African CFA Franc
XPF|CFP Franc
YER|Yemeni Rial
ZAR|South African Rand
ZMW|Zambian Kwacha
ZWL|Zimbabwean Dollar
`;

export const COUNTRY_OPTIONS: CountryOption[] = COUNTRY_DATA.trim().split('\n').map((line) => {
  const [code, name] = line.split('|');
  return { code, name };
});

export const CURRENCY_OPTIONS: CurrencyOption[] = CURRENCY_DATA.trim().split('\n').map((line) => {
  const [code, name] = line.split('|');
  return { code, name };
});
