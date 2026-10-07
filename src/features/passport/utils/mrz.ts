// ISO 3166-1 alpha-2 → alpha-3, for the nationality fields of the machine-readable zone.
const ISO3 = Object.fromEntries(
  (
    "AD:AND AE:ARE AF:AFG AG:ATG AI:AIA AL:ALB AM:ARM AO:AGO AQ:ATA AR:ARG AS:ASM AT:AUT AU:AUS AW:ABW AX:ALA AZ:AZE " +
    "BA:BIH BB:BRB BD:BGD BE:BEL BF:BFA BG:BGR BH:BHR BI:BDI BJ:BEN BL:BLM BM:BMU BN:BRN BO:BOL BQ:BES BR:BRA BS:BHS " +
    "BT:BTN BV:BVT BW:BWA BY:BLR BZ:BLZ CA:CAN CC:CCK CD:COD CF:CAF CG:COG CH:CHE CI:CIV CK:COK CL:CHL CM:CMR CN:CHN " +
    "CO:COL CR:CRI CU:CUB CV:CPV CW:CUW CX:CXR CY:CYP CZ:CZE DE:DEU DJ:DJI DK:DNK DM:DMA DO:DOM DZ:DZA EC:ECU EE:EST " +
    "EG:EGY EH:ESH ER:ERI ES:ESP ET:ETH FI:FIN FJ:FJI FK:FLK FM:FSM FO:FRO FR:FRA GA:GAB GB:GBR GD:GRD GE:GEO GF:GUF " +
    "GG:GGY GH:GHA GI:GIB GL:GRL GM:GMB GN:GIN GP:GLP GQ:GNQ GR:GRC GS:SGS GT:GTM GU:GUM GW:GNB GY:GUY HK:HKG HM:HMD " +
    "HN:HND HR:HRV HT:HTI HU:HUN ID:IDN IE:IRL IL:ISR IM:IMN IN:IND IO:IOT IQ:IRQ IR:IRN IS:ISL IT:ITA JE:JEY JM:JAM " +
    "JO:JOR JP:JPN KE:KEN KG:KGZ KH:KHM KI:KIR KM:COM KN:KNA KP:PRK KR:KOR KW:KWT KY:CYM KZ:KAZ LA:LAO LB:LBN LC:LCA " +
    "LI:LIE LK:LKA LR:LBR LS:LSO LT:LTU LU:LUX LV:LVA LY:LBY MA:MAR MC:MCO MD:MDA ME:MNE MF:MAF MG:MDG MH:MHL MK:MKD " +
    "ML:MLI MM:MMR MN:MNG MO:MAC MP:MNP MQ:MTQ MR:MRT MS:MSR MT:MLT MU:MUS MV:MDV MW:MWI MX:MEX MY:MYS MZ:MOZ NA:NAM " +
    "NC:NCL NE:NER NF:NFK NG:NGA NI:NIC NL:NLD NO:NOR NP:NPL NR:NRU NU:NIU NZ:NZL OM:OMN PA:PAN PE:PER PF:PYF PG:PNG " +
    "PH:PHL PK:PAK PL:POL PM:SPM PN:PCN PR:PRI PS:PSE PT:PRT PW:PLW PY:PRY QA:QAT RE:REU RO:ROU RS:SRB RU:RUS RW:RWA " +
    "SA:SAU SB:SLB SC:SYC SD:SDN SE:SWE SG:SGP SH:SHN SI:SVN SJ:SJM SK:SVK SL:SLE SM:SMR SN:SEN SO:SOM SR:SUR SS:SSD " +
    "ST:STP SV:SLV SX:SXM SY:SYR SZ:SWZ TC:TCA TD:TCD TF:ATF TG:TGO TH:THA TJ:TJK TK:TKL TL:TLS TM:TKM TN:TUN TO:TON " +
    "TR:TUR TT:TTO TV:TUV TW:TWN TZ:TZA UA:UKR UG:UGA UM:UMI US:USA UY:URY UZ:UZB VA:VAT VC:VCT VE:VEN VG:VGB VI:VIR " +
    "VN:VNM VU:VUT WF:WLF WS:WSM XK:XKX YE:YEM YT:MYT ZA:ZAF ZM:ZMB ZW:ZWE"
  )
    .split(" ")
    .map((pair) => pair.split(":")),
);

const LINE = 44;

export function iso3(code: string | null | undefined) {
  return (code && ISO3[code.toUpperCase()]) || "XXX";
}

/** Uppercase A–Z only: accents dropped, a few ligatures spelt out, anything non-Latin removed. */
export function mrzText(value: string) {
  return value
    .replace(/ß/g, "ss")
    .replace(/[Ææ]/g, "ae")
    .replace(/[Œœ]/g, "oe")
    .replace(/[Øø]/g, "o")
    .replace(/[Þþ]/g, "th")
    .replace(/[Đđ]/g, "d")
    .replace(/[Łł]/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/['’]/g, "")
    .replace(/[^A-Z0-9]+/g, "<")
    .replace(/^<+|<+$/g, "");
}

function fit(value: string, length: number) {
  return value.slice(0, length).padEnd(length, "<");
}

/** ICAO 9303 check digit (weights 7, 3, 1; '<' is 0, A is 10). */
export function checkDigit(value: string) {
  let sum = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    const n = ch === "<" ? 0 : ch >= "0" && ch <= "9" ? ch.charCodeAt(0) - 48 : ch.charCodeAt(0) - 55;
    sum += n * [7, 3, 1][i % 3];
  }
  return String(sum % 10);
}

/** A stable passport number for an account: two letters and seven digits from a hash of its id. */
export function passportNumber(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  const letters = String.fromCharCode(65 + (h % 26), 65 + (Math.floor(h / 26) % 26));
  let digits = Math.imul(h ^ 0x9e3779b9, 2654435761) >>> 0;
  digits = digits % 10_000_000;
  return `${letters}${String(digits).padStart(7, "0")}`;
}

function yymmdd(date: string | null | undefined, addYears = 0) {
  const m = date ? /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(date) : null;
  if (!m) return "<<<<<<";
  return `${String((Number(m[1]) + addYears) % 100).padStart(2, "0")}${m[2] ?? "01"}${m[3] ?? "01"}`;
}

export interface MrzInput {
  name: string;
  home: string | null;
  number: string;
  issued: string | null;
  countries: number;
  continents: number;
  daysAbroad: number;
}

/** TD3 MRZ lines; the issue date fills the birth-date slot (expiry +10 y), optional data holds the stats. */
export function buildMrz({ name, home, number, issued, countries, continents, daysAbroad }: MrzInput): [string, string] {
  const state = iso3(home);
  const parts = mrzText(name).split("<").filter(Boolean);
  const surname = parts.length > 1 ? parts[parts.length - 1] : (parts[0] ?? "");
  const given = parts.length > 1 ? parts.slice(0, -1).join("<") : "";
  const line1 = fit(`P<${state}${surname}<<${given}`, LINE);

  const doc = fit(mrzText(number), 9);
  const birth = yymmdd(issued);
  const expiry = yymmdd(issued, 10);
  const optional = fit(`C${countries}K${continents}D${daysAbroad}`, 14);
  const docPart = `${doc}${checkDigit(doc)}`;
  const birthPart = `${birth}${checkDigit(birth)}`;
  const expiryPart = `${expiry}${checkDigit(expiry)}`;
  const optionalPart = `${optional}${checkDigit(optional)}`;
  const composite = checkDigit(`${docPart}${birthPart}${expiryPart}${optionalPart}`);
  const line2 = `${docPart}${state}${birthPart}<${expiryPart}${optionalPart}${composite}`;
  return [line1, line2];
}
