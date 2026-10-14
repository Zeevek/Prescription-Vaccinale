"""Test de bout en bout de l'interface (Playwright, Chromium headless).
Usage : python3 tests/ui.test.py  (sert le dossier sur http://127.0.0.1:8765)
Produit des captures dans tests/out/."""
import http.server, json, os, socketserver, sys, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tests', 'out'); os.makedirs(OUT, exist_ok=True)
PORT = 8765

class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, *a): pass

socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(('127.0.0.1', PORT), Quiet)
threading.Thread(target=srv.serve_forever, daemon=True).start()

SETTINGS = {
    'revision': 1,
    'officine': {'nom': 'Pharmacie de Test', 'adresse': '1 rue de l’Exemple', 'cp': '63000', 'ville': 'Clermont-Ferrand', 'tel': '04 00 00 00 00', 'email': 'contact@exemple.fr', 'finess': '630000000', 'numAM': '', 'logo': ''},
    'pharmaciens': [{'id': 'p1', 'nom': 'Martin', 'prenom': 'Claire', 'statut': 'titulaire', 'rpps': '10000000001', 'declare': True},
                    {'id': 'p2', 'nom': 'Durand', 'prenom': 'Paul', 'statut': 'adjoint', 'rpps': '10000000002', 'declare': False}],
}

errors = []
ok = True
def check(cond, msg):
    global ok
    print(('✓ ' if cond else '✗ ') + msg)
    ok = ok and cond

with sync_playwright() as pw:
    br = pw.chromium.launch()
    pg = br.new_page(viewport={'width': 1280, 'height': 900})
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(str(e)))
    url = f'http://127.0.0.1:{PORT}/index.html?date=2026-10-14'
    pg.goto(url)
    pg.evaluate("s => localStorage.setItem('vp_settings_v1', JSON.stringify(s))", SETTINGS)
    pg.goto(url)
    pg.wait_for_selector('#p-nom')
    check('Pharmacie de Test' in pg.inner_text('#hdr-off'), 'en-tête officine chargé depuis les paramètres')

    # 1. patient : femme 70 ans
    pg.fill('#p-nom', 'Dupont'); pg.fill('#p-prenom', 'Jeanne')
    pg.check('input[name=sexe][value=F]')
    pg.fill('#p-ddn', '1956-03-12')
    check('70 ans' in pg.inner_text('#p-age'), 'âge calculé (70 ans)')
    pg.click('[data-p="patient.consentMT"] button[data-v="1"]')
    pg.click('[data-panel="1"] [data-go="2"]')

    # 2. entretien : non partout, anticoagulant oui
    for el in pg.query_selector_all('[data-panel="2"] .yn'):
        if el.is_visible():
            p = el.get_attribute('data-p')
            el.query_selector('button[data-v="%s"]' % ('1' if p == 'entretien.anticoag' else '0')).click()
    pg.click('[data-panel="2"] [data-go="3"]')

    # 3. profil : BPCO ; antécédents DTP 2015 (59 ans) ; grippe non faite
    pg.check('[data-p="risques.respChronique"]')
    pg.select_option('[data-p="histo.dtp.statut"]', 'connu')
    pg.fill('[data-p="histo.dtp.dernier"]', '2015-05-01')
    pg.click('[data-panel="3"] [data-go="4"]')

    pg.wait_for_selector('.rc')
    pg.screenshot(path=os.path.join(OUT, '1-recommandations.png'), full_page=True)
    recos = pg.eval_on_selector_all('.rc', "els => els.map(e => e.querySelector('b').textContent + ' : ' + e.dataset.s)")
    print('   ' + '\n   '.join(recos))
    for g in ['Grippe saisonnière : recommande', 'Covid-19 : recommande', 'Pneumocoque : recommande', 'Zona : recommande', 'Virus respiratoire syncytial (VRS) : recommande']:
        check(g in recos, 'recommandation présente — ' + g)
    al = pg.inner_text('#reco')
    check('sous-cutanée' in al, 'alerte anticoagulant : voie SC proposée')

    # ne garder que grippe + pneumo
    for g in ['covid', 'zona', 'vrs', 'dtcap']:
        box = pg.query_selector(f'[data-sel="{g}.on"]')
        if box and box.is_checked(): box.uncheck()
    pg.select_option('[data-sel="grippe.produit"]', 'vaxigrip')
    pg.click('[data-panel="4"] [data-go="5"]')

    # 5. ordonnance
    check(pg.is_disabled('#btn-print-ordo'), 'impression bloquée tant que l’entretien n’est pas attesté')
    pg.check('#confirm-entretien')
    check(not pg.is_disabled('#btn-print-ordo'), 'impression autorisée après attestation')
    prev = pg.inner_text('#ordo-preview')
    check('ORDONNANCE' in prev and 'VAXIGRIP' in prev.upper() and 'RPPS 10000000001' in prev, 'ordonnance : spécialité et RPPS présents')
    check('+33 4 00 00 00 00' in prev and 'France' in prev, 'ordonnance : téléphone international et mention France')
    check('voie sous-cutanée' in prev, 'ordonnance : voie SC retenue sous anticoagulant')
    check('L. 5125-1-1 A' in prev, 'ordonnance : base légale mentionnée')
    pg.screenshot(path=os.path.join(OUT, '2-ordonnance.png'), full_page=True)

    # pharmacien non déclaré → blocage
    pg.select_option('#hdr-pharm', 'p2')
    check(pg.is_disabled('#btn-print-ordo'), 'pharmacien non déclaré : prescription bloquée')
    pg.select_option('#hdr-pharm', 'p1')

    # PDF de l'ordonnance (rendu impression)
    html = pg.evaluate("() => VPApp.docOrdonnance(false) + VPApp.docFiche()")
    pg.evaluate("h => { document.getElementById('print-root').innerHTML = h; }", html)
    pg.emulate_media(media='print')
    pg.pdf(path=os.path.join(OUT, 'ordonnance.pdf'), format='A4', print_background=True, margin={'top': '0', 'bottom': '0', 'left': '0', 'right': '0'})
    pg.emulate_media(media='screen')
    pg.evaluate("() => { document.getElementById('print-root').innerHTML = ''; }")

    # 6. administration
    pg.click('[data-panel="5"] [data-go="6"]')
    check(pg.is_disabled('#btn-print-att'), 'attestation bloquée sans lot / péremption')
    pg.fill('[data-adm="grippe.lot"]', 'ab123c')
    pg.fill('[data-adm="grippe.peremption"]', '12/2025')
    pg.press('[data-adm="grippe.peremption"]', 'Tab')
    check('PÉRIMÉ' in pg.inner_text('#adm-msg'), 'vaccin périmé détecté')
    pg.fill('[data-adm="grippe.peremption"]', '06/2027'); pg.press('[data-adm="grippe.peremption"]', 'Tab')
    pg.fill('[data-adm="pneumo.lot"]', 'PN987'); pg.fill('[data-adm="pneumo.peremption"]', '01/2028'); pg.press('[data-adm="pneumo.peremption"]', 'Tab')
    pg.check('[data-a="dmp"]'); pg.check('[data-a="mtTransmis"]')
    check(not pg.is_disabled('#btn-print-att'), 'attestation imprimable une fois l’acte complet')
    att = pg.inner_text('#att-preview')
    check('AB123C' in att and '06/2027' in att and '2023-736' in att, 'attestation : lot, péremption, décret 2023-736')
    pg.click('#btn-mss')
    check('Cher Confrère' in pg.input_value('#adm-msg textarea'), 'message MSSanté généré')
    pg.screenshot(path=os.path.join(OUT, '3-administration.png'), full_page=True)
    html = pg.evaluate("() => VPApp.docAttestation()")
    pg.evaluate("h => { document.getElementById('print-root').innerHTML = h; }", html)
    pg.emulate_media(media='print')
    pg.pdf(path=os.path.join(OUT, 'attestation.pdf'), format='A4', print_background=True, margin={'top': '0', 'bottom': '0', 'left': '0', 'right': '0'})
    pg.emulate_media(media='screen')

    # Scénario 2 : femme enceinte 33 SA
    pg.goto(url); pg.wait_for_selector('#p-nom')
    pg.fill('#p-nom', 'Leroy'); pg.fill('#p-prenom', 'Inès'); pg.check('input[name=sexe][value=F]'); pg.fill('#p-ddn', '1996-07-02')
    pg.click('.step[data-step="2"]')
    for el in pg.query_selector_all('[data-panel="2"] .yn'):
        if el.is_visible():
            p = el.get_attribute('data-p')
            el.query_selector('button[data-v="%s"]' % ('1' if p == 'entretien.grossesse' else '0')).click()
    pg.fill('#e-sa', '33')
    pg.click('.step[data-step="4"]'); pg.wait_for_selector('.rc')
    recos = pg.eval_on_selector_all('.rc', "els => els.map(e => e.querySelector('b').textContent + ' : ' + e.dataset.s)")
    print('   ' + '\n   '.join(recos))
    check(any(r.startswith('Diphtérie') and r.endswith('recommande') for r in recos), 'grossesse : dTcaP recommandé')
    check(any(r.startswith('Virus respiratoire') and r.endswith('recommande') for r in recos), 'grossesse 33 SA : Abrysvo recommandé')
    pg.screenshot(path=os.path.join(OUT, '4-grossesse.png'), full_page=True)

    # Paramètres : ouverture
    pg.click('#btn-admin'); pg.wait_for_selector('#dlg-admin[open]')
    pg.click('.tab[data-tab="cat"]')
    pg.screenshot(path=os.path.join(OUT, '5-parametres.png'))
    pg.click('#adm-close')

    # Mobile
    m = br.new_page(viewport={'width': 390, 'height': 844})
    m.goto(url); m.wait_for_selector('#p-nom')
    m.screenshot(path=os.path.join(OUT, '6-mobile.png'), full_page=True)
    br.close()

srv.shutdown()
errors[:] = [e for e in errors if 'config.json' not in e and '404' not in e]
check(not errors, 'aucune erreur JavaScript' + ('' if not errors else ' : ' + ' | '.join(errors[:5])))
sys.exit(0 if ok else 1)
