# Orbital Tasks

## Run it (everything already installed)

**Windows** — open PowerShell and run:
```powershell
ollama serve
```

**macOS** — make sure Ollama is running (menu bar icon, or in Terminal):
```bash
ollama serve
```

Then open in your browser:
```
https://hp6673.github.io/AITaskListAndOrganizer/
```

That's it — the page runs entirely in the browser and only needs Ollama running on your machine.

## First-time setup (Windows)

1. Install Ollama: download and run the installer from https://ollama.com/download/windows, or via winget:
   ```powershell
   winget install Ollama.Ollama
   ```

2. Pull a model for Ollama to use:
   ```powershell
   ollama pull llama3.2:3b
   ```

3. Allow the GitHub Pages site to talk to your local Ollama (one-time). Open PowerShell **as Administrator**:
   ```powershell
   setx OLLAMA_ORIGINS "https://hp6673.github.io" /M
   ```
   Close and reopen PowerShell afterward so the change takes effect.

4. Start Ollama:
   ```powershell
   ollama serve
   ```

5. Open in your browser:
   ```
   https://hp6673.github.io/AITaskListAndOrganizer/
   ```

## First-time setup (macOS)

1. Install Ollama: download from https://ollama.com/download/mac, or via Homebrew:
   ```bash
   brew install ollama
   ```

2. Pull a model for Ollama to use:
   ```bash
   ollama pull llama3.2:3b
   ```

3. Allow the GitHub Pages site to talk to your local Ollama (one-time). In Terminal:
   ```bash
   launchctl setenv OLLAMA_ORIGINS "https://hp6673.github.io"
   ```
   Then quit Ollama (click the menu bar icon → Quit Ollama) and reopen it so it picks up the change. This setting resets on restart/logout — if the page ever shows "Ollama unreachable" again after rebooting, just rerun this command and restart Ollama.

4. Make sure Ollama is running — either the menu bar app, or in Terminal:
   ```bash
   ollama serve
   ```

5. Open in your browser:
   ```
   https://hp6673.github.io/AITaskListAndOrganizer/
   ```

**Note:** tasks are saved in your browser's local storage, not in the cloud — they won't follow you to a different browser or computer. If the page shows "Ollama unreachable," double check the OLLAMA_ORIGINS step and that Ollama is actually running.
