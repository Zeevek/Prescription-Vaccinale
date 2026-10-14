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
console.log('\n' + pass + ' réussis, ' + fail + ' échoués');
process.exit(fail ? 1 : 0);
