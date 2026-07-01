# EPIC14 — Seed Data

Sprint 14. Goal: development seed data for a German AutoMarket simulation. SQLite file-based database; data loads automatically on first `cds watch`. All UI text and data in German; currency EUR; vehicles are real German-market models with Wikimedia Commons photo URLs.

## Sprint Overview

| # | Item | Status |
|---|---|---|
| EPIC14-T1 | SQLite Config + Referenz-Daten — persistent SQLite, `Roles`, `Branches` CSV | Done |
| EPIC14-T2 | Benutzer & Credentials — Users/UserRoles CSV (bcrypt-gehashte Passwörter via init-hook), Test-Credentials-Dokument | Done |
| EPIC14-T3 | Fahrzeuge — 40+ deutsche Fahrzeuge mit Fotos, `Vehicles` + `VehicleImages` + `PriceHistory` CSV | Done |

### Sprint Backlog DoD mapping

- "SQLite persistent" → EPIC14-T1
- "Roles / Branches" → EPIC14-T1
- "Users per role + credentials doc" → EPIC14-T2
- "30-50 Fahrzeuge + Fotos" → EPIC14-T3

### Sign-off

All three tickets done. 42 vehicles across 4 German branches, 5 users (one per role + second Customer), bcrypt-hashed passwords, Wikimedia Commons photo URLs. CI green.

---

## EPIC14-T1 — SQLite Config + Reference Data

### What & Why

CAP uses in-memory SQLite by default. For development, we switched to a file-based persistent SQLite database so data survives restarts, and placed all seed CSVs under `db/data/` where CAP auto-imports them on startup. The `Roles` and `Branches` entities are seeded first because Users, UserRoles, and Vehicles all have foreign keys pointing at them.

### Step-by-step

**1. `package.json` — switch `db` kind to file-based SQLite**

In the `cds.requires` section, change the `db` block:

```json
"db": {
  "kind": "sqlite",
  "credentials": {
    "url": "db/automarket.db"
  }
}
```

> Note: if you prefer in-memory SQLite (no file on disk), use `":memory:"` as the url. For persistent development data use the file path.

**2. Create `db/data/automarket.Roles.csv`**

```csv
ID,code,description
bbb00000-0000-0000-0000-000000000001,Admin,Systemadministrator – vollständiger Zugriff auf alle Funktionen
bbb00000-0000-0000-0000-000000000002,Manager,Filialleiter – filialübergreifende Verwaltung und Auswertungen
bbb00000-0000-0000-0000-000000000003,Operator,Filialmitarbeiter – Verwaltung innerhalb der eigenen Filiale
bbb00000-0000-0000-0000-000000000004,Customer,Registrierter Kunde – Reservierungen, Angebote und Käufe
```

**3. Create `db/data/automarket.Branches.csv`**

```csv
ID,code,name,address,city,country,region,status
aaa00000-0000-0000-0000-000000000001,MUC,AutoMarkt München,Leopoldstraße 123,München,Deutschland,Bayern,ACTIVE
aaa00000-0000-0000-0000-000000000002,BER,AutoMarkt Berlin,Kurfürstendamm 56,Berlin,Deutschland,Berlin,ACTIVE
aaa00000-0000-0000-0000-000000000003,HAM,AutoMarkt Hamburg,Mönckebergstraße 12,Hamburg,Deutschland,Hamburg,ACTIVE
aaa00000-0000-0000-0000-000000000004,FRA,AutoMarkt Frankfurt,Zeil 90,Frankfurt am Main,Deutschland,Hessen,ACTIVE
```

**4. Commit**

```bash
npm run format && git add db/data/automarket.Roles.csv db/data/automarket.Branches.csv package.json && git commit -m "[EPIC14-T1] SQLite config + Roles and Branches seed data"
```

---

## EPIC14-T2 — Users & Credentials

### What & Why

CAP's mock auth reads credentials from `package.json` at startup and issues JWT-like tokens; each user needs an `id` field that matches the UUID stored in `Users.ID` so that `req.user.id` equals the DB UUID. Password hashes for `Users.csv` were generated offline with bcryptjs (cost 10) because CSV files cannot contain computed values. A human-readable credentials document is saved at `docs/test-credentials.md` for use during testing.

### Password hashes (bcryptjs cost 10, password = `Test@1234`)

Generate with:
```bash
node -e "const b=require('bcryptjs');['Test@1234'].forEach(p=>console.log(b.hashSync(p,10)))"
```

### Step-by-step

**1. Create `db/data/automarket.Users.csv`**

```csv
ID,email,passwordHash,firstName,lastName,phoneNumber,status,mfaRequired,failedLoginCount
ccc00000-0000-0000-0000-000000000001,admin.mueller@automarkt.de,$2b$10$ttuilTyDHfcG33Xx4kuVIOlF98QBnaPV9kkSinLB4rXZqTcWTC/Rq,Thomas,Müller,+49 89 12345001,ACTIVE,true,0
ccc00000-0000-0000-0000-000000000002,manager.schmidt@automarkt.de,$2b$10$4.HRg82dpyNciFsqZRgvV.pQ46.bgJ5hVIOT4Tv5etXeG.Gika5Hu,Anna,Schmidt,+49 30 12345002,ACTIVE,true,0
ccc00000-0000-0000-0000-000000000003,operator.weber@automarkt.de,$2b$10$DtWPfCpiQTXUw2DLJcOGSuREF/2.GTKM8CFloESiSaDErNb6m8CXC,Klaus,Weber,+49 40 12345003,ACTIVE,true,0
ccc00000-0000-0000-0000-000000000004,customer.bauer@automarkt.de,$2b$10$uJTCfSl25KaCpouJmUY4HOkvk.PFnCVm9scap.QaNw5P8IHSKrIgy,Maria,Bauer,+49 69 12345004,ACTIVE,false,0
ccc00000-0000-0000-0000-000000000005,customer.hoffmann@automarkt.de,$2b$10$u88/Z390aljqOJdoyaawAeb81RpTCMAdaOY3IUNFdAG7vLABL5qXe,Stefan,Hoffmann,+49 89 12345005,ACTIVE,false,0
```

**2. Create `db/data/automarket.UserRoles.csv`**

```csv
ID,user_ID,role_ID
ddd00000-0000-0000-0000-000000000001,ccc00000-0000-0000-0000-000000000001,bbb00000-0000-0000-0000-000000000001
ddd00000-0000-0000-0000-000000000002,ccc00000-0000-0000-0000-000000000002,bbb00000-0000-0000-0000-000000000002
ddd00000-0000-0000-0000-000000000003,ccc00000-0000-0000-0000-000000000003,bbb00000-0000-0000-0000-000000000003
ddd00000-0000-0000-0000-000000000004,ccc00000-0000-0000-0000-000000000004,bbb00000-0000-0000-0000-000000000004
ddd00000-0000-0000-0000-000000000005,ccc00000-0000-0000-0000-000000000005,bbb00000-0000-0000-0000-000000000004
```

**3. Update `package.json` — mock auth users**

Replace the `users` block inside `cds.requires.auth`:

```json
"users": {
  "admin.mueller@automarkt.de": {
    "password": "Test@1234",
    "id": "ccc00000-0000-0000-0000-000000000001",
    "roles": ["Admin"]
  },
  "manager.schmidt@automarkt.de": {
    "password": "Test@1234",
    "id": "ccc00000-0000-0000-0000-000000000002",
    "roles": ["Manager"]
  },
  "operator.weber@automarkt.de": {
    "password": "Test@1234",
    "id": "ccc00000-0000-0000-0000-000000000003",
    "roles": ["Operator"],
    "attr": {
      "branchId": "aaa00000-0000-0000-0000-000000000001"
    }
  },
  "customer.bauer@automarkt.de": {
    "password": "Test@1234",
    "id": "ccc00000-0000-0000-0000-000000000004",
    "roles": ["Customer"]
  },
  "customer.hoffmann@automarkt.de": {
    "password": "Test@1234",
    "id": "ccc00000-0000-0000-0000-000000000005",
    "roles": ["Customer"]
  }
}
```

**4. Create `docs/test-credentials.md`**

See the committed file for the full contents: role table, pre-encoded Base64 Basic Auth headers, branch/role UUID reference tables, and example curl commands.

**5. Commit**

```bash
npm run format && git add db/data/automarket.Users.csv db/data/automarket.UserRoles.csv package.json docs/test-credentials.md && git commit -m "[EPIC14-T2] Users, UserRoles seed data and test credentials doc"
```

---

## EPIC14-T3 — Vehicle Seed Data

### What & Why

42 real German-market vehicles are spread across the 4 branches (10–11 per branch) to enable realistic testing of branch-scoped queries, search, and reporting. Every vehicle has exactly one image entry (`sortOrder=0`) pointing to a Wikimedia Commons `Special:FilePath` URL — a stable redirect that does not require a specific image server. 10 `PriceHistory` entries show price reductions for selected premium vehicles, enabling reporting and price-drop notification flows to be tested without manual data entry.

### Vehicle distribution

| Branch | Count | Notable models |
|---|---|---|
| München (MUC) | 10 | Golf VIII, Porsche 911, BMW X5, Audi A4 |
| Berlin (BER) | 11 | Audi RS6, Tesla Model 3, BMW M3, Hyundai Tucson |
| Hamburg (HAM) | 11 | Tesla Model Y, Kia EV6, Porsche 911 Taycan, BMW 430i |
| Frankfurt (FRA) | 10 | Porsche Taycan, Porsche Cayenne, Mercedes S 500, Audi Q7 |

UUID pattern:
- Vehicles: `40000000-4000-4000-4000-4000000000XX` (01–42)
- VehicleImages: `50000000-5000-5000-5000-5000000000XX`
- PriceHistory: `60000000-6000-6000-6000-6000000000XX`

### Step-by-step

**1. Create `db/data/automarket.Vehicles.csv`**

42 rows. Header: `ID,vin,plateNumber,brand,model,year,mileage,fuelType,transmission,color,price,currency,status,branch_ID`

All vehicles have `status=FOR_SALE` and `currency=EUR`. VINs follow the manufacturer prefix convention (WVW=VW, WBA/WBX/WBS=BMW, WDD=Mercedes, WAU=Audi, WP0=Porsche, TMB=Skoda, W0L=Opel, WF0=Ford, 5YJ=Tesla, WMW=MINI, KNA=Hyundai, SB1=Toyota, U5Y=Kia, YV1=Volvo, JM1=Mazda) padded to exactly 17 characters.

See the committed CSV for all 42 rows.

**2. Create `db/data/automarket.VehicleImages.csv`**

42 rows — one per vehicle. Header: `ID,vehicle_ID,url,sortOrder`

All `sortOrder=0`. URLs use the `https://commons.wikimedia.org/wiki/Special:FilePath/<filename>` pattern. Filenames with special characters (Škoda) are percent-encoded (Š = `%C5%A0`).

Confirmed Wikimedia Commons filenames used (selected):
- `Volkswagen_Golf_VIII_IMG_2044.jpg`
- `BMW_3_Series_(G20).jpg`
- `Mercedes-Benz_C200_AVANTGARDE_(W206)_front.jpg`
- `Audi_A4_B9_sedans_(FL)_1X7A6816.jpg`
- `Porsche_992_Carrera_S_coupe_IMG_5838.jpg`
- `2021_Volkswagen_Tiguan_R_Line.jpg`
- `BMW_G05_IMG_0919.jpg`
- `Audi_Q5_FY_Facelift_IMG_4139.jpg`
- `Audi_RS6_Avant_C8_IMG_5683.jpg`
- `Tesla_Model_3_Front_View.jpg`
- `BMW_M3_Competition_(G80)_1X7A0170.jpg`
- `2022_MY_Toyota_RAV4_Hybrid_facelift_XA50.jpg`
- `2022_Tesla_Model_Y_Long_Range_AWD.jpg`
- `Volkswagen_Polo_VI_(2021)_IMG_5700.jpg`
- `BMW_520d_G30_2019.jpg`
- `Mercedes-Benz_W213_Facelift_IMG_3726.jpg`
- `Mercedes-Benz_W223_IAA_2021_1X7A0206.jpg`
- `Mercedes-Benz_GLC_300_4MATIC.jpg`
- `Porsche_Taycan_2022.jpg`

**3. Create `db/data/automarket.PriceHistory.csv`**

10 rows showing price reductions on premium vehicles. Header: `ID,vehicle_ID,oldPrice,newPrice,currency,changedBy`

`changedBy` stores the user's email (matches `Users.email` in the DB).

**4. Commit**

```bash
npm run format && git add db/data/automarket.Vehicles.csv db/data/automarket.VehicleImages.csv db/data/automarket.PriceHistory.csv docs/implementations/EPIC14-seed-data.md && git commit -m "[EPIC14-T3] Vehicle seed data: 42 vehicles with images and price history"
```
