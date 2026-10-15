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
    pg.click('[data-mode="pneumo.deliv"]')
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
    check('Acte d’injection' in prev or 'Acte d\u2019injection' in prev, 'ordonnance : acte d’injection prescrit pour la grippe')
    check('Délivrance seule' in prev and '+2 °C' in prev, 'ordonnance : délivrance seule pour le pneumocoque, sur la même ordonnance')
    check(pg.query_selector('#opt-copie') is None and 'Copie conservée' not in prev, 'plus de copie officine')
    pg.screenshot(path=os.path.join(OUT, '2-ordonnance.png'), full_page=True)

    # pharmacien non déclaré → blocage
    pg.select_option('#hdr-pharm', 'p2')
    check(pg.is_disabled('#btn-print-ordo'), 'pharmacien non déclaré : prescription bloquée')
    pg.select_option('#hdr-pharm', 'p1')

    # PDF de l'ordonnance (rendu impression)
    html = pg.evaluate("() => VPApp.docOrdonnance() + VPApp.docFiche()")
    pg.evaluate("h => { document.getElementById('print-root').innerHTML = h; }", html)
    pg.emulate_media(media='print')
    pg.pdf(path=os.path.join(OUT, 'ordonnance.pdf'), format='A4', print_background=True, margin={'top': '0', 'bottom': '0', 'left': '0', 'right': '0'})
    pg.emulate_media(media='screen')
    pg.evaluate("() => { document.getElementById('print-root').innerHTML = ''; }")

    # 6. administration
    pg.click('[data-panel="5"] [data-go="6"]')
    check(pg.is_disabled('#btn-print-att'), 'attestation bloquée sans lot / péremption')
    check(pg.query_selector('[data-adm="pneumo.site"]') is None, 'délivrance seule : pas de voie/site à saisir')
    # scan douchette (frappe clavier sans champ actif) — CIP inconnu → association puis mémorisation
    def gtin(cip12):
        g = '0' + cip12; t = sum(int(d) * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(g))); return g + str((10 - t % 10) % 10)
    G1 = gtin('340093000001'); G2 = gtin('340093000002')
    pg.evaluate("() => document.activeElement && document.activeElement.blur()"); pg.keyboard.type('01' + G1 + '1725123110AB123C21SN0001'); pg.keyboard.press('Enter')
    pg.click('[data-assoc]:has-text("Vaxigrip")')
    check('PÉRIMÉ' in pg.inner_text('#scan-msg') and 'PÉRIMÉ' in pg.inner_text('#adm-msg'), 'scan : vaccin périmé détecté')
    pg.fill('#scan-in', '(01)' + G1 + '(17)270630(10)AB123C(21)SN0002'); pg.press('#scan-in', 'Enter')
    check(pg.input_value('[data-adm="grippe.lot"]') == 'AB123C' and pg.input_value('[data-adm="grippe.peremption"]') == '06/2027', 'scan : CIP mémorisé, lot et péremption remplis')
    check(pg.evaluate("() => (VPApp.settings().catalogue.vaxigrip || {}).cips.length") == 1, 'scan : CIP enregistré dans le catalogue')
    pg.fill('#scan-in', '01' + G2 + '17280131' + '10PN987'); pg.press('#scan-in', 'Enter')
    pg.click('[data-assoc]:has-text("Prevenar")')
    check(pg.input_value('[data-adm="pneumo.lot"]') == 'PN987', 'scan : délivrance seule renseignée (lot)')
    pg.check('[data-a="dmp"]'); pg.check('[data-a="mtTransmis"]')
    check(not pg.is_disabled('#btn-print-att'), 'attestation imprimable une fois l’acte complet')
    att = pg.inner_text('#att-preview')
    check('AB123C' in att and '06/2027' in att and '2023-736' in att, 'attestation : lot, péremption, décret 2023-736')
    check('Prevenar' not in att, 'attestation : le vaccin seulement délivré n’y figure pas')
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
    pg.evaluate("() => document.activeElement && document.activeElement.blur()")
    pg.keyboard.type('IS01' + '0' * 22 + 'S1296077505612345' + 'S21.2.250.1.213.1.4.8S3INES CLAIRES4LEROYS5FS602-07-1996S775056')
    pg.keyboard.press('Enter')
    check(pg.input_value('#p-nom') == 'LEROY' and pg.input_value('#p-prenom') == 'Ines' and pg.input_value('#p-ddn') == '1996-07-02' and pg.is_checked('input[name=sexe][value=F]') and pg.input_value('#p-nir') == '296077505612345', 'Datamatrix INS : identité, sexe, date de naissance et NIR remplis')
    pg.screenshot(path=os.path.join(OUT, '0-identite-ins.png'))
    # Copier-coller depuis le LGO : boutons 📋 par champ et fiche collée avec Ctrl+V
    pg.context.grant_permissions(['clipboard-read', 'clipboard-write'])
    pg.on('dialog', lambda d: d.accept())
    pg.evaluate("() => navigator.clipboard.writeText('  durand-petit ')")
    pg.click('#p-nomu + .pbtn'); pg.wait_for_timeout(250)
    check(pg.input_value('#p-nomu') == 'DURAND-PETIT', 'bouton 📋 : nom utilisé collé et mis en majuscules')
    pg.evaluate("() => navigator.clipboard.writeText('2 96 07 75 056 123 99 NIR')")
    pg.click('#p-nir + .pbtn'); pg.wait_for_timeout(250)
    check(pg.input_value('#p-nir') == '296077505612399' and 'invalide' in pg.inner_text('#nir-hint'), 'bouton 📋 : NIR nettoyé, clé erronée signalée')
    pg.click('#btn-new'); pg.wait_for_timeout(100)
    fiche = 'INS actif\nMatricule INS\n2770163113005%s NIR\nOID\n1.2.250.1.213.1.4.8\nDate de dernière mise à jour\n13/08/2026\nNom utilisé\n\nNom de naissance *\nMARTIN\n1er prénom de naissance *\nLUCIE\nPrénom(s) de naissance\nLUCIE ANNE\nPrénom utilisé\n\nSexe *\nFéminin\nMasculin\nIndéterminé\nCode lieu de naissance (Code INSEE)\n63113\nDate de naissance *\n15/01/1977' % pg.evaluate("() => GS1.nirCle('2770163113005')")
    pg.evaluate("() => document.activeElement && document.activeElement.blur()")
    pg.evaluate("t => { const dt = new DataTransfer(); dt.setData('text/plain', t); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }", fiche)
    got = [pg.input_value(x) for x in ['#p-nom', '#p-prenom', '#p-prenoms', '#p-ddn', '#p-lieu', '#p-nir']]
    check(got == ['MARTIN', 'Lucie', 'LUCIE ANNE', '1977-01-15', '63113', '2770163113005' + pg.evaluate("() => GS1.nirCle('2770163113005')")] and pg.is_checked('input[name=sexe][value=F]') and 'cohérent' in pg.inner_text('#nir-hint'), 'fiche INS collée (Ctrl+V) : tous les champs remplis, sexe déduit du NIR, NIR cohérent ' + str(got))
    pg.screenshot(path=os.path.join(OUT, '0b-collage-lgo.png'))
    pg.click('#btn-new')
    pg.evaluate("() => document.activeElement && document.activeElement.blur()")
    pg.keyboard.type('IS01' + '0' * 22 + 'S1296077505612345' + 'S21.2.250.1.213.1.4.8S3INES CLAIRES4LEROYS5FS602-07-1996S775056')
    pg.keyboard.press('Enter')
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
    ctx = br.new_context(viewport={'width': 375, 'height': 812}, is_mobile=True, has_touch=True, device_scale_factor=2)
    m = ctx.new_page()
    m.on('pageerror', lambda e: errors.append(str(e)))
    m.goto(url); m.evaluate("s => localStorage.setItem('vp_settings_v1', JSON.stringify(s))", SETTINGS); m.goto(url); m.wait_for_selector('#p-nom')
    def no_hscroll(tag):
        w = m.evaluate("() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]")
        check(w[0] <= w[1], 'mobile — pas de défilement horizontal (' + tag + ') ' + str(w))
    small = m.evaluate("() => [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]),select,textarea')].filter(e => e.offsetParent).filter(e => parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.id || e.dataset.p)")
    check(not small, 'mobile — champs en 16 px minimum (pas de zoom iOS) ' + str(small[:5]))
    m.fill('#p-nom', 'Dupont'); m.fill('#p-prenom', 'Jeanne'); m.check('input[name=sexe][value=F]'); m.fill('#p-ddn', '1956-03-12')
    m.screenshot(path=os.path.join(OUT, '6-mobile.png'), full_page=True); no_hscroll('patient')
    m.click('.step[data-step="2"]')
    for el in m.query_selector_all('[data-panel="2"] .yn'):
        if el.is_visible(): el.query_selector('button[data-v="0"]').click()
    m.screenshot(path=os.path.join(OUT, '7-mobile-entretien.png')); no_hscroll('entretien')
    m.click('.step[data-step="3"]'); no_hscroll('profil')
    m.click('.step[data-step="4"]'); m.wait_for_selector('.rc')
    m.screenshot(path=os.path.join(OUT, '8-mobile-reco.png')); no_hscroll('recommandations')
    m.click('.step[data-step="5"]'); m.check('#confirm-entretien')
    m.screenshot(path=os.path.join(OUT, '9-mobile-ordo.png'), full_page=True); no_hscroll('ordonnance')
    fw = m.evaluate("() => { const f = document.querySelector('#ordo-preview .docfit'); return f ? f.getBoundingClientRect().width : 0 }")
    check(0 < fw <= 375, 'mobile — aperçu de l\u2019ordonnance ajusté à l\u2019écran (' + str(round(fw)) + ' px)')
    m.click('#btn-admin'); m.wait_for_selector('#dlg-admin[open]'); m.click('.tab[data-tab="ph"]')
    m.screenshot(path=os.path.join(OUT, '10-mobile-parametres.png')); no_hscroll('paramètres')
    br.close()

srv.shutdown()
errors[:] = [e for e in errors if 'config.json' not in e and '404' not in e]
check(not errors, 'aucune erreur JavaScript' + ('' if not errors else ' : ' + ' | '.join(errors[:5])))
sys.exit(0 if ok else 1)
