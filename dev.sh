#!/bin/bash

# Store root directory path
ROOT_DIR="$(pwd)"

# Cleanup function to kill background processes on exit/interrupt
cleanup() {
  echo -e "\n\nStopping development servers..."
  if [ -n "$BACKEND_PID" ]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [ -n "$FRONTEND_PID" ]; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
  exit 0
}

# Trap Ctrl+C (SIGINT) and termination (SIGTERM)
trap cleanup SIGINT SIGTERM

echo "Checking Backend dependencies..."
cd "$ROOT_DIR/server"
if [ ! -d "node_modules" ]; then
  echo "Installing backend dependencies..."
  npm install
fi

echo "Starting Backend API..."
npm start &
BACKEND_PID=$!

echo "Checking Frontend dependencies..."
cd "$ROOT_DIR/frontend"
if [ ! -d "node_modules" ]; then
  echo "Installing frontend dependencies..."
  npm install
fi

echo "Starting Frontend Dev Server (Vite)..."
npm run dev &
FRONTEND_PID=$!

# Keep script running and wait for background processes
echo "--------------------------------------------------"
echo "Development environment is running!"
echo "- API: http://localhost:3000"
echo "- Frontend: http://localhost:5173"
echo "Press Ctrl+C to stop both servers."
echo "--------------------------------------------------"

wait
