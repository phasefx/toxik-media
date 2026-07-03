#!/bin/bash

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

SESSION="toxik"

# Looks weird but handles edge cases:
BASE_DIR=$(cd -- "$(dirname -- "$0")" && pwd)

cd $BASE_DIR || { echo "Could not change into directory $BASE_DIR" >&2; exit 1; }

if [[ "$1" == "-k" || "$1" == "--kill" ]]; then
    tmux kill-session -t $SESSION 2>/dev/null
    echo "Toxik offline."
    exit 0
fi

if tmux has-session -t $SESSION 2>/dev/null; then
    tmux attach-session -t $SESSION
    exit 0
fi

tmux new-session -d -s $SESSION -c "$BASE_DIR" -n "Main"
tmux set-option -t $SESSION allow-rename off
tmux set-option -t $SESSION set-titles off
tmux set-option -t $SESSION pane-border-status top

tmux split-window -h -t $SESSION:0.0 -c "$BASE_DIR"
tmux split-window -v -t $SESSION:0.0 -c "$BASE_DIR"

tmux select-pane -t $SESSION:0.0 -T "Backend"
tmux select-pane -t $SESSION:0.1 -T "Frontend"
tmux select-pane -t $SESSION:0.2 -T "Shell"

tmux send-keys -t $SESSION:0.0 "python3 -m venv .venv" C-m
tmux send-keys -t $SESSION:0.0 "source .venv/bin/activate" C-m
tmux send-keys -t $SESSION:0.0 "pip install -r backend/requirements.txt" C-m
tmux send-keys -t $SESSION:0.0 "python -m backend.main" C-m
tmux send-keys -t $SESSION:0.1 "cd frontend" C-m
tmux send-keys -t $SESSION:0.1 "npm install" C-m
tmux send-keys -t $SESSION:0.1 "npm run dev" C-m
tmux send-keys -t $SESSION:0.2 "./import_cli.py --help" C-m

tmux select-window -t $SESSION:0

echo "Toxik started in the background (Session: $SESSION)."
echo
echo "To check on it: tmux attach -t $SESSION"
echo "Or run $0 again."
echo
echo "To disconnect from within tmux: Control+b, d"
echo "To kill it: $0 -k"
echo
echo "For tmux help within tmux: Control+b, ?"
