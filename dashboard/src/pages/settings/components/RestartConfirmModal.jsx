import GlassModal from '../../../components/GlassModal'
import { Button } from '../../../components/ui'

const RestartConfirmModal = ({ isOpen, onClose, onConfirm }) => {
    return (
        <GlassModal
            isOpen={isOpen}
            onClose={onClose}
            title="系统重启 (System Restart)"
            footer={
                <>
                    <Button
                        type="button"
                        onClick={onClose}
                        variant="secondary"
                    >
                        取消
                    </Button>
                    <Button
                        type="button"
                        onClick={onConfirm}
                        variant="danger"
                    >
                        确认重启
                    </Button>
                </>
            }
        >
            <p className="text-[var(--muted)]">
                确定要重启机器人吗？重启期间服务将暂时不可用。
            </p>
        </GlassModal>
    )
}

export default RestartConfirmModal
