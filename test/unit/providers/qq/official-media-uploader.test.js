#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const OfficialMediaUploader = require('../../../../src/providers/qq/official/mediaUploader')
const { assertPublicHttpUrl } = OfficialMediaUploader

describe('OfficialMediaUploader URL safety', () => {
    it('rejects local, private, file, and credential-bearing urls', () => {
        assert.throws(() => assertPublicHttpUrl('file:///tmp/a.png'), /requires_http/)
        assert.throws(() => assertPublicHttpUrl('http://localhost/a.png'), /private_url/)
        assert.throws(() => assertPublicHttpUrl('http://127.0.0.1/a.png'), /private_url/)
        assert.throws(() => assertPublicHttpUrl('http://192.168.1.10/a.png'), /private_url/)
        assert.throws(() => assertPublicHttpUrl('https://user:pass@example.com/a.png'), /credentials/)
    })

    it('allows public http urls', () => {
        assert.equal(assertPublicHttpUrl('https://cdn.example.com/a.png'), 'https://cdn.example.com/a.png')
    })

    it('adds a temporary public url for hybrid base64 media when configured', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-official-media-'))
        const uploader = new OfficialMediaUploader({
            mode: 'hybrid',
            tempPublicBaseUrl: 'https://bot.example.com/qq-official-temp/',
            tempFileDir: tempDir
        })

        const body = uploader.buildUploadBody({
            type: 'image',
            data: { file: 'base64://aGVsbG8=' }
        }, 'image')

        assert.equal(body.file_type, 1)
        assert.equal(body.file_data, 'aGVsbG8=')
        assert.match(body.url, /^https:\/\/bot\.example\.com\/qq-official-temp\/.+\.png$/)
        const fileName = decodeURIComponent(new URL(body.url).pathname.split('/').pop())
        assert.equal(fs.readFileSync(path.join(tempDir, fileName), 'utf8'), 'hello')

        fs.rmSync(tempDir, { recursive: true, force: true })
    })

    it('preserves relative temp subdirectories for local file urls', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-official-media-'))
        const downloadsDir = path.join(tempDir, 'downloads')
        fs.mkdirSync(downloadsDir)
        const videoPath = path.join(downloadsDir, 'video.mp4')
        fs.writeFileSync(videoPath, 'video')
        const uploader = new OfficialMediaUploader({
            mode: 'url_only',
            tempPublicBaseUrl: 'https://bot.example.com/qq-official-temp/',
            tempFileDir: tempDir
        })

        const body = uploader.buildUploadBody({
            type: 'video',
            data: { file: `file://${videoPath}` }
        }, 'video')

        assert.equal(body.file_type, 2)
        assert.equal(body.url, 'https://bot.example.com/qq-official-temp/downloads/video.mp4')
        fs.rmSync(tempDir, { recursive: true, force: true })
    })

    it('uses file_data for local files in hybrid mode when public base url is absent', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-official-media-'))
        const videoPath = path.join(tempDir, 'video.mp4')
        fs.writeFileSync(videoPath, 'video')
        const uploader = new OfficialMediaUploader({
            mode: 'hybrid'
        })

        const body = uploader.buildUploadBody({
            type: 'video',
            data: { file: `file://${videoPath}` }
        }, 'video')

        assert.equal(body.file_type, 2)
        assert.equal(body.file_data, Buffer.from('video').toString('base64'))
        assert.equal(body.url, undefined)
        fs.rmSync(tempDir, { recursive: true, force: true })
    })

    it('rejects local files outside configured source directories', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-official-media-'))
        const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-official-source-'))
        const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-official-outside-'))
        const outsidePath = path.join(outsideDir, 'secret.mp4')
        fs.writeFileSync(outsidePath, 'secret')
        const uploader = new OfficialMediaUploader({
            mode: 'hybrid',
            tempPublicBaseUrl: 'https://bot.example.com/qq-official-temp/',
            tempFileDir: tempDir,
            sourceFileBaseDir: sourceDir
        })

        assert.throws(() => uploader.resolvePublicUrl(`file://${outsidePath}`), /outside_allowed_dir/)
        assert.throws(() => uploader.readFileData(`file://${outsidePath}`), /outside_allowed_dir/)
        fs.rmSync(tempDir, { recursive: true, force: true })
        fs.rmSync(sourceDir, { recursive: true, force: true })
        fs.rmSync(outsideDir, { recursive: true, force: true })
    })

    it('sanitizes copied local file relative paths inside the temp directory', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-official-media-'))
        const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-official-source-'))
        const sourcePath = path.join(sourceDir, 'image.png')
        fs.writeFileSync(sourcePath, 'image')
        const uploader = new OfficialMediaUploader({
            mode: 'url_only',
            tempPublicBaseUrl: 'https://bot.example.com/qq-official-temp/',
            tempFileDir: tempDir
        })

        const relative = uploader.copyLocalFileToTempDir(sourcePath, '../escape/../../image.png')

        assert.equal(relative, 'escape/image.png')
        assert.equal(fs.existsSync(path.join(tempDir, 'escape', 'image.png')), true)
        assert.equal(fs.existsSync(path.join(tempDir, '..', 'image.png')), false)
        fs.rmSync(tempDir, { recursive: true, force: true })
        fs.rmSync(sourceDir, { recursive: true, force: true })
    })
})
