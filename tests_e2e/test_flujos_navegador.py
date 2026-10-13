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

    # A) ticket: abrir, responder (envía la encuesta); el cierre lo decide el cliente
    pg.locator('text=COR-8921').first.click(); pg.wait_for_timeout(500)
    ok(pg.get_by_text('Marcar como resuelto').count()==0 and pg.get_by_text('Enviar respuesta y encuesta').count()>0,'A1 el encargado no cierra el ticket: responde y envía la encuesta')
    # responder
    pg.locator('textarea').first.fill('Respuesta de prueba desde la consola'); pg.get_by_text('Enviar respuesta').first.click(); pg.wait_for_timeout(1200)
    t=[x for x in api('/tickets') if x['ticketNumber']=='COR-8921'][0]
    ok(t['transcript'][-1]['message']=='Respuesta de prueba desde la consola' and t['transcript'][-1]['sender']=='agent','A2 respuesta del agente queda en la transcripción')
    ok(t['status']=='esperando_cliente','A3 tras responder, el ticket queda esperando la respuesta del cliente (encuesta)')
    pg.screenshot(path='shot_ticket.png')
    pg.keyboard.press('Escape'); pg.reload(); pg.wait_for_timeout(1500)

    # B) empresas: configurar WellQ, subir documento
    pg.get_by_text('Empresas y agentes').first.click(); pg.wait_for_timeout(800)
    pg.get_by_text('Configurar agente').first.click(); pg.wait_for_timeout(600)
    pg.set_input_files('input[type=file]', DOC)
    for _ in range(40):   # la ingesta calcula embeddings (el primer arranque puede cargar el modelo)
        pg.wait_for_timeout(1000)
        docs=api('/empresas/wellq/documentos')
        if any(x['name']=='doc_demo.txt' and x['status']!='procesando' for x in docs): break
    pg.wait_for_timeout(2000)   # el panel refresca cada 1,5 s
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

    # F) chat público /chat/{slug} y widget embebible (RF-29); WellQ ya quedó activo en B3
    pg.goto('http://localhost:3000/chat/wellq'); pg.wait_for_timeout(1500)
    ok(pg.locator('text=Asistente de WellQ').count()>0 and pg.get_by_placeholder('Escribe tu consulta…').count()==1,'F1 /chat/{slug} muestra el chat de la empresa sin login')
    q=pg.get_by_placeholder('Escribe tu consulta…')
    q.fill('Cuanto tardan los reembolsos de consultas de telemedicina?'); q.press('Enter'); pg.wait_for_timeout(1800)
    ok(pg.locator('text=cinco dias habiles').count()>0 and pg.locator('text=Fuente: doc_demo.txt').count()>0,'F2 chat público responde con RAG y muestra la fuente')
    q.fill('Mi tarjeta fue clonada en el extranjero'); q.press('Enter'); pg.wait_for_timeout(1800)
    ok(pg.locator('text=Derivamos tu consulta').count()>0 and len(api('/tickets'))==10,'F3 chat público deriva y crea el ticket')
    pg.screenshot(path='shot_chat_publico.png')
    pg.goto('http://localhost:3000/chat/no-existe'); pg.wait_for_timeout(1200)
    ok(pg.locator('text=Este chat no existe').count()>0,'F4 slug inexistente muestra mensaje')
    HOST = '<!doctype html><html><body><h1>Sitio del cliente</h1><script src="http://localhost:3000/widget.min.js" data-tenant-id="wellq" data-primary-color="#0D9488" defer></script></body></html>'
    # el sitio del cliente: servidor real en otro puerto (otro origen, también loopback)
    import http.server, threading
    class Host(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.end_headers(); self.wfile.write(HOST.encode())
        def log_message(self, *a): pass
    srv = http.server.HTTPServer(('127.0.0.1', 3100), Host); threading.Thread(target=srv.serve_forever, daemon=True).start()
    pg.goto('http://127.0.0.1:3100/'); pg.wait_for_timeout(1000)
    launcher = pg.get_by_role('button', name='Abrir chat con Soporte')
    ok(launcher.count()==1 and pg.locator('iframe').count()==0,'F5 widget.min.js inyecta el botón flotante (iframe aún no cargado)')
    launcher.click(); pg.wait_for_timeout(1500)
    fr = pg.frame_locator('iframe[title="Chat de soporte"]')
    ok(fr.locator('text=Asistente de WellQ').count()==1,'F6 al abrir, el iframe carga /chat/{slug}')
    fr.get_by_placeholder('Escribe tu consulta…').fill('Cuanto tardan los reembolsos de consultas de telemedicina?')
    fr.get_by_role('button', name='Enviar').click(); pg.wait_for_timeout(1800)
    ok(fr.locator('text=cinco dias habiles').count()>0,'F7 el widget embebido responde con el documento')
    pg.screenshot(path='shot_widget_embebido.png')
    fr.get_by_role('button', name='Cerrar chat').click(); pg.wait_for_timeout(500)
    ok(not pg.locator('iframe').is_visible(),'F8 el botón cerrar del iframe oculta el chat')
    srv.shutdown(); srv.server_close()

    # G) roles afinados: analítica real por rol, asignación a usuarios reales, remitente autenticado, campos de empresa
    login(SUPER, SUPER_PW)
    pg.locator('aside').get_by_text('Analítica').first.click(); pg.wait_for_timeout(1500)
    glob = api('/metricas/analitica?dias=14')
    ok(pg.locator('text=Analítica global de soporte').count()>0 and pg.locator('text=34,180').count()==0 and pg.locator('text=88.2%').count()==0
       and pg.locator('text=Promedio: '+format(glob['botRate'],'.1f')+'%').count()>0,'G1 la analítica del superadmin usa datos reales (no los del prototipo)')
    pg.screenshot(path='shot_analitica_super.png')
    login('tickets@wellq.demo', DEMO_PW)
    pg.locator('aside').get_by_text('Analítica').first.click(); pg.wait_for_timeout(1500)
    ok(pg.locator('text=Analítica de soporte · WellQ').count()>0 and pg.locator('text=Dani ETH').count()==0 and pg.locator('text=Aprueba').count()==0,'G2 el encargado de tickets ve la analítica solo de su empresa')
    pg.screenshot(path='shot_analitica_empresa.png')
    pg.locator('aside').get_by_text('Consola de soporte').first.click(); pg.wait_for_timeout(1000)
    pg.locator('text=COR-8919').first.click(); pg.wait_for_timeout(600)
    pg.locator('button:has(svg.lucide-user-check)').first.click(); pg.wait_for_timeout(300)
    menu = pg.locator('div.absolute:has-text("Asignar agente Corestream")').last
    ok(menu.get_by_text('Admin WellQ').count()==1 and menu.get_by_text('Tickets WellQ').count()==1 and menu.get_by_text('Felipe Armijo').count()==0 and menu.get_by_text('Admin Dani').count()==0,'G3 el desplegable lista solo usuarios reales de la empresa del ticket')
    menu.get_by_text('Admin WellQ').click(); pg.wait_for_timeout(1000)
    t = [x for x in api('/tickets') if x['ticketNumber']=='COR-8919'][0]
    ok(t['assignedAgent']=='Admin WellQ' and t.get('assignedAgentId'),'G4 la asignación guarda el usuario real en la BD')
    pg.locator('textarea').first.fill('Respuesta del encargado de tickets'); pg.get_by_text('Enviar respuesta').first.click(); pg.wait_for_timeout(1200)
    t = [x for x in api('/tickets') if x['ticketNumber']=='COR-8919'][0]
    ok(t['transcript'][-1]['sender']=='agent' and t['transcript'][-1]['senderName']=='Tickets WellQ','G5 el remitente de la respuesta es el usuario autenticado')
    v0 = api('/empresas/wellq')
    login('agente@wellq.demo', DEMO_PW)
    pg.locator('aside').get_by_text('Empresas y agentes').first.click(); pg.wait_for_timeout(800)
    pg.get_by_text('Configurar agente').first.click(); pg.wait_for_timeout(600)
    pg.get_by_text('Publicar agente').first.click(); pg.wait_for_timeout(1500)
    v1 = api('/empresas/wellq')
    ok(int(v1['version'][1:].split('.')[0])==int(v0['version'][1:].split('.')[0])+1 and v1['name']==v0['name'] and pg.locator('text=No se pudo guardar').count()==0,'G6 el encargado del agente publica sin tocar nombre ni industria de la empresa')

    # H) el cliente ve la respuesta del agente humano en el chat público (sin recargar), la conversación
    #    se recupera al recargar y el widget cerrado avisa con un punto
    def responder_como_agente(marca, texto):
        t = [x for x in api('/tickets') if marca in x['userQueryExcerpt']][0]
        rq = urllib.request.Request('http://localhost:8000/tickets/%s/respuesta' % t['id'], json.dumps({'text': texto}).encode(),
                                    {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN})
        urllib.request.urlopen(rq).read()
        return t
    pg.goto('http://localhost:3000/chat/wellq'); pg.evaluate('localStorage.clear()'); pg.reload(); pg.wait_for_timeout(1200)
    q = pg.get_by_placeholder('Escribe tu consulta…')
    q.fill('Perdi mi tarjeta H-prueba urgente'); q.press('Enter'); pg.wait_for_timeout(1800)
    ok(pg.locator('text=Derivamos tu consulta').count()>0 and pg.locator('text=esta ventana se actualiza sola').count()>0,'H1 tras derivar, avisa que la respuesta llegará a esta ventana')
    responder_como_agente('H-prueba', 'Ya revisamos tu caso H-respuesta')
    try:
        pg.wait_for_selector('text=Ya revisamos tu caso H-respuesta', timeout=12000); visto = True
    except Exception:
        visto = False
    ok(visto and pg.locator('[data-testid="survey"]').count()==1 and pg.locator('text=¿Se resolvió tu consulta?').count()>0,'H2 el cliente ve la respuesta del agente sin recargar y la encuesta de resolución')
    pg.screenshot(path='shot_respuesta_agente.png')
    pg.get_by_role('button', name='Sí, se resolvió').click(); pg.wait_for_timeout(1500)
    tH=[x for x in api('/tickets') if 'H-prueba' in x['userQueryExcerpt']][0]
    ok(tH['status']=='cerrado' and tH['closeReason']=='confirmado_cliente' and pg.locator('text=cerrado. ¡Gracias').count()>0
       and pg.get_by_placeholder('Este caso ya terminó').is_disabled(),'H2b el cliente dice SÍ: el ticket se cierra y el chat queda terminado')
    pg.reload(); pg.wait_for_timeout(1500)
    ok(pg.locator('text=Ya revisamos tu caso H-respuesta').count()>0 and pg.locator('text=Perdi mi tarjeta H-prueba').count()>0,'H3 al recargar se recupera la conversación completa')
    pg.evaluate("localStorage.setItem('alloxentric_chat_wellq','00000000-0000-0000-0000-000000000000')"); pg.reload(); pg.wait_for_timeout(1500)
    ok(pg.locator('text=Ya revisamos tu caso').count()==0 and pg.evaluate("localStorage.getItem('alloxentric_chat_wellq')") is None,'H4 una conversación inexistente se descarta y el chat empieza limpio')
    srv2 = http.server.HTTPServer(('127.0.0.1', 3100), Host); threading.Thread(target=srv2.serve_forever, daemon=True).start()
    pg.goto('http://127.0.0.1:3100/'); pg.wait_for_timeout(1000)
    pg.get_by_role('button', name='Abrir chat con Soporte').click(); pg.wait_for_timeout(1500)
    fr = pg.frame_locator('iframe[title="Chat de soporte"]')
    fr.get_by_placeholder('Escribe tu consulta…').fill('Perdi mi tarjeta H-badge urgente'); fr.get_by_role('button', name='Enviar').click(); pg.wait_for_timeout(1800)
    fr.get_by_role('button', name='Cerrar chat').click(); pg.wait_for_timeout(500)
    responder_como_agente('H-badge', 'Respuesta para el badge')
    try:
        pg.wait_for_selector('button[data-unread="1"]', timeout=12000); badge = True
    except Exception:
        badge = False
    ok(badge,'H5 el widget cerrado muestra un aviso cuando el agente responde')
    pg.locator('button[data-unread="1"]').click(); pg.wait_for_timeout(800)
    ok(fr.locator('text=Respuesta para el badge').count()>0 and pg.locator('button[data-unread="1"]').count()==0,'H6 al abrir el widget el aviso desaparece y se ve la respuesta')
    srv2.shutdown(); srv2.server_close()

    # I) el cliente dice que NO se resolvió: el ticket se escala, sale de la cola del encargado y lo gestiona el admin
    pg.goto('http://localhost:3000/chat/wellq'); pg.evaluate('localStorage.clear()'); pg.reload(); pg.wait_for_timeout(1200)
    q = pg.get_by_placeholder('Escribe tu consulta…')
    q.fill('No me llega el certificado I-noresuelto urgente'); q.press('Enter'); pg.wait_for_timeout(1800)
    responder_como_agente('I-noresuelto', 'Te reenviamos el certificado por correo')
    try:
        pg.wait_for_selector('[data-testid="survey"]', timeout=12000); encuesta = True
    except Exception:
        encuesta = False
    pg.get_by_role('button', name='No, sigue sin resolverse').click(); pg.wait_for_timeout(1500)
    tI=[x for x in api('/tickets') if 'I-noresuelto' in x['userQueryExcerpt']][0]
    ok(encuesta and tI['status']=='escalado' and pg.locator('text=fue escalado a la gestión').count()>0,'I1 el cliente dice NO: el ticket queda escalado y el chat avisa que lo contactarán')
    pg.screenshot(path='shot_encuesta_no.png')
    login('tickets@wellq.demo', DEMO_PW)
    pg.locator('aside').get_by_text('Consola de soporte').first.click(); pg.wait_for_timeout(1200)
    ok(pg.locator('text=I-noresuelto').count()==0 and pg.get_by_text('Escalado').count()==0,'I2 el ticket escalado ya no está en la cola del encargado de tickets')
    login('admin@wellq.demo', DEMO_PW)
    pg.locator('aside').get_by_text('Consola de soporte').first.click(); pg.wait_for_timeout(1200)
    pg.locator('text=I-noresuelto').first.click(); pg.wait_for_timeout(600)
    ok(pg.locator('text=Escalado a gestión').count()>0 and pg.get_by_text('Enviar respuesta y encuesta').count()==0,'I3 el admin de la empresa ve el ticket escalado y no puede responderlo por el chat')
    pg.get_by_text('Cerrar ticket (ya gestionado)').first.click(); pg.wait_for_timeout(1200)
    tI=[x for x in api('/tickets') if 'I-noresuelto' in x['userQueryExcerpt']][0]
    ok(tI['status']=='cerrado' and tI['closeReason']=='gestion_manual','I4 el admin cierra el ticket escalado y queda cerrado para siempre')
    b.close()
