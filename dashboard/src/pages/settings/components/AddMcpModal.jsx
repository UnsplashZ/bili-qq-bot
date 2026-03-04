import { X } from 'lucide-react'

const AddMcpModal = ({
    isOpen,
    onClose,
    newMcp,
    onNewMcpChange,
    savingMcp,
    onAddMcp
}) => {
    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-gray-900 border border-white/20 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
                <div className="flex justify-between items-center p-4 border-b border-white/10 bg-white/5">
                    <h3 className="text-lg font-bold text-white">添加 MCP 服务器</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">服务器名称</label>
                        <input
                            type="text"
                            value={newMcp.name}
                            onChange={e => onNewMcpChange({ ...newMcp, name: e.target.value })}
                            placeholder="例如：Filesystem"
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">类型</label>
                        <select
                            value={newMcp.type}
                            onChange={e => onNewMcpChange({ ...newMcp, type: e.target.value })}
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                        >
                            <option value="stdio">stdio</option>
                            <option value="sse">sse</option>
                            <option value="streamable_http">streamable_http</option>
                        </select>
                    </div>
                    {newMcp.type !== 'stdio' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">URL</label>
                            <input
                                type="text"
                                value={newMcp.url}
                                onChange={e => onNewMcpChange({ ...newMcp, url: e.target.value })}
                                placeholder="http://localhost:port/mcp"
                                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                            />
                        </div>
                    )}
                    {newMcp.type === 'stdio' && (
                        <>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">命令</label>
                                <input
                                    type="text"
                                    value={newMcp.command}
                                    onChange={e => onNewMcpChange({ ...newMcp, command: e.target.value })}
                                    placeholder="npx, python 等"
                                    className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">参数 (逗号分隔)</label>
                                <input
                                    type="text"
                                    value={newMcp.args}
                                    onChange={e => onNewMcpChange({ ...newMcp, args: e.target.value })}
                                    placeholder="-y, @modelcontextprotocol/server-filesystem, /path/to/dir"
                                    className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">环境变量 (JSON)</label>
                                <textarea
                                    value={newMcp.env}
                                    onChange={e => onNewMcpChange({ ...newMcp, env: e.target.value })}
                                    rows={3}
                                    className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white font-mono text-xs focus:border-purple-500 focus:outline-none"
                                />
                            </div>
                        </>
                    )}
                </div>
                <div className="p-4 border-t border-white/10 bg-white/5 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        disabled={savingMcp}
                        className="px-4 py-2 text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                    >
                        取消
                    </button>
                    <button
                        onClick={onAddMcp}
                        disabled={savingMcp || !newMcp.name || (newMcp.type === 'stdio' ? !newMcp.command : !newMcp.url)}
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {savingMcp ? '添加中...' : '添加服务器'}
                    </button>
                </div>
            </div>
        </div>
    )
}

export default AddMcpModal
