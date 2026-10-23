# Mutual

Mutual is a campus connection app and an unaudited research prototype. Phones notice, over Bluetooth and never GPS, which students actually spent time near each other; each morning a student sees yesterday's crossings and can send a private signal for study, project, fitness, friend or date, which is revealed only if it is returned for the same intent. `SPEC.md` is the contract, `PLAN.md` the phased plan and progress log, and `CLAUDE.md` the rules for the coding agent. The approved interface reference is `docs/design/prototype.html` (open it in a browser).

## Setup (Windows, PowerShell)

```powershell
# Python 3.11 virtual environment (once). Use either line:
py -3.11 -m venv .venv                      # python.org install
uv venv --seed --python 3.11 .venv          # uv-managed Python
.venv\Scripts\Activate.ps1
pip install -e packages/protocol_py -e "server[dev]" -e "sim[dev]" pre-commit
pre-commit install

# Node (once, from the repository root)
npm install

# Checks
pytest packages/protocol_py server sim -q
pre-commit run --all-files
```

Every other command is listed in `CLAUDE.md` §4.

## Trying it

```powershell
$env:MUTUAL_ENV="dev"; uvicorn mutual_server.main:create_app --factory --no-access-log --app-dir server
python -m mutual_server.demo_seed      # second terminal: synthetic students + a demo operator
```

- **Test accounts:** in a dev build of the app (`EXPO_PUBLIC_MUTUAL_ENV=dev`), tap
  *Try a demo account* on the Welcome screen, then a name. Every account is synthetic.
- **Admin:** open `http://127.0.0.1:8000/admin` and sign in as `admin` with the password
  `demo_seed` printed. Owners open colleges, review applications, handle reports,
  suspend accounts and add operators. Campus moderators see only their own college.
- **Colleges:** officials apply at `/colleges`. How to win a college over in real life:
  `docs/COLLEGE_ONBOARDING.md`.
- **Deploying a pilot for free:** `docs/DEPLOYMENT.md`.

