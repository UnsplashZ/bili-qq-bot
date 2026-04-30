import { Activity, Bot, Brain, Home, Settings, Terminal, Users } from 'lucide-react';

export const NAV_ITEMS = [
  { icon: Home, label: '运行状态', href: '/' },
  { icon: Users, label: '群组管理', href: '/groups' },
  { icon: Settings, label: '系统设置', href: '/settings' },
  { icon: Bot, label: 'Agent 管理', href: '/agent-settings' },
  { icon: Activity, label: 'Agent 决策', href: '/agent-decisions' },
  { icon: Brain, label: 'Agent 记忆', href: '/agent-memory' },
  { icon: Terminal, label: '系统日志', href: '/logs' }
];
