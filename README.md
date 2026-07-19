# Orbital Tasks

## Run it (everything already installed)

Open PowerShell and run:

```powershell
ollama serve
```

Open in your browser:

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

**Note:** tasks are saved in your browser's local storage, not in the cloud — they won't follow you to a different browser or computer. If the page shows "Ollama unreachable," double check step 3 and that `ollama serve` is running.
