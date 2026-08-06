# How to Run:

### Already Ran:
1. Open powershell or terminal
2. Run <pre>ollama serve</pre>
3. Open site - https://hp6673.github.io/AITaskListAndOrganizer/




### Initial Setup - Windows:
1. Open powershell and run following commands:

<pre>
   winget install Ollama.Ollama
   ollama pull llama3.2:3b
   setx OLLAMA_ORIGINS "https://hp6673.github.io" /M
   ollama serve
</pre>

3. Open Site - https://hp6673.github.io/AITaskListAndOrganizer/




### Initial Setup - Mac:
1. Open terminal and run following commands:

<pre>
   brew install ollama
   ollama pull llama3.2:3b
   launchctl setenv OLLAMA_ORIGINS "https://hp6673.github.io"
</pre>

2. Relaunch Ollama
3. Run <pre>ollama serve</pre>
4. Open Site - https://hp6673.github.io/AITaskListAndOrganizer/
