import { Activity, AlertTriangle } from 'lucide-react'
import { Button } from '../../../components/ui'

const SystemControlSection = ({ onRestart }) => {
    return (
        <section className="pt-8 border-t border-[var(--border)]">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-[var(--fg)] flex items-center gap-2">
                        <Activity className="text-[var(--danger)]" />
                        系统控制
                    </h2>
                    <p className="text-sm mt-1 text-[var(--muted)]">重启会短暂中断当前服务。</p>
                </div>
                <Button
                    type="button"
                    onClick={onRestart}
                    variant="danger"
                    icon={AlertTriangle}
                >
                    重启系统
                </Button>
            </div>
        </section>
    )
}

export default SystemControlSection
