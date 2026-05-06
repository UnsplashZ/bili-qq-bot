import { Activity, Bot, Brain, Home, Settings, Terminal, Users } from 'lucide-react';

export const NAV_GROUPS = [
  {
    label: '概览',
    items: [
      { icon: Home, label: '运行状态', href: '/', badge: 'Live' }
    ]
  },
  {
    label: '配置',
    items: [
      { icon: Users, label: '群组管理', href: '/groups', badge: 'Groups' },
      { icon: Settings, label: '系统设置', href: '/settings', badge: 'Config' }
    ]
  },
  {
    label: '自动化',
    items: [
      { icon: Bot, label: 'Agent 管理', href: '/agent-settings', badge: 'Rules' },
      { icon: Activity, label: 'Agent 决策', href: '/agent-decisions', badge: 'Trace' },
      { icon: Brain, label: 'Agent 记忆', href: '/agent-memory', badge: 'Store' }
    ]
  },
  {
    label: '诊断',
    items: [
      { icon: Terminal, label: '系统日志', href: '/logs', badge: 'Logs' }
    ]
  }
];

export const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);
