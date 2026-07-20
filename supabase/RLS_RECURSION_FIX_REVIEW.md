# RLS Recursion Fix Review

## Ursache
Die Rekursion entstand durch Admin-Policies, die den Adminstatus direkt über `public.profiles` geprüft haben. Sobald `public.profiles` selbst per RLS gelesen wurde, löste die Policy `Admins can read all profiles` erneut eine Abfrage auf `public.profiles` aus. Das führte zu `ERROR 42P17: infinite recursion detected in policy for relation "profiles"`.

## Betroffene Policy oder Funktion
- `public.profiles`:
  - `Admins can read all profiles`
  - `Admins can manage all profiles`
- Weitere rekursive Admin-Policies mit derselben Musterprüfung auf `public.profiles`:
  - `public.farms` - `Admins can manage farms`
  - `public.products` - `Admins can manage products`
  - `public.opening_hours` - `Admins can manage opening hours`
  - `public.farm_images` - `Admins can manage farm images`
  - `public.verification_requests` - `Admins can manage verification requests`
  - `public.farm_owners` - `Admins can manage farm owners`

## Korrektur
Die neue Migration `supabase/migrations/003_fix_profiles_rls_recursion.sql` führt eine private Helper-Funktion ein:
- `private.current_user_is_admin()`

Eigenschaften:
- eigenes Schema `private`
- `returns boolean`
- `language sql`
- `stable`
- `security definer`
- `set search_path = ''`
- vollständig qualifizierte Tabellenreferenz auf `public.profiles`
- keine frei übergebene Benutzer-ID
- EXECUTE nur für `authenticated`
- EXECUTE für `PUBLIC` und `anon` entzogen

Alle Admin-Policies werden danach auf diese Helper-Funktion umgestellt und enthalten keine direkte Unterabfrage auf `public.profiles` mehr.

## Warum SECURITY DEFINER die Rekursion verhindert
Die Adminprüfung läuft in einer separaten Funktion mit Definer-Rechten. Dadurch wird der Adminstatus nicht mehr als Teil einer RLS-Policy auf `public.profiles` selbst mit einer normalen, rekursiven `SELECT`-Policy geprüft. Die Funktion kann `public.profiles` kontrolliert auswerten, ohne dass die Profil-Policy erneut in dieselbe Schleife zurückspringt.

## Verbleibende Sicherheitsrisiken
- Die Funktion ist bewusst privilegiert, daher muss der Funktionskörper klein und vollständig qualifiziert bleiben.
- Der Owner sollte ein vertrauenswürdiger DB-Owner wie `postgres` bleiben.
- Wenn künftig neue Admin-Policies ergänzt werden, müssen sie ebenfalls ausschließlich `private.current_user_is_admin()` verwenden.
- Die `profiles`-Self-Policies und der Trigger zum Schutz von `role` und `id` müssen erhalten bleiben.

## SQL-Tests nach der Migration
Die folgenden Prüfungen sollten nach dem Einspielen der Migration in einem kontrollierten SQL-Editor oder mit einer passenden Supabase-Testumgebung ausgeführt werden.

### 1. `farmer_pending` liest eigenes Profil
```sql
begin;
set local role authenticated;
set local request.jwt.claim.sub = '<farmer_pending_user_id>';

select id, display_name, phone, role
from public.profiles
where id = auth.uid();

rollback;
```

Erwartung: genau eine Zeile, nur das eigene Profil.

### 2. `farmer_pending` liest eigene Anträge
```sql
begin;
set local role authenticated;
set local request.jwt.claim.sub = '<farmer_pending_user_id>';

select id, profile_id, requested_by_profile_id, status
from public.verification_requests
where requested_by_profile_id = auth.uid();

rollback;
```

Erwartung: nur eigene Anträge mit `requested_by_profile_id = auth.uid()`.

### 3. `farmer_pending` sieht keine fremden Profile
```sql
begin;
set local role authenticated;
set local request.jwt.claim.sub = '<farmer_pending_user_id>';

select count(*) as visible_other_profiles
from public.profiles
where id <> auth.uid();

rollback;
```

Erwartung: `0`.

### 4. `farmer_pending` kann eigene Rolle nicht ändern
```sql
begin;
set local role authenticated;
set local request.jwt.claim.sub = '<farmer_pending_user_id>';

update public.profiles
set role = 'admin'
where id = auth.uid();

rollback;
```

Erwartung: Fehler durch Trigger beziehungsweise Schutzlogik, kein Rollenwechsel.

### 5. Admin kann Profile und Anträge verwalten
```sql
begin;
set local role authenticated;
set local request.jwt.claim.sub = '<admin_user_id>';

select private.current_user_is_admin();
select count(*) from public.profiles;
select count(*) from public.verification_requests;

rollback;
```

Erwartung: `private.current_user_is_admin()` liefert `true`, Profile und Anträge sind lesbar.

### 6. Admin-Policy ohne Rekursion prüfen
```sql
begin;
set local role authenticated;
set local request.jwt.claim.sub = '<admin_user_id>';

select *
from public.profiles
limit 1;

rollback;
```

Erwartung: Kein `42P17`, kein Rekursionsfehler.
