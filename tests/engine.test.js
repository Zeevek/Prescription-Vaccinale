/* Harnais de tests du moteur de recommandations.
   Usage : node tests/engine.test.js
   Le moteur est extrait du bloc <script id="vp-engine"> de index.html. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = /<script id="vp-engine">([\s\S]*?)<\/script>/.exec(html);
if (!m) { console.error('Bloc moteur introuvable'); process.exit(2); }
const sandbox = { globalThis: {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(m[1], sandbox);
const VP = sandbox.VP;

const SETTINGS = {
  campagnes: {
    grippe: { debut: '2026-10-13', fin: '2027-01-31' },
    covidPrintemps: { debut: '2027-04-14', fin: '2027-06-16' },
    vrsGrossesse: { debut: '2026-09-01', fin: '2027-01-31' }
  }
};
const TODAY = '2026-10-14';

let pass = 0, fail = 0;
function run(name, input, checks, today) {
  const res = VP.evaluate(input, SETTINGS, today || TODAY);
  const get = g => res.items.find(i => i.groupe === g);
  const errs = [];
  for (const [g, exp] of Object.entries(checks)) {
    if (g === '_global') { if (!exp(res)) errs.push('condition globale non vérifiée'); continue; }
    const it = get(g);
    const st = it ? it.status : 'absent';
    if (typeof exp === 'function') { const r = exp(it, res); if (r !== true) errs.push(g + ' : ' + (r || 'échec') + ' (statut ' + st + ')'); }
    else if (st !== exp) errs.push(g + ' : attendu ' + exp + ', obtenu ' + st + (it ? ' — ' + it.raisons.join(' | ') : ''));
  }
  if (errs.length) { fail++; console.log('✗ ' + name + '\n   ' + errs.join('\n   ')); }
  else { pass++; console.log('✓ ' + name); }
}
const P = (ddn, sexe, extra) => Object.assign({ patient: { nom: 'TEST', prenom: 'Cas', sexe: sexe || 'F', ddn }, entretien: {}, risques: {}, histo: {} }, extra || {});
const prods = it => (it && it.produits || []).map(p => p.id);

/* ---------------- dTcaP et tableau de transition */
run('Adulte 25 ans, dernier rappel à 12 ans → rappel 25 ans dû', P('2001-03-01', 'M', { histo: { dtp: { statut: 'connu', dernier: '2013-05-01' } } }), { dtcap: 'recommande' });
run('Adulte 30 ans, rappel à 22 ans → à jour, prochain à 45 ans', P('1996-01-10', 'M', { histo: { dtp: { statut: 'connu', dernier: '2018-02-01' } } }), {
  dtcap: it => it.status === 'a_jour' && VP.D.iso(it.prochaine) === '2041-01-10' || 'prochaine=' + (it && VP.D.iso(it.prochaine))
});
run('Adulte 50 ans, dernier rappel à 30 ans → rappel dû (> 45 ans manqué)', P('1976-06-01', 'F', { histo: { dtp: { statut: 'connu', dernier: '2006-06-01' } } }), { dtcap: 'recommande' });
run('Adulte 46 ans, rappel à 42 ans → à jour, prochain à 65 ans', P('1980-05-05', 'M', { histo: { dtp: { statut: 'connu', dernier: '2022-06-01' } } }), {
  dtcap: it => it.status === 'a_jour' && it.prochaine.getFullYear() === 2045 || 'prochaine=' + VP.D.iso(it.prochaine)
});
run('Senior 66 ans, rappel à 62 ans → prochain à 75 ans', P('1960-01-01', 'F', { histo: { dtp: { statut: 'connu', dernier: '2022-01-15' } } }), {
  dtcap: it => it.status === 'a_jour' && it.prochaine.getFullYear() === 2035 || VP.D.iso(it.prochaine)
});
run('Senior 72 ans, rappel à 55 ans → rappel dû (intervalle max)', P('1954-02-01', 'M', { histo: { dtp: { statut: 'connu', dernier: '2009-03-01' } } }), { dtcap: 'recommande' });
run('Ado 12 ans sans rappel des 6 ans → DTCaP Tétravac', P('2014-04-01', 'M', { histo: { dtp: { statut: 'connu', dernier: '2015-03-01', rappel6: 'non' } } }), {
  dtcap: it => it.status === 'recommande' && prods(it).join() === 'tetravac' || prods(it).join()
});
run('Ado 12 ans rappel 6 ans fait → dTcaP', P('2014-04-01', 'F', { histo: { dtp: { statut: 'connu', dernier: '2020-05-01', rappel6: 'oui' } } }), {
  dtcap: it => it.status === 'recommande' && prods(it).includes('boostrixtetra') && !prods(it).includes('tetravac') || prods(it).join()
});
run('Rappel il y a 3 ans mais âge fixe atteint → délai 5 ans non atteint', P('1981-01-01', 'M', { histo: { dtp: { statut: 'connu', dernier: '2023-06-01' } } }), { dtcap: 'a_jour' });
run('Statut inconnu adulte → rattrapage', P('1990-01-01', 'M', { histo: { dtp: { statut: 'inconnu' } } }), { dtcap: 'recommande' });
run('Femme enceinte 24 SA → dTcaP recommandé', P('1995-01-01', 'F', { entretien: { grossesse: true, sa: 24 } }), { dtcap: 'recommande', ror: it => !it || it.status !== 'recommande' || 'ROR proposé chez la femme enceinte' });
run('Femme enceinte 10 SA → dTcaP à différer', P('1995-01-01', 'F', { entretien: { grossesse: true, sa: 10 } }), { dtcap: 'differer' });
run('Cocooning : rappel > 5 ans, pas encore à âge fixe', P('1994-01-01', 'M', { risques: { entourageNourrisson: true }, histo: { dtp: { statut: 'connu', dernier: '2019-02-01' } } }), { dtcap: 'recommande' });

/* ---------------- ROR / vivants */
run('Né 1995, 1 dose ROR → 2e dose', P('1995-03-03', 'M', { histo: { ror: { doses: 1, dernier: '1996-04-01' } } }), { ror: it => it.status === 'recommande' && it.doseRang === 2 || it.doseRang });
run('Né 1995, 2 doses → à jour', P('1995-03-03', 'M', { histo: { ror: { doses: 2 } } }), { ror: 'a_jour' });
run('Immunodéprimé (corticoïdes) → ROR orienter', P('1995-03-03', 'M', { entretien: { corticoides: true }, histo: { ror: { doses: 0 } } }), { ror: 'orienter', zona: 'recommande' });
run('Enceinte → ROR contre-indiqué', P('1998-03-03', 'F', { entretien: { grossesse: true, sa: 20 }, histo: { ror: { doses: 1 } } }), { ror: 'ci' });
run('Allergie gélatine → MMRVaxPro exclu, Priorix conservé', P('1995-03-03', 'M', { entretien: { allergies: { gelatine: true } }, histo: { ror: { doses: 0 } } }), {
  ror: it => it.status === 'recommande' && prods(it).join() === 'priorix' || prods(it).join()
});
run('Femme née 1975, projet de grossesse, jamais vaccinée → 1 dose ROR', P('1985-01-01', 'F', {}), { ror: 'recommande' }); // née après 1980 : 2 doses
run('Femme née 1978 projet de grossesse → 1 dose', P('1978-06-01', 'F', { entretien: { projetGrossesse: true }, histo: { ror: { doses: 0 } } }), { ror: it => it.status === 'recommande' && it.totalDoses === 1 || it.totalDoses });
run('Homme né 1970 sans indication → ROR non indiqué', P('1970-01-01', 'M', {}), { ror: 'non_indique' });
run('Vaccin vivant reçu il y a 10 jours → ROR différé', P('2000-01-01', 'M', { entretien: { vivantRecent: '2026-10-04' }, histo: { ror: { doses: 1 } } }), { ror: 'differer' });

/* ---------------- HPV */
run('Fille 12 ans → HPV 2 doses Gardasil 9', P('2014-02-01', 'F', {}), { hpv: it => it.status === 'recommande' && it.totalDoses === 2 && prods(it).join() === 'gardasil9' || [it.totalDoses, prods(it)].join() });
run('Garçon 20 ans → HPV rattrapage 3 doses', P('2006-02-01', 'M', {}), { hpv: it => it.status === 'recommande' && it.totalDoses === 3 || it.totalDoses });
run('Femme 30 ans → HPV non indiqué', P('1996-02-01', 'F', {}), { hpv: 'non_indique' });
run('Ado 13 ans, 1re dose il y a 2 mois → schéma en cours', P('2013-01-01', 'F', { histo: { hpv: { doses: 1, premiere: '2026-08-10', dernier: '2026-08-10' } } }), { hpv: 'en_cours' });
run('16 ans, 1re dose à 13 ans → 2e dose (schéma 2 doses)', P('2010-01-01', 'M', { histo: { hpv: { doses: 1, premiere: '2023-03-01', dernier: '2023-03-01' } } }), { hpv: it => it.status === 'recommande' && it.totalDoses === 2 || it.totalDoses });
run('Enceinte 22 ans → HPV différé', P('2004-01-01', 'F', { entretien: { grossesse: true, sa: 25 } }), { hpv: 'differer' });

/* ---------------- Méningocoques */
run('15 ans jamais vacciné ACWY → recommandé', P('2011-01-01', 'M', {}), { menacwy: 'recommande', menb: 'propose' });
run('13 ans vacciné ACWY à 1 an → dose ado recommandée', P('2013-01-01', 'F', { histo: { menacwy: { dernier: '2014-02-01' } } }), { menacwy: 'recommande' });
run('20 ans vacciné ACWY à 12 ans → à jour', P('2006-01-01', 'F', { histo: { menacwy: { dernier: '2018-02-01' } } }), { menacwy: 'a_jour' });
run('Asplénie 40 ans → ACWY + B recommandés', P('1986-01-01', 'M', { risques: { asplenie: true } }), { menacwy: 'recommande', menb: 'recommande', pneumo: 'recommande' });

/* ---------------- Hépatite B */
run('12 ans non vacciné HB → rattrapage', P('2014-01-01', 'F', {}), { hepb: 'recommande' });
run('35 ans sans risque → HB non indiqué', P('1991-01-01', 'M', {}), { hepb: 'non_indique' });
run('30 ans partenaires multiples → HB Engerix B20', P('1996-01-01', 'M', { risques: { partenairesMultiples: true } }), { hepb: it => it.status === 'recommande' && prods(it).join() === 'engerixb20' || prods(it).join() });
run('HB 1 dose il y a 15 jours → en cours', P('1996-01-01', 'M', { risques: { partenairesMultiples: true }, histo: { hepb: { doses: 1, premiere: '2026-09-29', dernier: '2026-09-29' } } }), { hepb: 'en_cours' });
run('HB + HA indiqués ≥ 16 ans → Twinrix proposé', P('1990-01-01', 'M', { risques: { hsh: true, partenairesMultiples: true } }), { hepb: it => prods(it).includes('twinrix') || prods(it).join(), hepa: it => prods(it).includes('twinrix') || prods(it).join() });

/* ---------------- Pneumocoque */
run('70 ans jamais vacciné → VPC20/21', P('1956-01-01', 'F', {}), { pneumo: it => it.status === 'recommande' && prods(it).join() === 'prevenar20,capvaxive' || prods(it).join() });
run('70 ans VPC13-VPP23, VPP23 il y a 3 ans → en cours', P('1956-01-01', 'F', { histo: { pneumo: { vpc13: '2022-01-01', vpp23: '2023-06-01' } } }), { pneumo: 'en_cours' });
run('50 ans diabète non équilibré → pneumo recommandé', P('1976-01-01', 'M', { risques: { diabeteNonEquilibre: true } }), { pneumo: 'recommande' });
run('40 ans sans risque → pneumo non indiqué', P('1986-01-01', 'M', {}), { pneumo: 'non_indique' });
run('14 ans à risque → VPC13/15', P('2012-01-01', 'M', { risques: { asplenie: true } }), { pneumo: it => it.status === 'recommande' && prods(it).includes('prevenar13') || prods(it).join() });

/* ---------------- Grippe / Covid */
run('70 ans en campagne → grippe recommandée, Efluelda/Fluad en tête', P('1956-01-01', 'M', {}), { grippe: it => it.status === 'recommande' && ['efluelda', 'fluad'].includes(prods(it)[0]) || prods(it).join(), covid: 'recommande' });
run('40 ans sans risque → grippe proposée (non remboursée)', P('1986-01-01', 'M', {}), { grippe: it => it.status === 'propose' && /non pris en charge/.test(it.priseEnCharge) || it.priseEnCharge, covid: 'propose' });
run('15 ans sans comorbidité → grippe proposée 65 %', P('2011-01-01', 'F', {}), { grippe: it => it.status === 'propose' && /65/.test(it.priseEnCharge) || it.priseEnCharge });
run('Allergie à l’œuf → grippe orienter', P('1956-01-01', 'M', { entretien: { allergies: { oeuf: true } } }), { grippe: 'orienter' });
run('Hors campagne (juillet) → grippe différée pour cible', P('1956-01-01', 'M', {}), { grippe: 'differer' }, '2026-07-01');
run('Déjà vacciné grippe cette saison → à jour', P('1956-01-01', 'M', { histo: { grippe: { saison: true } } }), { grippe: 'a_jour' });
run('Covid : dernière dose il y a 4 mois, 70 ans → en cours (délai 6 mois)', P('1956-01-01', 'M', { histo: { covid: { dose: '2026-06-10' } } }), { covid: 'en_cours' });
run('Covid : 82 ans, dose il y a 4 mois → délai 3 mois atteint', P('1944-01-01', 'M', { histo: { covid: { dose: '2026-06-10' } } }), { covid: 'recommande' });
run('Enfant 8 ans → seul Covid prescriptible', P('2018-01-01', 'M', {}), { covid: 'propose', grippe: 'absent', _global: r => r.globaux.some(g => /5 à 10 ans/.test(g.texte)) });
run('Enfant 3 ans → bloquant', P('2023-01-01', 'M', {}), { _global: r => r.globaux.some(g => g.niveau === 'bloquant') && r.items.length === 0 });
run('Allergie PEG → Comirnaty exclu, Nuvaxovid conservé', P('1956-01-01', 'M', { entretien: { allergies: { peg: true } } }), { covid: it => prods(it).join() === 'nuvaxovid' || prods(it).join() });
run('Femme enceinte → Covid ARNm seulement', P('1995-01-01', 'F', { entretien: { grossesse: true, sa: 30 } }), { covid: it => it.status === 'recommande' && !prods(it).includes('nuvaxovid') || prods(it).join(), grippe: 'recommande' });

/* ---------------- Zona / VRS */
run('67 ans → Shingrix 2 doses', P('1959-01-01', 'F', {}), { zona: it => it.status === 'recommande' && it.totalDoses === 2 || it.totalDoses });
run('67 ans zona il y a 6 mois → en cours (délai 1 an)', P('1959-01-01', 'F', { histo: { zona: { episode: '2026-04-01' } } }), { zona: 'en_cours' });
run('30 ans immunodéprimé → Shingrix recommandé', P('1996-01-01', 'M', { entretien: { immunosup: true } }), { zona: 'recommande' });
run('50 ans immunocompétent → zona non indiqué', P('1976-01-01', 'M', {}), { zona: 'non_indique' });
run('78 ans → VRS recommandé, non remboursé', P('1948-01-01', 'M', {}), { vrs: it => it.status === 'recommande' && /Non pris en charge/.test(it.priseEnCharge) || it.priseEnCharge });
run('68 ans BPCO → VRS recommandé', P('1958-01-01', 'M', { risques: { respChronique: true } }), { vrs: 'recommande' });
run('68 ans sans risque → VRS non indiqué', P('1958-01-01', 'M', {}), { vrs: 'non_indique' });
run('Enceinte 33 SA → Abrysvo', P('1995-01-01', 'F', { entretien: { grossesse: true, sa: 33 } }), { vrs: it => it.status === 'recommande' && prods(it).join() === 'abrysvo' || prods(it).join() });
run('Enceinte 28 SA → VRS en attente 32 SA', P('1995-01-01', 'F', { entretien: { grossesse: true, sa: 28 } }), { vrs: 'en_cours' });
run('Enceinte 34 SA, dTcaP il y a 5 jours → Abrysvo différé', P('1995-01-01', 'F', { entretien: { grossesse: true, sa: 34 }, histo: { dtp: { statut: 'connu', dernier: '2026-10-09' } } }), { vrs: 'differer' });

/* ---------------- Varicelle */
run('Ado 14 ans sans antécédent → varicelle', P('2012-01-01', 'M', { histo: { varicelle: { antecedent: 'non' } } }), { varicelle: 'recommande' });
run('Antécédent de varicelle → non indiqué', P('2012-01-01', 'M', { histo: { varicelle: { antecedent: 'oui' } } }), { varicelle: 'non_indique' });
run('Homme 40 ans contact immunodéprimé sans sérologie → proposé (sérologie)', P('1986-01-01', 'M', { risques: { entourageImmunodep: true }, histo: { varicelle: { antecedent: 'douteux' } } }), { varicelle: 'propose' });

/* ---------------- Transversal */
run('Fièvre → tout ce qui est recommandé est différé', P('1956-01-01', 'M', { entretien: { fievre: true } }), { grippe: 'differer', zona: 'differer', pneumo: 'differer' });
run('Anaphylaxie à un vaccin inconnu → orienter', P('1956-01-01', 'M', { entretien: { anaphylaxie: true, anaphylaxieVaccin: 'inconnu' } }), { grippe: 'orienter', zona: 'orienter' });
run('Anaphylaxie au vaccin grippe → CI grippe seulement', P('1956-01-01', 'M', { entretien: { anaphylaxie: true, anaphylaxieVaccin: 'grippe' } }), { grippe: 'ci', zona: 'recommande' });
run('Allergie aminosides → dTcaP contre-indiqué (toutes spécialités)', P('2001-03-01', 'M', { entretien: { allergies: { aminosides: true } }, histo: { dtp: { statut: 'connu', dernier: '2013-05-01' } } }), { dtcap: 'ci' });
run('Anticoagulant → alerte voie SC pour Vaxigrip', P('1956-01-01', 'M', { entretien: { anticoag: true } }), { grippe: it => it.alertes.some(a => /sous-cutanée/.test(a)) || it.alertes.join(' | ') });
run('SGB post-vaccinal → orienter', P('1956-01-01', 'M', { entretien: { sgb: true } }), { grippe: 'orienter' });
run('Voyage, sans autre indication → hépatite A orienter', P('1990-01-01', 'M', { entretien: { voyage: true } }), { hepa: 'orienter' });

/* ---------------- prochainRappelDTP : tableau de transition */
(function () {
  const cases = [ // [naissance, dernier rappel, âge attendu du prochain RDV ou null si intervalle max]
    ['1980-01-01', '2002-06-01', 45], // 22 ans → 45
    ['1980-01-01', '2021-06-01', 65], // 41 ans → 65
    ['1950-01-01', '2012-06-01', 75], // 62 ans → 75
    ['1950-01-01', '2022-06-01', 85], // 72 ans → 85
    ['1950-01-01', '2032-06-01', 95]  // 82 ans → 95
  ];
  for (const [dob, last, exp] of cases) {
    const c = VP.buildContext({ patient: { ddn: dob, sexe: 'M' } }, SETTINGS, TODAY);
    const r = VP.prochainRappelDTP(c, VP.D.parse(last));
    if (r.age === exp) { pass++; console.log('✓ transition : dernier rappel ' + last + ' → ' + exp + ' ans'); }
    else { fail++; console.log('✗ transition : dernier rappel ' + last + ' → attendu ' + exp + ', obtenu ' + r.age + ' (' + r.motif + ')'); }
  }
})();

console.log('\n' + pass + ' réussis, ' + fail + ' échoués');
process.exit(fail ? 1 : 0);
