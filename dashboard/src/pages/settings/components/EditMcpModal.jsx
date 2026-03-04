import { X } from 'lucide-react'

const EditMcpModal = ({
    isOpen,
    onClose,
    editMcp,
    onEditMcpChange,
    savingMcp,
    onSaveEditMcp
}) => {
    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-gray-900 border border-white/20 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
                <div className="flex justify-between items-center p-4 border-b border-white/10 bg-white/5">
                    <h3 className="text-lg font-bold text-white">编辑 MCP 服务器</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">服务器名称</label>
                        <input
                            type="text"
                            value={editMcp.name}
                            onChange={e => onEditMcpChange({ ...editMcp, name: e.target.value })}
                            placeholder="例如：Filesystem"
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                        />
                        <p className="text-xs text-gray-500 mt-1">只能包含字母、数字、下划线和短横线</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">类型</label>
                        <select
                            value={editMcp.type}
                            onChange={e => onEditMcpChange({ ...editMcp, type: e.target.value })}
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                        >
                            <option value="stdio">stdio</option>
                            <option value="sse">sse</option>
                            <option value="streamable_http">streamable_http</option>
                        </select>
                    </div>
                    {editMcp.type !== 'stdio' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">URL</label>
                            <input
                                type="text"
                                value={editMcp.url}
                                onChange={e => onEditMcpChange({ ...editMcp, url: e.target.value })}
                                placeholder="http://localhost:port/mcp"
                                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                            />
                        </div>
                    )}
                    {editMcp.type === 'stdio' && (
                        <>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">命令</label>
                                <input
                                    type="text"
                                    value={editMcp.command}
                                    onChange={e => onEditMcpChange({ ...editMcp, command: e.target.value })}
                                    placeholder="npx, python 等"
                                    className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">参数 (逗号分隔)</label>
                                <input
                                    type="text"
                                    value={editMcp.args}
                                    onChange={e => onEditMcpChange({ ...editMcp, args: e.target.value })}
                                    placeholder="-y, @modelcontextprotocol/server-filesystem, /path/to/dir"
                                    className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">环境变量 (JSON)</label>
                                <textarea
                                    value={editMcp.env}
                                    onChange={e => onEditMcpChange({ ...editMcp, env: e.target.value })}
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
                        onClick={onSaveEditMcp}
                        disabled={savingMcp || !editMcp.name || (editMcp.type === 'stdio' ? !editMcp.command : !editMcp.url)}
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {savingMcp ? '保存中...' : '保存更改'}
                    </button>
                </div>
            </div>
        </div>
    )
}

export default EditMcpModal
