import GlassModal from '../../../components/GlassModal'

const RemoveMcpModal = ({ isOpen, onClose, onConfirm, savingMcp }) => {
    return (
        <GlassModal
            isOpen={isOpen}
            onClose={onClose}
            title="移除服务器"
            footer={
                <>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                    >
                        取消
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={savingMcp}
                        className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
                    >
                        移除
                    </button>
                </>
            }
        >
            <p className="text-gray-300">
                确定要移除此 MCP 服务器吗？此操作无法撤销。
            </p>
        </GlassModal>
    )
}

export default RemoveMcpModal
