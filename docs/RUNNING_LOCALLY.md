# Running this project on the development laptop

Status: written 2026-10-07, after getting the app to build and launch on an
emulator for the first time. Every workaround here is one that was actually
needed, not a precaution.

Added to `SPEC.md` §20's file list in the same change that introduced it.

---

## The short version

```bash
# Git Bash, from the repository root.
export PATH="/c/Program Files/nodejs:$LOCALAPPDATA/Android/Sdk/platform-tools:$PATH"
export JAVA_HOME="$LOCALAPPDATA/Programs/Microsoft/jdk-17.0.10.7-hotspot"
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export MSYS_NO_PATHCONV=1            # or adb's /sdcard/... paths get mangled

# Python: see "the Device Guard problem" below -- do NOT use .venv/Scripts/python.exe
R="$PWD"
PY="C:/Users/sanka/AppData/Roaming/uv/python/cpython-3.11-windows-x86_64-none/python.exe"
export PYTHONPATH="$R/.venv/Lib/site-packages;$R/packages/protocol_py;$R/server;$R/sim"

"$PY" -m pytest packages/protocol_py server sim -q      # 325 tests (2026-10-23)
npm test -w app                                          # 220 tests (2026-10-23)
```

---

## The Device Guard problem (the important one)

**It is Smart App Control, and it is on.** Checked on 2026-10-07:

```powershell
(Get-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy).VerifiedAndReputablePolicyState
# 1 = enforced, 2 = evaluation, 0 = off
```

It returned **1**. Smart App Control blocks executables it does not consider
signed and reputable, which is exactly what a freshly created virtualenv's
`python.exe` is — a copy with no signature of its own.

**Turning it off is a one-way door.** Windows Security → App & browser control
→ Smart App Control settings → Off. Once off it cannot be switched back on
without resetting or reinstalling Windows, so it is worth deciding deliberately
rather than in the middle of a build. Defender's real-time protection is
separate and stays on either way.

The alternative is the shim directory below, which works and costs nothing but
having to remember it. The one thing the shim cannot fix is `scipy`'s compiled
module, so the study's mixed-effects model cannot be fitted on this machine
while Smart App Control is on; that analysis can be run elsewhere (it needs no
paid service) and the eight descriptive tables print regardless.

**`.venv\Scripts\python.exe` is blocked by this machine's Device Guard / WDAC
policy.** Running it gives:

```
'...\.venv\Scripts\python.exe' was blocked by your organization's Device Guard policy.
```

It worked for most of the build session and then started being blocked, so the
policy evidently re-evaluates. The **uv-managed interpreter it was copied from
is still allowed**:

```
C:\Users\sanka\AppData\Roaming\uv\python\cpython-3.11-windows-x86_64-none\python.exe
```

So: use that interpreter, and put the venv's packages on `PYTHONPATH`. The
three editable installs (`mutual_protocol`, `mutual_server`, `mutual_sim`) are
installed via `.pth` files, which `PYTHONPATH` does not process, so their
source directories have to be listed too — that is why `PYTHONPATH` has four
entries and not one.

Verified: `272 passed`.

### The pre-commit gate works, but only with the shim directory on `PATH`

The hooks shell out to bare `python`, `pytest` and `ruff`. With the venv's own
interpreter blocked, they find the system Python 3.14 instead, which has none of
the dependencies.

`%LOCALAPPDATA%\mutual-dev-shim` holds `python`, `pytest`, `ruff`, `alembic` and
`uvicorn` shims that route through the allowed uv interpreter with the right
`PYTHONPATH`. **Put it first on `PATH` before committing** and the whole gate
runs — verified on 2026-10-07, all eleven hooks passing:

```bash
export PATH="/c/Users/sanka/AppData/Local/mutual-dev-shim:$PATH"
git add -A && git commit -F message.txt
```

(An earlier version of this file said the four Python hooks fail regardless.
That was written after a run where the shim directory was not on `PATH`, and it
was wrong. They pass.)

`.git/hooks/pre-commit` is also patched to use the allowed interpreter, so a
commit from a shell without the shim still gets most of the way.

**The proper fix is still yours to make.** Ask whoever administers this machine
to allow the `.venv\Scripts\` directory under the Device Guard / WDAC policy,
then delete the shim directory. A workaround that has to be remembered is one
that will eventually be forgotten.

### What else that policy blocks

- **`scipy`'s compiled `_alternative` module**, which is why the study's
  mixed-effects model cannot be fitted here. `study/analysis/analyze.py`
  reports it as an environment problem and still prints all eight
  pre-registered tables.

## PowerShell: two separate problems

1. **`.venv\Scripts\Activate.ps1` fails** with
   `running scripts is disabled on this system`. Fix with
   `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`
   (no admin needed) — **but it will not help**, because of (2).
2. **PowerShell cannot run the venv's Python at all** (Device Guard, above).

**Use Git Bash for anything involving Python.** PowerShell is fine for Gradle,
the emulator and `adb`.

## The 260-character path limit

The C++ part of the Android build fails from this project's real path:

```
ninja: error: Stat(...RNGestureHandlerDetectorShadowNode.cpp.o): Filename longer than 260 characters
```

Windows `LongPathsEnabled` is already `1`; ninja and CMake do not honour it.
CMake mangles each source file's absolute path into its object-file name, so the
project's own path has to be short before the build starts.

**Use a `subst` drive, not a junction.** `C:\mtl` is a junction, which is a
reparse point, and Java's `getCanonicalPath()` — used by Gradle and by the React
Native Gradle plugin when it writes `Android-autolinking.cmake` — resolves it
straight back to the long path, so the generated CMake files name
`C:/Users/sanka/Desktop/STUDIES/AIDS/Project 2/node_modules/...` however the
build was launched. A `subst` drive is not a reparse point and survives
canonicalisation:

```powershell
subst M: "C:\Users\sanka\Desktop\STUDIES\AIDS\Project 2"
cd M:\app\android
.\gradlew.bat assembleDebug
```

`subst` does not survive a reboot; re-run it.

**The stale cache turned out to matter more than the path.** On 2026-10-07 this
error came back after an `expo prebuild`, and rebuilding through the junction
did not clear it. What did was deleting the two generated directories first:

```powershell
Remove-Item -Recurse -Force app\android\app\.cxx, app\android\app\build\generated\autolinking
```

With those gone the build succeeded in 25 minutes. So when the 260-character
error appears, delete those two directories before trying anything cleverer —
and note that the generated `Android-autolinking.cmake` still names the real
long path whether you build from `M:`, from `C:\mtl`, or from the project
itself, because the React Native Gradle plugin canonicalises. The short path is
insurance, not the fix.

The junction is still there and is still convenient for everything that is not
the C++ build:

```powershell
cmd /c 'mklink /J C:\mtl "C:\Users\sanka\Desktop\STUDIES\AIDS\Project 2"'
cd C:\mtl\app\android
.\gradlew.bat assembleDebug
```

`C:\mtl` already exists. It is a junction, not a copy — the same files.

## Building and running the app

**Set `EXPO_PUBLIC_MUTUAL_ENV=dev` before building or starting Metro.** The app
config defaults to `prod` on purpose (invariant 11: a build made without the
variable must be the safe one), and `isDev()` is what shows the dev panel,
enables clock travel and allows the fake BLE adapter on an emulator. Without it
the build works, but the dev panel is gone and `pickAdapter` returns the native
adapter, which honestly reports `unsupported_device` on an emulator.

```powershell
# PowerShell, with JAVA_HOME / ANDROID_HOME set as above.
$env:EXPO_PUBLIC_MUTUAL_ENV = "dev"
subst M: "C:\Users\sanka\Desktop\STUDIES\AIDS\Project 2"   # see the 260-character section
cd M:\app
npx expo prebuild --platform android --no-install
# prebuild wipes android/, and the stale C++ paths under it are what fail the build.
Remove-Item -Recurse -Force android\app\.cxx, android\app\build\generated\autolinking -ErrorAction SilentlyContinue
# Forward slashes on purpose. A .properties file reads a single backslash as an
# escape, so C:\Users\... becomes C:UsersAppData... and Gradle fails with "The
# filename, directory name, or volume label syntax is incorrect".
"sdk.dir=C:/Users/sanka/AppData/Local/Android/Sdk" | Set-Content android\local.properties -Encoding ascii
cd M:\app\android
.\gradlew.bat assembleDebug          # about 12 minutes cold, 2 warm
```

Then, in Git Bash:

```bash
emulator -avd mutual-a -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect &
until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1" ]; do sleep 5; done

adb shell wm size 1080x1920 && adb shell wm density 420   # the default skin is 320x640
adb install -r "C:/Users/sanka/Desktop/STUDIES/AIDS/Project 2/app/android/app/build/outputs/apk/debug/app-debug.apk"
```

Two AVDs already exist: **`mutual-a`** and **`mutual-b`**. Two are needed from
§4 of `docs/E2E_CHECKLIST.md` onwards, because a mutual match needs two people.

Drop `-no-window` to watch it on screen.

### Metro and the server

```bash
adb reverse tcp:8081 tcp:8081      # Metro
adb reverse tcp:8000 tcp:8000      # the Mutual server

cd app && EXPO_PUBLIC_MUTUAL_ENV=dev npx expo start --dev-client --port 8081
```

The app is a **dev build**, so it opens a launcher listing development
servers. Tap the "Mutual" row, or skip the tap with a deep link:

```bash
adb shell am start -a android.intent.action.VIEW \
  -d 'mutual://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081'
```

The server, in Git Bash with the Python setup above:

```bash
"$PY" -m alembic -c server/alembic.ini upgrade head
MUTUAL_ENV=dev "$PY" -m mutual_server.admin campuses approve example.ac.in --name "Example College"
MUTUAL_ENV=dev "$PY" -m uvicorn mutual_server.main:create_app --factory \
  --no-access-log --app-dir server --host 0.0.0.0 --port 8000
```

`MUTUAL_ENV=dev` is required for the admin CLI too: `config.example.yaml` has
`email.mode: console`, which the config refuses outside dev/test.

### Demo data, test accounts and the operator console

With the dev server running, in a second terminal:

```bash
MUTUAL_ENV=dev "$PY" -m mutual_server.demo_seed
```

It opens Example College, seeds 12 synthetic students with crossings and two finished
mutuals, and creates an `/admin` owner called `admin`, printing its password once. Then:

- **In the app** (a dev build): Welcome → *Try a demo account*, then tap a name. Already
  signed in? You tab → *Dev panel*. Both links exist only in dev builds.
- **In a browser:** `http://<laptop-ip>:8000/admin`, as `admin`.
- **College applications:** `http://<laptop-ip>:8000/colleges`. In dev, the verification
  code is printed to the server console, like login codes.

## Screenshots

```bash
export MSYS_NO_PATHCONV=1           # without this, /sdcard/... becomes a Windows path
adb shell screencap -p /sdcard/s.png && adb pull /sdcard/s.png ./shot.png
```

Do **not** use PowerShell's `adb exec-out screencap -p > file.png` — the
redirect adds a BOM and corrupts the PNG.

## Things that look broken and are not

- **Nothing uploads during the day.** Both uploads now wait for a random minute
  inside their window — `signal_upload_window` (18:00–23:30) and
  `presence_upload_window` (00:05–06:00), SPEC §6.11. Running the app at noon
  and expecting a request is a misreading of the system, not a bug. Use the dev
  panel's clock travel to move into a window, or shift the windows in
  `server/config.yaml` for a demo and change them back.
- **A night missed is a night gone.** If the device is not awake during the
  presence window, that day is not uploaded late; the server's cutoff then
  drops it. Deliberate (DECISIONS_LOG 29, Board Q11).

- **`SYSTEM_ALERT_WINDOW` in the debug manifest.** React Native's debug AAR
  declares it for LogBox. `npm run check:privacy -w app` reports it as a note
  in debug and **fails on it in release**. See `docs/DECISIONS_LOG.md` 26.
- **`expo start` says "An update for expo is available".** Ignore it during a
  verification run; upgrading mid-check invalidates what you just measured.
