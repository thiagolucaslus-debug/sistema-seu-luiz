"""
Assistente interativo 1-clique para conectar o Google Drive ao Sistema Seu Luiz
(Local + Render 24/7), inspirado no fluxo do Sistema Editor.
"""

from __future__ import annotations

import argparse
import getpass
import http.server
import json
import os
import subprocess
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = ROOT_DIR / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from database import CLOUD_CONFIG_DIR, DATA_DIR, DB_PATH, engine
from main import ensure_schema_and_migrations
from services.cloud_sync import DEFAULT_RENDER_URL, CloudSyncManager


def copy_to_clipboard_windows(text: str) -> bool:
    if os.name != "nt":
        return False
    try:
        subprocess.run(
            ["clip"],
            input=text.encode("utf-16le"),
            check=True,
            timeout=5,
        )
        return True
    except Exception:
        return False


def build_manager() -> CloudSyncManager:
    return CloudSyncManager(
        data_dir=DATA_DIR,
        db_path=DB_PATH,
        config_dir=CLOUD_CONFIG_DIR,
        engine_disposer=engine.dispose,
        schema_migrator=ensure_schema_and_migrations,
        is_cloud_container=False,
    )


def oauth_browser_one_click(mgr: CloudSyncManager, timeout_sec: int = 240) -> dict:
    captured: dict[str, str] = {}
    done_event = threading.Event()

    class CallbackHandler(http.server.BaseHTTPRequestHandler):
        def log_message(self, format: str, *args) -> None:
            return

        def do_GET(self) -> None:
            parsed = urllib.parse.urlparse(self.path)
            qs = urllib.parse.parse_qs(parsed.query)
            captured["state"] = (qs.get("state") or [""])[0]
            captured["code"] = (qs.get("code") or [""])[0]
            captured["error"] = (qs.get("error") or [""])[0]

            ok = bool(captured["code"] and not captured["error"])
            title = "Google Drive Conectado!" if ok else "Autorizacao nao concluida"
            msg = (
                "Pode fechar esta aba e voltar para a janela preta do assistente."
                if ok
                else "Tente novamente na janela do assistente."
            )
            html = (
                "<!doctype html><html lang='pt-BR'><head><meta charset='utf-8'>"
                f"<title>{title}</title></head>"
                "<body style='background:#10151d;color:#f3f6fb;font-family:sans-serif;"
                "display:grid;place-items:center;min-height:95vh;text-align:center'>"
                f"<div style='background:#1a202b;padding:28px;border-radius:16px;border:1px solid #343e4d'>"
                f"<h2>{title}</h2><p>{msg}</p></div>"
                "<script>setTimeout(()=>window.close(),1500);</script></body></html>"
            ).encode("utf-8")
            self.send_response(200 if ok else 400)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(html)))
            self.end_headers()
            self.wfile.write(html)
            done_event.set()

    server = http.server.HTTPServer(("127.0.0.1", 0), CallbackHandler)
    port = server.server_port
    redirect_uri = f"http://127.0.0.1:{port}/cloud/oauth/callback"
    oauth_info = mgr.start_oauth(redirect_uri=redirect_uri)

    srv_thread = threading.Thread(target=server.serve_forever, daemon=True)
    srv_thread.start()
    try:
        print("\n" + "-" * 72)
        print(" Abrindo seu navegador para conectar o Google Drive...")
        print(" Se nao abrir sozinho, copie e abra este link:\n")
        print(" " + oauth_info["url"])
        print("-" * 72)
        webbrowser.open(oauth_info["url"])

        if not done_event.wait(timeout=timeout_sec):
            raise TimeoutError("Tempo esgotado aguardando autorizacao no navegador.")
        if captured.get("error"):
            raise RuntimeError(f"Autorizacao cancelada no Google ({captured['error']}).")
        return mgr.finish_oauth_callback(state=captured["state"], code=captured["code"])
    finally:
        server.shutdown()
        server.server_close()


def push_token_to_render_live(
    compact_token: str,
    render_url: str = DEFAULT_RENDER_URL,
    usuario: str = "",
    senha: str = "",
) -> dict:
    base = render_url.strip().rstrip("/")
    if not usuario:
        usuario = input("Usuario de login no sistema online [Enter = luiz]: ").strip() or "luiz"
    if not senha:
        senha = getpass.getpass(f"Senha do usuario '{usuario}' no sistema online: ").strip()
    if not senha:
        raise ValueError("Senha vazia.")

    login_req = urllib.request.Request(
        f"{base}/auth/login",
        data=json.dumps({"usuario": usuario, "senha": senha}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(login_req, timeout=35) as resp:
        jwt_token = json.loads(resp.read().decode("utf-8"))["access_token"]

    tok_req = urllib.request.Request(
        f"{base}/cloud/token",
        data=json.dumps(
            {"token": compact_token, "restore_first": False, "sync_immediately": True}
        ).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {jwt_token}",
        },
        method="POST",
    )
    with urllib.request.urlopen(tok_req, timeout=60) as resp2:
        return json.loads(resp2.read().decode("utf-8"))


def persist_env_via_render_api(compact_token: str, render_api_key: str) -> bool:
    headers = {
        "Authorization": f"Bearer {render_api_key.strip()}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    req = urllib.request.Request(
        "https://api.render.com/v1/services?limit=20", headers=headers, method="GET"
    )
    with urllib.request.urlopen(req, timeout=25) as resp:
        items = json.loads(resp.read().decode("utf-8"))

    service_id = ""
    for entry in items:
        svc = entry.get("service") or entry
        slug_url = str((svc.get("serviceDetails") or {}).get("url") or "")
        name = str(svc.get("name") or "").lower()
        if "sistema-seu-luiz" in slug_url or "seu-luiz" in name:
            service_id = str(svc.get("id") or "")
            break
    if not service_id:
        return False

    put_req = urllib.request.Request(
        f"https://api.render.com/v1/services/{service_id}/env-vars/GOOGLE_DRIVE_OAUTH_JSON",
        data=json.dumps({"value": compact_token}).encode("utf-8"),
        headers=headers,
        method="PUT",
    )
    with urllib.request.urlopen(put_req, timeout=25) as resp_put:
        return resp_put.status in (200, 201)


def check_online_health(render_url: str = DEFAULT_RENDER_URL) -> dict:
    url = f"{render_url.strip().rstrip('/')}/health"
    req = urllib.request.Request(url, headers={"User-Agent": "SistemaSeuLuiz-Setup/2.1"})
    with urllib.request.urlopen(req, timeout=35) as resp:
        return json.loads(resp.read().decode("utf-8"))


def print_render_instructions(compact_token: str) -> None:
    copied = copy_to_clipboard_windows(compact_token)
    print("\n" + "=" * 72)
    print(" PARA DEIXAR PERMANENTE NO RENDER (FEITO UMA UNICA VEZ):")
    print("=" * 72)
    if copied:
        print(" [OK] O codigo ja foi COPIADO automaticamente para o seu Ctrl+V!")
    print(" 1. Abra https://dashboard.render.com -> clique no servico 'sistema-seu-luiz'")
    print(" 2. No menu esquerdo, clique em 'Environment' -> 'Add Environment Variable'")
    print(" 3. Key (Nome):   GOOGLE_DRIVE_OAUTH_JSON")
    print(" 4. Value (Valor): Aperte Ctrl+V (ou cole o codigo abaixo) e clique em Save:")
    print(f"\n{compact_token}\n")
    print("=" * 72)


def interactive_menu() -> None:
    mgr = build_manager()
    while True:
        st = mgr.status()
        print("\n" + "=" * 72)
        print("   NUVEM 24/7 + GOOGLE DRIVE — SISTEMA FINANCEIRO SEU LUIZ (R$ 0,00)")
        print("=" * 72)
        conta = st["account"] or ("Conectado" if st["connected"] else "NAO CONECTADO")
        print(f" Status Google Drive neste PC : {conta}")
        if st.get("folder_url"):
            print(f" Pasta no seu Google Drive    : {st['folder_url']}")
        print(f" Servidor Online 24/7         : {DEFAULT_RENDER_URL}")
        print("-" * 72)
        print(" [1] Conectar meu Google Drive em 1 Clique + Fazer Backup Inicial")
        print(" [2] Ativar Google Drive no Servidor Online (sistema-seu-luiz.onrender.com)")
        print(" [3] Fazer Backup Manual Agora (PC -> Google Drive)")
        print(" [4] Restaurar Dados do Google Drive para este PC")
        print(" [5] Verificar Saude 24/7 do Servidor Online (/health)")
        print(" [6] Copiar Codigo GOOGLE_DRIVE_OAUTH_JSON para o Ctrl+V")
        print(" [0] Sair")
        print("=" * 72)

        op = input("Escolha uma opcao: ").strip()
        if op == "0":
            break
        elif op == "1":
            try:
                res = oauth_browser_one_click(mgr)
                print(f"\n[SUCESSO] Conta Google conectada: {res.get('account')}")
                print("Enviando backup inicial seguro (financeiro.db + fotos/comprovantes)...")
                sync_info = mgr.sync_now(force=True, reason="wizard_initial")
                print(f"[OK] Backup salvo no Google Drive! Pasta: {sync_info.get('folder_url')}")
                exported = mgr.export_oauth_token()
                print_render_instructions(exported["compact_token"])

                enviar = (
                    input("Deseja ja ativar agora no servidor online Render tambem? [Enter=Sim / n=Depois]: ")
                    .strip()
                    .lower()
                )
                if enviar not in ("n", "nao", "não"):
                    live_res = push_token_to_render_live(exported["compact_token"])
                    print(f"[OK] Servidor online conectado ao Google Drive ({live_res.get('account')})!")
            except Exception as exc:
                print(f"\n[ERRO] {exc}")
        elif op == "2":
            try:
                exported = mgr.export_oauth_token()
                print_render_instructions(exported["compact_token"])
                api_key = input(
                    "Opcional — se tiver Render API Key (rnd_...), cole aqui [Enter p/ login direto no painel]: "
                ).strip()
                if api_key.startswith("rnd_"):
                    if persist_env_via_render_api(exported["compact_token"], api_key):
                        print("[OK] Variavel GOOGLE_DRIVE_OAUTH_JSON gravada permanentemente no Render!")
                live_res = push_token_to_render_live(exported["compact_token"])
                print(f"[OK] Servidor online sincronizado com Google Drive ({live_res.get('account')})!")
            except Exception as exc:
                print(f"\n[ERRO] {exc}")
        elif op == "3":
            try:
                res = mgr.sync_now(force=True, reason="manual_cli")
                print(f"\n[OK] Backup salvo! Revisao #{res.get('revision')} -> {res.get('folder_url')}")
            except Exception as exc:
                print(f"\n[ERRO] {exc}")
        elif op == "4":
            conf = input("Confirmar restauracao dos dados do Google Drive para este PC? [s/N]: ").strip().lower()
            if conf in ("s", "sim", "y"):
                try:
                    res = mgr.restore_from_drive(force=True, on_boot=False)
                    print(f"\n[OK] Restauracao concluida! Contagens: {res.get('counts')}")
                except Exception as exc:
                    print(f"\n[ERRO] {exc}")
        elif op == "5":
            try:
                h = check_online_health()
                print("\n[ONLINE] Resposta do servidor:", json.dumps(h, ensure_ascii=False, indent=2))
            except Exception as exc:
                print(f"\n[AVISO] Falha ao consultar servidor online: {exc}")
        elif op == "6":
            try:
                exported = mgr.export_oauth_token()
                print_render_instructions(exported["compact_token"])
            except Exception as exc:
                print(f"\n[ERRO] {exc}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Configurador Nuvem 24/7 + Google Drive - Sistema Seu Luiz")
    parser.add_argument("--status", action="store_true", help="Exibe o status local em JSON e encerra")
    args = parser.parse_args()

    if args.status:
        mgr = build_manager()
        print(json.dumps(mgr.status(), ensure_ascii=False, indent=2))
        return

    interactive_menu()


if __name__ == "__main__":
    main()
