import type { CompanySeedEntry } from './types.ts';

/**
 * Satellite industry companies with known alias variants.
 * Each entry includes the canonical name, market identifiers,
 * a parent reference (by canonical name), and known FCC filing aliases.
 */
export const COMPANY_SEED_DATA: ReadonlyArray<CompanySeedEntry> = [
  // ── SpaceX ────────────────────────────────────────────────────────
  {
    name: 'SpaceX',
    ticker: null,
    exchange: null,
    website: 'https://spacex.com',
    parentRef: null,
    aliases: [
      'Space Exploration Holdings, LLC',
      'Space Exploration Technologies Corp.',
      'SpaceX Services, Inc.',
      'SpaceX',
    ],
  },

  // ── SES group ─────────────────────────────────────────────────────
  {
    name: 'SES S.A.',
    ticker: 'SESG',
    exchange: 'Euronext Paris',
    website: 'https://ses.com',
    parentRef: null,
    aliases: [
      'SES S.A.',
      'SES',
      'SES Americom, Inc.',
      'SES Americom',
      'New Skies Satellites B.V.',
      'New Skies Satellites',
      'SES Government Solutions',
      'SES Space & Defense, Inc.',
      'SES Space & Defense',
      'AMERICOM GOVERNMENT SERVICES, INC.',
      'Americom Government Services, Inc.',
      'SES Satellites (Gibraltar) Limited',
      'SES License Subsidiary, LLC',
      'SES Networks Lux, S.a.r.l.',
    ],
  },
  {
    name: 'O3b Limited',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: 'SES S.A.',
    aliases: [
      'O3b Limited',
      'O3b Networks Limited',
      'O3b',
      'SES-17/O3b mPOWER',
    ],
  },

  // ── Intelsat group ────────────────────────────────────────────────
  {
    name: 'Intelsat S.A.',
    ticker: null,
    exchange: null,
    website: 'https://intelsat.com',
    parentRef: null,
    aliases: [
      'Intelsat S.A.',
      'Intelsat',
      'Intelsat License LLC',
      'Intelsat North America LLC',
      'Intelsat General Corporation',
      'Intelsat General Communications, Inc.',
      'PanAmSat Corporation',
      'PanAmSat Licensee Corp.',
      'PanAmSat',
      'Intelsat License LLC, Debtor-in-Possession',
      'Intelsat Jackson Holdings S.A.',
      'Intelsat US LLC',
      'Intelsat Holdings S.A.',
      'Intelsat Satellite LLC',
      'INTELSAT LLC',
      'Intelsat LLC',
    ],
  },

  // ── EchoStar / Hughes / DISH ──────────────────────────────────────
  {
    name: 'EchoStar Corporation',
    ticker: 'SATS',
    exchange: 'NASDAQ',
    website: 'https://echostar.com',
    parentRef: null,
    aliases: [
      'EchoStar Corporation',
      'EchoStar',
      'EchoStar Satellite Operating Corporation',
      'EchoStar Satellite Services L.L.C.',
      'EchoStar Operating L.L.C.',
      'EchoStar Technologies L.L.C.',
      'EchoStar Broadcasting Corporation',
      'DISH Operating L.L.C.',
      'DISH Network Corporation',
      'DISH Network L.L.C.',
      'DISH Network',
      'DISH',
      'DISH Satellite Services Corporation',
      'DISH Broadcasting Corporation',
      'DISH DBS Corporation',
    ],
  },
  {
    name: 'Hughes Network Systems, LLC',
    ticker: null,
    exchange: null,
    website: 'https://hughes.com',
    parentRef: 'EchoStar Corporation',
    aliases: [
      'Hughes Network Systems, LLC',
      'Hughes Network Systems',
      'Hughes Communications, Inc.',
      'HughesNet',
      'Hughes',
      'Hughes Electronics Corporation',
      'HNS License Sub, LLC',
      'HUGHES NETWORK SYSTEMS, INC.',
      'Hughes Network Systems, Inc.',
      'HUGHES COMMUNICATIONS GALAXY, INC.',
    ],
  },

  // ── Viasat ────────────────────────────────────────────────────────
  {
    name: 'Viasat, Inc.',
    ticker: 'VSAT',
    exchange: 'NASDAQ',
    website: 'https://viasat.com',
    parentRef: null,
    aliases: [
      'Viasat, Inc.',
      'Viasat',
      'ViaSat, Inc.',
      'Inmarsat Global Limited',
      'Inmarsat Solutions (US) Inc.',
      'Inmarsat Solutions US Inc.',
      'Inmarsat',
      'Inmarsat Inc.',
      'ISAT US Inc.',
    ],
  },

  // ── Telesat ───────────────────────────────────────────────────────
  {
    name: 'Telesat Canada',
    ticker: 'TSAT',
    exchange: 'NASDAQ',
    website: 'https://telesat.com',
    parentRef: null,
    aliases: [
      'Telesat Canada',
      'Telesat',
      'Telesat Network Services Inc.',
      'Telesat Network Services, Inc.',
      'Telesat International Limited',
    ],
  },

  // ── Iridium ───────────────────────────────────────────────────────
  {
    name: 'Iridium Communications Inc.',
    ticker: 'IRDM',
    exchange: 'NASDAQ',
    website: 'https://iridium.com',
    parentRef: null,
    aliases: [
      'Iridium Communications Inc.',
      'Iridium',
      'Iridium Constellation LLC',
      'Iridium Satellite LLC',
    ],
  },

  // ── Globalstar ────────────────────────────────────────────────────
  {
    name: 'Globalstar, Inc.',
    ticker: 'GSAT',
    exchange: 'NYSE',
    website: 'https://globalstar.com',
    parentRef: null,
    aliases: ['Globalstar, Inc.', 'Globalstar', 'Globalstar Licensee LLC'],
  },

  // ── OneWeb / Eutelsat ─────────────────────────────────────────────
  {
    name: 'Eutelsat Group',
    ticker: 'ETL',
    exchange: 'Euronext Paris',
    website: 'https://eutelsat.com',
    parentRef: null,
    aliases: ['Eutelsat Group', 'Eutelsat S.A.', 'Eutelsat'],
  },
  {
    name: 'OneWeb',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: 'Eutelsat Group',
    aliases: [
      'Network Access Associates Limited',
      'OneWeb',
      'WorldVu Satellites Limited',
    ],
  },

  // ── Kuiper (Amazon) ───────────────────────────────────────────────
  {
    name: 'Kuiper Systems LLC',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['Kuiper Systems LLC', 'Kuiper Systems', 'Amazon Kuiper'],
  },

  // ── Boeing ────────────────────────────────────────────────────────
  {
    name: 'The Boeing Company',
    ticker: 'BA',
    exchange: 'NYSE',
    website: 'https://boeing.com',
    parentRef: null,
    aliases: [
      'The Boeing Company',
      'Boeing',
      'Boeing Satellite Systems International, Inc.',
      'Boeing Satellite Systems',
    ],
  },

  // ── AST SpaceMobile ───────────────────────────────────────────────
  {
    name: 'AST SpaceMobile, Inc.',
    ticker: 'ASTS',
    exchange: 'NASDAQ',
    website: 'https://ast-science.com',
    parentRef: null,
    aliases: ['AST SpaceMobile, Inc.', 'AST SpaceMobile', 'AST & Science, LLC'],
  },

  // ── Lynk Global ───────────────────────────────────────────────────
  {
    name: 'Lynk Global, Inc.',
    ticker: null,
    exchange: null,
    website: 'https://lynk.world',
    parentRef: null,
    aliases: ['Lynk Global, Inc.', 'Lynk Global', 'Lynk', 'UbiquitiLink, Inc.'],
  },

  // ── Ligado / AMSC ─────────────────────────────────────────────────
  {
    name: 'Ligado Networks LLC',
    ticker: null,
    exchange: null,
    website: 'https://ligado.com',
    parentRef: null,
    aliases: [
      'Ligado Networks LLC',
      'Ligado Networks',
      'Ligado',
      'Ligado Networks Subsidiary LLC',
      'Ligado Networks Subsidiary LLC, Debtor-in-Possession',
      'LightSquared Inc.',
      'LightSquared',
      'SkyTerra Communications, Inc.',
      'SkyTerra',
      'Mobile Satellite Ventures Subsidiary LLC',
    ],
  },

  // ── ORBCOMM ───────────────────────────────────────────────────────
  {
    name: 'ORBCOMM Inc.',
    ticker: null,
    exchange: null,
    website: 'https://orbcomm.com',
    parentRef: null,
    aliases: ['ORBCOMM Inc.', 'ORBCOMM', 'ORBCOMM License Corp.'],
  },

  // ── DIRECTV ───────────────────────────────────────────────────────
  {
    name: 'DIRECTV',
    ticker: null,
    exchange: null,
    website: 'https://directv.com',
    parentRef: null,
    aliases: ['DIRECTV', 'DIRECTV Enterprises, LLC', 'DIRECTV, LLC'],
  },

  // ── Comcast / NBCUniversal ────────────────────────────────────────
  {
    name: 'Comcast Corporation',
    ticker: 'CMCSA',
    exchange: 'NASDAQ',
    website: 'https://comcast.com',
    parentRef: null,
    aliases: [
      'Comcast Corporation',
      'Comcast',
      'Comcast Cable Communications Management, LLC',
      'Comcast Cable Communications, LLC',
    ],
    prefixAliases: ['Comcast of ', 'Comcast Cable', 'COMCAST '],
  },

  // ── Loral / Maxar ─────────────────────────────────────────────────
  {
    name: 'Maxar Technologies',
    ticker: null,
    exchange: null,
    website: 'https://maxar.com',
    parentRef: null,
    aliases: [
      'Maxar Technologies',
      'Maxar',
      'Maxar License Inc.',
      'Loral Space & Communications Inc.',
      'Loral',
      'Telesat Holdings Inc.',
      'LORAL SKYNET NETWORK SERVICES, INC.',
      'Loral Skynet Network Services, Inc.',
    ],
    prefixAliases: ['Loral '],
  },

  // ── Lockheed Martin ───────────────────────────────────────────────
  {
    name: 'Lockheed Martin Corporation',
    ticker: 'LMT',
    exchange: 'NYSE',
    website: 'https://lockheedmartin.com',
    parentRef: null,
    aliases: ['Lockheed Martin Corporation', 'Lockheed Martin'],
  },

  // ── Northrop Grumman ──────────────────────────────────────────────
  {
    name: 'Northrop Grumman Corporation',
    ticker: 'NOC',
    exchange: 'NYSE',
    website: 'https://northropgrumman.com',
    parentRef: null,
    aliases: ['Northrop Grumman Corporation', 'Northrop Grumman'],
  },

  // ── L3Harris ──────────────────────────────────────────────────────
  {
    name: 'L3Harris Technologies, Inc.',
    ticker: 'LHX',
    exchange: 'NYSE',
    website: 'https://l3harris.com',
    parentRef: null,
    aliases: ['L3Harris Technologies, Inc.', 'L3Harris', 'Harris Corporation'],
  },

  // ── Thales Alenia Space ───────────────────────────────────────────
  {
    name: 'Thales Group',
    ticker: 'HO',
    exchange: 'Euronext Paris',
    website: 'https://thalesgroup.com',
    parentRef: null,
    aliases: ['Thales Group', 'Thales', 'Thales Alenia Space'],
  },

  // ── AT&T ──────────────────────────────────────────────────────────
  {
    name: 'AT&T Inc.',
    ticker: 'T',
    exchange: 'NYSE',
    website: 'https://att.com',
    parentRef: null,
    aliases: [
      'AT&T Inc.',
      'AT&T',
      'AT&T Services, Inc.',
      'AT&T Enterprises, LLC',
      'AT&T Corp.',
      'AT&T CORP.',
      'AT&T CORP.,',
      'AMERICAN TELEPHONE AND TELEGRAPH COMPANY',
      'American Telephone and Telegraph Company',
      'AMERICAN TELEPHONE AND TELEGRAPH COMPANY (AT&T)',
    ],
    prefixAliases: ['AT&T '],
  },

  // ── T-Mobile / Deutsche Telekom ───────────────────────────────────
  {
    name: 'T-Mobile US, Inc.',
    ticker: 'TMUS',
    exchange: 'NASDAQ',
    website: 'https://t-mobile.com',
    parentRef: null,
    aliases: ['T-Mobile US, Inc.', 'T-Mobile', 'T-Mobile USA, Inc.'],
  },

  // ── Rivada Space Networks ─────────────────────────────────────────
  {
    name: 'Rivada Space Networks',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: [
      'Rivada Space Networks GmbH',
      'Rivada Space Networks',
      'Rivada Networks',
    ],
  },

  // ── Swarm / SpaceX subsidiary ─────────────────────────────────────
  {
    name: 'Swarm Technologies, Inc.',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: 'SpaceX',
    aliases: ['Swarm Technologies, Inc.', 'Swarm Technologies', 'Swarm'],
  },

  // ── Planet Labs ───────────────────────────────────────────────────
  {
    name: 'Planet Labs PBC',
    ticker: 'PL',
    exchange: 'NYSE',
    website: 'https://planet.com',
    parentRef: null,
    aliases: ['Planet Labs PBC', 'Planet Labs Inc.', 'Planet Labs', 'Planet'],
  },

  // ── Kepler Communications ─────────────────────────────────────────
  {
    name: 'Kepler Communications Inc.',
    ticker: null,
    exchange: null,
    website: 'https://kepler.space',
    parentRef: null,
    aliases: ['Kepler Communications Inc.', 'Kepler Communications'],
  },

  // ── NBC / Telemundo (Comcast subsidiary) ──────────────────────────
  {
    name: 'NBCUniversal Media, LLC',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: 'Comcast Corporation',
    aliases: [
      'NBCUniversal Media, LLC',
      'NBC Telemundo License LLC',
      'NBC Telemundo License Co.',
      'NBC Broadcasting',
    ],
  },

  // ── Alascom (AT&T subsidiary) ─────────────────────────────────────
  {
    name: 'Alascom, Inc.',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: 'AT&T Inc.',
    aliases: ['Alascom, Inc.', 'ALASCOM, INC.', 'Alascom'],
  },

  // ── Associated Press ──────────────────────────────────────────────
  {
    name: 'The Associated Press',
    ticker: null,
    exchange: null,
    website: 'https://ap.org',
    parentRef: null,
    aliases: [
      'The Associated Press',
      'THE ASSOCIATED PRESS',
      'Associated Press',
    ],
  },

  // ── Equatorial Communications ─────────────────────────────────────
  {
    name: 'Equatorial Communications',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: [
      'EQUATORIAL COMMUNICATION SERVICES',
      'EQUATORIAL COMMUNICATIONS COMPANY',
      'Equatorial Communications',
    ],
  },

  // ── Gray Television ───────────────────────────────────────────────
  {
    name: 'Gray Television, Inc.',
    ticker: 'GTN',
    exchange: 'NYSE',
    website: 'https://gray.tv',
    parentRef: null,
    aliases: [
      'Gray Television, Inc.',
      'Gray Television',
      'Gray Television Licensee, LLC',
    ],
  },

  // ── Nexstar Media ─────────────────────────────────────────────────
  {
    name: 'Nexstar Media Group, Inc.',
    ticker: 'NXST',
    exchange: 'NASDAQ',
    website: 'https://nexstar.tv',
    parentRef: null,
    aliases: [
      'Nexstar Media Group, Inc.',
      'Nexstar Media Inc.',
      'Nexstar Broadcasting',
    ],
    prefixAliases: ['Nexstar '],
  },

  // ── Fox Corporation ───────────────────────────────────────────────
  {
    name: 'Fox Corporation',
    ticker: 'FOXA',
    exchange: 'NASDAQ',
    website: 'https://foxcorporation.com',
    parentRef: null,
    aliases: [
      'Fox Corporation',
      'Fox Broadcasting Company',
      'Fox Television Stations, LLC',
    ],
    prefixAliases: ['Fox Television'],
  },

  // ── GCI Communication ────────────────────────────────────────────
  {
    name: 'GCI Communication Corp.',
    ticker: null,
    exchange: null,
    website: 'https://gci.com',
    parentRef: null,
    aliases: ['GCI Communication Corp.', 'GCI Communications', 'GCI'],
  },

  // ── Charter / Spectrum ────────────────────────────────────────────
  {
    name: 'Charter Communications, Inc.',
    ticker: 'CHTR',
    exchange: 'NASDAQ',
    website: 'https://charter.com',
    parentRef: null,
    aliases: [
      'Charter Communications, Inc.',
      'Charter Communications',
      'Charter Communications, LLC',
      'Spectrum Pacific West, LLC',
      'Spectrum Mid-America, LLC',
      'Spectrum Southeast, LLC',
      'Spectrum Management Holding Company, LLC',
      'Spectrum Sunshine State, LLC',
      'Spectrum Northeast, LLC',
      'Spectrum NLP, LLC',
      'Spectrum Gulf Coast, LLC',
      'Spectrum New York Metro, LLC',
      'Broadpoint License Co., LLC',
      'CC VIII Operating, LLC',
      'CC VIII OPERATING, LLC',
      'Cebridge Acquisition, L.P.',
      'Cebridge Acquisition, LLC',
      'Bresnan Communications, LLC',
    ],
    prefixAliases: [
      'Spectrum ',
      'Charter Communications',
      'Charter Cable',
      'Charter Video',
      'Charter Fiberlink',
      'CC VIII',
      'Cebridge ',
      'Bresnan ',
      'Broadpoint ',
    ],
  },

  // ── Scripps (E.W. Scripps) ───────────────────────────────────────
  {
    name: 'The E.W. Scripps Company',
    ticker: 'SSP',
    exchange: 'NASDAQ',
    website: 'https://scripps.com',
    parentRef: null,
    aliases: [
      'The E.W. Scripps Company',
      'Scripps Broadcasting Holdings LLC',
      'E.W. Scripps',
    ],
  },

  // ── Spire Global ──────────────────────────────────────────────────
  {
    name: 'Spire Global, Inc.',
    ticker: 'SPIR',
    exchange: 'NYSE',
    website: 'https://spire.com',
    parentRef: null,
    aliases: ['Spire Global, Inc.', 'Spire Global'],
  },

  // ── CBS / Paramount ───────────────────────────────────────────────
  {
    name: 'Paramount Global',
    ticker: 'PARA',
    exchange: 'NASDAQ',
    website: 'https://paramount.com',
    parentRef: null,
    aliases: [
      'Paramount Global',
      'ViacomCBS Inc.',
      'CBS Communications Services Inc.',
      'CBS Broadcasting Inc.',
    ],
  },

  // ── Anuvu (formerly Global Eagle) ─────────────────────────────────
  {
    name: 'Anuvu',
    ticker: null,
    exchange: null,
    website: 'https://anuvu.com',
    parentRef: null,
    aliases: [
      'Anuvu',
      'Anuvu Licensing Holdings LLC',
      'Global Eagle Entertainment',
    ],
  },

  // ── PSSI (Production Services) ────────────────────────────────────
  {
    name: 'PSSI Global Services LLC',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['PSSI Global Services LLC', 'PSSI Global Services', 'PSSI'],
  },

  // ── Goonhilly ─────────────────────────────────────────────────────
  {
    name: 'Goonhilly Earth Station Ltd.',
    ticker: null,
    exchange: null,
    website: 'https://goonhilly.org',
    parentRef: null,
    aliases: ['Goonhilly Earth Station Ltd.', 'Goonhilly Inc.', 'Goonhilly'],
  },

  // ── Time Warner / Warner Bros Discovery ───────────────────────────
  {
    name: 'Warner Bros. Discovery, Inc.',
    ticker: 'WBD',
    exchange: 'NASDAQ',
    website: 'https://wbd.com',
    parentRef: null,
    aliases: [
      'Warner Bros. Discovery, Inc.',
      'Time Warner NY Cable LLC',
      'Time Warner Cable',
      'WarnerMedia',
      'TIME WARNER ENTERTAINMENT COMPANY, L.P.',
      'AMERICAN TELEVISION AND COMMUNICATIONS CORPORATION',
      'WARNER AMEX CABLE COMMUNICATIONS, INC.',
      'CNN America, Inc.',
    ],
    prefixAliases: ['Time Warner ', 'Warner '],
  },

  // ── BFI (Bonneville International) ────────────────────────────────
  {
    name: 'Bonneville International Corporation',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['Bonneville International Corporation', 'BFI Licenses, LLC'],
  },

  // ── RCN ───────────────────────────────────────────────────────────
  {
    name: 'RCN Corporation',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['RCN Corporation', 'RCN License Subsidiary, Inc.', 'RCN'],
  },

  // ── American Satellite (legacy) ───────────────────────────────────
  {
    name: 'American Satellite Company',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['AMERICAN SATELLITE COMPANY', 'American Satellite Company'],
  },

  // ── GTE Spacenet (legacy, now Verizon lineage) ────────────────────
  {
    name: 'GTE Spacenet Corporation',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: [
      'GTE SPACENET CORPORATION',
      'GTE Spacenet Corporation',
      'GTE Spacenet',
      'GTE SPACENET SATELLITE SERVICES CORPORATION',
      'GE CAPITAL SPACENET SERVICES, INC.',
    ],
  },

  // ── Universal Space Network ───────────────────────────────────────
  {
    name: 'Universal Space Network, Inc.',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['Universal Space Network, Inc.', 'Universal Space Network'],
  },

  // ── COMSAT (Communications Satellite Corporation) ────────────────
  {
    name: 'COMSAT Corporation',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: [
      'COMSAT CORPORATION',
      'Comsat Corporation',
      'Comsat, Inc.',
      'COMSAT GENERAL CORPORATION',
      'Comsat General Corporation',
      'COMSAT',
    ],
    prefixAliases: ['COMSAT '],
  },

  // ── RCA American Communications (legacy, later GE Americom → SES) ──
  {
    name: 'RCA American Communications',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: 'SES S.A.',
    aliases: [
      'RCA AMERICAN COMMUNICATIONS, INC.',
      'RCA American Communications, Inc.',
      'RCA Americom',
    ],
  },

  // ── Sirius XM ───────────────────────────────────────────────────
  {
    name: 'Sirius XM Holdings Inc.',
    ticker: 'SIRI',
    exchange: 'NASDAQ',
    website: 'https://siriusxm.com',
    parentRef: null,
    aliases: [
      'Sirius XM Holdings Inc.',
      'Sirius XM Radio Inc.',
      'Sirius XM Radio LLC',
      'XM Radio LLC',
      'XM Radio Inc.',
      'Sirius Satellite Radio Inc.',
      'SIRIUS SATELLITE RADIO INC.',
      'XM Satellite Radio Inc.',
    ],
  },

  // ── MCI / Verizon Business ──────────────────────────────────────
  {
    name: 'MCI Communications',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: [
      'MCI Communications Services, Inc.',
      'MCI Communications Services LLC',
      'MCI COMMUNICATIONS CORPORATION',
      'MCI Communications Corporation',
      'MCI International, Inc.',
      'MCI INTERNATIONAL, INC.',
      'MCI WorldCom',
    ],
    prefixAliases: ['MCI '],
  },

  // ── Tribune Media ───────────────────────────────────────────────
  {
    name: 'Tribune Media Company',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: [
      'Tribune Media Company',
      'Tribune Broadcasting Company, LLC',
      'TRIBUNE BROADCASTING COMPANY',
    ],
    prefixAliases: ['Tribune '],
  },

  // ── SpeedCast ───────────────────────────────────────────────────
  {
    name: 'SpeedCast Communications Inc',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: [
      'SpeedCast Communications Inc',
      'SpeedCast Communications, Inc.',
      'Speedcast Communications Inc',
    ],
  },

  // ── Globecast ───────────────────────────────────────────────────
  {
    name: 'Globecast North America',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: [
      'GLOBECAST NORTH AMERICA INCORPORATED',
      'Globecast North America',
      'GLOBECAST NORTH AMERICA, INC.',
      'Globecomm License Sub LLC',
    ],
  },

  // ── Satellite Business Systems (legacy IBM/Comsat/Aetna JV) ────
  {
    name: 'Satellite Business Systems',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['SATELLITE BUSINESS SYSTEMS', 'Satellite Business Systems'],
  },

  // ── Denali (Liberty Broadband subsidiary) ───────────────────────
  {
    name: 'Denali 20020, LLC',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['Denali 20020, LLC'],
  },

  // ── Calian / Pacific Teleports ──────────────────────────────────
  {
    name: 'Calian Pacific Teleports Ltd.',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['Calian Pacific Teleports Ltd.', 'Calian Pacific Teleports'],
  },

  // ── Marlink ─────────────────────────────────────────────────────
  {
    name: 'Marlink, Inc.',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['Marlink, Inc.', 'Marlink'],
    prefixAliases: ['Marlink'],
  },

  // ── Vyvx (now Lumen/CenturyLink lineage) ───────────────────────
  {
    name: 'Vyvx, LLC',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['Vyvx, LLC', 'Vyvx'],
  },

  // ── SageNet ─────────────────────────────────────────────────────
  {
    name: 'SageNet LLC',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['SageNet LLC', 'SageNet'],
  },

  // ── Vizada / Airbus Defence ─────────────────────────────────────
  {
    name: 'Vizada Satellite, Inc.',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['Vizada Satellite, Inc.', 'Vizada'],
  },

  // ── TEGNA ───────────────────────────────────────────────────────
  {
    name: 'TEGNA Inc.',
    ticker: 'TGNA',
    exchange: 'NYSE',
    website: 'https://tegna.com',
    parentRef: null,
    aliases: ['TEGNA Inc.', 'TEGNA Broadcast Holdings, LLC', 'TEGNA'],
  },

  // ── RBC Signals ─────────────────────────────────────────────────
  {
    name: 'RBC Signals, LLC',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['RBC Signals, LLC', 'RBC Signals'],
  },

  // ── ATLAS Space Operations ──────────────────────────────────────
  {
    name: 'ATLAS Space Operations, Inc',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['ATLAS Space Operations, Inc', 'ATLAS Space Operations'],
  },

  // ── Amoco (legacy, now BP) ──────────────────────────────────────
  {
    name: 'Amoco Corporation',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['AMOCO CORPORATION', 'Amoco Corporation'],
  },

  // ── Hi-Net Communications ──────────────────────────────────────
  {
    name: 'Hi-Net Communications, Inc.',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['HI-NET COMMUNICATIONS, INC.', 'Hi-Net Communications'],
  },

  // ── Interlink Communications ───────────────────────────────────
  {
    name: 'Interlink Communications, Inc.',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['INTERLINK COMMUNICATIONS, INC.', 'Interlink Communications'],
  },

  // ── MCC Iowa (Mediacom subsidiary) ─────────────────────────────
  {
    name: 'MCC Iowa LLC',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['MCC IOWA LLC', 'MCC Iowa LLC'],
    prefixAliases: ['MCC '],
  },

  // ── Spectradyne ────────────────────────────────────────────────
  {
    name: 'Spectradyne, Inc.',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['SPECTRADYNE, INC.', 'Spectradyne, Inc.', 'Spectradyne'],
  },

  // ── Windjammer Communications ──────────────────────────────────
  {
    name: 'Windjammer Communications LLC',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['WINDJAMMER COMMUNICATIONS LLC', 'Windjammer Communications'],
  },

  // ── Cable One ──────────────────────────────────────────────────
  {
    name: 'Cable One, Inc.',
    ticker: 'CABO',
    exchange: 'NYSE',
    website: 'https://cableone.net',
    parentRef: null,
    aliases: ['CABLE ONE, INC.', 'Cable One, Inc.', 'Cable One'],
  },

  // ── Cox Communications ─────────────────────────────────────────
  {
    name: 'Cox Communications, Inc.',
    ticker: null,
    exchange: null,
    website: 'https://cox.com',
    parentRef: null,
    aliases: [
      'Cox Communications, Inc.',
      'CoxCom, LLC',
      'CoxCom, Inc.',
      'Cox Enterprises',
    ],
    prefixAliases: ['Cox Communications', 'COX COMMUNICATIONS', 'CoxCom'],
  },

  // ── Hearst ─────────────────────────────────────────────────────
  {
    name: 'Hearst Corporation',
    ticker: null,
    exchange: null,
    website: 'https://hearst.com',
    parentRef: null,
    aliases: [
      'Hearst Corporation',
      'Hearst Properties Inc.',
      'Hearst Stations Inc.',
    ],
    prefixAliases: ['Hearst '],
  },

  // ── New Cingular / AT&T Mobility ───────────────────────────────
  {
    name: 'AT&T Mobility LLC',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: 'AT&T Inc.',
    aliases: [
      'New Cingular Wireless PCS, LLC',
      'AT&T Mobility LLC',
      'Cingular Wireless LLC',
    ],
    prefixAliases: ['New Cingular '],
  },

  // ── Cirion Technologies ────────────────────────────────────────
  {
    name: 'Cirion Technologies Solutions, LLC',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['Cirion Technologies Solutions, LLC', 'Cirion Technologies'],
  },

  // ── Westar Satellite Services ──────────────────────────────────
  {
    name: 'Westar Satellite Services LP',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['Westar Satellite Services LP', 'Westar Satellite Services'],
  },

  // ── Midcontinent Communications ────────────────────────────────
  {
    name: 'Midcontinent Communications',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['Midcontinent Communications'],
  },

  // ── Maritime Telecommunications Network ────────────────────────
  {
    name: 'Maritime Telecommunications Network, Inc.',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: [
      'MARITIME TELECOMMUNICATIONS NETWORK, INC.',
      'Maritime Telecommunications Network, Inc.',
    ],
  },

  // ── IDB Communications ─────────────────────────────────────────
  {
    name: 'IDB Communications Group, Inc.',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['IDB COMMUNICATIONS GROUP, INC.', 'IDB Communications Group'],
  },

  // ── Tampnet ────────────────────────────────────────────────────
  {
    name: 'Tampnet USA LLC',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['Tampnet USA LLC', 'Tampnet'],
  },

  // ── Teleprompter Corporation (legacy cable) ────────────────────
  {
    name: 'Teleprompter Corporation',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['TELEPROMPTER CORPORATION', 'Teleprompter Corporation'],
  },

  // ── Contel Federal Systems ─────────────────────────────────────
  {
    name: 'Contel Federal Systems, Inc.',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['CONTEL FEDERAL SYSTEMS, INC.', 'Contel Federal Systems'],
  },

  // ── Verestar ───────────────────────────────────────────────────
  {
    name: 'Verestar, LLC',
    ticker: null,
    exchange: null,
    website: null,
    parentRef: null,
    aliases: ['VERESTAR, LLC', 'Verestar, LLC', 'Verestar'],
  },
];
