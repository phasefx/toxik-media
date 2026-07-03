#!/bin/bash
# ./toxik_inside_tmux.sh -s toxik-movies -d ./data-movies -p 8001 --frontend-port 5174
# ./toxik_inside_tmux.sh -s toxik-music -d ./data-music -p 8002 --frontend-port 5175

if command -v tmux &> /dev/null; then
    echo "✔ tmux found"
else
    echo "❌ tmux not found"
    echo "If you need to install it, try one of these invocations:"
    echo "------------------------------------------------------------------------"

    if command -v apt-get &> /dev/null; then
        echo "👉 Debian/Ubuntu:  sudo apt update && sudo apt install tmux"
    elif command -v pacman &> /dev/null; then
        echo "👉 Arch Linux:     sudo pacman -S tmux"
    elif command -v dnf &> /dev/null; then
        echo "👉 RHEL/Fedora:    sudo dnf install tmux"
    elif command -v zypper &> /dev/null; then
        echo "👉 openSUSE:       sudo zypper install tmux"
    elif command -v brew &> /dev/null; then
        echo "👉 macOS (Homebrew): brew install tmux"
    else
        # Fallback if we can't narrow it down automatically
        echo "  Debian/Ubuntu:   sudo apt install tmux"
        echo "  Arch Linux:      sudo pacman -S tmux"
        echo "  RHEL/Fedora:     sudo dnf install tmux"
    fi
    echo "------------------------------------------------------------------------"
    exit 1
fi

SESSION="${TOXIK_SESSION:-toxik}"
DATA_DIR="${TOXIK_DATA_DIR:-./data}"
PORT="${TOXIK_PORT:-8000}"
HOST="${TOXIK_HOST:-0.0.0.0}"
FRONTEND_PORT="${TOXIK_FRONTEND_PORT:-5173}"

KILL_SESSION=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        -k|--kill)
            KILL_SESSION=true
            shift
            ;;
        -s|--session)
            SESSION="$2"
            shift 2
            ;;
        -d|--data-dir)
            DATA_DIR="$2"
            shift 2
            ;;
        -p|--port)
            PORT="$2"
            shift 2
            ;;
        --host)
            HOST="$2"
            shift 2
            ;;
        --frontend-port)
            FRONTEND_PORT="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [options]"
            echo "Options:"
            echo "  -k, --kill               Kill the target tmux session"
            echo "  -s, --session <name>     Tmux session name (default: toxik)"
            echo "  -d, --data-dir <path>    Data directory path (default: ./data)"
            echo "  -p, --port <port>        Backend API port (default: 8000)"
            echo "  --host <host>            Backend listen address (default: 0.0.0.0)"
            echo "  --frontend-port <port>   Frontend Vite UI port (default: 5173)"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Run $0 --help for usage."
            exit 1
            ;;
    esac
done

if [[ "$KILL_SESSION" == true ]]; then
    tmux kill-session -t "$SESSION" 2>/dev/null
    echo "Toxik session '$SESSION' offline."
    exit 0
fi
SESSION="${TOXIK_SESSION:-toxik}"
DATA_DIR="${TOXIK_DATA_DIR:-./data}"
PORT="${TOXIK_PORT:-8000}"
HOST="${TOXIK_HOST:-0.0.0.0}"
FRONTEND_PORT="${TOXIK_FRONTEND_PORT:-5173}"

KILL_SESSION=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        -k|--kill)
            KILL_SESSION=true
            shift
            ;;
        -s|--session)
            SESSION="$2"
            shift 2
            ;;
        -d|--data-dir)
            DATA_DIR="$2"
            shift 2
            ;;
        -p|--port)
            PORT="$2"
            shift 2
            ;;
        --host)
            HOST="$2"
            shift 2
            ;;
        --frontend-port)
            FRONTEND_PORT="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [options]"
            echo "Options:"
            echo "  -k, --kill               Kill the target tmux session"
            echo "  -s, --session <name>     Tmux session name (default: toxik)"
            echo "  -d, --data-dir <path>    Data directory path (default: ./data)"
            echo "  -p, --port <port>        Backend API port (default: 8000)"
            echo "  --host <host>            Backend listen address (default: 0.0.0.0)"
            echo "  --frontend-port <port>   Frontend Vite UI port (default: 5173)"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Run $0 --help for usage."
            exit 1
            ;;
    esac
done

if [[ "$KILL_SESSION" == true ]]; then
    tmux kill-session -t "$SESSION" 2>/dev/null
    echo "Toxik session '$SESSION' offline."
    exit 0
fi

# Looks weird but handles edge cases:
BASE_DIR=$(cd -- "$(dirname -- "$0")" && pwd)

cd $BASE_DIR || { echo "Could not change into directory $BASE_DIR" >&2; exit 1; }

if tmux has-session -t "$SESSION" 2>/dev/null; then
    tmux attach-session -t "$SESSION"
    exit 0
fi

mkdir -p "$DATA_DIR"
ABS_DATA_DIR=$(cd -- "$DATA_DIR" && pwd)

tmux new-session -d -s $SESSION -c "$BASE_DIR" -n "Main"
tmux set-option -t $SESSION allow-rename off
tmux set-option -t $SESSION set-titles off
tmux set-option -t $SESSION pane-border-status top

tmux split-window -h -t $SESSION:0.0 -c "$BASE_DIR"
tmux split-window -v -t $SESSION:0.0 -c "$BASE_DIR"

tmux select-pane -t $SESSION:0.0 -T "Backend ($PORT)"
tmux select-pane -t $SESSION:0.1 -T "Frontend ($FRONTEND_PORT)"
tmux select-pane -t $SESSION:0.2 -T "Shell"

tmux send-keys -t $SESSION:0.0 "export TOXIK_DATA_DIR=\"$ABS_DATA_DIR\" TOXIK_PORT=\"$PORT\" TOXIK_HOST=\"$HOST\"" C-m
tmux send-keys -t $SESSION:0.0 "python3 -m venv .venv" C-m
tmux send-keys -t $SESSION:0.0 "source .venv/bin/activate" C-m
tmux send-keys -t $SESSION:0.0 "pip install -r backend/requirements.txt" C-m
tmux send-keys -t $SESSION:0.0 "python -m backend.main" C-m

tmux send-keys -t $SESSION:0.1 "export TOXIK_PORT=\"$PORT\" TOXIK_HOST=\"$HOST\" TOXIK_FRONTEND_PORT=\"$FRONTEND_PORT\"" C-m
tmux send-keys -t $SESSION:0.1 "cd frontend" C-m
tmux send-keys -t $SESSION:0.1 "npm install" C-m
tmux send-keys -t $SESSION:0.1 "npm run dev" C-m

tmux send-keys -t $SESSION:0.2 "export TOXIK_DATA_DIR=\"$ABS_DATA_DIR\" TOXIK_PORT=\"$PORT\" TOXIK_HOST=\"$HOST\"" C-m
tmux send-keys -t $SESSION:0.2 "source .venv/bin/activate 2>/dev/null || true" C-m
tmux send-keys -t $SESSION:0.2 "./import_cli.py --help" C-m
tmux send-keys -t $SESSION:0.2 "echo '💡 Tip: To import media into this collection, run: ./import_cli.py /path/to/media'" C-m

tmux select-window -t $SESSION:0

DISPLAY_HOST="$HOST"
if [[ "$HOST" == "0.0.0.0" ]]; then DISPLAY_HOST="localhost"; fi

echo "Toxik started in the background (Session: $SESSION)."
echo
echo "Collection Data Dir: $ABS_DATA_DIR"
echo "Backend API:         http://$DISPLAY_HOST:$PORT"
echo "Frontend UI:         http://$DISPLAY_HOST:$FRONTEND_PORT"
echo
echo "To check on it: tmux attach -t $SESSION"
echo "Or run $0 -s $SESSION again."
echo
echo "To disconnect from within tmux: Control+b, d"
echo "To kill this session: $0 -s $SESSION -k"
echo
echo "For tmux help within tmux: Control+b, ?"

