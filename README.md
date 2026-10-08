# Panel de Proyectos — Multivista (Jira)

Dashboard estático que muestra un resumen diario de todos los proyectos de Jira
a los que tiene acceso la cuenta configurada. Se actualiza solo, una vez por
día, vía GitHub Actions, y se publica gratis con GitHub Pages.

No hay backend: los datos se generan como un archivo `data/data.json` que la
página lee directamente. El acceso está protegido con un passcode simple
(no es seguridad real, ver sección "Sobre el passcode" más abajo).

## Qué vas a necesitar

- Una cuenta de GitHub (gratis)
- El token de API de Jira que ya generaste en id.atlassian.com
- Tu email de Atlassian: `mfranchini@voyansi.com`
- Tu dominio de Jira: `multivista.atlassian.net`

## Paso 1 — Crear el repositorio

1. Entrá a [github.com/new](https://github.com/new)
2. Nombre del repo: por ejemplo `jira-dashboard`
3. Elegí **Public** (GitHub Pages gratis requiere que el repo sea público —
   el passcode es lo que filtra el acceso, no la privacidad del repo)
4. No marques ninguna opción de inicialización (README, .gitignore, etc.) —
   ya los tenemos armados
5. Creá el repo

## Paso 2 — Subir estos archivos

Desde tu computadora, en la carpeta que descargaste:

```bash
cd jira-dashboard
git init
git add .
git commit -m "Panel de proyectos inicial"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/jira-dashboard.git
git push -u origin main
```

(Reemplazá `TU-USUARIO` por tu nombre de usuario de GitHub.)

## Paso 3 — Guardar el token de Jira como secret

**Nunca pegues el token en el código.** Guardalo así:

1. En el repo de GitHub, ir a **Settings → Secrets and variables → Actions**
2. Click en **New repository secret** y crear estos tres, uno por uno:

   | Name | Value |
   |---|---|
   | `JIRA_DOMAIN` | `multivista.atlassian.net` |
   | `JIRA_EMAIL` | `mfranchini@voyansi.com` |
   | `JIRA_API_TOKEN` | (tu token, el que generaste en id.atlassian.com) |

## Paso 4 — Activar GitHub Pages

1. En el repo, ir a **Settings → Pages**
2. En "Source", elegir **Deploy from a branch**
3. Branch: `main`, carpeta: `/ (root)`
4. Guardar. GitHub te va a dar una URL tipo:
   `https://TU-USUARIO.github.io/jira-dashboard/`

## Paso 5 — Correr la primera sincronización

Por defecto el workflow corre todos los días a las 08:00 UTC (~05:00
Argentina). Para no esperar hasta la próxima corrida automática:

1. Ir a la pestaña **Actions** del repo
2. Click en el workflow **"Update Jira data"**
3. Click en **Run workflow** (botón a la derecha) → **Run workflow**
4. Esperá ~1 minuto y refrescá la página del dashboard

Si algo falla, el log de esa corrida en la pestaña Actions te va a decir
exactamente qué pasó (token inválido, dominio mal escrito, etc.).

## Sobre "Time Tracking"

Pestaña nueva, separada de Resource Management (no pide el PIN de manager
— cualquiera con el login general puede entrar). Cada persona escribe su
email; si coincide con un email del roster (colección `resources` de
Firebase), ve sus propios proyectos asignados y puede cargar sus horas.
Usa las mismas colecciones de Firestore que Resource Management
(`resources`, `assignments`, `assignment_history`), así que todo queda
sincronizado en ambos sentidos automáticamente.

## Sobre "Flagged Projects" y el formulario público

Son dos páginas distintas que comparten la misma colección de Firestore
(`flags`):

- **`flag-form.html`** — formulario público, **sin login ni nada de la
  plataforma visible**. Cualquiera con el link puede buscar un proyecto
  real de Jira y reportar un problema (categoría + descripción + nombre
  opcional). Pensado para compartir con las franquicias directamente
  (por email, etc.) — nunca entran al resto del dashboard.
- **`flagged-projects.html`** (pestaña "Flagged Projects" en la
  plataforma, con login) — acá ya no se puede *crear* un flag, solo
  verlos y gestionarlos: filtrar por estado/territorio/categoría, marcar
  resuelto/reabrir, y click en el proyecto abre el detalle completo.
  Arriba de la lista hay un botón para copiar el link al formulario
  público, para compartirlo.

El link exacto al formulario depende de dónde esté publicado el sitio,
por ejemplo: `https://tu-usuario.github.io/tu-repo/flag-form.html`

## Sobre la secci\u00f3n "In Progress: Due Soon & Overdue" (Dashboard)

Nueva sección fija en el Dashboard, independiente de los filtros de
arriba — siempre muestra el panorama real de todos los tickets "In
Progress" según su fecha de entrega. Si hay alguno vencido, aparece un
banner de alerta rojo arriba de todo.

## Sobre "Franchise Tracking"

Pestaña nueva, sin PIN (acceso libre, igual que Time Tracking). Sirve para
las reuniones de seguimiento con franquicias:

- **Log a Meeting**: creás una reunión (fecha + territorio), y le vas
  agregando ítems — cada uno apunta a un ticket real de Jira o a un
  "proyecto potencial" nuevo (que se crea al vuelo si no existe), con un
  comentario y, opcionalmente, marcado como acción con responsable y fecha
- **Open Action Items**: todas las acciones pendientes de todas las
  reuniones, ordenadas por fecha, con checkbox para marcarlas hechas
- **Meeting History**: reuniones pasadas, agrupadas y filtrables por
  territorio

Usa 3 colecciones nuevas de Firestore: `meetings`, `meeting_items`,
`potential_projects`. Se crean solas, no hace falta tocar nada en Firebase.

## Sobre el login

El dashboard pide usuario y contraseña antes de mostrar nada. Las
credenciales actuales son:

- Usuario: `Hex-Multivista`
- Contraseña: `Hexagon`

**Importante:** esto filtra el acceso casual, pero no es seguridad real —
el archivo `auth.js` es público, así que alguien con conocimientos
técnicos podría intentar forzarlo. No lo uses para datos verdaderamente
sensibles.

Para cambiar las credenciales:

1. Elegí un usuario y contraseña nuevos
2. Generá el hash SHA-256 de `usuario:contraseña` (con los dos puntos en
   el medio, tal cual). En una terminal (Mac/Linux):
   ```bash
   echo -n "tu-usuario:tu-contraseña" | sha256sum
   ```
   En Windows (PowerShell):
   ```powershell
   $h = [System.Security.Cryptography.SHA256]::Create()
   $b = $h.ComputeHash([System.Text.Encoding]::UTF8.GetBytes("tu-usuario:tu-contraseña"))
   ($b | ForEach-Object { $_.ToString("x2") }) -join ""
   ```
3. Copiá el resultado y reemplazá el valor de `AUTH_HASH_HEX` en `auth.js`
4. Subí el cambio (`git add auth.js && git commit -m "cambiar credenciales" && git push`)

## Sobre el PIN de Resource Management

Además del login general, la pestaña "Resource Management" (y sus futuras
subpestañas) tienen un candado propio: un PIN de 4 dígitos. Actual: **`1122`**.

Para cambiarlo, mismo mecanismo que las otras credenciales:

```bash
echo -n "el-pin-nuevo" | sha256sum
```

Reemplazá el resultado en `RM_PIN_HASH_HEX` dentro de `pin-gate.js`.

## Sobre la subpestaña "Timeline"

Suma una tercera colección de Firestore: **`estimates`** — solo se usa
cuando un ticket no tiene "Price" en Jira, para guardar una estimación de
horas ingresada a mano:

```
{ hours: 40, manual: true }   // documento con id = la clave del ticket, ej. "SCAN-6060"
```

Si el ticket tiene Price, la estimación se calcula sola como `Price / 2 / 25`
y no hace falta tocar nada.

## Sobre la subpestaña "Projects" (asignación de horas)

Además de la colección `resources`, esta subpestaña usa una nueva
colección de Firestore: **`assignments`**. Cada documento representa
"esta persona trabajó estas horas, estos días, en este ticket de Jira":

```
{ ticketKey: "SCAN-6060", resourceId: "abc123", hours: { "2026-07-27": 8, "2026-07-28": 8 } }
```

No hace falta crear nada a mano en Firebase — el código crea los
documentos solos la primera vez que asignás un recurso a un ticket. Las
mismas reglas de Firestore ("allow read, write: if true") ya cubren esta
colección nueva.

## Sobre Resource Management (Firebase)

La pestaña "Resource Management" guarda datos en **Firebase Firestore**,
no en Jira. La configuración ya está en `firebase-init.js`.

**Reglas de seguridad de Firestore:** al crear la base de datos en modo de
prueba ("test mode"), las reglas expiran a los 30 días. Cuando eso pase, la
pestaña deja de funcionar hasta que actualices las reglas. Para renovarlas
(o dejarlas sin vencimiento, coherente con que el resto del dashboard
tampoco tiene seguridad real):

1. Firebase Console → tu proyecto → **Firestore Database** → pestaña **Rules**
2. Reemplazá el contenido por:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if true;
       }
     }
   }
   ```
3. **Publish**

Como con el resto del dashboard, esto no es seguridad real — cualquiera
con el link puede editar los recursos. Si en algún momento se necesita
restringir esto, hay que sumar autenticación real de Firebase (es otro
paso, avisen si lo necesitan).

## Ajustar la frecuencia de sincronización

En `.github/workflows/update-data.yml`, la línea:

```yaml
- cron: "0 8 * * *"
```

controla el horario (formato UTC). Por ejemplo, para que corra una vez por
semana los lunes a la misma hora:

```yaml
- cron: "0 8 * * 1"
```

## Estructura del proyecto

```
jira-dashboard/
├── index.html                     # Dashboard page (KPIs + charts by territory)
├── issues.html                    # Issues List page (filterable table)
├── laser-support.html             # 3D Laser Support page (flagged components)
├── laser-support.js               # 3D Laser Support page logic
├── resource-management.html       # Resource Management page (Firebase)
├── resource-management.js         # Resource Management: Team Roster sub-tab + tab switching
├── rm-projects.js                 # Resource Management: Projects sub-tab (hour assignment)
├── rm-timeline.js                 # Resource Management: Timeline sub-tab (Gantt + pace)
├── firebase-init.js               # Firebase config + Firestore init
├── auth.js                        # login gate logic
├── logo.svg                       # Hexagon Multivista logo (login screen)
├── shared.js                      # shared data loading + sync status + project modal
├── dashboard.js                   # Dashboard page logic (Chart.js)
├── list.js                        # Issues List page logic
├── style.css                      # estilos
├── data/
│   └── data.json                  # snapshot de datos (se sobrescribe solo)
├── scripts/
│   └── fetch-jira-data.js         # script que llama a la API de Jira
├── .github/workflows/
│   └── update-data.yml            # corre el script todos los días
└── package.json
```

## Nota sobre las "sheets" adicionales

Todavía no sumamos la tabla con horas usadas y datos manuales que
mencionaste, porque vive en un plugin de terceros y necesitamos confirmar
cuál es (nombre de la app en **Configuración → Apps → Administrar apps**
de Jira) antes de saber si tiene una API a la que podamos conectarnos.
