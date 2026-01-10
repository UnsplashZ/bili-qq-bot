const { URL } = require('url');

/**
 * Parses a proxy URL string into an Axios proxy configuration object.
 * @param {string} proxyUrl - The proxy URL (e.g., http://127.0.0.1:7890)
 * @returns {object|false} - Axios proxy config or false if invalid/empty
 */
function getAxiosProxyConfig(proxyUrl) {
    if (!proxyUrl) return false;

    try {
        const parsed = new URL(proxyUrl);
        const protocol = parsed.protocol.replace(':', '');
        let port = parseInt(parsed.port, 10);
        
        if (isNaN(port)) {
            port = protocol === 'https' ? 443 : 80;
        }

        return {
            protocol: protocol,
            host: parsed.hostname,
            port: port,
            auth: (parsed.username && parsed.password) ? {
                username: parsed.username,
                password: parsed.password
            } : undefined
        };
    } catch (e) {
        console.error('[ProxyUtils] Invalid proxy URL:', proxyUrl, e.message);
        return false;
    }
}

module.exports = {
    getAxiosProxyConfig
};
