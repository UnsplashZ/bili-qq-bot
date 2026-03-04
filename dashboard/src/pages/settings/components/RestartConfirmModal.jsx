import GlassModal from '../../../components/GlassModal'

const RestartConfirmModal = ({ isOpen, onClose, onConfirm }) => {
    return (
        <GlassModal
            isOpen={isOpen}
            onClose={onClose}
            title="系统重启 (System Restart)"
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
                        className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
                    >
                        确认重启
                    </button>
                </>
            }
        >
            <p className="text-gray-300">
                确定要重启机器人吗？重启期间服务将暂时不可用。
            </p>
        </GlassModal>
    )
}

export default RestartConfirmModal
