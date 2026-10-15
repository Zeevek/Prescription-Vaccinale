/* Tests du lecteur de Datamatrix GS1. Usage : node tests/gs1.test.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = /<script id="vp-gs1">([\s\S]*?)<\/script>/.exec(html);
const sb = {}; sb.globalThis = sb; vm.createContext(sb); vm.runInContext(m[1], sb);
const { parse, gtinCheck, GS } = sb.GS1;

const cip = '340093000001';            // 12 premiers chiffres d'un CIP13 fictif
const cip13 = cip + gtinCheck('0' + cip).slice(-1) ;
const g13 = '0' + cip13.slice(0, 12);
const GTIN = g13 + gtinCheck(g13);
const CIP13 = GTIN.slice(1);
const AZ = { '0': 'à', '1': '&', '2': 'é', '3': '"', '4': "'", '5': '(', '6': '-', '7': 'è', '8': '_', '9': 'ç', 'A': 'Q', 'Q': 'A', 'Z': 'W', 'W': 'Z', 'M': '?' };
const toAzerty = s => s.split('').map(c => AZ[c] || c).join('');

let pass = 0, fail = 0;
function t(name, raw, exp) {
  const r = parse(raw);
  const errs = [];
  for (const [k, v] of Object.entries(exp)) if (r[k] !== v) errs.push(k + ' = ' + JSON.stringify(r[k]) + ' (attendu ' + JSON.stringify(v) + ')');
  if (errs.length) { fail++; console.log('✗ ' + name + ' — ' + errs.join(', ')); } else { pass++; console.log('✓ ' + name); }
}
const base = { ok: true, cip13: CIP13, lot: 'AB123C', serie: 'SN0012345678', peremption: '2027-06' };
t('format avec parenthèses', '(01)' + GTIN + '(17)270630(10)AB123C(21)SN0012345678', base);
t('brut avec séparateur GS', '01' + GTIN + '17270630' + '10AB123C' + GS + '21SN0012345678', base);
t('brut sans séparateur, ordre 01-17-10-21', '01' + GTIN + '1727063010AB123C21SN0012345678', base);
t('brut sans séparateur, ordre 01-21-17-10', '01' + GTIN + '21SN0012345678' + GS + '1727063010AB123C', base);
t('préfixe ]d2 et retour chariot', ']d201' + GTIN + '17270630' + '10AB123C' + GS + '21SN0012345678\r\n', base);
t('séparateur texte <GS>', '01' + GTIN + '1727063010AB123C<GS>21SN0012345678', base);
t('douchette QWERTY sur poste AZERTY', toAzerty('01' + GTIN + '1727063010AB123C21SN0012345678'), Object.assign({}, base, { azerty: true }));
t('jour 00 → fin de mois', '01' + GTIN + '1727020010LOT9', { ok: true, peremption: '2027-02', peremptionJour: '2027-02-28', lot: 'LOT9' });
t('clé GTIN invalide → refus', '01' + GTIN.slice(0, 13) + ((+GTIN[13] + 1) % 10) + '1727063010AB1', { ok: false });
t('code-barres non GS1 → refus', 'ABCDEF', { ok: false });
/* ---------- Datamatrix INS */
const { parseINS, isINS } = sb.GS1;
const H = 'IS01' + '0'.repeat(22);
function ti(name, raw, exp) {
  const r = parseINS(raw); const errs = [];
  for (const [k, v] of Object.entries(exp)) if (r[k] !== v) errs.push(k + ' = ' + JSON.stringify(r[k]) + ' (attendu ' + JSON.stringify(v) + ')');
  if (errs.length) { fail++; console.log('✗ INS ' + name + ' — ' + errs.join(', ')); } else { pass++; console.log('✓ INS ' + name); }
}
const insOK = { ok: true, ins: '277010115400329', oid: '1.2.250.1.213.1.4.8', nom: 'DUPONT-MARTIN', prenoms: 'MARIE ANNE', prenom: 'MARIE', sexe: 'F', ddn: '1977-01-01', lieu: '63113' };
ti('avec séparateurs GS', H + 'S1277010115400329S21.2.250.1.213.1.4.8' + GS + 'S3MARIE ANNE' + GS + 'S4DUPONT-MARTIN' + GS + 'S5FS601-01-1977S763113', insOK);
ti('sans séparateur (douchette)', H + 'S1277010115400329S21.2.250.1.213.1.4.8S3MARIE ANNES4DUPONT-MARTINS5FS601-01-1977S763113', insOK);
ti('ordre des blocs différent, sans lieu', H + 'S4DUPONT-MARTINS3MARIE ANNES1277010115400329S5FS601-01-1977S21.2.250.1.213.1.4.8', Object.assign({}, insOK, { lieu: '' }));
ti('nom finissant par S', H + 'S1277010115400329S21.2.250.1.213.1.4.8S3JESSS4THOMASS5MS601-01-1977', { ok: true, prenoms: 'JESS', nom: 'THOMAS', sexe: 'M' });
const AZI = { '0': 'à', '1': '&', '2': 'é', '3': '"', '4': "'", '5': '(', '6': '-', '7': 'è', '8': '_', '9': 'ç', '-': ')', "'": 'ù', '.': ':', 'A': 'Q', 'Q': 'A', 'Z': 'W', 'W': 'Z', 'M': '?' };
ti('douchette QWERTY sur poste AZERTY', (H + 'S1277010115400329S21.2.250.1.213.1.4.8S3MARIE ANNES4DUPONT-MARTINS5FS601-01-1977S763113').split('').map(c => AZI[c] || c).join(''), Object.assign({}, insOK, { azerty: true }));
ti('incomplet → refus', H + 'S1277010115400329S4DUPONT', { ok: false });
if (isINS(H + 'S1') && !isINS('01' + GTIN)) { pass++; console.log('✓ INS distingué d\u2019un GS1'); } else { fail++; console.log('✗ isINS'); }

console.log('\n' + pass + ' réussis, ' + fail + ' échoués');
process.exit(fail ? 1 : 0);
