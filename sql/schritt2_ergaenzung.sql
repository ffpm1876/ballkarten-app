-- =====================================================================
-- Feuerwehr Pyhra – Schritt 2: Ergänzungen für die Web-App
-- Im Supabase SQL-Editor EINMAL ausführen (nach dem Schritt-1-Skript).
-- =====================================================================

-- 1) Koordinaten als einfache Zahlen (die App braucht Breite/Länge pro Haus).
--    Werden von der Datenbank automatisch aus der Position berechnet.
alter table public.houses
  add column lat double precision generated always as (extensions.st_y(geom)) stored,
  add column lng double precision generated always as (extensions.st_x(geom)) stored;


-- 2) Haus-Trigger anpassen: die neuen Spalten lat/lng zählen nicht als "Hausdaten ändern".
--    (Sonst identisch zu Schritt 1.)
create or replace function public.houses_before_update()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  v_change uuid := coalesce(nullif(current_setting('app.change_id', true), '')::uuid, gen_random_uuid());
  v_source text := coalesce(nullif(current_setting('app.change_source', true), ''), 'online');
  v_skip   text[] := array['status', 'revisit', 'version', 'updated_at',
                           'status_changed_at', 'status_changed_by', 'lat', 'lng'];
begin
  if new is not distinct from old then
    return old;
  end if;

  if auth.uid() is not null and not public.is_admin() then
    if (to_jsonb(new) - v_skip) is distinct from (to_jsonb(old) - v_skip) then
      raise exception 'Keine Berechtigung, Hausdaten zu ändern (nur Status und Wiedervorlage).'
        using errcode = '42501';
    end if;
  end if;

  new.version    := old.version + 1;
  new.updated_at := now();

  if new.status is distinct from old.status then
    new.status_changed_at := now();
    new.status_changed_by := auth.uid();
    insert into public.status_history (change_id, house_id, old_status, new_status, changed_by, source)
    values (v_change, old.id, old.status, new.status, auth.uid(), v_source);
  else
    new.status_changed_at := old.status_changed_at;
    new.status_changed_by := old.status_changed_by;
  end if;

  return new;
end;
$$;


-- 3) Import-Funktion für den Admin-Bereich der App.
--    Erwartet eine Liste von Objekten: { osm_id, street, house_number, geometry }.
--    Gebäudeflächen werden zu einem Punkt innerhalb des Gebäudes.
--    Nur für Administratoren. Bestehende Häuser (gleiche osm_id) werden aktualisiert,
--    ihr Status bleibt erhalten.
create or replace function public.import_houses(p_features jsonb)
returns jsonb
language plpgsql security invoker set search_path = public, extensions as $$
declare
  f          jsonb;
  v_geom     extensions.geometry;
  v_osm      text;
  v_street   text;
  v_nr       text;
  v_inserted boolean;
  v_new      integer := 0;
  v_upd      integer := 0;
  v_skip     integer := 0;
  v_err      text;
begin
  if not public.is_admin() then
    raise exception 'Nur Administratoren dürfen Häuser importieren.' using errcode = '42501';
  end if;
  if p_features is null or jsonb_typeof(p_features) <> 'array' then
    raise exception 'p_features muss eine Liste (JSON-Array) sein.';
  end if;

  for f in select value from jsonb_array_elements(p_features) loop
    begin
      v_geom := extensions.st_setsrid(extensions.st_geomfromgeojson((f -> 'geometry')::text), 4326);
      if extensions.geometrytype(v_geom) <> 'POINT' then
        v_geom := extensions.st_pointonsurface(v_geom);
      end if;

      v_osm    := nullif(btrim(f ->> 'osm_id'), '');
      v_street := nullif(btrim(f ->> 'street'), '');
      v_nr     := nullif(btrim(f ->> 'house_number'), '');

      insert into public.houses (osm_id, street, house_number, address, geom)
      values (v_osm, v_street, v_nr, nullif(btrim(concat_ws(' ', v_street, v_nr)), ''), v_geom)
      on conflict (osm_id) do update
        set street       = excluded.street,
            house_number = excluded.house_number,
            address      = excluded.address,
            geom         = excluded.geom
      returning (xmax = 0) into v_inserted;

      if v_inserted then v_new := v_new + 1; else v_upd := v_upd + 1; end if;
    exception when others then
      v_skip := v_skip + 1;
      if v_err is null then v_err := sqlerrm; end if;
    end;
  end loop;

  return jsonb_build_object('inserted', v_new, 'updated', v_upd, 'skipped', v_skip, 'first_error', v_err);
end;
$$;

revoke all on function public.import_houses(jsonb) from public, anon, authenticated;
grant execute on function public.import_houses(jsonb) to authenticated;

-- 4) API-Schema neu laden, damit die neuen Spalten/Funktionen sofort verfügbar sind
notify pgrst, 'reload schema';
