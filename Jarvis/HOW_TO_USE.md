# JARVIS - how to use (Phase 1, text only)

## First-time setup on your Windows PC
1. Copy this whole `Jarvis` folder to `C:\` so it becomes `C:\Jarvis`.
2. Make sure Python 3.10 or newer is installed (python.org). This is the one
   system-wide install JARVIS needs; everything else stays inside `C:\Jarvis`.
3. Double-click `start_jarvis.bat`. The first start takes a minute or two while
   it sets itself up inside `C:\Jarvis\.venv`.
4. Notepad opens a file named `.env`. Paste your Anthropic API key after
   `ANTHROPIC_API_KEY=`, save, close Notepad, and press a key in the black window.
5. Paste your personality and rules into `personality.md` (replace what is there).

## Every day
- Double-click `start_jarvis.bat`. Type, press **Enter**. Shift+Enter = new line.
- Under each reply you see which brain answered, how long it took, and the estimated cost.
- Big jobs ("research...", "write a report on...", "plan...") run in the background.
  Keep chatting; JARVIS beeps and posts the report when it is done, and saves a
  copy in `workspace\reports`.

## Things to say
- "Remember that my car service is due in March." / "What do you remember about my car?"
- "Forget fact 3."
- "Open notepad." / "Open youtube.com."
- "Create a file called ideas.txt with ..." / "Read ideas.txt." (only inside `workspace`)

## Files you may want to touch
| File | What it is |
|---|---|
| `personality.md` | JARVIS's personality and rules |
| `config.yaml` | Which model each brain uses, prices for cost estimates, the list of apps JARVIS may open |
| `.env` | Your API key (never share this file) |
| `logs\requests-DATE.csv` | One line per request - opens in Excel |
| `logs\daily_totals.csv` | Total requests, tokens and estimated cost per day |
| `logs\errors.log` | Technical details if something went wrong |
| `jarvis_memory.db` | JARVIS's memory. Delete it to wipe facts and history |

## Good to know
- Cost figures are estimates from the prices in `config.yaml`; your Anthropic
  Console shows the real bill.
- JARVIS can only open apps listed under `apps:` in `config.yaml`. Add lines there.
- The deep brain has no internet access in Phase 1; it works from what the model knows.
- If a request fails for a temporary reason (connection, overload), JARVIS retries
  once, then tells you what went wrong.
