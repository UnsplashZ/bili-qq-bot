import { Power, Trash2, MessageSquare } from 'lucide-react';
import { clsx } from 'clsx';
import GlassCard from '../../../components/GlassCard';

const GroupListPanel = ({
  groups,
  loading,
  selectedGroupId,
  onSelectGroup,
  onToggleGroup,
  onDeleteConfig
}) => {
  return (
    <GlassCard className="w-full lg:w-1/3 flex flex-col p-0 overflow-hidden max-h-[38vh] sm:max-h-[45vh] lg:max-h-none">
      <div className="p-3 sm:p-4 border-b border-white/10 bg-white/5">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <MessageSquare size={18} />
          群组 ({groups.length})
        </h2>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-1.5 sm:p-2 space-y-1">
        {loading ? (
          <div className="text-center p-4 text-gray-400">加载中...</div>
        ) : groups.length === 0 ? (
          <div className="text-center p-4 text-gray-400">未找到群组</div>
        ) : (
          groups.map((group) => (
            <div
              key={group.id}
              onClick={() => onSelectGroup(group.id)}
              className={clsx(
                'flex items-center gap-2.5 sm:gap-3 p-2.5 sm:p-3 rounded-lg cursor-pointer transition-all',
                'hover:bg-white/5',
                selectedGroupId === group.id
                  ? 'bg-blue-500/20 ring-2 ring-blue-500'
                  : 'bg-white/5',
                !group.isEnabled && 'opacity-50',
                !group.isInGroup && 'opacity-60 grayscale'
              )}
            >
              {group.isInGroup ? (
                <button
                  type="button"
                  onClick={(e) => onToggleGroup(e, group)}
                  className="p-1 rounded hover:bg-white/10 transition-colors"
                  title={group.isEnabled ? '禁用群组' : '启用群组'}
                >
                  <Power
                    className={clsx(
                      'w-4 h-4',
                      group.isEnabled ? 'text-green-400' : 'text-gray-400'
                    )}
                  />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={(e) => onDeleteConfig(e, group)}
                  className="p-1 rounded hover:bg-red-500/20 transition-colors"
                  title="删除配置"
                >
                  <Trash2 className="w-4 h-4 text-red-400" />
                </button>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-medium truncate text-white">{group.name || `Group ${group.id}`}</div>
                  {!group.isInGroup && (
                    <span className="text-xs text-red-400 px-2 py-0.5 bg-red-500/20 rounded flex-shrink-0">
                      已退群
                    </span>
                  )}
                </div>
                <div className="text-xs text-white/50">ID: {group.id}</div>
              </div>
              {group.isInGroup && !group.isEnabled && (
                <span className="text-xs text-white/40 px-2 py-1 bg-white/5 rounded">
                  已禁用
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </GlassCard>
  );
};

export default GroupListPanel;
