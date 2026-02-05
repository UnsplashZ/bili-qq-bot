const logger = require('./logger');

/**
 * 监控正则表达式执行时间
 * @param {string} patternName - 正则模式名称
 * @param {RegExp} regex - 正则表达式
 * @param {string} input - 输入字符串
 * @param {Function} callback - 执行函数 (regex, input) => result
 * @returns {*} 执行结果
 */
function monitorRegex(patternName, regex, input, callback) {
    const startTime = process.hrtime.bigint();

    try {
        const result = callback(regex, input);
        const endTime = process.hrtime.bigint();
        const durationMs = Number(endTime - startTime) / 1000000;

        // 如果执行时间超过100ms，记录警告
        if (durationMs > 100) {
            logger.warn(`[RegexMonitor] Slow regex execution: ${patternName}`, {
                duration: `${durationMs.toFixed(2)}ms`,
                inputLength: input.length,
                pattern: regex.source.substring(0, 100) // 只记录前100字符
            });
        }

        return result;
    } catch (error) {
        const endTime = process.hrtime.bigint();
        const durationMs = Number(endTime - startTime) / 1000000;

        logger.error(`[RegexMonitor] Regex execution failed: ${patternName}`, {
            duration: `${durationMs.toFixed(2)}ms`,
            inputLength: input.length,
            error: error.message
        });

        throw error;
    }
}

module.exports = { monitorRegex };
