// Can a Field House-style sports facility (indoor athletic facility + rentable sports fields) go in this
// city zone? Read from each city's use table on Nov 20–21, 2026. Verdicts:
//   permitted   – indoor sports and fields allowed outright (development conditions may still apply)
//   conditional – needs a conditional use / hearing / administrative permit, or only part of the program
//                 (indoor only or fields only) is allowed
//   prohibited  – neither is listed for the zone
//   unknown     – zone not in the table we read (often an old assessor zone code), or not read yet
// A city's code changes; confirm with the city before relying on any of this.

const R = (re, verdict, note) => ({ re, verdict, note });

export const CITY_RULES = {
  REDMOND: {
    source: 'https://redmond.municipal.codes/RZC/21.04.0200',
    rules: [
      R(/^I$/, 'prohibited', 'Arts, entertainment and recreation uses are not permitted in the Industrial zone.'),
      R(/^(NR|NMF|NMU|CMU|UMU|MME|MMC|MMM|DTE|DTC|TWNC|OV|OBAT|OUMF|BP|MP|UR|RA-5|COS)$/, 'conditional',
        'Recreation is allowed here, but Redmond requires a conditional use permit for athletic, sports and play fields in every zone.'),
    ],
  },
  SAMMAMISH: {
    source: 'https://sammamish.us/media/31rmvypr/sammamish-udc-13september2024.pdf',
    rules: [
      R(/^R-?\d/, 'conditional', 'Sports club is a conditional use, limited to clubs with supervised instructional or athletic programs (SDC 21.05.010.N).'),
      R(/^NB$/, 'conditional', 'Sports club is a conditional use in Neighborhood Business (SDC 21.05.010.N).'),
      R(/^CB$/, 'permitted', 'Sports club permitted in Community Business (SDC 21.05.010.N).'),
      R(/^O$/, 'prohibited', 'Sports club prohibited in the Office zone.'),
      R(/^TC ?[B-E]$/, 'prohibited', 'Sports club not allowed in Town Center B–E (SMC 21.07).'),
    ],
  },
  KENT: {
    source: 'https://www.codepublishing.com/WA/Kent/html/Kent15/Kent1504.html',
    rules: [
      R(/^(CM|GC|GC-MU)$/, 'permitted', 'Indoor sports facilities/athletic clubs and outdoor athletic fields are both permitted (KCC 15.04).'),
      R(/^I[123]$/, 'permitted', 'Indoor sports facilities and outdoor athletic fields permitted, subject to development condition 8 (KCC 15.04).'),
      R(/^MCR$/, 'conditional', 'Indoor sports facilities permitted or conditional; outdoor athletic fields conditional (KCC 15.04).'),
      R(/^(CC|CC-MU|DCE)$/, 'conditional', 'Indoor sports facilities permitted; outdoor athletic fields are not listed (KCC 15.04).'),
      R(/^(NCC|A-10|AG|NR-.*|SR-.*|MR-.*|MHP)$/, 'conditional', 'Only as a recreation facility under "open space uses" with a conditional use permit (KCC 15.04).'),
    ],
  },
  AUBURN: {
    source: 'https://auburn.municipal.codes/ACC/18.23.030',
    rules: [
      R(/^M-?1$/, 'permitted', 'Indoor and outdoor commercial recreation facilities permitted (ACC 18.23.030); outdoor facilities must be 300+ ft from residential zones (ACC 18.57.025).'),
      R(/^M-?2$/, 'conditional', 'Indoor and outdoor commercial recreation need administrative approval (ACC 18.23.030).'),
      R(/^C-?1$/, 'conditional', 'Indoor commercial recreation permitted; outdoor not allowed (ACC 18.23.030).'),
      R(/^(C-?2|C-?AG)$/, 'conditional', 'Indoor commercial recreation permitted; outdoor needs administrative approval (ACC 18.23.030).'),
      R(/^(R-?4|R-NM)$/, 'conditional', 'Indoor commercial recreation permitted; outdoor commercial recreation not listed (ACC 18.07.020).'),
      R(/^(RC|R-?1|R-?2|R-?3|R-F)$/, 'prohibited', 'Commercial recreation is not permitted in these residential zones (ACC 18.07.020).'),
    ],
  },
  RENTON: {
    source: 'https://www.codepublishing.com/WA/Renton/html/Renton04/Renton0402/Renton0402060.html',
    rules: [
      R(/^(IL|IH)$/, 'permitted', 'Indoor and outdoor recreational facilities permitted, with conditions (RMC 4-2-060).'),
      R(/^IM$/, 'conditional', 'Outdoor recreational facilities permitted; indoor not listed (RMC 4-2-060).'),
      R(/^(CA|CO|UC-?\d?)$/, 'conditional', 'Indoor recreation permitted; outdoor needs a hearing examiner conditional use permit (RMC 4-2-060).'),
      R(/^(CN|CV|CD|COR)$/, 'conditional', 'Indoor recreation permitted; outdoor recreation not listed (RMC 4-2-060).'),
      R(/^(RC|R-\d+|RMH|RM-F|RMF.*)$/, 'prohibited', 'Recreational facilities are not listed in residential zones (RMC 4-2-060).'),
    ],
  },
  COVINGTON: {
    source: 'https://covington.municipal.codes/CMC/18.25',
    rules: [
      R(/^R-?(4|6|8|12)$/, 'conditional', 'Indoor and outdoor recreation are conditional uses (CMC 18.25).'),
      R(/^(RCMU|I)$/, 'permitted', 'Indoor and outdoor recreation and fitness clubs permitted (CMC 18.25).'),
      R(/^(US|MR|R-?18)$/, 'prohibited', 'Indoor and outdoor recreation not listed for this zone (CMC 18.25).'),
    ],
  },
  'MAPLE VALLEY': {
    source: 'https://ecode360.com/47486519',
    rules: [
      R(/^(NB|CB|PUB|PRO|FCC|REC|RLTC)$/, 'permitted', 'Recreational use permitted (MVMC 18.30).'),
      R(/^R-\d+/, 'prohibited', 'Recreational use not listed in residential zones (MVMC 18.30).'),
    ],
  },
  SNOQUALMIE: {
    source: 'https://ecode360.com/49298989',
    rules: [
      R(/^BG$/, 'permitted', 'Enclosed and unenclosed commercial recreation permitted (SMC 17.55).'),
      R(/^(PCI|OP|I)$/, 'conditional', 'Unenclosed commercial recreation is conditional; enclosed (indoor) is not allowed (SMC 17.55).'),
      R(/^(OS-?\d|OS\d|R-?1.*|R-?2|RC|R-C|UP)$/, 'prohibited', 'Commercial recreation not allowed in this zone (SMC 17.55).'),
    ],
  },
  ENUMCLAW: {
    source: 'https://ecode360.com/48868902',
    rules: [
      R(/^LI$/, 'permitted', 'Indoor and outdoor commercial recreation permitted (EMC 18.05.050).'),
      R(/^P$/, 'permitted', 'Indoor and outdoor recreation permitted in the Public Use zone (EMC 18.05.050); usually publicly owned land.'),
      R(/^(GO|R-\d|RMHP)$/, 'prohibited', 'Commercial recreation not listed for this zone (EMC 18.05.050).'),
    ],
  },
  WOODINVILLE: {
    source: 'https://www.codepublishing.com/WA/Woodinville/html/Woodinville21/Woodinville2121.html',
    rules: [
      R(/^(T\/I|I)$/, 'conditional', 'Indoor and outdoor sports facilities mostly need a conditional use permit (WMC 21.21).'),
      R(/^(GB|CBD|TB)$/, 'conditional', 'Indoor sports facilities permitted; outdoor sports facilities only as an accessory use (WMC 21.21).'),
      R(/^R-\d+/, 'prohibited', 'Sports facilities only as accessory uses in residential zones (WMC 21.21).'),
    ],
  },
  ISSAQUAH: {
    source: 'https://issaquah.municipal.codes/LUC/18.402.020',
    rules: [
      R(/^(CBD|MU|MUR|MU-CI|PO|UC|VR|IC|IC-CI|CF-F)$/, 'permitted', 'Sports fields and health/fitness clubs permitted (IMC 18.402.020).'),
      R(/^(SF-.*|MF-.*|CF-R|CF-RPO)$/, 'conditional', 'Sports fields permitted (CF-RPO: fields without structures); indoor fitness club not listed (IMC 18.402.020).'),
      R(/^UV.*$/, 'conditional', 'Health/fitness club permitted in most UV zones; sports fields not listed (IMC 18.402.020).'),
      R(/^(C-RES|TP-NRCA|M)$/, 'prohibited', 'Sports fields and fitness clubs not listed (IMC 18.402.020).'),
    ],
  },
  BOTHELL: {
    source: 'https://bothell.municipal.codes/BMC/12.06.130',
    rules: [
      R(/\b(NB|CB|GC|LI)\b/, 'permitted', 'Sports fields and indoor recreation facilities permitted (BMC 12.06.130).'),
      R(/\b(R|R-AC|R-C|R-L\d?|RM\d?|OP|SSHO|MV)\b|^R \d+/, 'conditional', 'Sports fields permitted in every zone; indoor recreation facilities only in NB, CB, GC and LI (BMC 12.06.130).'),
    ],
  },
  BELLEVUE: {
    source: 'https://bellevue.municipal.codes/LUC/20.10.440',
    rules: [
      R(/^(LL|SR|LDR|MDR)-?\d/, 'conditional', 'Athletic fields are a conditional use; athletic clubs not listed in residential districts (LUC 20.10.440).'),
      R(/^(O|PO|OLB|OLB2|OLB-OS|LI|GC|NB|NMU|CB|MU-?\d+|F-?\d)$/, 'conditional', 'Athletic fields need a conditional use or administrative permit; athletic clubs permitted or conditional by district (LUC 20.10.440).'),
    ],
  },
  TUKWILA: {
    source: 'https://ecode360.com/attachment/340023/TU6948-018zzo%20Table%206%20-%20Land%20Uses%20Allowed%20by%20District.pdf',
    rules: [
      R(/^(C\/LI|LI|HI)$/, 'conditional', 'Indoor commercial recreation permitted; outdoor commercial recreation needs a conditional use permit (TMC Table 18-6).'),
      R(/^(MIC\/L|MIC\/H|TVS|TSO|TUC-.*|NM|RC|NCC)$/, 'conditional', 'Indoor commercial recreation permitted (some size limits); outdoor commercial recreation not listed (TMC Table 18-6).'),
      R(/^(CR|HDR|LDR|MDR)$/, 'prohibited', 'Commercial recreation not allowed in residential districts (TMC Table 18-6).'),
    ],
  },
  'NORTH BEND': {
    source: 'https://ecode360.com/48653947',
    rules: [
      R(/^(IC|NB|BP)$/, 'permitted', 'Indoor commercial recreation and athletic fields/sports facilities both permitted (NBMC Table 18.10.030).'),
      R(/^NMU$/, 'conditional', 'Indoor commercial recreation permitted; athletic fields/sports facilities need a conditional use permit (NBMC Table 18.10.030).'),
      R(/^(IMU|EP)$/, 'conditional', 'Indoor commercial recreation permitted; athletic fields not listed (NBMC Table 18.10.030).'),
      R(/^POSPF$/, 'conditional', 'Athletic fields permitted; indoor commercial recreation not listed; public facilities zone (NBMC Table 18.10.030).'),
      R(/^(LDR|CLDR|MDR|HDR)$/, 'prohibited', 'Indoor recreation and athletic fields not listed in residential zones (NBMC Table 18.10.030).'),
    ],
  },
  CARNATION: {
    source: 'https://storage.googleapis.com/proudcity/carnationwa/2025/02/Carnation-Municipal-Code-Chapter-15-and-16.pdf',
    rules: [
      R(/^AGI$/, 'permitted', 'Fitness/sport centers, indoor recreation (up to 10,000 sq ft) and outdoor recreation permitted (CMC 15.40 Table 2).'),
      R(/^(LI\/M|HC|SC)$/, 'conditional', 'Fitness/sport centers permitted; outdoor recreation needs a special or conditional use permit (CMC 15.40 Table 2).'),
      R(/^(CBD|MU)$/, 'conditional', 'Indoor recreation and fitness centers permitted; outdoor recreation not listed (CMC 15.40 Table 2).'),
      R(/^R\d/, 'prohibited', 'Recreation uses not listed in residential zones (CMC 15.40 Table 1).'),
    ],
  },
  'FEDERAL WAY': {
    source: 'https://www.federalwaywa.gov/sites/default/files/Documents/Department/CD/Planning/Land%20Use%20Apps%20and%20Info%20Handouts/047%20Summary%20of%20Uses_1.pdf',
    rules: [
      R(/^CE$/, 'permitted', 'Entertainment and recreational services and health clubs permitted (FWRC 19.240).'),
      R(/^CC(-[CF])?$/, 'permitted', 'Recreational services and health clubs permitted in City Center (FWRC 19.225/19.230); fields unlikely to fit.'),
      R(/^(SE|RS.*|RM.*)$/, 'unknown', 'Only private noncommercial sports fields are listed (FWRC 19.195–19.205); a commercial rental facility is not.'),
    ],
  },
};

export function cityVerdict(city, zone) {
  const c = CITY_RULES[city];
  if (!c) return { verdict: 'unknown', note: `Inside ${titleCase(city)}: the city's zoning code hasn't been read yet.`, source: null };
  const z = String(zone ?? '').trim().toUpperCase();
  for (const r of c.rules) if (r.re.test(z)) return { verdict: r.verdict, note: r.note, source: c.source };
  return { verdict: 'unknown', note: `Zone ${z || '(none)'} isn't in the ${titleCase(city)} use table we read; the assessor may use an older zone name.`, source: c.source };
}
const titleCase = (s) => String(s ?? '').toLowerCase().replace(/\b\w/g, (x) => x.toUpperCase());
