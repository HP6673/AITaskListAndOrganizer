# Orbital Tasks

## Run it (everything already installed)

Open PowerShell and run:

```powershell
ollama serve
```

Open a second PowerShell window:

```powershell
cd path\to\AITaskListAndOrganizer
npm start
```

Open in your browser:

```
http://localhost:5757
```

## First-time setup (Windows)

1. Install Node.js: download and run the installer from https://nodejs.org (LTS version), or via winget:
   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```

2. Install Ollama: download and run the installer from https://ollama.com/download/windows, or via winget:
   ```powershell
   winget install Ollama.Ollama
   ```

3. Pull a model for Ollama to use:
   ```powershell
   ollama pull llama3.2:3b
   ```

4. Clone this repo:
   ```powershell
   git clone https://github.com/HP6673/AITaskListAndOrganizer.git
   cd AITaskListAndOrganizer
   ```

5. Install project dependencies:
   ```powershell
   npm install
   ```

6. Start Ollama, then start the app:
   ```powershell
   ollama serve
   ```
   In a second window:
   ```powershell
   npm start
   ```

7. Open in your browser:
   ```
   http://localhost:5757
   ```
