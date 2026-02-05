#!/bin/bash

# Bili QQ Bot 数据备份脚本
# 使用方法: ./scripts/backup.sh

set -e

# 配置
BACKUP_ROOT="backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP"

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Bili QQ Bot 数据备份工具${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# 检查是否在项目根目录
if [ ! -f "package.json" ]; then
    echo -e "${RED}错误: 请在项目根目录运行此脚本${NC}"
    exit 1
fi

# 创建备份目录
echo -e "${YELLOW}创建备份目录: $BACKUP_DIR${NC}"
mkdir -p "$BACKUP_DIR"

# 备份配置文件
echo -e "${YELLOW}备份配置文件...${NC}"
if [ -f "config/config.json" ]; then
    cp config/config.json "$BACKUP_DIR/"
    echo "  ✓ config.json"
else
    echo "  ⚠ config.json 不存在"
fi

if [ -f ".env" ]; then
    cp .env "$BACKUP_DIR/"
    echo "  ✓ .env"
else
    echo "  ⚠ .env 不存在"
fi

if [ -f "config/.jwtSecret" ]; then
    cp config/.jwtSecret "$BACKUP_DIR/"
    echo "  ✓ .jwtSecret"
fi

# 备份数据目录
echo -e "${YELLOW}备份数据文件...${NC}"

# 向量数据
if [ -d "data/vectors" ]; then
    mkdir -p "$BACKUP_DIR/vectors"
    cp -r data/vectors/* "$BACKUP_DIR/vectors/" 2>/dev/null || true
    COUNT=$(find data/vectors -name "*.json" | wc -l | tr -d ' ')
    echo "  ✓ vectors ($COUNT files)"
else
    echo "  ⚠ data/vectors 不存在"
fi

# 上下文数据
if [ -d "data/contexts" ]; then
    mkdir -p "$BACKUP_DIR/contexts"
    cp -r data/contexts/* "$BACKUP_DIR/contexts/" 2>/dev/null || true
    COUNT=$(find data/contexts -name "*.json" | wc -l | tr -d ' ')
    echo "  ✓ contexts ($COUNT files)"
else
    echo "  ⚠ data/contexts 不存在"
fi

# Cookie文件
COOKIE_COUNT=0
for cookie_file in data/cookies*.json; do
    if [ -f "$cookie_file" ]; then
        cp "$cookie_file" "$BACKUP_DIR/"
        COOKIE_COUNT=$((COOKIE_COUNT + 1))
    fi
done
if [ $COOKIE_COUNT -gt 0 ]; then
    echo "  ✓ cookies ($COOKIE_COUNT files)"
else
    echo "  ⚠ 没有找到 cookies 文件"
fi

# 订阅数据
if [ -f "data/subscriptions.json" ]; then
    cp data/subscriptions.json "$BACKUP_DIR/"
    echo "  ✓ subscriptions.json"
else
    echo "  ⚠ subscriptions.json 不存在"
fi

# Cookie映射
if [ -f "data/cookies_map.json" ]; then
    cp data/cookies_map.json "$BACKUP_DIR/"
    echo "  ✓ cookies_map.json"
fi

# 计算备份大小
BACKUP_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}备份完成!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "备份位置: $BACKUP_DIR"
echo "备份大小: $BACKUP_SIZE"
echo ""
echo "恢复命令:"
echo "  配置: cp $BACKUP_DIR/config.json config/"
echo "  数据: cp -r $BACKUP_DIR/vectors/* data/vectors/"
echo "  完整恢复: ./scripts/restore.sh $TIMESTAMP"
echo ""

# 清理旧备份（保留最近10个）
echo -e "${YELLOW}清理旧备份...${NC}"
cd "$BACKUP_ROOT"
ls -t | tail -n +11 | xargs -I {} rm -rf {}
REMAINING=$(ls -1 | wc -l | tr -d ' ')
echo "  保留最近 $REMAINING 个备份"
cd - > /dev/null

echo -e "${GREEN}完成!${NC}"
