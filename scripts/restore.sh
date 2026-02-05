#!/bin/bash

# Bili QQ Bot 数据恢复脚本
# 使用方法: ./scripts/restore.sh [backup_timestamp]
# 示例: ./scripts/restore.sh 20260205_143022

set -e

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Bili QQ Bot 数据恢复工具${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# 检查参数
if [ -z "$1" ]; then
    echo -e "${YELLOW}可用的备份:${NC}"
    ls -1 backups/ | sort -r | head -10
    echo ""
    echo -e "${RED}请指定要恢复的备份时间戳${NC}"
    echo "使用方法: ./scripts/restore.sh [timestamp]"
    exit 1
fi

TIMESTAMP=$1
BACKUP_DIR="backups/$TIMESTAMP"

# 检查备份是否存在
if [ ! -d "$BACKUP_DIR" ]; then
    echo -e "${RED}错误: 备份目录不存在: $BACKUP_DIR${NC}"
    exit 1
fi

# 确认操作
echo -e "${YELLOW}警告: 此操作将覆盖当前数据!${NC}"
echo "备份时间: $TIMESTAMP"
echo ""
read -p "确认恢复? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "操作已取消"
    exit 0
fi

echo ""
echo -e "${YELLOW}开始恢复...${NC}"

# 恢复配置
if [ -f "$BACKUP_DIR/config.json" ]; then
    cp "$BACKUP_DIR/config.json" config/
    echo "  ✓ config.json"
fi

if [ -f "$BACKUP_DIR/.env" ]; then
    cp "$BACKUP_DIR/.env" .
    echo "  ✓ .env"
fi

if [ -f "$BACKUP_DIR/.jwtSecret" ]; then
    mkdir -p config
    cp "$BACKUP_DIR/.jwtSecret" config/
    echo "  ✓ .jwtSecret"
fi

# 恢复向量数据
if [ -d "$BACKUP_DIR/vectors" ]; then
    mkdir -p data/vectors
    cp -r "$BACKUP_DIR/vectors/"* data/vectors/
    echo "  ✓ vectors"
fi

# 恢复上下文
if [ -d "$BACKUP_DIR/contexts" ]; then
    mkdir -p data/contexts
    cp -r "$BACKUP_DIR/contexts/"* data/contexts/
    echo "  ✓ contexts"
fi

# 恢复Cookie
for cookie_file in "$BACKUP_DIR"/cookies*.json; do
    if [ -f "$cookie_file" ]; then
        cp "$cookie_file" data/
    fi
done
echo "  ✓ cookies"

# 恢复订阅
if [ -f "$BACKUP_DIR/subscriptions.json" ]; then
    cp "$BACKUP_DIR/subscriptions.json" data/
    echo "  ✓ subscriptions"
fi

if [ -f "$BACKUP_DIR/cookies_map.json" ]; then
    cp "$BACKUP_DIR/cookies_map.json" data/
    echo "  ✓ cookies_map"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}恢复完成!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "请重启应用以应用恢复的数据"
