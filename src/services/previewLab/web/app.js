(function () {
  const inputEl = document.getElementById('input')
  const groupIdEl = document.getElementById('groupId')
  const outNameEl = document.getElementById('outName')
  const freshEl = document.getElementById('fresh')
  const emitHtmlEl = document.getElementById('emitHtml')
  const showIdEl = document.getElementById('showId')
  const runBtnEl = document.getElementById('runBtn')
  const runStatusEl = document.getElementById('run-status')
  const healthStatusEl = document.getElementById('health-status')
  const errorBannerEl = document.getElementById('error-banner')
  const summaryEl = document.getElementById('summary')
  const previewFrameEl = document.getElementById('preview-frame')
  const renderHtmlEl = document.getElementById('render-html')
  const dataJsonEl = document.getElementById('data-json')
  const manifestJsonEl = document.getElementById('manifest-json')

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function setBusy(isBusy) {
    runBtnEl.disabled = isBusy
    runStatusEl.textContent = isBusy ? '执行中...' : '待执行'
  }

  function showError(message) {
    errorBannerEl.textContent = message
    errorBannerEl.classList.remove('hidden')
  }

  function clearError() {
    errorBannerEl.textContent = ''
    errorBannerEl.classList.add('hidden')
  }

  function renderSummary(result) {
    const { manifest, previewTargetSummary } = result
    const debugMeta = manifest.debugMeta || {}
    const rows = [
      { key: 'Input', value: escapeHtml(manifest.input) },
      { key: 'Resolved Type', value: escapeHtml(`${manifest.resolvedLink.type || ''}`) },
      { key: 'Resolved ID', value: escapeHtml(`${manifest.resolvedLink.id || ''}`) },
      { key: 'Card Type', value: escapeHtml(manifest.cardType) },
      {
        key: 'Canonical URL',
        value: `<a href="${escapeHtml(manifest.canonicalUrl)}" target="_blank" rel="noreferrer">${escapeHtml(manifest.canonicalUrl)}</a>`,
        isHtml: true
      },
      { key: 'JSON 文件', value: escapeHtml(manifest.jsonPath) },
      { key: 'Manifest 文件', value: escapeHtml(manifest.manifestPath) },
      { key: '输出名', value: escapeHtml(manifest.outputName) },
      { key: 'Viewport', value: escapeHtml(JSON.stringify(debugMeta.viewport || {})) },
      { key: 'Theme', value: escapeHtml(debugMeta.themeClass || '') },
      { key: 'Preview Summary', value: escapeHtml(JSON.stringify(previewTargetSummary || {})) }
    ]

    summaryEl.innerHTML = `<div class="summary-list">${rows.map((row) => `
      <div class="summary-item">
        <div class="summary-key">${escapeHtml(row.key)}</div>
        <div class="summary-value">${row.isHtml ? row.value : row.value}</div>
      </div>
    `).join('')}</div>`
  }

  function renderPreview(result) {
    previewFrameEl.innerHTML = `<img src="${result.imageUrl}" alt="preview image">`
    renderHtmlEl.textContent = result.renderHtml || '暂无数据'
    dataJsonEl.textContent = JSON.stringify(result.dataPayload, null, 2)
    manifestJsonEl.textContent = JSON.stringify(result.manifest, null, 2)
  }

  async function refreshHealth() {
    try {
      const response = await fetch('/api/health')
      const payload = await response.json()
      healthStatusEl.textContent = payload.busy
        ? '服务忙碌中'
        : `服务正常 · 输出目录 ${payload.outputDir}`
    } catch (_error) {
      healthStatusEl.textContent = '服务状态获取失败'
    }
  }

  async function runPreview() {
    const input = inputEl.value.trim()
    if (!input) {
      showError('请输入一个 B 站链接')
      return
    }

    clearError()
    setBusy(true)

    try {
      const response = await fetch('/api/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          input,
          groupId: groupIdEl.value.trim(),
          outName: outNameEl.value.trim(),
          fresh: freshEl.checked,
          emitHtml: emitHtmlEl.checked,
          showId: showIdEl.checked
        })
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.message || `请求失败: ${response.status}`)
      }

      renderSummary(payload)
      renderPreview(payload)
      runStatusEl.textContent = '执行完成'
      refreshHealth()
    } catch (error) {
      runStatusEl.textContent = '执行失败'
      showError(error.message || String(error))
    } finally {
      setBusy(false)
    }
  }

  runBtnEl.addEventListener('click', runPreview)
  inputEl.value = 'https://www.bilibili.com/read/cv45123193'
  refreshHealth()
}())
