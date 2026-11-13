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

# Voice (Phase 2)

## One-time setup
1. Run `start_jarvis.bat` once so the basic setup exists, then close JARVIS.
2. Double-click `setup_voice.bat` and press Y. It downloads about 350 MB of speech
   models into `C:\Jarvis\models` and installs the voice packages into
   `C:\Jarvis\.venv` only. Voice needs Python 3.11 or newer.
3. Start JARVIS again. The blue line at the bottom of the window shows the voice status.

After setup, listening and speaking run on your PC without internet. Only the
text of your request goes to Anthropic, exactly as when you type.

## Talking to JARVIS
- Say **"Jarvis"** then your request, e.g. "Jarvis, what time is it?". You can
  also say "Jarvis", wait for the beep, then speak.
- Or **hold F9** (or the "Hold to talk" button), speak, and let go. This is the
  reliable backup when the wake word does not catch.
- JARVIS detects when you stop talking (a pause of about 0.6 seconds).
- What it heard appears in the chat as **You (JARVIS heard)** so you can spot mistakes.
- To interrupt: say **"Jarvis, stop"**, tap **F9**, or click **Stop talking**.
- Pick a voice from the menu at the bottom: Alan (British man), Ryan (American
  man) or Alba (Scottish woman). All three work offline.
- Typing still works at any time. Typed replies are not read aloud unless you set
  `speak_typed_replies: true` in `config.yaml`.

## Speed check
Open a Command Prompt in `C:\Jarvis` and run:

    .venv\Scripts\python.exe speed_check.py

It plays 10 spoken requests into JARVIS (5 quick, 5 normal) and prints a table
of the time from the end of each request to JARVIS's first spoken word. It makes
real API calls. Every spoken request is also timed in `logs\voice-DATE.csv`.

## Voice tips
- Use a headset if you can. With loudspeakers, the microphone hears JARVIS's own
  voice, which can occasionally set off the wake word.
- If the wake word triggers by mistake too often, or not often enough, adjust
  `wake_word_threshold` in `config.yaml`, or rely on F9.
- If JARVIS cuts you off mid-sentence, raise `end_silence_seconds` (e.g. 0.9).
  Lower values feel faster.
- To change the hotkey, edit `hotkey:` in `config.yaml`.
- If voice fails to start, the blue line says why and typing keeps working.
