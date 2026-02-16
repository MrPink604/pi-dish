# pi-dish

A minimal web interface for pi's sessions.

## Features

- **Session List**: View all active pi sessions in the sidebar
- **Session Status**: See if sessions are working (green pulse), current context usage %, model, and session name
- **Message View**: Browse full session history with formatted messages
- **Prompt Input**: Send prompts to sessions

## Running

```bash
cd ~/workspace/pi-dish
npm install
npm start
```

Then open http://localhost:3333 in your browser.

## How It Works

- Scans `~/.pi/agent/sessions/` for session files
- Parses JSONL session format to extract messages and metadata
- Uses SSE (Server-Sent Events) for real-time session list updates
- Supports sending prompts via pi's CLI (spawns a new pi process)

## Future Improvements

- Connect to pi's control socket for true real-time updates
- Full RPC mode integration for streaming responses
- Session creation with model selection
- Better markdown rendering
- Image support
