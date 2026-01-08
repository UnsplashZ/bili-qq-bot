#!/bin/bash

# Setup script for Bili QQ Bot

echo "Setting up Bili QQ Bot environment..."

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
if [ -f "requirements.txt" ]; then
    pip install -r requirements.txt
else
    pip install bilibili-api-python aiohttp
fi
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
echo "Initializing configuration files..."

if [ ! -f "config/.env" ]; then
    cp config/.env.example config/.env
    echo "Created config/.env from example."
fi

if [ ! -f "config/config.json" ]; then
    cp config/config.json.example config/config.json
    echo "Created config/config.json from example."
fi

echo "启动机器人: "
echo "1. 编辑 config/.env (连接与 AI 配置) "
echo "2. 编辑 config/config.json (黑名单与群组等) "
echo "3. 运行: npm start"
