# Turbo Kart Island

Gioco di kart 3D nel browser (three.js): 5 piste, 3 coppe, oggetti, bot, multigiocatore online (PeerJS) e telefono come controller.

**Gioca:** https://frozut.github.io/turbo-kart-island/

## In locale

```
python serve.py        # http://localhost:8000/
```

`serve.py` espone anche `/lan-ip`, così il QR del controller punta all'IP del PC nella rete locale.

## Test

```
node --test "tests/*.test.mjs"
```
