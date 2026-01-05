#!/bin/bash

# Setup script for NapCat QQ Bot

echo "Setting up NapCat QQ Bot environment..."

# 1. Create Python Virtual Environment
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
else
    echo "Virtual environment already exists."
fi

# 2. Install Python Dependencies
echo "Installing Python dependencies..."
source venv/bin/activate
pip install bilibili-api-python aiohttp
deactivate

# 3. Install Node.js Dependencies
if [ -f "package.json" ]; then
    echo "Installing Node.js dependencies..."
    npm install
else
    echo "package.json not found!"
    exit 1
fi

echo "Setup complete!"
echo "To start the bot:"
echo "1. Configure .env file (optional)"
echo "2. Run: npm start"
