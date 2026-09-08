#!/usr/bin/env python3
"""
Petit serveur statique, uniquement pour ouvrir les pages d'outils dans un
navigateur (les modules ES refusent d'etre charges depuis file://).

    python tools/serve.py                 -> http://127.0.0.1:8777/

    /tools/selftest.html      les auto-tests
    /tools/preview.html       l'apercu du popup avec des donnees factices
"""
import functools
import http.server
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8777


class Handler(http.server.SimpleHTTPRequestHandler):
    # HTTP/1.1 : le navigateur reutilise une poignee de connexions au lieu d'en
    # ouvrir une par fichier. En HTTP/1.0, chaque reponse ferme sa socket, et
    # sous Windows une fermeture alors qu'il reste des octets en tampon part en
    # RST — d'ou des fichiers tronques (ERR_CONNECTION_RESET) sur les gros
    # fixtures charges en parallele.
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        # Pas de cache : on recharge la page apres chaque modification.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    # Threading obligatoire : les pages d'outils chargent une dizaine de modules
    # et de fixtures en parallele. Un serveur mono-thread en refuse une partie,
    # et la page echoue sur un « Failed to fetch » sans rapport avec le code.
    #
    # `allow_reuse_address` reste a False : sous Windows, SO_REUSEADDR laisse
    # DEUX serveurs se lier au meme port, et les connexions partent alors au
    # hasard de l'un ou de l'autre — d'ou des ERR_CONNECTION_RESET inexplicables.
    # Mieux vaut refuser de demarrer et le dire.
    handler = functools.partial(Handler, directory=str(ROOT))
    try:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    except OSError as exc:
        print(f"Port {PORT} deja pris ({exc}). Arrete l'autre serveur, "
              f"ou lance : python tools/serve.py {PORT + 1}")
        sys.exit(1)
    with server as httpd:
        print(f"http://127.0.0.1:{PORT}/tools/selftest.html")
        print(f"http://127.0.0.1:{PORT}/tools/preview.html")
        httpd.serve_forever()
