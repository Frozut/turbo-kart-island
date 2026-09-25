"""Server statico per il gioco. Espone /lan-ip così il QR punta all'IP del PC anche se il gioco è aperto da localhost."""
import http.server
import os
import socket
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))  # nessun pacchetto inviato: serve solo a scegliere l'interfaccia
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/lan-ip":
            body = lan_ip().encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


os.chdir(os.path.dirname(os.path.abspath(__file__)))
print(f"http://localhost:{PORT}/  ·  telefono: http://{lan_ip()}:{PORT}/controller.html", flush=True)
http.server.ThreadingHTTPServer(("", PORT), Handler).serve_forever()
