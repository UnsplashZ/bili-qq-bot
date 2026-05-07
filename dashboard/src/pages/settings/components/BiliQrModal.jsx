import GlassModal from '../../../components/GlassModal'

const BiliQrModal = ({ isOpen, onClose, qrCodeUrl }) => {
    return (
        <GlassModal
            isOpen={isOpen}
            onClose={onClose}
            title="扫码登录 B 站（全局）"
        >
            <div className="flex flex-col items-center space-y-4">
                <p className="text-[var(--muted)] text-sm text-center">
                    请使用 B 站 App 扫描下方二维码完成登录
                </p>
                {qrCodeUrl && (
                    <img
                        src={qrCodeUrl}
                        alt="QR Code"
                        className="w-64 h-64 border-2 border-[var(--border)] rounded-lg"
                    />
                )}
                <div className="flex items-center gap-2 text-[var(--accent)]">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-[var(--accent)] border-t-transparent" />
                    <span className="text-sm">等待扫码...</span>
                </div>
                <p className="text-xs text-[var(--muted)]">
                    二维码有效期60秒，超时请重新获取
                </p>
            </div>
        </GlassModal>
    )
}

export default BiliQrModal
