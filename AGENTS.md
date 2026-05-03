# AGENTS.md — PosteApp

Contexto para herramientas de IA (OpenCode, Copilot, etc.) al trabajar en este proyecto.

---

## Arquitectura

- **Single-file app**: `index.html` (~2000 líneas) contiene HTML, CSS y JS.
- **Backend**: [Supabase](https://supabase.com) con anon key pública.
- **Deploy**: GitHub Pages desde la rama `master`.
- **No build step**: editar `index.html` → commit → push → listo.

---

## Supabase

| Recurso | Detalle |
|---------|---------|
| URL | `https://aoduvchuwxuzdstzlxuu.supabase.co` |
| Auth | Anon key (sin autenticación de usuario) |
| Tablas | `config`, `proyectos`, `registros` |
| Storage | Bucket `fotos` (público) |

### Esquema relevante

- **config**: `key` (PK), `value` — guarda `admin_code`
- **proyectos**: `proyecto_key` (unique), `nombre`, `codigo_acceso`, `modo`, `activo`
- **registros**: `proyecto`, `uid`, `n_poste`, `material`, `altura`, `carga`, `tension`, `estado`, `lat`, `lng`, `fotos` (JSONB), `equipamiento` (JSONB)

### RLS

Todas las tablas tienen políticas `FOR ALL TO anon USING (true) WITH CHECK (true)`.

---

## Mapa del código (líneas aproximadas en index.html)

| Líneas | Sección | Descripción |
|--------|---------|-------------|
| 1–8 | `<head>` | Meta tags, título, CDN links |
| 9–234 | `<style>` | CSS completo (variables, layout, componentes) |
| 240–289 | `#project-screen` | Pantalla de acceso / admin (login, crear proyecto, cambiar código) |
| 291–308 | Header + tabs | Logo, botón salir, 5 tabs (Encuesta, Ubicación, Fotos, Exportar, Soporte) |
| 313–481 | Paneles 0–3 | Formularios de encuesta, GPS, fotos, exportar |
| 484–517 | Panel 4 | Soporte (autor, contacto) |
| 519–550 | Mapa modal + sidebar | Leaflet map y panel de registros |
| 564–566 | `SUPABASE_URL`, `SUPABASE_KEY` | Credenciales Supabase |
| 572–719 | Acceso | `initApp()`, `loadAdminCode()`, `updateAdminCode()`, `verifyCode()`, `clearAccess()` |
| 721–850 | Proyectos | `createProject()`, `startProject()`, `loadPrevProjects()`, `toggleProject()` |
| 893–902 | `goTo()` | Navegación entre tabs |
| 906–960 | Supabase CRUD | `sbUploadPhoto()`, `sbSaveRecord()`, `sbLoadRecords()` |
| 1100–1154 | Draft / caché | Guardar y restaurar borrador local |
| 1156–1211 | GPS | `captureGPS()`, geocodificación Nominatim |
| 1213–1321 | Mapa | `openMap()`, `confirmMapCoord()`, `openProjectMap()` |
| 1325–1515 | Fotos | `trigCam()`, `handleFoto()`, `highlightNextSlot()`, `rmFoto()` |
| 1544–1643 | Guardar | `validateAndSave()`, `newRecord()`, `autoCaptureGPS()` |
| 1763–1925 | Exportar | `buildCSV()`, `buildKML()`, `exportZIP()`, `downloadKML()`, `downloadGeoJSON()` |

---

## Variables globales clave

| Variable | Inicial | Descripción |
|----------|---------|-------------|
| `ADMIN_CODE` | `'4839'` (fallback) | Código admin, se carga de Supabase |
| `isAdmin` | `false` | Si el usuario entró como admin |
| `accessCode` | `''` | Código de acceso actual |
| `projectKey` | `''` | ID del proyecto activo |
| `projectName` | `''` | Nombre del proyecto activo |
| `projectMode` | `'libre'` | `'libre'` o `'estricto'` |
| `records` | `[]` | Registros del proyecto actual |
| `photos` | `[null,null,null]` | Fotos del poste actual (b64 + url) |
| `uid` | generado | ID único del poste actual |
| `seqNum` | autoincremental | Número de secuencia |
| `geoAddress` | `''` | Dirección obtenida por geocodificación |

---

## Flujo de la app

```
initApp()
  → loadAdminCode() [Supabase]
  → verifyCode() match contra ADMIN_CODE o tabla proyectos
  → startProject() carga registros existentes
  → tabs: Encuesta → Ubicación → Fotos → Exportar
  → Guardar: validateAndSave() → sbSaveRecord()
  → Exportar: exportZIP() → CSV + KML + fotos
```

---

## Comandos

```bash
# Deploy (automático vía GitHub Pages)
git add index.html
git commit -m "descripción del cambio"
git push

# Solo hay un archivo. No hay build, lint, ni tests automatizados.
```

---

## Convenciones

- **Idioma**: UI en español, código en inglés.
- **Nombres de funciones**: camelCase descriptivo (`captureGPS`, `handleFoto`, `exportZIP`).
- **IDs de elementos**: prefijo descriptivo (`f-num`, `f-dir`, `proj-input`, `cam-0`).
- **Separadores de sección**: `// ════════════════` con nombre en mayúsculas.
- **CSS**: variables en `:root`, clases con prefijo semántico (`.ps-` = project screen, `.f-` = field, `.mm-` = map modal).
- **Sin librerías externas locales**: todo por CDN (Leaflet, JSZip, Supabase JS, Google Fonts).
