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

# Research agent (Phase 3)

## Starting a research job
- Start a message with **research**, **find out** or **compare**, typed or spoken:
  "Research the best way to back up family photos", "Find out when the next
  bank holiday is", "Compare three robot vacuums under 300 dollars".
- JARVIS also starts one by itself when a request needs the web.
- It answers "On it" and works in the background. Keep chatting meanwhile; ask
  "how is the research going?" for a progress count.

## What you get
- A Word file in `workspace\research`, named with the date and topic.
- JARVIS reads out a three-sentence summary and asks whether to open the report.
  Answer yes or no, by voice or typing.
- In the report: links only to pages the agent actually opened, a list of every
  page opened and every search run, and a final section "What I couldn't verify".
  Under it, "Automatic checks by JARVIS" lists links it removed because the page
  was never opened, quotes it could not find word for word in those pages, and
  figures it could not find exactly as written.

## Limits
Set in `config.yaml` under `research:`. Defaults: 20 searches and an estimated
3 dollars per job. At either limit JARVIS stops and asks. Answer **continue**,
**write it up**, or **cancel**.
- The cost is checked between steps, so a job can go somewhat over before it stops.
- Each search costs a fee on top of the normal usage; opening pages does not.

## Good to know
- A research job is lost if you close JARVIS while it is running.
- Pages that need a login or are built entirely by scripts usually cannot be opened.
- The agent is told to mark any number it found on only one page with
  "(single source)". That marking is done by the agent, not checked by JARVIS.
- If you just updated JARVIS, start it with `start_jarvis.bat` once so it can
  install the Word-file part.

# Computer control (Phase 4)

JARVIS's own code decides which tier an action is in; the brain cannot change it.
The tiers and allowed folders are in `config.yaml` under `computer_control:`.

## Tier 1 - done without asking
Open apps and websites, find files by name, read text files, list a folder,
change the volume, look at the screen (the picture is not saved).
"Find my holiday notes", "Read notes.txt in Documents", "Turn the volume down".

## Tier 2 - JARVIS asks first
Create a text file, move or rename a file or folder, move something to the
Recycle Bin, run a PowerShell command, type into an app, fill in a form.
- JARVIS shows the exact action in yellow under **MAY I DO THIS?** and reads it
  aloud if voice is on.
- Answer with the green **Yes, do it** button, or type or say "yes".
  Anything that is not a clear yes counts as no. No answer in 2 minutes counts as no.
- It never overwrites an existing file.
- When typing into an app it never presses Enter, so nothing is sent or submitted.

## Tier 3 - never
Delete permanently, make payments, send emails or messages, change passwords
or security settings, install software.
- "Delete X" becomes "move X to the Recycle Bin", after your yes. You can restore it.
- PowerShell commands that delete, install, download code, send mail or change
  accounts/security are refused before you are even asked. This is a list of
  known commands, not a guarantee, so always read the command before saying yes.

## Allowed folders
`workspace` (C:\Jarvis\workspace), `Documents`, `Downloads`. File actions outside
these are refused. Add a line under `allowed_folders:` to allow another folder.
Note: a PowerShell command you approve is not limited to these folders.

## Kill switch
Press **Ctrl + Alt + K**, or click the red **STOP ALL** button. It stops the
current reply, any waiting question, a running PowerShell command, typing,
screen control, and all background jobs (deep and research). Change the keys
with `kill_switch_hotkey:` in `config.yaml`.

## Action log
`logs\actions-DATE.csv` (opens in Excel): time, tier, action, exactly what,
whether it was automatic / approved / declined / refused, and the result.

## Screen control (mouse and keyboard) - switched OFF
JARVIS can operate apps through the screen using Anthropic's computer use tool.
It is off until you set `screen_control: enabled: true` in `config.yaml`.
Before you do:
- Anthropic recommends running this in a separate virtual machine, not on a PC
  with your personal data and logged-in accounts. On your real PC it can see
  whatever is on screen.
- It is Tier 2: JARVIS asks before the task, and again before every click and
  keystroke (`ask: every_action`). It is slow.
- Close anything sensitive first, watch what it does, and keep a finger near
  the kill switch.

# Speed (Phase 5)

## Measuring before and after
Open a Command Prompt in `C:\Jarvis` and run:

    .venv\Scripts\python.exe benchmark.py

It sends 10 quick and 10 normal requests by text and by voice, first with the
speed improvements off and then on, and prints a before-and-after table of
speed and cost. The table is also saved in `logs`. Add `--silent` to keep it
quiet, or `--text-only` to skip voice. It makes about 80 real API calls and
takes roughly 10 to 15 minutes. It uses a temporary memory, and nothing on your
PC is opened or changed.

## What was changed for speed
- The reflex now answers more by itself: short explanations, simple how-to
  questions, sums, a sentence or two of writing, and finding, listing or reading
  files. Anything that changes something still goes to the main brain.
- The main brain runs at low effort (`effort: low` in `config.yaml`). If
  everyday answers feel thin, change it to `medium`.
- At start-up JARVIS opens its connection and stores the fixed part of its
  prompts in Anthropic's cache (`performance: prewarm`).
- In multi-step tasks the main brain's conversation is cached between steps.
- Speech-to-text uses an NVIDIA graphics card automatically if one works; the
  blue voice line then says "(speech-to-text on graphics card)". If a card is
  found but cannot be used, the reason is in `logs\errors.log`.

## Graphics card for speech-to-text
This needs an NVIDIA card plus NVIDIA's CUDA 12 and cuDNN 9 libraries, which are
a system-wide install. JARVIS does not install them. Without them it simply
uses the processor, as before.

## Tool calls in parallel
When a brain asks for several things in one go, they all come back in a single
round. JARVIS runs them one after another on purpose: its own tools take
milliseconds, and running four file searches on separate threads measured
slower (about 1.2 seconds against 0.09), and order matters for ask-first actions.
