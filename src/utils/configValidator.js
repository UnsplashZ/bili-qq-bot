// 🆕 P2-4: AI配置验证工具
const logger = require('./logger');

/**
 * 验证URL格式
 */
function isValidUrl(urlString) {
    try {
        const url = new URL(urlString);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (e) {
        return false;
    }
}

/**
 * 验证AI API URL
 */
function validateAiApiUrl(url) {
    if (!url || typeof url !== 'string') {
        return { valid: false, error: 'AI API URL is required' };
    }

    if (!isValidUrl(url)) {
        return { valid: false, error: 'AI API URL must be a valid HTTP(S) URL' };
    }

    // 常见endpoint检查（可选警告）
    if (!url.includes('/chat/completions') && !url.includes('/completions')) {
        logger.warn('[Config] AI API URL may not be a valid OpenAI-compatible endpoint:', url);
    }

    return { valid: true };
}

/**
 * 验证AI模型名称
 */
function validateAiModel(model) {
    if (!model || typeof model !== 'string') {
        return { valid: false, error: 'AI model name is required' };
    }

    if (model.trim().length === 0) {
        return { valid: false, error: 'AI model name cannot be empty' };
    }

    // 基础格式检查
    if (model.length > 100) {
        return { valid: false, error: 'AI model name too long (max 100 chars)' };
    }

    // 不允许特殊字符（可能导致问题）
    if (/[<>\"'`]/.test(model)) {
        return { valid: false, error: 'AI model name contains invalid characters' };
    }

    return { valid: true };
}

/**
 * 验证完整AI配置
 */
function validateAiConfig(config) {
    const errors = [];

    // 验证API URL
    const urlResult = validateAiApiUrl(config.aiApiUrl);
    if (!urlResult.valid) {
        errors.push(`aiApiUrl: ${urlResult.error}`);
    }

    // 验证模型
    const modelResult = validateAiModel(config.aiModel);
    if (!modelResult.valid) {
        errors.push(`aiModel: ${modelResult.error}`);
    }

    // 验证API Key（可选，但如果提供则检查）
    if (config.aiApiKey && config.aiApiKey.length > 0 && config.aiApiKey.length < 10) {
        logger.warn('[Config] AI API Key seems too short, may be invalid');
    }

    if (errors.length > 0) {
        return {
            valid: false,
            errors
        };
    }

    return { valid: true };
}

module.exports = {
    isValidUrl,
    validateAiApiUrl,
    validateAiModel,
    validateAiConfig
};
