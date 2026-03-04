import GlassCard from '../../../components/GlassCard'
import { Server, Plus, Power, Edit, Trash2, Terminal } from 'lucide-react'

const McpServersSection = ({
    mcpConfig,
    savingMcp,
    onOpenAddModal,
    onToggleMcp,
    onOpenEditMcp,
    onRemoveMcp
}) => {
    return (
        <section>
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Server className="text-purple-400" />
                    <h2 className="text-xl font-semibold text-white">MCP 扩展</h2>
                </div>
                <button
                    onClick={onOpenAddModal}
                    disabled={savingMcp}
                    className="flex items-center gap-2 px-3 py-1.5 bg-purple-600/20 text-purple-300 hover:bg-purple-600/30 border border-purple-500/30 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Plus size={16} />
                    添加服务器
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {mcpConfig.mcpServers.map((server, idx) => (
                    <GlassCard key={idx} className="relative group">
                        <div className="flex justify-between items-start mb-3">
                            <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${server.enabled ? 'bg-green-400' : 'bg-gray-500'}`} />
                                <h3 className="font-semibold text-lg">{server.name}</h3>
                            </div>
                            <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    onClick={() => onToggleMcp(idx)}
                                    disabled={savingMcp}
                                    className="p-1.5 hover:bg-white/10 rounded-md text-gray-300 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={server.enabled ? '禁用' : '启用'}
                                >
                                    <Power size={16} />
                                </button>
                                <button
                                    onClick={() => onOpenEditMcp(idx)}
                                    disabled={savingMcp}
                                    className="p-1.5 hover:bg-blue-500/20 rounded-md text-gray-300 hover:text-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="编辑"
                                >
                                    <Edit size={16} />
                                </button>
                                <button
                                    onClick={() => onRemoveMcp(idx)}
                                    disabled={savingMcp}
                                    className="p-1.5 hover:bg-red-500/20 rounded-md text-gray-300 hover:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="移除"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>

                        <div className="space-y-2 text-sm text-gray-400">
                            <div className="flex items-center gap-2 bg-black/20 p-2 rounded font-mono text-xs truncate">
                                <Terminal size={12} />
                                {server.type && server.type !== 'stdio' ? (
                                    <span className="truncate" title={server.url || ''}>
                                        {server.url || '-'}
                                    </span>
                                ) : (
                                    <span className="truncate" title={`${server.command} ${server.args?.join(' ')}`}>
                                        {server.command} {server.args?.join(' ')}
                                    </span>
                                )}
                            </div>
                            <div className="flex justify-between text-xs">
                                {server.type && server.type !== 'stdio' ? (
                                    <>
                                        <span>类型: {server.type}</span>
                                        <span>URL: {server.url ? '已配置' : '未配置'}</span>
                                    </>
                                ) : (
                                    <>
                                        <span>参数: {server.args?.length || 0}</span>
                                        <span>环境变量: {Object.keys(server.env || {}).length} 个</span>
                                    </>
                                )}
                            </div>
                        </div>
                    </GlassCard>
                ))}

                {mcpConfig.mcpServers.length === 0 && (
                    <div className="col-span-full py-8 text-center text-gray-500 border border-dashed border-white/10 rounded-xl">
                        未安装 MCP 服务器。添加一个以扩展功能。
                    </div>
                )}
            </div>
        </section>
    )
}

export default McpServersSection
