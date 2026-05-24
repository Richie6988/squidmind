#!/bin/bash

# 🦑 SquidMind - GitHub Push Script
# Repository: https://github.com/Richie6988/squidmind

echo "🦑 SquidMind - Preparing to push to GitHub..."
echo ""
echo "Repository URL: https://github.com/Richie6988/squidmind"
echo ""

# Navigate to project
cd /home/claude/squidmind

# Check git status
echo "📊 Current git status:"
git status
echo ""

# Show remote
echo "🔗 Current remote:"
git remote -v
echo ""

echo "📝 Instructions pour push:"
echo ""
echo "Option 1 - Avec ton GitHub token:"
echo "  git remote set-url origin https://<TON_TOKEN>@github.com/Richie6988/squidmind.git"
echo "  git push -u origin main"
echo ""
echo "Option 2 - Avec GitHub CLI:"
echo "  gh auth login"
echo "  git push -u origin main"
echo ""
echo "Option 3 - Avec SSH (si configuré):"
echo "  git remote set-url origin git@github.com:Richie6988/squidmind.git"
echo "  git push -u origin main"
echo ""
echo "✅ Le repo est prêt, il attend juste d'être pushé!"
