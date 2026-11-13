import os
import sys
import time
import socket
import threading
import webbrowser

# Garante caminhos corretos tanto em modo script quanto empacotado (.exe com PyInstaller)
if getattr(sys, 'frozen', False):
    ROOT_DIR = sys._MEIPASS
else:
    ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

backend_path = os.path.join(ROOT_DIR, "backend")
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

import uvicorn
from backend.main import app

def encontrar_porta_livre(porta_preferida=8000):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(('127.0.0.1', porta_preferida))
            return porta_preferida
    except OSError:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(('127.0.0.1', 0))
            return s.getsockname()[1]

def abrir_navegador(porta):
    time.sleep(1.8)
    url = f"http://127.0.0.1:{porta}"
    try:
        webbrowser.open(url)
    except Exception as e:
        print(f"Abra o navegador em: {url}")

def main():
    porta = encontrar_porta_livre(8000)
    print("=" * 60)
    print("   ADMINISTRAÇÃO FINANCEIRA — SISTEMA DESKTOP")
    print("=" * 60)
    print(f"Servidor local ativo em: http://127.0.0.1:{porta}")
    print("Abrindo seu navegador automaticamente...")
    print("Para encerrar o sistema, feche esta janela.")
    print("=" * 60)

    threading.Thread(target=abrir_navegador, args=(porta,), daemon=True).start()

    # Executa o servidor uvicorn integrado
    uvicorn.run(app, host="127.0.0.1", port=porta, log_level="warning")

if __name__ == "__main__":
    main()
