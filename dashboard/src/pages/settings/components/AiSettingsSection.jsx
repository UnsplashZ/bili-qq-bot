import GlassCard from '../../../components/GlassCard'
import AiConfigSection from '../../../components/AiConfigSection'
import { Save, Cpu, MessageSquare } from 'lucide-react'

const AiSettingsSection = ({
    aiConfig,
    savingAi,
    resettingAi,
    onGlobalAiToggle,
    onAiChange,
    onSaveAi,
    onResetAi
}) => {
    return (
        <section>
            <div className="flex items-center gap-2 mb-4">
                <Cpu className="text-blue-400" />
                <h2 className="text-xl font-semibold text-white">AI 配置</h2>
            </div>
            <GlassCard>
                <div className="mb-6 pb-6 border-b border-white/10">
                    <h3 className="text-lg font-semibold text-white mb-4">全局AI功能</h3>
                    <AiConfigSection
                        config={{
                            aiEnabled: aiConfig.aiEnabled,
                            aiRagEnabled: aiConfig.aiRagEnabled,
                            aiProfileEnabled: aiConfig.aiProfileEnabled
                        }}
                        globalConfig={null}
                        onToggle={onGlobalAiToggle}
                        onReset={null}
                        isGroup={false}
                    />
                </div>

                <h3 className="text-lg font-semibold text-white mb-4">AI 参数设置</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            响应概率 ({Math.round(aiConfig.aiProbability * 100)}%)
                        </label>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={aiConfig.aiProbability}
                            onChange={(e) => onAiChange('aiProbability', parseFloat(e.target.value))}
                            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                        />
                        <p className="text-xs text-gray-500 mt-1">AI 回复随机消息的概率。</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            上下文限制 (对话轮数)
                        </label>
                        <input
                            type="number"
                            value={aiConfig.aiContextLimit}
                            onChange={(e) => onAiChange('aiContextLimit', parseInt(e.target.value))}
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                        />
                        <p className="text-xs text-gray-500 mt-1">保留在上下文中的最近对话轮数（1轮 = 1问1答）。</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            温度参数 ({aiConfig.aiTemperature})
                        </label>
                        <input
                            type="range"
                            min="0"
                            max="2"
                            step="0.1"
                            value={aiConfig.aiTemperature}
                            onChange={(e) => onAiChange('aiTemperature', parseFloat(e.target.value))}
                            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                        />
                        <p className="text-xs text-gray-500 mt-1">控制 AI 回复的随机性（0=确定性，2=创造性）。</p>
                    </div>

                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-white/90">
                            历史记录最大体积
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min="1"
                                max="10000"
                                step="1"
                                value={Math.round(aiConfig.aiHistoryMaxSize / (1024 * 1024))}
                                onChange={(e) => {
                                    const mb = Math.max(1, parseInt(e.target.value, 10) || 1)
                                    onAiChange('aiHistoryMaxSize', mb * 1024 * 1024)
                                }}
                                className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white"
                            />
                            <span className="text-white/70 font-medium">MB</span>
                        </div>
                        <p className="text-xs text-white/50">
                            默认: 200 MB (用于存储AI对话历史，范围: 1-10000 MB)
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            向量相似度阈值 ({aiConfig.aiVectorSimilarityThreshold})
                        </label>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={aiConfig.aiVectorSimilarityThreshold}
                            onChange={(e) => onAiChange('aiVectorSimilarityThreshold', parseFloat(e.target.value))}
                            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                        />
                        <p className="text-xs text-gray-500 mt-1">相关性判断标准，值越高越严格。</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            向量搜索结果数量
                        </label>
                        <input
                            type="number"
                            min="1"
                            max="10"
                            value={aiConfig.aiVectorSearchLimit}
                            onChange={(e) => onAiChange('aiVectorSearchLimit', parseInt(e.target.value))}
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                        />
                        <p className="text-xs text-gray-500 mt-1">每次回顾的记忆条数。</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            记忆安全限制 (消息条数)
                        </label>
                        <input
                            type="number"
                            value={aiConfig.aiMemorySafetyLimit}
                            onChange={(e) => onAiChange('aiMemorySafetyLimit', parseInt(e.target.value))}
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                        />
                        <p className="text-xs text-gray-500 mt-1">防止记忆过大导致上下文溢出。</p>
                    </div>

                    <div className="flex items-center justify-between bg-white/5 p-4 rounded-lg">
                        <div>
                            <span className="block text-sm font-medium text-white">向量缓存</span>
                            <span className="text-xs text-gray-400">启用向量数据库缓存以支持长期记忆</span>
                        </div>
                        <div className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={aiConfig.aiEnableVectorCache}
                                onChange={(e) => onAiChange('aiEnableVectorCache', e.target.checked)}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </div>
                    </div>
                </div>

                <div className="space-y-4 pt-6 border-t border-white/10">
                    <div className="flex items-center gap-2">
                        <MessageSquare className="w-5 h-5 text-blue-400" />
                        <h3 className="text-lg font-semibold text-white">对话服务配置</h3>
                    </div>

                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                        <p className="text-sm text-white/70">
                            配置AI对话API。留空则使用通用AI配置 (aiApiUrl/aiApiKey)。
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                API端点
                            </label>
                            <input
                                type="text"
                                value={aiConfig.aiChatApiUrl}
                                onChange={(e) => onAiChange('aiChatApiUrl', e.target.value)}
                                placeholder="https://api.openai.com/v1/chat/completions"
                                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                            />
                            <p className="text-xs text-gray-500 mt-1">对话服务的API地址</p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                API密钥
                            </label>
                            <input
                                type="password"
                                value={aiConfig.aiChatApiKey}
                                onChange={(e) => onAiChange('aiChatApiKey', e.target.value)}
                                placeholder="sk-..."
                                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                            />
                            <p className="text-xs text-gray-500 mt-1">对话服务的密钥</p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                模型
                            </label>
                            <input
                                type="text"
                                value={aiConfig.aiChatModel}
                                onChange={(e) => onAiChange('aiChatModel', e.target.value)}
                                placeholder="gpt-3.5-turbo"
                                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                            />
                            <p className="text-xs text-gray-500 mt-1">使用的对话模型名称</p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                代理地址
                            </label>
                            <input
                                type="text"
                                value={aiConfig.aiChatProxy}
                                onChange={(e) => onAiChange('aiChatProxy', e.target.value)}
                                placeholder="http://proxy.example.com:8080"
                                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                            />
                            <p className="text-xs text-gray-500 mt-1">HTTP代理（可选）</p>
                        </div>

                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                系统提示词
                            </label>
                            <textarea
                                rows={4}
                                value={aiConfig.aiChatSystemPrompt}
                                onChange={(e) => onAiChange('aiChatSystemPrompt', e.target.value)}
                                placeholder="你是一个有用的助手"
                                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none resize-none"
                            />
                            <p className="text-xs text-gray-500 mt-1">定义AI的角色和行为</p>
                        </div>
                    </div>
                </div>

                <div className="space-y-4 pt-6 border-t border-white/10">
                    <div className="flex items-center gap-2">
                        <Cpu className="w-5 h-5 text-purple-400" />
                        <h3 className="text-lg font-semibold text-white">向量化服务配置</h3>
                    </div>

                    <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4">
                        <p className="text-sm text-white/70">
                            配置文本向量化API（用于相似度搜索）。留空则使用对话服务配置。
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                API端点
                            </label>
                            <input
                                type="text"
                                value={aiConfig.aiEmbeddingApiUrl}
                                onChange={(e) => onAiChange('aiEmbeddingApiUrl', e.target.value)}
                                placeholder="https://api.openai.com/v1/embeddings"
                                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                            />
                            <p className="text-xs text-gray-500 mt-1">向量化服务的API地址</p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                API密钥
                            </label>
                            <input
                                type="password"
                                value={aiConfig.aiEmbeddingApiKey}
                                onChange={(e) => onAiChange('aiEmbeddingApiKey', e.target.value)}
                                placeholder="sk-..."
                                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                            />
                            <p className="text-xs text-gray-500 mt-1">向量化服务的密钥</p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                模型
                            </label>
                            <input
                                type="text"
                                value={aiConfig.aiEmbeddingModel}
                                onChange={(e) => onAiChange('aiEmbeddingModel', e.target.value)}
                                placeholder="text-embedding-3-small"
                                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                            />
                            <p className="text-xs text-gray-500 mt-1">使用的向量化模型名称</p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                代理地址
                            </label>
                            <input
                                type="text"
                                value={aiConfig.aiEmbeddingProxy}
                                onChange={(e) => onAiChange('aiEmbeddingProxy', e.target.value)}
                                placeholder="http://proxy.example.com:8080"
                                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                            />
                            <p className="text-xs text-gray-500 mt-1">HTTP代理（可选）</p>
                        </div>
                    </div>
                </div>

                <div className="mt-6 flex justify-end gap-3">
                    <button
                        onClick={onResetAi}
                        disabled={resettingAi || savingAi}
                        className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg transition-colors disabled:opacity-50"
                    >
                        {resettingAi ? '重置中...' : '重置为默认值 (.env)'}
                    </button>
                    <button
                        onClick={onSaveAi}
                        disabled={savingAi || resettingAi}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-medium transition-colors disabled:opacity-50"
                    >
                        <Save size={18} />
                        {savingAi ? '保存中...' : '保存 AI 设置'}
                    </button>
                </div>
            </GlassCard>
        </section>
    )
}

export default AiSettingsSection
