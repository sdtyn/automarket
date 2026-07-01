# Test Credentials — AutoMarkt Deutschland

Diese Zugangsdaten werden beim Start der Anwendung automatisch geladen (CAP In-Memory SQLite + CSV-Seed).

> **Passwort für alle Benutzer:** `Test@1234`

## Benutzer

| Rolle | E-Mail | Passwort | UUID | Filiale |
|---|---|---|---|---|
| Admin | admin.mueller@automarkt.de | Test@1234 | ccc00000-0000-0000-0000-000000000001 | — |
| Manager | manager.schmidt@automarkt.de | Test@1234 | ccc00000-0000-0000-0000-000000000002 | — |
| Operator | operator.weber@automarkt.de | Test@1234 | ccc00000-0000-0000-0000-000000000003 | München (MUC) |
| Customer | customer.bauer@automarkt.de | Test@1234 | ccc00000-0000-0000-0000-000000000004 | — |
| Customer | customer.hoffmann@automarkt.de | Test@1234 | ccc00000-0000-0000-0000-000000000005 | — |

## Mock-Authentifizierung (cds watch / Entwicklung)

CAP verwendet Mock-Auth mit dem Benutzernamen als Anmelde-ID.
In HTTP-Anfragen wird Basic Auth verwendet:

```
Authorization: Basic <base64(email:Test@1234)>
```

Vorkodierte Base64-Werte:

| Benutzer | Authorization Header |
|---|---|
| admin.mueller@automarkt.de | `Basic YWRtaW4ubXVlbGxlckBhdXRvbWFya3QuZGU6VGVzdEAxMjM0` |
| manager.schmidt@automarkt.de | `Basic bWFuYWdlci5zY2htaWR0QGF1dG9tYXJrdC5kZTpUZXN0QDEyMzQ=` |
| operator.weber@automarkt.de | `Basic b3BlcmF0b3Iud2ViZXJAYXV0b21hcmt0LmRlOlRlc3RAMTIzNA==` |
| customer.bauer@automarkt.de | `Basic Y3VzdG9tZXIuYmF1ZXJAYXV0b21hcmt0LmRlOlRlc3RAMTIzNA==` |
| customer.hoffmann@automarkt.de | `Basic Y3VzdG9tZXIuaG9mZm1hbm5AYXV0b21hcmt0LmRlOlRlc3RAMTIzNA==` |

## Filialen (Branches)

| UUID | Code | Name | Stadt |
|---|---|---|---|
| aaa00000-0000-0000-0000-000000000001 | MUC | AutoMarkt München | München |
| aaa00000-0000-0000-0000-000000000002 | BER | AutoMarkt Berlin | Berlin |
| aaa00000-0000-0000-0000-000000000003 | HAM | AutoMarkt Hamburg | Hamburg |
| aaa00000-0000-0000-0000-000000000004 | FRA | AutoMarkt Frankfurt | Frankfurt am Main |

## Rollen (Roles)

| UUID | Code | Beschreibung |
|---|---|---|
| bbb00000-0000-0000-0000-000000000001 | Admin | Systemadministrator |
| bbb00000-0000-0000-0000-000000000002 | Manager | Filialleiter |
| bbb00000-0000-0000-0000-000000000003 | Operator | Filialmitarbeiter |
| bbb00000-0000-0000-0000-000000000004 | Customer | Registrierter Kunde |

## Anwendung starten

```bash
# Anwendung starten (Seed-Daten werden automatisch geladen)
npm run watch
# oder
cds watch
```

## Beispiel-Anfrage (curl)

```bash
# Fahrzeuge abrufen als Admin
curl -X GET http://localhost:4004/vehicle/Vehicles \
  -H "Authorization: Basic YWRtaW4ubXVlbGxlckBhdXRvbWFya3QuZGU6VGVzdEAxMjM0"

# Bestellungen als Kunde abrufen
curl -X GET http://localhost:4004/sales/Orders \
  -H "Authorization: Basic Y3VzdG9tZXIuYmF1ZXJAYXV0b21hcmt0LmRlOlRlc3RAMTIzNA=="
```
