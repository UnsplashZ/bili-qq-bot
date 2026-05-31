import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Eye,
  Image as ImageIcon,
  LayoutTemplate,
  RefreshCw,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Wand2
} from 'lucide-react';
import api from '../utils/auth';
import { Button, StatusPill, ToggleSwitch } from '../components/ui';
import { useToast } from '../hooks/useToast';

const FIELD_LABELS = {
  offsetX: 'X 偏移',
  offsetY: 'Y 偏移',
  width: '宽度',
  height: '高度',
  marginTop: '上间距',
  marginBottom: '下间距',
  fontSize: '字号',
  lineHeight: '行高',
  maxLines: '最大行数',
  maxHeight: '最大高度',
  aspectRatio: '比例',
  objectFit: '裁切',
  objectPosition: '对齐',
  borderRadius: '圆角'
};

const GROUP_LABELS = {
  layout: '布局',
  typography: '文字',
  media: '图片'
};

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeDeep(base = {}, patch = {}) {
  const next = clone(base);
  for (const [key, value] of Object.entries(patch || {})) {
    if (isPlainObject(value) && isPlainObject(next[key])) {
      next[key] = mergeDeep(next[key], value);
    } else if (value === undefined) {
      delete next[key];
    } else {
      next[key] = clone(value);
    }
  }
  return cleanEmpty(next);
}

function cleanEmpty(value) {
  if (!isPlainObject(value)) return value;
  const next = {};
  for (const [key, child] of Object.entries(value)) {
    const cleaned = cleanEmpty(child);
    if (isPlainObject(cleaned) && Object.keys(cleaned).length === 0) continue;
    if (cleaned !== undefined && cleaned !== null && cleaned !== '') {
      next[key] = cleaned;
    }
  }
  return next;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function valuesEqual(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function diffFromBase(value = {}, base = {}) {
  if (!isPlainObject(value)) return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    const baseChild = base?.[key];
    if (isPlainObject(child)) {
      const nested = diffFromBase(child, isPlainObject(baseChild) ? baseChild : {});
      if (Object.keys(nested).length > 0) output[key] = nested;
      continue;
    }
    if (!valuesEqual(child, baseChild)) {
      output[key] = child;
    }
  }
  return output;
}

function getElementDraft(draft, elementKey) {
  return draft?.elements?.[elementKey] || {};
}

function getApiError(error, fallback) {
  return error?.response?.data?.error || error?.message || fallback;
}

function NumberControl({ label, value, limits, onChange }) {
  const currentValue = value ?? '';
  return (
    <label className="grid gap-1.5 text-xs">
      <span className="font-medium text-[var(--muted)]">{label}</span>
      <input
        type="number"
        min={limits?.min}
        max={limits?.max}
        step={limits?.integer ? 1 : 0.1}
        value={currentValue}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw === '' ? null : Number(raw));
        }}
        className="min-h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]"
      />
    </label>
  );
}

function SelectControl({ label, value, options, onChange }) {
  return (
    <label className="grid gap-1.5 text-xs">
      <span className="font-medium text-[var(--muted)]">{label}</span>
      <select
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
        className="min-h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]"
      >
        <option value="">继承默认</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function FieldGroupControls({ groupName, schema, values, onChange }) {
  const entries = Object.entries(schema || {});
  if (entries.length === 0) return null;

  return (
    <div className="space-y-3 border-t border-[var(--border)] pt-4">
      <div className="text-xs font-bold uppercase text-[var(--subtle)]">{GROUP_LABELS[groupName]}</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        {entries.map(([field, fieldSchema]) => {
          if (field === 'mode') return null;
          if (fieldSchema.kind === 'enum') {
            return (
              <SelectControl
                key={field}
                label={FIELD_LABELS[field] || field}
                value={values?.[field]}
                options={fieldSchema.values || []}
                onChange={(nextValue) => onChange(field, nextValue)}
              />
            );
          }
          return (
            <NumberControl
              key={field}
              label={FIELD_LABELS[field] || field}
              value={values?.[field]}
              limits={fieldSchema.limit}
              onChange={(nextValue) => onChange(field, nextValue)}
            />
          );
        })}
      </div>
    </div>
  );
}

function PreviewOverlay({ elements, container, selectedKey, onSelect }) {
  if (!container?.width || !container?.height) return null;
  return (
    <div className="pointer-events-none absolute inset-0">
      {Object.entries(elements || {}).map(([key, meta]) => {
        if (!meta?.box || !meta.visible) return null;
        const active = key === selectedKey;
        const style = {
          left: `${(meta.box.x / container.width) * 100}%`,
          top: `${(meta.box.y / container.height) * 100}%`,
          width: `${(meta.box.width / container.width) * 100}%`,
          height: `${(meta.box.height / container.height) * 100}%`
        };
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(key)}
            className={`pointer-events-auto absolute border transition-colors ${
              active
                ? 'border-[var(--accent)] bg-[color-mix(in_oklch,var(--accent)_18%,transparent)]'
                : 'border-[color-mix(in_oklch,var(--accent)_55%,transparent)] bg-transparent hover:bg-[color-mix(in_oklch,var(--accent)_10%,transparent)]'
            }`}
            style={style}
            title={key}
          />
        );
      })}
    </div>
  );
}

export default function PreviewLayoutEditor() {
  const { show } = useToast();
  const [schema, setSchema] = useState(null);
  const [groups, setGroups] = useState([]);
  const [selectedType, setSelectedType] = useState('video');
  const [groupId, setGroupId] = useState('');
  const [mode, setMode] = useState('structure');
  const [input, setInput] = useState('');
  const [savedConfig, setSavedConfig] = useState({ global: {}, group: {}, effective: {}, scopeMeta: {} });
  const [draftOverrides, setDraftOverrides] = useState({});
  const [selectedElement, setSelectedElement] = useState('cover');
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef(null);
  const lastPreviewPayloadRef = useRef('');

  const typeSchema = schema?.types?.[selectedType];
  const editable = typeSchema?.status === 'editable';
  const elements = useMemo(() => typeSchema?.elements || {}, [typeSchema]);
  const selectedElementSchema = elements[selectedElement] || null;
  const selectedDraft = getElementDraft(draftOverrides, selectedElement);
  const dirty = !valuesEqual(draftOverrides, savedConfig.effective);

  const fetchConfig = useCallback(async () => {
    const response = await api.get('/api/preview-layout/config', {
      params: {
        type: selectedType,
        groupId: groupId || undefined
      }
    });
    setSavedConfig(response.data);
    setDraftOverrides(clone(response.data.effective));
    if (!elements[selectedElement]) {
      const firstKey = Object.keys(response.data.effective?.elements || {})[0] || Object.keys(elements)[0] || '';
      setSelectedElement(firstKey);
    }
  }, [selectedType, groupId, elements, selectedElement]);

  useEffect(() => {
    let mounted = true;
    async function bootstrap() {
      setLoading(true);
      try {
        const [schemaResponse, groupsResponse] = await Promise.all([
          api.get('/api/preview-layout/schema'),
          api.get('/api/groups')
        ]);
        if (!mounted) return;
        setSchema(schemaResponse.data);
        setGroups(Array.isArray(groupsResponse.data) ? groupsResponse.data : []);
      } catch (error) {
        show(getApiError(error, '预览编辑器初始化失败'), 'error');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    bootstrap();
    return () => {
      mounted = false;
    };
  }, [show]);

  useEffect(() => {
    if (!schema) return;
    fetchConfig().catch((error) => {
      show(getApiError(error, '读取布局配置失败'), 'error');
    });
  }, [schema, fetchConfig, show]);

  const buildPreviewPayload = useCallback(() => ({
    mode,
    input,
    groupId: groupId || null,
    mockType: selectedType,
    showId: true,
    cacheMode: 'cached',
    renderOverrides: draftOverrides
  }), [mode, input, groupId, selectedType, draftOverrides]);

  const runPreview = useCallback(async ({ silent = false } = {}) => {
    if (!editable) {
      setPreviewError('当前类型暂未开放编辑');
      return;
    }
    if (mode === 'link' && !input.trim()) {
      setPreviewError('请输入 B 站视频链接');
      return;
    }
    const payload = buildPreviewPayload();
    const payloadKey = stableStringify(payload);
    lastPreviewPayloadRef.current = payloadKey;
    setPreviewing(true);
    if (!silent) setPreviewError('');
    try {
      const response = await api.post('/api/preview-layout/preview', payload);
      if (lastPreviewPayloadRef.current !== payloadKey) return;
      setPreview(response.data);
      setPreviewError('');
    } catch (error) {
      if (lastPreviewPayloadRef.current !== payloadKey) return;
      setPreviewError(getApiError(error, '预览生成失败'));
    } finally {
      if (lastPreviewPayloadRef.current === payloadKey) {
        setPreviewing(false);
      }
    }
  }, [editable, mode, input, buildPreviewPayload]);

  useEffect(() => {
    if (!preview || !dirty || !editable) return undefined;
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      runPreview({ silent: true });
    }, 700);
    return () => window.clearTimeout(debounceRef.current);
  }, [draftOverrides, dirty, editable, preview, runPreview]);

  const updateElement = (elementKey, patch) => {
    setDraftOverrides((current) => mergeDeep(current, {
      elements: {
        [elementKey]: patch
      }
    }));
  };

  const updateElementGroupField = (groupName, field, value) => {
    updateElement(selectedElement, {
      [groupName]: {
        [field]: value
      }
    });
  };

  const resetDraftElement = () => {
    setDraftOverrides((current) => {
      const next = clone(current);
      if (next.elements) {
        delete next.elements[selectedElement];
        if (Object.keys(next.elements).length === 0) delete next.elements;
      }
      return next;
    });
  };

  const saveConfig = async (scope) => {
    if (!editable) return;
    if (scope === 'global' && groupId) {
      show('请先切回全局模板再保存全局配置', 'error');
      return;
    }
    setSaving(true);
    try {
      const patch = scope === 'group'
        ? diffFromBase(draftOverrides, savedConfig.global)
        : draftOverrides;
      await api.post('/api/preview-layout/config', {
        scope,
        groupId: scope === 'group' ? groupId : null,
        type: selectedType,
        patch
      });
      await fetchConfig();
      show('布局配置已保存', 'success');
    } catch (error) {
      show(getApiError(error, '保存失败'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const resetSaved = async (scope, element = '') => {
    if (!editable) return;
    setSaving(true);
    try {
      await api.post('/api/preview-layout/reset', {
        scope,
        groupId: scope === 'group' ? groupId : null,
        type: selectedType,
        element: element || undefined
      });
      await fetchConfig();
      show(element ? '元素配置已重置' : '模板配置已重置', 'success');
    } catch (error) {
      show(getApiError(error, '重置失败'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const elementEntries = Object.entries(elements);

  return (
    <div className="space-y-4 pb-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="font-mono text-xs font-semibold uppercase text-[var(--accent)]">Diagnostics</div>
          <h1 className="mt-1 text-3xl font-semibold text-[var(--fg)]">预览编辑器</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill tone={editable ? 'success' : 'warn'}>{editable ? 'video 可编辑' : '暂未开放'}</StatusPill>
          <StatusPill tone={dirty ? 'warn' : 'neutral'}>{dirty ? '未保存' : '已同步'}</StatusPill>
          {savedConfig.scopeMeta?.hasGroupOverride && <StatusPill tone="accent">使用群组覆盖</StatusPill>}
        </div>
      </header>

      <section className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="grid gap-3 xl:grid-cols-[1.1fr_1fr_0.8fr_0.7fr_auto]">
          <div className="grid gap-1.5">
            <span className="text-xs font-semibold text-[var(--muted)]">来源</span>
            <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-[var(--border)]">
              {[
                ['structure', '结构示例'],
                ['link', '真实链接']
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={`min-h-10 px-3 text-sm font-semibold ${
                    mode === value
                      ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
                      : 'bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--surface-muted)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-[var(--muted)]">视频链接</span>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              disabled={mode !== 'link'}
              placeholder="https://www.bilibili.com/video/BV..."
              className="min-h-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--fg)] outline-none disabled:opacity-50"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-[var(--muted)]">群组</span>
            <select
              value={groupId}
              onChange={(event) => setGroupId(event.target.value)}
              className="min-h-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--fg)] outline-none"
            >
              <option value="">全局模板</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>{group.name} ({group.id})</option>
              ))}
            </select>
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-[var(--muted)]">模板</span>
            <select
              value={selectedType}
              onChange={(event) => setSelectedType(event.target.value)}
              className="min-h-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--fg)] outline-none"
            >
              {Object.entries(schema?.types || {}).map(([key, value]) => (
                <option key={key} value={key} disabled={value.status !== 'editable'}>
                  {value.label}{value.status === 'editable' ? '' : '（暂未开放）'}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap items-end gap-2">
            <Button icon={Wand2} variant="primary" disabled={loading || previewing || !editable} onClick={() => runPreview()}>
              {previewing ? '生成中' : '生成预览'}
            </Button>
            <Button icon={RefreshCw} disabled={loading || previewing} onClick={fetchConfig}>
              重载
            </Button>
          </div>
        </div>
        {previewError && (
          <div className="rounded-lg border border-[color-mix(in_oklch,var(--danger)_38%,var(--border))] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[color-mix(in_oklch,var(--danger)_88%,var(--fg))]">
            {previewError}
          </div>
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_320px]">
        <aside className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
            <LayoutTemplate size={17} className="text-[var(--accent)]" />
            <h2 className="text-sm font-semibold">元素</h2>
          </div>
          <div className="grid gap-1 p-2">
            {elementEntries.map(([key, element]) => {
              const meta = preview?.elements?.[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedElement(key)}
                  className={`flex min-h-10 items-center justify-between rounded-lg px-3 text-left text-sm transition-colors ${
                    selectedElement === key
                      ? 'bg-[var(--accent-soft)] text-[var(--fg)]'
                      : 'text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--fg)]'
                  }`}
                >
                  <span>{element.label}</span>
                  <span className="text-[11px] text-[var(--subtle)]">
                    {meta ? (meta.exists ? (meta.visible ? '可见' : '隐藏') : '缺失') : key}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex flex-col gap-2 border-b border-[var(--border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <ImageIcon size={17} className="text-[var(--accent)]" />
              <h2 className="text-sm font-semibold">预览画布</h2>
            </div>
            <div className="text-xs text-[var(--muted)]">
              {preview?.resolved?.canonicalUrl || '生成预览后显示真实截图'}
            </div>
          </div>
          <div className="grid min-h-[420px] place-items-center p-4">
            {preview?.image?.base64 ? (
              <div className="relative max-h-[72vh] max-w-full overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-muted)]">
                <div className="relative inline-block max-w-full">
                  <img
                    src={`data:${preview.image.mime};base64,${preview.image.base64}`}
                    alt="预览图"
                    className="block h-auto max-w-full"
                  />
                  <PreviewOverlay
                    elements={preview.elements}
                    container={preview.container}
                    selectedKey={selectedElement}
                    onSelect={setSelectedElement}
                  />
                </div>
              </div>
            ) : (
              <div className="grid gap-3 text-center text-[var(--muted)]">
                <Eye className="mx-auto h-10 w-10 text-[var(--subtle)]" />
                <div className="text-sm">选择结构示例或输入视频链接后生成预览</div>
              </div>
            )}
          </div>
        </main>

        <aside className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
            <SlidersHorizontal size={17} className="text-[var(--accent)]" />
            <h2 className="text-sm font-semibold">属性</h2>
          </div>
          <div className="space-y-4 p-4">
            {selectedElementSchema ? (
              <>
                <div>
                  <div className="text-lg font-semibold text-[var(--fg)]">{selectedElementSchema.label}</div>
                  <div className="mt-1 font-mono text-xs text-[var(--subtle)]">{selectedElement}</div>
                </div>

                {selectedElementSchema.controls.includes('visible') && (
                  <div className="flex items-center justify-between rounded-lg border border-[var(--border)] p-3">
                    <div>
                      <div className="text-sm font-semibold">显示元素</div>
                      <div className="text-xs text-[var(--muted)]">关闭后本元素从预览中隐藏</div>
                    </div>
                    <ToggleSwitch
                      checked={selectedDraft.visible !== false}
                      onChange={(checked) => updateElement(selectedElement, { visible: checked })}
                      label="显示元素"
                    />
                  </div>
                )}

                {selectedElementSchema.controls
                  .filter((control) => ['layout', 'typography', 'media'].includes(control))
                  .map((control) => (
                    <FieldGroupControls
                      key={control}
                      groupName={control}
                      schema={schema?.fieldGroups?.[control]}
                      values={selectedDraft[control] || {}}
                      onChange={(field, value) => updateElementGroupField(control, field, value)}
                    />
                  ))}

                <div className="grid gap-2 border-t border-[var(--border)] pt-4">
                  <Button icon={Wand2} variant="primary" disabled={previewing || !editable} onClick={() => runPreview()}>
                    应用预览
                  </Button>
                  <Button icon={RotateCcw} disabled={!editable} onClick={resetDraftElement}>
                    重置草稿元素
                  </Button>
                  <Button icon={Save} disabled={saving || !editable || Boolean(groupId)} onClick={() => saveConfig('global')}>
                    保存到全局
                  </Button>
                  <Button icon={Save} disabled={saving || !editable || !groupId} onClick={() => saveConfig('group')}>
                    保存到当前群
                  </Button>
                  <Button variant="danger" icon={RotateCcw} disabled={saving || !editable} onClick={() => resetSaved(groupId ? 'group' : 'global', selectedElement)}>
                    重置已保存元素
                  </Button>
                  <Button variant="danger" icon={RotateCcw} disabled={saving || !editable} onClick={() => resetSaved(groupId ? 'group' : 'global')}>
                    重置当前模板
                  </Button>
                </div>
              </>
            ) : (
              <div className="text-sm text-[var(--muted)]">当前类型没有可编辑元素。</div>
            )}
          </div>
        </aside>
      </section>
    </div>
  );
}
