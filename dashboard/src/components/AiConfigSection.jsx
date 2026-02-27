import React from 'react';

/**
 * AI Configuration Section Component
 * Displays AI and RAG toggle switches with inheritance status
 */
export default function AiConfigSection({
    config,
    globalConfig,
    onToggle,
    onReset,
    isGroup = false
}) {
    const aiEnabled = config.aiEnabled ?? globalConfig?.aiEnabled ?? true;
    const ragEnabled = config.aiRagEnabled ?? globalConfig?.aiRagEnabled ?? true;
    const profileEnabled = config.aiProfileEnabled ?? globalConfig?.aiProfileEnabled ?? false;

    const aiIsInherited = config.aiEnabled === undefined || config.aiEnabled === null;
    const ragIsInherited = config.aiRagEnabled === undefined || config.aiRagEnabled === null;
    const profileIsInherited = config.aiProfileEnabled === undefined || config.aiProfileEnabled === null;

    return (
        <div className="space-y-4">
            {/* AI Enable Toggle */}
            <div className="flex items-center justify-between p-4 bg-white/5 rounded-lg">
                <div className="flex-1">
                    <h4 className="font-medium text-white">
                        AI功能
                        {isGroup && aiIsInherited && (
                            <span className="ml-2 text-sm text-gray-500">(继承全局)</span>
                        )}
                    </h4>
                    <p className="text-sm text-gray-400">
                        {isGroup
                            ? "控制该群是否启用AI聊天功能"
                            : "全局控制所有群的AI聊天功能"}
                    </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                    <input
                        type="checkbox"
                        checked={aiEnabled}
                        onChange={(e) => onToggle('aiEnabled', e.target.checked)}
                        className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all border-gray-600 peer-checked:bg-blue-600"></div>
                </label>
            </div>

            {/* RAG Enable Toggle */}
            <div className="flex items-center justify-between p-4 bg-white/5 rounded-lg">
                <div className="flex-1">
                    <h4 className="font-medium text-white">
                        RAG记忆功能
                        {isGroup && ragIsInherited && (
                            <span className="ml-2 text-sm text-gray-500">(继承全局)</span>
                        )}
                    </h4>
                    <p className="text-sm text-gray-400">
                        使用向量记忆增强AI回复（需要AI功能开启）
                    </p>
                    {!aiEnabled && (
                        <p className="text-sm text-amber-400 mt-1">
                            ⚠️ AI功能已关闭，RAG功能不可用
                        </p>
                    )}
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                    <input
                        type="checkbox"
                        checked={ragEnabled}
                        onChange={(e) => onToggle('aiRagEnabled', e.target.checked)}
                        disabled={!aiEnabled}
                        className="sr-only peer disabled:opacity-50"
                    />
                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all border-gray-600 peer-checked:bg-blue-600 peer-disabled:opacity-50"></div>
                </label>
            </div>

            {/* User Profile Toggle */}
            <div className="flex items-center justify-between p-4 bg-white/5 rounded-lg">
                <div className="flex-1">
                    <h4 className="font-medium text-white">
                        用户画像功能
                        {isGroup && profileIsInherited && (
                            <span className="ml-2 text-sm text-gray-500">(继承全局)</span>
                        )}
                    </h4>
                    <p className="text-sm text-gray-400">
                        {isGroup
                            ? "控制该群是否为用户生成个性化画像（需要AI功能开启）"
                            : "全局控制是否为用户生成个性化画像（需要AI功能开启）"}
                    </p>
                    {!aiEnabled && (
                        <p className="text-sm text-amber-400 mt-1">
                            ⚠️ AI功能已关闭，用户画像功能不可用
                        </p>
                    )}
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                    <input
                        type="checkbox"
                        checked={profileEnabled}
                        onChange={(e) => onToggle('aiProfileEnabled', e.target.checked)}
                        disabled={!aiEnabled}
                        className="sr-only peer disabled:opacity-50"
                    />
                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all border-gray-600 peer-checked:bg-blue-600 peer-disabled:opacity-50"></div>
                </label>
            </div>

            {/* Reset Button (Group only) */}
            {isGroup && (!aiIsInherited || !ragIsInherited || !profileIsInherited) && (
                <button
                    onClick={onReset}
                    className="w-full px-4 py-2 text-sm font-medium text-gray-300 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10"
                >
                    重置为全局设置
                </button>
            )}

            {/* Info Messages */}
            {!isGroup && (
                <div className="p-3 bg-blue-500/10 rounded-lg">
                    <p className="text-sm text-blue-300">
                        💡 这些设置会影响所有未自定义的群组
                    </p>
                </div>
            )}
        </div>
    );
}
