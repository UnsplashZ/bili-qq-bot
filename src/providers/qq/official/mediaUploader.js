const fs = require('fs')
const path = require('path')
const net = require('net')

const FILE_TYPES = {
    image: 1,
    video: 2
}

const FILE_EXTENSIONS = {
    image: '.png',
    video: '.mp4'
}

function isPrivateHostname(hostname) {
    const host = String(hostname || '').toLowerCase()
    if (!host || host === 'localhost' || host.endsWith('.localhost')) return true
    const ipVersion = net.isIP(host)
    if (!ipVersion) return false
    if (ipVersion === 6) {
        return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')
    }
    const parts = host.split('.').map((part) => Number(part))
    if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return false
    return parts[0] === 10 ||
        parts[0] === 127 ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
        (parts[0] === 192 && parts[1] === 168) ||
        (parts[0] === 169 && parts[1] === 254) ||
        parts[0] === 0
}

function assertPublicHttpUrl(url) {
    let parsed
    try {
        parsed = new URL(url)
    } catch {
        throw new Error('official_media_invalid_url')
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('official_media_requires_http_url')
    if (parsed.username || parsed.password) throw new Error('official_media_url_credentials_forbidden')
    if (isPrivateHostname(parsed.hostname)) throw new Error('official_media_private_url_forbidden')
    return parsed.toString()
}

function stripBase64Prefix(value) {
    const text = String(value || '')
    if (text.startsWith('base64://')) return text.slice('base64://'.length)
    const match = text.match(/^data:[^;]+;base64,(.+)$/)
    return match ? match[1] : ''
}

function isLocalFileReference(file) {
    const value = String(file || '').trim()
    if (!value) return false
    if (value.startsWith('file://')) return true
    if (/^https?:\/\//i.test(value)) return false
    if (stripBase64Prefix(value)) return false
    return true
}

function sanitizeRelativePath(relativePath) {
    const parts = String(relativePath || '')
        .split(/[\\/]+/)
        .map((part) => part.trim())
        .filter(Boolean)
        .filter((part) => part !== '.' && part !== '..')
        .map((part) => part.replace(/[^a-zA-Z0-9._-]/g, '_'))
        .filter(Boolean)
    return parts.join(path.sep)
}

function isInsideDirectory(filePath, baseDir) {
    if (!filePath || !baseDir) return false
    const resolvedFile = path.resolve(filePath)
    const resolvedBase = path.resolve(baseDir)
    return resolvedFile === resolvedBase || resolvedFile.startsWith(resolvedBase + path.sep)
}

class OfficialMediaUploader {
    constructor(options = {}) {
        this.client = options.client
        this.mode = String(options.mode || 'hybrid').toLowerCase()
        this.tempPublicBaseUrl = String(options.tempPublicBaseUrl || '').trim()
        this.tempFileDir = String(options.tempFileDir || '').trim()
        this.sourceFileBaseDir = String(options.sourceFileBaseDir || '').trim()
        this.tempMaxAgeMs = Math.max(60000, Number(options.tempMaxAgeMs || 24 * 60 * 60 * 1000))
    }

    buildPublicUrlForRelativePath(relativePath) {
        const base = assertPublicHttpUrl(this.tempPublicBaseUrl.endsWith('/') ? this.tempPublicBaseUrl : `${this.tempPublicBaseUrl}/`)
        const encodedPath = String(relativePath || '')
            .split(/[\\/]+/)
            .filter(Boolean)
            .map((part) => encodeURIComponent(part))
            .join('/')
        if (!encodedPath) throw new Error('official_media_invalid_file_name')
        return new URL(encodedPath, base).toString()
    }

    writeBase64TempFile(base64, mediaKind) {
        if (!this.tempFileDir) throw new Error('official_media_temp_dir_unavailable')
        const extension = FILE_EXTENSIONS[mediaKind] || '.bin'
        fs.mkdirSync(this.tempFileDir, { recursive: true })
        this.cleanupExpiredTempFiles()
        const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}${extension}`
        const filePath = path.join(this.tempFileDir, fileName)
        fs.writeFileSync(filePath, Buffer.from(base64, 'base64'))
        return {
            fileName,
            filePath,
            url: this.buildPublicUrlForRelativePath(fileName)
        }
    }

    copyLocalFileToTempDir(filePath, relativePath) {
        if (!this.tempFileDir) throw new Error('official_media_temp_dir_unavailable')
        const safeRelativePath = sanitizeRelativePath(relativePath)
        if (!safeRelativePath) throw new Error('official_media_invalid_file_name')
        const targetPath = path.join(this.tempFileDir, safeRelativePath)
        const baseDir = path.resolve(this.tempFileDir)
        const resolvedTarget = path.resolve(targetPath)
        if (resolvedTarget === baseDir || !resolvedTarget.startsWith(baseDir + path.sep)) {
            throw new Error('official_media_invalid_file_name')
        }
        this.cleanupExpiredTempFiles()
        const targetDir = path.dirname(resolvedTarget)
        fs.mkdirSync(targetDir, { recursive: true })
        fs.copyFileSync(filePath, resolvedTarget)
        return safeRelativePath
    }

    cleanupExpiredTempFiles(now = Date.now()) {
        if (!this.tempFileDir) return 0
        let deletedCount = 0
        const visit = (dir) => {
            let entries = []
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true })
            } catch {
                return
            }
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name)
                if (entry.isDirectory()) {
                    visit(fullPath)
                    try {
                        if (fs.readdirSync(fullPath).length === 0) fs.rmdirSync(fullPath)
                    } catch {}
                    continue
                }
                if (!entry.isFile()) continue
                try {
                    const stat = fs.statSync(fullPath)
                    if (now - stat.mtimeMs > this.tempMaxAgeMs) {
                        fs.unlinkSync(fullPath)
                        deletedCount += 1
                    }
                } catch {}
            }
        }
        visit(this.tempFileDir)
        return deletedCount
    }

    assertAllowedLocalFile(filePath) {
        const absFile = path.resolve(filePath)
        const allowedBases = [this.tempFileDir, this.sourceFileBaseDir]
            .map((dir) => String(dir || '').trim())
            .filter(Boolean)
        if (allowedBases.length === 0) return absFile
        if (allowedBases.some((baseDir) => isInsideDirectory(absFile, baseDir))) return absFile
        throw new Error('official_media_local_file_outside_allowed_dir')
    }

    resolvePublicUrl(file) {
        const value = String(file || '').trim()
        if (/^https?:\/\//i.test(value)) {
            return assertPublicHttpUrl(value)
        }
        if (!this.tempPublicBaseUrl) {
            throw new Error('official_media_requires_public_url')
        }
        const cleanFile = value.startsWith('file://') ? value.slice('file://'.length) : value
        let relativePath = path.basename(cleanFile)
        if (this.tempFileDir) {
            const baseDir = path.resolve(this.tempFileDir)
            const absFile = this.assertAllowedLocalFile(cleanFile)
            if (absFile === baseDir || absFile.startsWith(baseDir + path.sep)) {
                relativePath = path.relative(baseDir, absFile)
            } else if (fs.existsSync(absFile)) {
                const sourceBaseDir = this.sourceFileBaseDir ? path.resolve(this.sourceFileBaseDir) : ''
                if (sourceBaseDir && (absFile === sourceBaseDir || absFile.startsWith(sourceBaseDir + path.sep))) {
                    relativePath = path.relative(sourceBaseDir, absFile)
                }
                relativePath = this.copyLocalFileToTempDir(absFile, relativePath)
            }
        }
        return this.buildPublicUrlForRelativePath(relativePath)
    }

    readFileData(file) {
        const value = String(file || '').trim()
        const base64 = stripBase64Prefix(value)
        if (base64) return base64
        if (value.startsWith('file://')) {
            return fs.readFileSync(this.assertAllowedLocalFile(value.slice('file://'.length))).toString('base64')
        }
        if (value && !/^https?:\/\//i.test(value)) {
            return fs.readFileSync(this.assertAllowedLocalFile(value)).toString('base64')
        }
        throw new Error('official_media_file_data_unavailable')
    }

    buildUploadBody(segment, mediaKind, metadata = {}) {
        const fileType = FILE_TYPES[mediaKind]
        if (!fileType) throw new Error(`official_media_unsupported_type:${mediaKind}`)
        const file = segment?.data?.file || segment?.data?.url || ''
        const body = {
            file_type: fileType,
            srv_send_msg: false
        }

        if (metadata.msgId) body.msg_id = metadata.msgId
        if (metadata.eventId) body.event_id = metadata.eventId

        const base64 = stripBase64Prefix(file)
        if (base64 && this.mode !== 'url_only') {
            body.file_data = base64
            if (this.mode === 'hybrid' && this.tempPublicBaseUrl) {
                body.url = this.writeBase64TempFile(base64, mediaKind).url
            }
            return body
        }

        if (this.mode === 'file_data' || (this.mode === 'hybrid' && isLocalFileReference(file) && !this.tempPublicBaseUrl)) {
            body.file_data = this.readFileData(file)
            return body
        }

        body.url = this.resolvePublicUrl(file)
        return body
    }

    async upload({ targetType, targetId, segment, mediaKind, metadata = {} }) {
        const body = this.buildUploadBody(segment, mediaKind, metadata)
        if (targetType === 'private') {
            return this.client.uploadC2CMedia(targetId, body)
        }
        return this.client.uploadGroupMedia(targetId, body)
    }
}

module.exports = OfficialMediaUploader
module.exports.assertPublicHttpUrl = assertPublicHttpUrl
module.exports.isPrivateHostname = isPrivateHostname
module.exports.isLocalFileReference = isLocalFileReference
module.exports.isInsideDirectory = isInsideDirectory
module.exports.sanitizeRelativePath = sanitizeRelativePath
