"""Prueba de punta a punta en navegador real (RF-26).

Requisitos: `pip install playwright && playwright install chromium`, y el sistema corriendo
(docker compose up -d, uvicorn en :8000, npm run dev en :3000) con la BD RECIÉN SEMBRADA:
    cd backend && python seed.py --reset
    python ../tests_e2e/test_flujos_navegador.py
Recorre: login; consola -> ticket -> responder; subir documento; chat con RAG; derivación; crear empresa;
y los permisos por rol (superadmin, encargado de tickets, encargado del agente, admin de empresa).
El seed deja: superadmin@alloxentric.local / Superadmin123!  y  admin|tickets|agente@<slug>.demo / Demo1234!
"""
import json, os, tempfile, urllib.request
from playwright.sync_api import sync_playwright
SUPER, SUPER_PW, DEMO_PW = 'superadmin@alloxentric.local', 'Superadmin123!', 'Demo1234!'
def _token():
    rq = urllib.request.Request('http://localhost:8000/auth/login', json.dumps({'email': SUPER, 'password': SUPER_PW}).encode(), {'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(rq))['accessToken']
TOKEN = _token()
def api(path):
    rq = urllib.request.Request('http://localhost:8000'+path, headers={'Authorization': 'Bearer '+TOKEN})
    return json.load(urllib.request.urlopen(rq))
DOC = os.path.join(tempfile.mkdtemp(), 'doc_demo.txt')
open(DOC, 'w').write('Politica de reembolsos de WellQ\n\nLos reembolsos de consultas de telemedicina se procesan en cinco dias habiles una vez recibida la boleta electronica.\n\nPara reprogramar una cita sin costo debes avisar con al menos dos horas de anticipacion desde el portal.\n')
ok=lambda c,m: print(('PASS ' if c else 'FAIL ')+m)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width':1440,'height':900})
    def login(email, pw):
        pg.goto('http://localhost:3000'); pg.evaluate('sessionStorage.clear()'); pg.reload(); pg.wait_for_timeout(800)
        pg.get_by_test_id('login-email').fill(email); pg.get_by_test_id('login-password').fill(pw)
        pg.get_by_test_id('login-submit').click(); pg.wait_for_timeout(2000)
    def nav(txt): return pg.locator('aside').get_by_text(txt).count()

    # 0) login
    pg.goto('http://localhost:3000'); pg.evaluate('sessionStorage.clear()'); pg.reload(); pg.wait_for_timeout(800)
    ok(pg.get_by_test_id('login-submit').count()==1,'L1 sin sesión se muestra el login')
    pg.screenshot(path='shot_login.png')
    pg.get_by_test_id('login-email').fill(SUPER); pg.get_by_test_id('login-password').fill('mala'); pg.get_by_test_id('login-submit').click(); pg.wait_for_timeout(1000)
    ok(pg.get_by_test_id('login-error').count()==1,'L2 clave incorrecta muestra error')
    login(SUPER, SUPER_PW)
    ok(pg.get_by_test_id('user-role').first.inner_text()=='Superadmin','L3 login del superadmin')

    # A) ticket: abrir, marcar resuelto
    pg.locator('text=COR-8921').first.click(); pg.wait_for_timeout(500)
    pg.get_by_text('Marcar como resuelto').first.click(); pg.wait_for_timeout(1000)
    t=[x for x in api('/tickets') if x['ticketNumber']=='COR-8921'][0]
    ok(t['status']=='resuelto','A1 marcar resuelto persiste en la BD')
    # responder
    pg.locator('textarea').first.fill('Respuesta de prueba desde la consola'); pg.get_by_text('Enviar respuesta').first.click(); pg.wait_for_timeout(1200)
    t=[x for x in api('/tickets') if x['ticketNumber']=='COR-8921'][0]
    ok(t['transcript'][-1]['message']=='Respuesta de prueba desde la consola' and t['transcript'][-1]['sender']=='agent','A2 respuesta del agente queda en la transcripción')
    pg.screenshot(path='shot_ticket.png')
    pg.keyboard.press('Escape'); pg.reload(); pg.wait_for_timeout(1500)

    # B) empresas: configurar WellQ, subir documento
    pg.get_by_text('Empresas y agentes').first.click(); pg.wait_for_timeout(800)
    pg.get_by_text('Configurar agente').first.click(); pg.wait_for_timeout(600)
    pg.set_input_files('input[type=file]', DOC); pg.wait_for_timeout(3500)
    docs=api('/empresas/wellq/documentos')
    d=[x for x in docs if x['name']=='doc_demo.txt']
    ok(len(d)==1 and d[0]['status']=='procesado' and d[0]['chunkCount']>=1, f'B1 subida + ingesta real ({d})')
    ok(pg.locator('text=doc_demo.txt').count()>0,'B2 el documento aparece en el modal')
    pg.screenshot(path='shot_config.png')
    # guardar cambios (Publicar)
    pg.get_by_text('Publicar agente').first.click(); pg.wait_for_timeout(1500)
    w=api('/empresas/wellq'); ok(w['agentStatus']=='activo' and w['version'].startswith('v3'),f"B3 publicar persiste (version {w['version']})")

    # C) widget: pregunta con respaldo, luego sin respaldo
    pg.get_by_text('Vista previa del widget').first.click(); pg.wait_for_timeout(1000)
    inp=pg.get_by_placeholder('Escribe tu mensaje para el asistente...')
    inp.fill('Cuanto tardan los reembolsos de consultas de telemedicina?'); inp.press('Enter'); pg.wait_for_timeout(1800)
    ok(pg.locator('text=cinco dias habiles').count()>0,'C1 el bot responde con el contenido del documento subido')
    ok(pg.locator('text=doc_demo.txt').count()>0,'C2 muestra la fuente RAG')
    inp.fill('Mi tarjeta fue clonada en el extranjero'); inp.press('Enter'); pg.wait_for_timeout(1800)
    ok(pg.locator('text=derivado a Corestream').count()>0,'C3 deriva y muestra el ticket')
    pg.screenshot(path='shot_widget.png')
    n=len(api('/tickets')); ok(n==9,f'C4 se creó un ticket nuevo en la BD ({n})')
    pg.get_by_text('Ver este ticket en la Consola de Soporte').first.click(); pg.wait_for_timeout(1500)
    ok(pg.locator('text=COR-8922').count()>0,'C5 el ticket nuevo (COR-8922) aparece en la consola')

    # D) agregar empresa
    pg.get_by_text('Empresas y agentes').first.click(); pg.wait_for_timeout(600)
    pg.get_by_text('+ Agregar empresa').first.click(); pg.wait_for_timeout(400)
    pg.locator('form input[type=text]').first.fill('Cliente Nuevo SpA'); pg.get_by_text('Crear empresa').first.click(); pg.wait_for_timeout(1500)
    ok(any(e['slug']=='cliente-nuevo-spa' for e in api('/empresas')),'D1 empresa creada desde el front persiste')
    pg.screenshot(path='shot_empresas.png')

    # E) permisos por rol
    login('tickets@wellq.demo', DEMO_PW)
    ok(nav('Consola de soporte')==1 and nav('Empresas y agentes')==0 and nav('Usuarios y roles')==0,'E1 encargado de tickets: solo consola y analítica')
    ok(pg.locator('text=COR-8919').count()>0 and pg.locator('text=COR-8921').count()==0 and pg.locator('text=COR-8914').count()==0,'E2 encargado de tickets ve solo tickets de su empresa (WellQ)')
    pg.screenshot(path='shot_rol_tickets.png')
    login('agente@wellq.demo', DEMO_PW)
    ok(nav('Consola de soporte')==0 and nav('Empresas y agentes')==1 and nav('Usuarios y roles')==0,'E3 encargado del agente: sin consola ni usuarios')
    ok(pg.get_by_text('+ Agregar empresa').count()==0,'E4 solo el superadmin puede agregar empresas')
    ok(pg.locator('text=Dani ETH').count()==0,'E5 encargado del agente ve solo su empresa')
    pg.screenshot(path='shot_rol_agente.png')
    login('admin@wellq.demo', DEMO_PW)
    ok(nav('Usuarios y roles')==1 and nav('Consola de soporte')==1 and nav('Empresas y agentes')==1,'E6 admin de empresa ve consola, agentes y usuarios')
    pg.get_by_test_id('nav-users').click(); pg.wait_for_timeout(1000)
    pg.get_by_test_id('new-user-email').fill('nuevo.tickets@wellq.demo'); pg.get_by_test_id('new-user-password').fill('Clave12345!')
    pg.get_by_test_id('new-user-role').select_option('encargado_tickets'); pg.get_by_test_id('new-user-submit').click(); pg.wait_for_timeout(1200)
    ok(pg.get_by_test_id('user-row-nuevo.tickets@wellq.demo').count()==1,'E7 admin crea un usuario desde el panel')
    pg.screenshot(path='shot_usuarios.png')
    login('nuevo.tickets@wellq.demo','Clave12345!')
    ok(nav('Consola de soporte')==1 and nav('Usuarios y roles')==0,'E8 el usuario nuevo entra con su rol')
    pg.get_by_test_id('user-name').first.click(); pg.get_by_test_id('logout').click(); pg.wait_for_timeout(800)
    ok(pg.get_by_test_id('login-submit').count()==1,'E9 cerrar sesión vuelve al login')
    b.close()
