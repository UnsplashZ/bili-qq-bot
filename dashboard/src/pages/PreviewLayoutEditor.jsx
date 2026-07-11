import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Moveable from 'react-moveable';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlignCenter,
  AlignHorizontalSpaceAround,
  Braces,
  ChevronDown,
  Copy,
  Download,
  Eye,
  Grid3x3,
  Image as ImageIcon,
  Layers,
  LayoutTemplate,
  Magnet,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Square,
  Trash2,
  Type,
  Undo2,
  Upload
} from 'lucide-react';
import api from '../utils/auth';
import { Button, Card, PanelHeader, StatusPill, ToggleSwitch } from '../components/ui';
import { useToast } from '../hooks/useToast';
import LivePreviewCanvas from '../components/LivePreviewCanvas';
import PreviewGradientSection from './settings/components/PreviewGradientSection';
import usePreviewGradientSettings from './settings/hooks/usePreviewGradientSettings';

const RESIZABLE_ROLES = new Set(['card', 'cover', 'content', 'text', 'title', 'media', 'dynamicMedia', 'dynamicSection']);

function isNodeResizable(node) {
  if (!node) return false;
  if (!node.role) return true;
  return RESIZABLE_ROLES.has(node.role);
}

function clone(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

function getApiError(error, fallback) {
  return error?.response?.data?.error || error?.message || fallback;
}

function createEmptyTemplate(type = 'video') {
  return {
    version: 2,
    type,
    canvas: { width: 1000, height: 'auto', minHeight: 320, maxHeight: 1600, padding: 24 },
    rootId: 'root',
    nodesById: {
      root: {
        id: 'root',
        type: 'container',
        role: 'root',
        label: '模板',
        parentId: null,
        visible: true,
        locked: true,
        layout: { mode: 'stack' },
        style: {},
        binding: {}
      }
    },
    childrenByParentId: { root: [] }
  };
}

function nodeLabel(node) {
  return node?.label || node?.role || node?.id || '';
}

function getChildren(template, nodeId) {
  return template?.childrenByParentId?.[nodeId] || [];
}

function flattenTree(template, nodeId = template?.rootId || 'root', depth = 0, output = []) {
  const node = template?.nodesById?.[nodeId];
  if (!node) return output;
  output.push({ node, depth });
  for (const childId of getChildren(template, nodeId)) {
    flattenTree(template, childId, depth + 1, output);
  }
  return output;
}

function nextNodeId(template, componentType) {
  const base = `node_${componentType}_${Date.now().toString(36)}`;
  let id = base;
  let index = 1;
  while (template.nodesById[id]) {
    id = `${base}_${index}`;
    index += 1;
  }
  return id;
}

function updateNode(template, nodeId, patch) {
  if (!template?.nodesById?.[nodeId]) return template;
  const existing = template.nodesById[nodeId];
  // Deep-merge nested objects (layout, style, binding) to avoid shared references
  // between nodes after a shallow spread of a patch that contains nested objects.
  const merged = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && typeof existing[key] === 'object' && existing[key] !== null) {
      merged[key] = { ...existing[key], ...value };
    } else {
      merged[key] = value;
    }
  }
  return {
    ...template,
    nodesById: {
      ...template.nodesById,
      [nodeId]: merged
    }
  };
}

function getRolePolicy(schema, type) {
  return schema?.rolePolicies?.[type] || {};
}

function isLegacyNode(schema, type, node) {
  if (!node?.role) return false;
  const policy = getRolePolicy(schema, type);
  return node.role === 'root'
    || (policy.requiredRoles || []).includes(node.role)
    || (policy.optionalRoles || []).includes(node.role);
}

function isRequiredRole(schema, type, node) {
  if (!node?.role) return false;
  return (getRolePolicy(schema, type).requiredRoles || []).includes(node.role);
}

function isGenericInsertParent(schema, type, node) {
  if (!node?.role) return false;
  return (getRolePolicy(schema, type).genericInsertParents || []).includes(node.role);
}

function removeNodeRecursive(template, nodeId) {
  if (!template?.nodesById?.[nodeId] || nodeId === template.rootId) return template;
  const next = clone(template);
  const removeOne = (id) => {
    for (const childId of next.childrenByParentId[id] || []) removeOne(childId);
    const parentId = next.nodesById[id]?.parentId;
    if (parentId && next.childrenByParentId[parentId]) {
      next.childrenByParentId[parentId] = next.childrenByParentId[parentId].filter((child) => child !== id);
    }
    delete next.childrenByParentId[id];
    delete next.nodesById[id];
  };
  removeOne(nodeId);
  return next;
}

function cloneSubtree(template, sourceId, parentId, componentType) {
  const source = template.nodesById[sourceId];
  if (!source) return null;
  const id = nextNodeId(template, componentType || source.componentType || source.type);
  const node = {
    ...clone(source),
    id,
    parentId,
    label: `${nodeLabel(source)} 副本`,
    locked: false
  };
  delete node.templateType;
  const nodes = { [id]: node };
  const childrenByParentId = {};
  const childIds = [];
  for (const childId of template.childrenByParentId[sourceId] || []) {
    const childClone = cloneSubtree({
      ...template,
      nodesById: {
        ...template.nodesById,
        ...nodes
      }
    }, childId, id, template.nodesById[childId]?.componentType || template.nodesById[childId]?.type);
    if (!childClone) continue;
    Object.assign(nodes, childClone.nodesById);
    Object.assign(childrenByParentId, childClone.childrenByParentId);
    childIds.push(childClone.rootId);
  }
  if (childIds.length > 0 || template.childrenByParentId[sourceId]) {
    childrenByParentId[id] = childIds;
  }
  return { rootId: id, nodesById: nodes, childrenByParentId };
}

function addComponent(template, componentType, registry, parentId = 'root', schema = null, type = 'video') {
  const component = registry?.[componentType];
  if (!component?.defaultNode) return template;
  const id = nextNodeId(template, componentType);
  const requestedParent = template.nodesById[parentId];
  const fallbackParent = template.nodesById.content ? 'content' : template.rootId;
  const parent = requestedParent?.type === 'container' && isGenericInsertParent(schema, type, requestedParent)
    ? parentId
    : fallbackParent;
  const node = {
    ...clone(component.defaultNode),
    id,
    componentType,
    parentId: parent,
    visible: true,
    locked: false
  };
  const next = clone(template);
  next.nodesById[id] = node;
  next.childrenByParentId[parent] = [...(next.childrenByParentId[parent] || []), id];
  if (component.allowsChildren && !next.childrenByParentId[id]) next.childrenByParentId[id] = [];
  return next;
}

function moveNode(template, nodeId, newParentId, overId = null) {
  if (!template.nodesById[nodeId] || nodeId === template.rootId || nodeId === newParentId) return template;
  if (template.nodesById[nodeId].role) return template;
  if (!template.nodesById[newParentId] || template.nodesById[newParentId].type !== 'container') return template;
  let cursor = newParentId;
  while (cursor) {
    if (cursor === nodeId) return template;
    cursor = template.nodesById[cursor]?.parentId;
  }
  const next = clone(template);
  const oldParent = next.nodesById[nodeId].parentId;
  if (oldParent && next.childrenByParentId[oldParent]) {
    next.childrenByParentId[oldParent] = next.childrenByParentId[oldParent].filter((id) => id !== nodeId);
  }
  next.nodesById[nodeId].parentId = newParentId;
  const siblings = next.childrenByParentId[newParentId] || [];
  const insertAt = overId && siblings.includes(overId) ? siblings.indexOf(overId) : siblings.length;
  siblings.splice(insertAt, 0, nodeId);
  next.childrenByParentId[newParentId] = siblings;
  return next;
}

function reorderNode(template, activeId, overId) {
  const active = template.nodesById[activeId];
  const over = template.nodesById[overId];
  if (!active || !over || activeId === template.rootId || activeId === overId) return template;
  if (active.role) return template;
  if (over.type === 'container' && overId !== active.parentId) {
    return moveNode(template, activeId, overId);
  }
  if (active.parentId !== over.parentId) return moveNode(template, activeId, over.parentId, overId);
  const parentId = active.parentId;
  const siblings = [...(template.childrenByParentId[parentId] || [])];
  const oldIndex = siblings.indexOf(activeId);
  const newIndex = siblings.indexOf(overId);
  if (oldIndex < 0 || newIndex < 0) return template;
  return {
    ...template,
    childrenByParentId: {
      ...template.childrenByParentId,
      [parentId]: arrayMove(siblings, oldIndex, newIndex)
    }
  };
}

function applyVisualDeltaToLayout(node, delta = { x: 0, y: 0 }) {
  const layout = node.layout || {};
  const dx = Math.round(delta.x || 0);
  const dy = Math.round(delta.y || 0);
  if (layout.mode === 'absolute') {
    return {
      ...layout,
      x: Math.round((layout.x || 0) + dx),
      y: Math.round((layout.y || 0) + dy),
      zIndex: layout.zIndex || 10
    };
  }
  const transform = layout.transform || {};
  return {
    ...layout,
    transform: {
      x: Math.round((transform.x || 0) + dx),
      y: Math.round((transform.y || 0) + dy)
    }
  };
}

function applyVisualSizeToLayout(node, meta, size = {}) {
  const layout = node.layout || {};
  const box = meta?.box || {};
  return {
    ...layout,
    width: Math.round(size.width || box.width || layout.width || 120),
    height: Math.round(size.height || box.height || layout.height || 48)
  };
}

function SortableNodeButton({
  item,
  selected,
  onSelect,
  onToggleVisible,
  onDelete,
  sortableDisabled = false,
  toggleDisabled = false,
  deleteDisabled = false
}) {
  const { node, depth } = item;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: node.id, disabled: sortableDisabled });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    paddingLeft: `${8 + depth * 14}px`
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-tree-node-id={node.id}
      data-tree-node-label={nodeLabel(node)}
      {...attributes}
      {...listeners}
      className={`group flex min-h-10 items-center gap-2 rounded-lg border px-2 text-sm ${
        selected
          ? 'border-[var(--accent)] bg-[var(--accent-surface)] text-[var(--fg)]'
          : 'border-transparent text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]'
      } ${isDragging ? 'opacity-50' : ''}`}
    >
      <button
        type="button"
        data-tree-action="select"
        className="min-w-0 flex-1 truncate text-left"
        onClick={(event) => onSelect(node.id, event.shiftKey)}
      >
        {nodeLabel(node)}
        <span className="ml-2 font-mono text-[10px] text-[var(--subtle)]">{node.type}</span>
      </button>
      <button
        type="button"
        data-tree-action="visible"
        disabled={toggleDisabled}
        className="text-[11px] text-[var(--subtle)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-45"
        onClick={() => onToggleVisible(node.id)}
      >
        {node.visible === false ? '隐' : '显'}
      </button>
      {!deleteDisabled && (
        <button
          type="button"
          data-tree-action="delete"
          className="text-[var(--subtle)] hover:text-[var(--danger)]"
          onClick={() => onDelete(node.id)}
          title="删除"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

function NumberInput({ label, value, onChange, step = 1 }) {
  return (
    <label className="grid gap-1 text-xs">
      <span className="font-medium text-[var(--muted)]">{label}</span>
      <input
        type="number"
        step={step}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
        className="min-h-9 rounded-lg border border-[var(--border-muted)] bg-[var(--field-bg)] px-3 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]"
      />
    </label>
  );
}

function TextInput({ label, value, onChange }) {
  return (
    <label className="grid gap-1 text-xs">
      <span className="font-medium text-[var(--muted)]">{label}</span>
      <input
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-9 rounded-lg border border-[var(--border-muted)] bg-[var(--field-bg)] px-3 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]"
      />
    </label>
  );
}

function SelectInput({ label, value, options, onChange }) {
  return (
    <label className="grid gap-1 text-xs">
      <span className="font-medium text-[var(--muted)]">{label}</span>
      <select
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-9 rounded-lg border border-[var(--border-muted)] bg-[var(--field-bg)] px-3 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]"
      >
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function PropertyPanel({ node, schema, onChange, onDelete, onDuplicate, liveLayout }) {
  if (!node) return <div className="p-4 text-sm text-[var(--muted)]">选择节点后编辑属性。</div>;
  const layout = liveLayout || node.layout || {};
  const savedLayout = node.layout || {};
  const style = node.style || {};
  const binding = node.binding || {};
  const legacyNode = isLegacyNode(schema, node.templateType, node);
  const requiredRole = isRequiredRole(schema, node.templateType, node);
  const layoutModes = legacyNode
    ? (schema?.controls?.layoutModes || ['flow', 'absolute', 'stack', 'flex', 'grid']).filter((mode) => mode !== 'absolute')
    : (schema?.controls?.layoutModes || ['flow', 'absolute', 'stack', 'flex', 'grid']);
  const bindingOptions = [
    ...(schema?.bindings?.common || []),
    ...(schema?.bindings?.[node.templateType] || [])
  ];
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold text-[var(--fg)]">{nodeLabel(node)}</div>
          <div className="font-mono text-xs text-[var(--subtle)]">{node.id}</div>
        </div>
        <div className="flex gap-1">
          <Button size="sm" icon={Copy} disabled={node.locked || legacyNode} onClick={onDuplicate}>复制</Button>
          <Button size="sm" variant="danger" icon={Trash2} disabled={node.locked || node.id === 'root' || legacyNode} onClick={onDelete}>删除</Button>
        </div>
      </div>

      <div className="flex items-center justify-between border-y border-[var(--border-subtle)] py-3">
        <span className="text-sm font-semibold">显示节点</span>
        <ToggleSwitch checked={node.visible !== false} disabled={requiredRole} onChange={(checked) => onChange({ visible: checked })} label="显示节点" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
        <TextInput label="名称" value={node.label || ''} onChange={(value) => onChange({ label: value })} />
        <SelectInput label="布局模式" value={layout.mode || 'flow'} options={layoutModes} onChange={(value) => onChange({ layout: { ...savedLayout, mode: value } })} />
        {layout.mode === 'absolute' && (
          <>
            <NumberInput label="X" value={layout.x} onChange={(value) => onChange({ layout: { ...savedLayout, x: value } })} />
            <NumberInput label="Y" value={layout.y} onChange={(value) => onChange({ layout: { ...savedLayout, y: value } })} />
            <NumberInput label="层级" value={layout.zIndex} onChange={(value) => onChange({ layout: { ...savedLayout, zIndex: value } })} />
          </>
        )}
        <NumberInput label="宽" value={layout.width} onChange={(value) => onChange({ layout: { ...savedLayout, width: value } })} />
        <NumberInput label="高" value={layout.height} onChange={(value) => onChange({ layout: { ...savedLayout, height: value } })} />
        <NumberInput label="间距" value={layout.gap} onChange={(value) => onChange({ layout: { ...savedLayout, gap: value } })} />
        <NumberInput label="内边距" value={layout.padding} onChange={(value) => onChange({ layout: { ...savedLayout, padding: value } })} />
      </div>

      <div className="grid gap-3 border-t border-[var(--border-subtle)] pt-4 sm:grid-cols-2 xl:grid-cols-1">
        <NumberInput label="字号" value={style.fontSize} onChange={(value) => onChange({ style: { ...style, fontSize: value } })} />
        <NumberInput label="字重" value={style.fontWeight} onChange={(value) => onChange({ style: { ...style, fontWeight: value } })} />
        <NumberInput label="行高" value={style.lineHeight} step={0.1} onChange={(value) => onChange({ style: { ...style, lineHeight: value } })} />
        <NumberInput label="最大行数" value={style.maxLines} onChange={(value) => onChange({ style: { ...style, maxLines: value } })} />
        <TextInput label="文字色" value={style.color || ''} onChange={(value) => onChange({ style: { ...style, color: value } })} />
        <TextInput label="背景色" value={style.background || ''} onChange={(value) => onChange({ style: { ...style, background: value } })} />
        <NumberInput label="圆角" value={style.radius} onChange={(value) => onChange({ style: { ...style, radius: value } })} />
        {node.type === 'image' && (
          <>
            <SelectInput label="裁切" value={style.objectFit || 'cover'} options={schema?.controls?.objectFit || ['cover', 'contain', 'fill']} onChange={(value) => onChange({ style: { ...style, objectFit: value } })} />
            <SelectInput label="焦点" value={style.objectPosition || '50% 50%'} options={schema?.controls?.objectPosition || ['top', 'center', 'bottom', '50% 50%']} onChange={(value) => onChange({ style: { ...style, objectPosition: value } })} />
          </>
        )}
      </div>

      <div className="grid gap-3 border-t border-[var(--border-subtle)] pt-4">
        <SelectInput
          label="绑定源"
          value={binding.source || 'static'}
          options={bindingOptions.includes(binding.source) ? bindingOptions : [binding.source || 'static', ...bindingOptions].filter(Boolean)}
          onChange={(value) => onChange({ binding: { ...binding, source: value } })}
        />
        {binding.source === 'static' && (
          <TextInput label="静态值" value={binding.value || ''} onChange={(value) => onChange({ binding: { ...binding, value } })} />
        )}
        <TextInput label="Fallback" value={binding.fallback || ''} onChange={(value) => onChange({ binding: { ...binding, fallback: value } })} />
      </div>
    </div>
  );
}

export default function PreviewLayoutEditor() {
  const { show } = useToast();
  const configGenerationRef = useRef(null);
  const {
    previewGradientConfig,
    savingPreviewGradient,
    handlePreviewGradientChange,
    savePreviewGradientSettings,
    resetPreviewGradientSettings
  } = usePreviewGradientSettings(show, configGenerationRef);
  const [schema, setSchema] = useState(null);
  const [groups, setGroups] = useState([]);
  const [selectedType, setSelectedType] = useState('video');
  const [groupId, setGroupId] = useState('');
  const [mode, setMode] = useState('structure');
  const [input, setInput] = useState('');
  const [template, setTemplate] = useState(createEmptyTemplate('video'));
  const [savedTemplate, setSavedTemplate] = useState(createEmptyTemplate('video'));
  const [selectedIds, setSelectedIds] = useState(['root']);
  const [panel, setPanel] = useState('nodes');
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [previewPayloadKey, setPreviewPayloadKey] = useState('');
  const [selectedTargetElement, setSelectedTargetElement] = useState(null);
  const [interactionState, setInteractionState] = useState(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const fileInputRef = useRef(null);
  const overlayRef = useRef(null);
  const lastPreviewPayloadRef = useRef('');
  const debounceRef = useRef(null);
  const artifactDebounceRef = useRef(null);
  const lastMoveableDragRef = useRef(null);
  const lastMoveableResizeRef = useRef(null);
  const overlayDragRef = useRef(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const selectedId = selectedIds[0] || template.rootId;
  const selectedNode = template.nodesById?.[selectedId] ? { ...template.nodesById[selectedId], templateType: selectedType } : null;

  const liveLayout = (() => {
    if (!interactionState || interactionState.nodeId !== selectedId || !selectedNode) return null;
    const layout = selectedNode.layout || {};
    if (interactionState.type === 'drag') {
      return applyVisualDeltaToLayout(selectedNode, interactionState.delta);
    }
    if (interactionState.type === 'resize') {
      return { ...layout, width: interactionState.width ?? layout.width, height: interactionState.height ?? layout.height };
    }
    return null;
  })();
  const flattened = useMemo(() => flattenTree(template), [template]);
  const sortedLayerNodes = useMemo(
    () => flattened
      .map((item) => item.node)
      .filter((node) => node.layout?.mode === 'absolute')
      .sort((left, right) => (right.layout?.zIndex || 0) - (left.layout?.zIndex || 0)),
    [flattened]
  );
  const dirty = !valuesEqual(template, savedTemplate);

  const pushTemplate = useCallback((updater, { historyEntry = true } = {}) => {
    setTemplate((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      if (historyEntry && !valuesEqual(current, next)) {
        setHistory((items) => [...items.slice(-29), current]);
        setFuture([]);
      }
      return next;
    });
  }, []);

  const fetchConfig = useCallback(async () => {
    const response = await api.get('/api/preview-layout/config', {
      params: { type: selectedType, groupId: groupId || undefined }
    });
    const generation = Number(response.headers?.['x-config-generation']);
    if (Number.isSafeInteger(generation)) configGenerationRef.current = generation;
    const nextTemplate = response.data.template || createEmptyTemplate(selectedType);
    setTemplate(nextTemplate);
    setSavedTemplate(clone(nextTemplate));
    setSelectedIds([nextTemplate.rootId || 'root']);
    setHistory([]);
    setFuture([]);
    return nextTemplate;
  }, [selectedType, groupId]);

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
    return () => { mounted = false; };
  }, [show]);

  useEffect(() => {
    if (!schema) return;
    fetchConfig().catch((error) => show(getApiError(error, '读取模板配置失败'), 'error'));
  }, [schema, fetchConfig, show]);

  const buildPreviewPayload = useCallback((draft = template) => ({
    mode,
    input,
    groupId: groupId || null,
    mockType: selectedType,
    showId: true,
    cacheMode: 'cached',
    draftTemplate: draft,
    artifactMode: 'image+html'
  }), [mode, input, groupId, selectedType, template]);

  const currentPreviewPayloadKey = useMemo(() => stableStringify(buildPreviewPayload()), [buildPreviewPayload]);
  const previewOutdated = Boolean(preview?.image?.base64 && previewPayloadKey && previewPayloadKey !== currentPreviewPayloadKey);

  const runPreview = useCallback(async ({ silent = false, draft = template } = {}) => {
    if (mode === 'link' && !input.trim()) {
      setPreviewError('请输入 B 站链接');
      setPreview(null);
      setSelectedTargetElement(null);
      return;
    }
    const payload = buildPreviewPayload(draft);
    const payloadKey = stableStringify(payload);
    lastPreviewPayloadRef.current = payloadKey;
    setPreviewing(true);
    if (!silent) setPreviewError('');
    try {
      const response = await api.post('/api/preview-layout/preview', payload);
      if (lastPreviewPayloadRef.current !== payloadKey) return;
      setPreview(response.data);
      setPreviewPayloadKey(payloadKey);
      setPreviewError('');
    } catch (error) {
      if (lastPreviewPayloadRef.current !== payloadKey) return;
      setPreview(null);
      setPreviewPayloadKey(payloadKey);
      setSelectedTargetElement(null);
      setPreviewError(getApiError(error, '预览生成失败'));
    } finally {
      if (lastPreviewPayloadRef.current === payloadKey) setPreviewing(false);
    }
  }, [buildPreviewPayload, input, mode, template]);

  useEffect(() => {
    if (!preview?.image?.base64 || !dirty || !previewOutdated) return undefined;
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => runPreview({ silent: true }), 700);
    return () => window.clearTimeout(debounceRef.current);
  }, [dirty, preview?.image?.base64, previewOutdated, runPreview]);

  const selectNode = (nodeId, multi = false) => {
    setSelectedIds((current) => (multi
      ? (current.includes(nodeId) ? current.filter((id) => id !== nodeId) : [...current, nodeId])
      : [nodeId]));
  };

  const toggleVisible = (nodeId) => {
    pushTemplate((current) => {
      const node = current.nodesById[nodeId];
      if (isRequiredRole(schema, selectedType, node)) return current;
      return updateNode(current, nodeId, { visible: node.visible === false });
    });
  };

  const deleteNode = (nodeId) => {
    const node = template.nodesById[nodeId];
    if (isLegacyNode(schema, selectedType, node)) return;
    pushTemplate((current) => removeNodeRecursive(current, nodeId));
    setSelectedIds(['root']);
  };

  const duplicateNode = () => {
    if (!selectedNode || selectedNode.id === template.rootId) return;
    if (isLegacyNode(schema, selectedType, selectedNode)) return;
    pushTemplate((current) => {
      const cloned = cloneSubtree(current, selectedNode.id, selectedNode.parentId, selectedNode.componentType || selectedNode.type);
      if (!cloned) return current;
      const next = clone(current);
      Object.assign(next.nodesById, cloned.nodesById);
      Object.assign(next.childrenByParentId, cloned.childrenByParentId);
      const parentId = cloned.nodesById[cloned.rootId].parentId || next.rootId;
      next.childrenByParentId[parentId] = [...(next.childrenByParentId[parentId] || []), cloned.rootId];
      return next;
    });
  };

  const saveConfig = async (scope) => {
    if (scope === 'global' && groupId) {
      show('请先切回全局模板再保存全局配置', 'error');
      return;
    }
    setSaving(true);
    try {
      if (!Number.isSafeInteger(configGenerationRef.current)) throw new Error('配置 generation 尚未就绪，请刷新后重试');
      const response = await api.post('/api/preview-layout/config', {
        scope,
        groupId: scope === 'group' ? groupId : null,
        type: selectedType,
        template,
        expectedGeneration: configGenerationRef.current
      });
      configGenerationRef.current = response.data.documentGeneration ?? response.data.generation;
      const nextTemplate = await fetchConfig();
      await runPreview({ silent: true, draft: nextTemplate });
      show('模板已保存', 'success');
    } catch (error) {
      show(getApiError(error, '保存失败'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const resetSaved = async (nodeId = '') => {
    setSaving(true);
    try {
      if (!Number.isSafeInteger(configGenerationRef.current)) throw new Error('配置 generation 尚未就绪，请刷新后重试');
      const response = await api.post('/api/preview-layout/reset', {
        scope: groupId ? 'group' : 'global',
        groupId: groupId || null,
        type: selectedType,
        nodeId: nodeId || undefined,
        expectedGeneration: configGenerationRef.current
      });
      configGenerationRef.current = response.data.documentGeneration ?? response.data.generation;
      const nextTemplate = await fetchConfig();
      await runPreview({ silent: true, draft: nextTemplate });
      show(nodeId ? '节点已重置' : '模板已重置', 'success');
    } catch (error) {
      show(getApiError(error, '重置失败'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const undo = () => {
    setHistory((items) => {
      if (items.length === 0) return items;
      const previous = items[items.length - 1];
      setFuture((futureItems) => [template, ...futureItems]);
      setTemplate(previous);
      return items.slice(0, -1);
    });
  };

  const redo = () => {
    setFuture((items) => {
      if (items.length === 0) return items;
      const next = items[0];
      setHistory((historyItems) => [...historyItems, template]);
      setTemplate(next);
      return items.slice(1);
    });
  };

  const exportTemplate = () => {
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `preview-template-${selectedType}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importTemplate = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      const response = await api.post('/api/preview-layout/template/validate', {
        type: selectedType,
        template: raw
      });
      pushTemplate(response.data.template);
      show('模板已导入', 'success');
    } catch (error) {
      show(getApiError(error, '导入失败'), 'error');
    } finally {
      event.target.value = '';
    }
  };

  const alignSelected = (axis) => {
    if (selectedIds.length < 2) return;
    const metas = selectedIds.map((id) => preview?.elements?.[id]?.box).filter(Boolean);
    if (metas.length < 2) return;
    const center = axis === 'x'
      ? metas.reduce((sum, box) => sum + box.x + box.width / 2, 0) / metas.length
      : metas.reduce((sum, box) => sum + box.y + box.height / 2, 0) / metas.length;
    pushTemplate((current) => {
      let next = current;
      for (const id of selectedIds) {
        const node = next.nodesById[id];
        const meta = preview?.elements?.[id];
        if (!node || node.locked || !meta?.box) continue;
        const delta = axis === 'x'
          ? { x: center - (meta.box.x + meta.box.width / 2), y: 0 }
          : { x: 0, y: center - (meta.box.y + meta.box.height / 2) };
        next = updateNode(next, id, { layout: applyVisualDeltaToLayout(node, delta) });
      }
      return next;
    });
  };

  const distributeSelected = () => {
    if (selectedIds.length < 3) return;
    const items = selectedIds
      .map((id) => ({ id, box: preview?.elements?.[id]?.box }))
      .filter((item) => item.box)
      .sort((a, b) => a.box.x - b.box.x);
    if (items.length < 3) return;
    const first = items[0].box.x;
    const last = items[items.length - 1].box.x;
    const step = (last - first) / (items.length - 1);
    pushTemplate((current) => {
      let next = current;
      items.forEach((item, index) => {
        const node = next.nodesById[item.id];
        if (!node || node.locked) return;
        const desiredX = first + step * index;
        next = updateNode(next, item.id, {
          layout: applyVisualDeltaToLayout(node, { x: desiredX - item.box.x, y: 0 })
        });
      });
      return next;
    });
  };

  const onMoveableDragEnd = (event) => {
    const nodeId = selectedId;
    const node = template.nodesById[nodeId];
    const meta = preview?.elements?.[nodeId];
    if (!node || node.locked || !meta?.box) return;
    const overlayWidth = overlayRef.current?.getBoundingClientRect().width || preview.container?.width || 1;
    const scale = overlayWidth / (preview.container?.width || overlayWidth || 1);
    const lastDrag = event.lastEvent || lastMoveableDragRef.current || {};
    const beforeTranslate = lastDrag.beforeTranslate || lastDrag.translate || [0, 0];
    const delta = { x: beforeTranslate[0] / scale, y: beforeTranslate[1] / scale };
    lastMoveableDragRef.current = null;
    pushTemplate((current) => updateNode(current, nodeId, { layout: applyVisualDeltaToLayout(node, delta) }));
  };

  const onMoveableResizeEnd = (event) => {
    const nodeId = selectedId;
    const node = template.nodesById[nodeId];
    const meta = preview?.elements?.[nodeId];
    if (!node || node.locked || !meta?.box) return;
    const overlayWidth = overlayRef.current?.getBoundingClientRect().width || preview.container?.width || 1;
    const scale = overlayWidth / (preview.container?.width || overlayWidth || 1);
    const lastResize = event.lastEvent || lastMoveableResizeRef.current || {};
    const width = lastResize.width ? lastResize.width / scale : meta.box.width;
    const height = lastResize.height ? lastResize.height / scale : meta.box.height;
    lastMoveableResizeRef.current = null;
    pushTemplate((current) => updateNode(current, nodeId, { layout: applyVisualSizeToLayout(node, meta, { width, height }) }));
  };

  const beginOverlayDrag = (event, nodeId) => {
    if (event.button !== 0) return;
    const node = template.nodesById[nodeId];
    const meta = preview?.elements?.[nodeId];
    if (!node || node.locked || !meta?.box) return;
    overlayDragRef.current = {
      nodeId,
      startX: event.clientX,
      startY: event.clientY,
      deltaX: 0,
      deltaY: 0
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const updateOverlayDrag = (event) => {
    const state = overlayDragRef.current;
    if (!state) return;
    state.deltaX = event.clientX - state.startX;
    state.deltaY = event.clientY - state.startY;
  };

  const finishOverlayDrag = (event) => {
    const state = overlayDragRef.current;
    overlayDragRef.current = null;
    if (!state || Math.abs(state.deltaX) + Math.abs(state.deltaY) < 4) return;
    const node = template.nodesById[state.nodeId];
    const meta = preview?.elements?.[state.nodeId];
    if (!node || node.locked || !meta?.box) return;
    const overlayWidth = overlayRef.current?.getBoundingClientRect().width || preview.container?.width || 1;
    const scale = overlayWidth / (preview.container?.width || overlayWidth || 1);
    const delta = { x: state.deltaX / scale, y: state.deltaY / scale };
    event.preventDefault();
    pushTemplate((current) => updateNode(current, state.nodeId, { layout: applyVisualDeltaToLayout(node, delta) }));
  };

  const scheduleArtifactRefresh = useCallback(() => {
    window.clearTimeout(artifactDebounceRef.current);
    artifactDebounceRef.current = window.setTimeout(() => runPreview({ silent: true }), 400);
  }, [runPreview]);

  const onNodeGroupDragEndHandler = useCallback((results) => {
    pushTemplate((current) => {
      let next = current;
      for (const { nodeId, delta } of results) {
        const node = current.nodesById?.[nodeId];
        if (!node || node.locked) continue;
        next = updateNode(next, nodeId, { layout: applyVisualDeltaToLayout(node, delta) });
      }
      return next;
    });
    scheduleArtifactRefresh();
  }, [pushTemplate, scheduleArtifactRefresh]);

  const setSelectedTargetRef = useCallback((element) => {
    setSelectedTargetElement(element);
  }, []);

  useEffect(() => {
    setSelectedTargetElement(null);
  }, [preview?.image?.base64]);

  const selectedTarget = selectedIds.length === 1 ? selectedTargetElement : null;
  const componentRegistry = schema?.componentRegistry || {};
  const canvasStatus = previewing ? '预览更新中' : (previewOutdated ? '预览待更新' : '');

  return (
    <div className="space-y-4 pb-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="font-mono text-xs font-semibold uppercase text-[var(--accent)]">Template Designer</div>
          <h1 className="mt-1 text-3xl font-semibold text-[var(--fg)]">预览模板设计器</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {dirty && <StatusPill tone="warn">草稿未保存</StatusPill>}
          {groupId && <StatusPill tone="accent">群组覆盖</StatusPill>}
        </div>
      </header>

      <PreviewGradientSection
        previewGradientConfig={previewGradientConfig}
        onPreviewGradientChange={handlePreviewGradientChange}
        onResetPreviewGradient={resetPreviewGradientSettings}
        onSavePreviewGradient={savePreviewGradientSettings}
        saving={savingPreviewGradient}
      />

      <Card className="grid gap-3" padded>
        <div className="grid gap-3 xl:grid-cols-[0.8fr_1.2fr_0.8fr_0.7fr]">
          <div className="grid gap-1.5">
            <span className="text-xs font-semibold text-[var(--muted)]">来源</span>
            <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-quiet)]">
              {[
                ['structure', '结构示例'],
                ['link', '真实链接']
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={`min-h-10 px-3 text-sm font-semibold ${mode === value ? 'bg-[var(--accent)] text-[var(--accent-contrast)]' : 'text-[var(--muted)] hover:bg-[var(--surface-hover)]'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-[var(--muted)]">B 站链接</span>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              disabled={mode !== 'link'}
              placeholder="https://www.bilibili.com/video/BV... / https://t.bilibili.com/..."
              className="min-h-10 rounded-lg border border-[var(--border-muted)] bg-[var(--field-bg)] px-3 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-[var(--muted)]">群组</span>
            <select
              value={groupId}
              onChange={(event) => setGroupId(event.target.value)}
              className="min-h-10 rounded-lg border border-[var(--border-muted)] bg-[var(--field-bg)] px-3 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]"
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
              className="min-h-10 rounded-lg border border-[var(--border-muted)] bg-[var(--field-bg)] px-3 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]"
            >
              {Object.entries(schema?.types || { video: { label: '视频' } }).map(([key, value]) => (
                <option key={key} value={key}>{value.label}</option>
              ))}
            </select>
          </label>
        </div>

        {previewError && (
          <div className="rounded-lg border border-[color-mix(in_oklch,var(--danger)_38%,var(--border))] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[color-mix(in_oklch,var(--danger)_88%,var(--fg))]">
            {previewError}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-4">
          <Button icon={Eye} variant="primary" disabled={loading || previewing} onClick={() => runPreview()}>
            {previewing ? '生成中' : '应用预览'}
          </Button>
          <Button icon={Save} disabled={saving || Boolean(groupId)} onClick={() => saveConfig('global')}>保存全局</Button>
          <Button icon={Save} disabled={saving || !groupId} onClick={() => saveConfig('group')}>保存群组</Button>
          <Button icon={RefreshCw} disabled={loading || previewing} onClick={() => fetchConfig()}>重载</Button>
          <Button icon={RotateCcw} variant="danger" disabled={saving} onClick={() => resetSaved()}>重置模板</Button>
          <Button icon={Undo2} disabled={history.length === 0} onClick={undo}>撤销</Button>
          <Button icon={RotateCcw} disabled={future.length === 0} onClick={redo}>重做</Button>
          <Button icon={AlignCenter} disabled={selectedIds.length < 2} onClick={() => alignSelected('x')}>水平对齐</Button>
          <Button icon={AlignHorizontalSpaceAround} disabled={selectedIds.length < 3} onClick={distributeSelected}>分布</Button>
          <Button icon={Download} onClick={exportTemplate}>导出</Button>
          <Button icon={Upload} onClick={() => fileInputRef.current?.click()}>导入</Button>
          <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={importTemplate} />
        </div>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[200px_minmax(0,1fr)_300px]">
        <Card as="aside" className="overflow-hidden" padded={false}>
          <PanelHeader
            title={panel === 'nodes' ? '节点树' : panel === 'components' ? '组件库' : '图层'}
            icon={panel === 'nodes' ? LayoutTemplate : panel === 'components' ? Plus : Layers}
            actions={(
              <div className="flex overflow-hidden rounded-lg border border-[var(--border-subtle)]">
                {[
                  ['nodes', LayoutTemplate],
                  ['components', Plus],
                  ['layers', Layers]
                ].map(([value, TabIcon]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPanel(value)}
                    className={`grid h-8 w-9 place-items-center ${panel === value ? 'bg-[var(--accent)] text-[var(--accent-contrast)]' : 'text-[var(--muted)] hover:bg-[var(--surface-hover)]'}`}
                  >
                    {React.createElement(TabIcon, { size: 15 })}
                  </button>
                ))}
              </div>
            )}
          />
          <div className="max-h-[72vh] overflow-auto p-2">
            {panel === 'nodes' && (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={({ active, over }) => {
                  if (!over) return;
                  pushTemplate((current) => reorderNode(current, active.id, over.id));
                }}
              >
                <SortableContext items={flattened.map((item) => item.node.id)} strategy={verticalListSortingStrategy}>
                  <div className="grid gap-1">
                    {flattened.map((item) => {
                      const legacyNode = isLegacyNode(schema, selectedType, item.node);
                      const requiredRole = isRequiredRole(schema, selectedType, item.node);
                      return (
                        <SortableNodeButton
                          key={item.node.id}
                          item={item}
                          selected={selectedIds.includes(item.node.id)}
                          sortableDisabled={item.node.id === 'root' || item.node.locked || legacyNode}
                          toggleDisabled={requiredRole}
                          deleteDisabled={item.node.id === 'root' || item.node.locked || legacyNode}
                          onSelect={selectNode}
                          onToggleVisible={toggleVisible}
                          onDelete={deleteNode}
                        />
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>
            )}
            {panel === 'components' && (
              <div className="grid gap-2">
                {Object.entries(componentRegistry).map(([key, component]) => {
                  const ComponentIcon = key.includes('Text') ? Type : key === 'shape' ? Square : key === 'imagePlaceholder' ? ImageIcon : Plus;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => pushTemplate((current) => addComponent(current, key, componentRegistry, selectedId, schema, selectedType))}
                      className="flex min-h-12 items-center gap-3 rounded-lg border border-[var(--border-subtle)] px-3 text-left text-sm text-[var(--fg)] hover:bg-[var(--surface-hover)]"
                    >
                      <ComponentIcon size={16} className="text-[var(--accent)]" />
                      <span>{component.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {panel === 'layers' && (
              <div className="grid gap-1">
                {sortedLayerNodes.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => selectNode(node.id)}
                    className={`flex min-h-10 items-center justify-between rounded-lg px-3 text-left text-sm ${selectedIds.includes(node.id) ? 'bg-[var(--accent-surface)] text-[var(--fg)]' : 'text-[var(--muted)] hover:bg-[var(--surface-hover)]'}`}
                  >
                    <span>{nodeLabel(node)}</span>
                    <span className="font-mono text-[11px]">{node.layout?.zIndex || 0}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card as="main" className="overflow-hidden" padded={false}>
          <PanelHeader
            title="真实预览画布"
            icon={ImageIcon}
            meta={<div className="max-w-[40vw] truncate">{preview?.resolved?.canonicalUrl || 'WebUI 与真实推送共用后端 renderer'}</div>}
          />
          {preview?.htmlArtifact && (
            <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-1.5">
              <button
                type="button"
                title={snapEnabled ? '关闭吸附 (Alt 临时禁用)' : '开启吸附'}
                onClick={() => setSnapEnabled((v) => !v)}
                className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors ${snapEnabled ? 'bg-[var(--accent-surface)] text-[var(--accent)]' : 'text-[var(--muted)] hover:bg-[var(--surface-hover)]'}`}
              >
                <Magnet size={13} />
                吸附
              </button>
              <button
                type="button"
                title={snapToGrid ? '关闭网格 8px' : '开启网格 8px'}
                onClick={() => setSnapToGrid((v) => !v)}
                className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors ${snapToGrid ? 'bg-[var(--accent-surface)] text-[var(--accent)]' : 'text-[var(--muted)] hover:bg-[var(--surface-hover)]'}`}
              >
                <Grid3x3 size={13} />
                8px 网格
              </button>
              <span className="ml-auto text-[10px] text-[var(--subtle)]">Alt 临时禁用吸附 · Shift 锁轴</span>
            </div>
          )}
          <div className="flex min-h-[520px] items-start justify-center p-3">
            {preview?.htmlArtifact ? (
              <div className="w-full max-h-[72vh] overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-quiet)]">
                <LivePreviewCanvas
                  htmlArtifact={preview.htmlArtifact}
                  selectedId={selectedId}
                  selectedIds={selectedIds}
                  keepNodeRatio={selectedNode?.type === 'image'}
                  isResizable={selectedIds.length <= 1 && isNodeResizable(selectedNode)}
                  canvasStatus={canvasStatus}
                  snapEnabled={snapEnabled}
                  snapToGrid={snapToGrid}
                  onInteractionChange={setInteractionState}
                  onNodeDragEnd={(nodeId, delta) => {
                    const node = template.nodesById[nodeId];
                    if (!node || node.locked) return;
                    pushTemplate((current) => updateNode(current, nodeId, { layout: applyVisualDeltaToLayout(node, delta) }));
                    scheduleArtifactRefresh();
                  }}
                  onNodeResizeEnd={(nodeId, size) => {
                    const node = template.nodesById[nodeId];
                    const meta = preview?.elements?.[nodeId];
                    if (!node || node.locked) return;
                    pushTemplate((current) => updateNode(current, nodeId, { layout: applyVisualSizeToLayout(node, meta, size) }));
                    scheduleArtifactRefresh();
                  }}
                  onNodeGroupDragEnd={onNodeGroupDragEndHandler}
                  onNodeClick={selectNode}
                />
                {preview?.image?.base64 && (
                  <details className="mt-3 px-2 pb-2">
                    <summary className="cursor-pointer text-xs font-semibold text-[var(--muted)] hover:text-[var(--fg)]">PNG 截图对照</summary>
                    <img
                      src={`data:${preview.image.mime};base64,${preview.image.base64}`}
                      alt="PNG 截图"
                      className="mt-2 block h-auto max-w-full rounded"
                    />
                  </details>
                )}
              </div>
            ) : preview?.image?.base64 ? (
              <div className="relative max-h-[72vh] max-w-full overflow-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-quiet)]">
                <div className="relative inline-block max-w-full" ref={overlayRef}>
                  <img
                    src={`data:${preview.image.mime};base64,${preview.image.base64}`}
                    alt="预览图"
                    className="block h-auto max-w-full"
                  />
                  <div className="pointer-events-none absolute inset-0">
                    {Object.entries(preview.elements || {}).map(([id, meta]) => {
                      if (!meta?.box || !meta.visible) return null;
                      const active = selectedIds.includes(id);
                      const style = {
                        left: `${(meta.box.x / preview.container.width) * 100}%`,
                        top: `${(meta.box.y / preview.container.height) * 100}%`,
                        width: `${(meta.box.width / preview.container.width) * 100}%`,
                        height: `${(meta.box.height / preview.container.height) * 100}%`
                      };
                      return (
                        <button
                          key={id}
                          type="button"
                          ref={id === selectedId ? setSelectedTargetRef : null}
                          data-node-id={id}
                          onPointerDown={(event) => beginOverlayDrag(event, id)}
                          onPointerMove={updateOverlayDrag}
                          onPointerUp={finishOverlayDrag}
                          onPointerCancel={() => { overlayDragRef.current = null; }}
                          onClick={(event) => {
                            event.stopPropagation();
                            selectNode(id, event.shiftKey);
                          }}
                          className={`pointer-events-auto absolute border transition-colors ${active ? 'border-[var(--accent)] bg-[color-mix(in_oklch,var(--accent)_18%,transparent)]' : 'border-transparent hover:border-[color-mix(in_oklch,var(--accent)_55%,transparent)] hover:bg-[color-mix(in_oklch,var(--accent)_10%,transparent)]'}`}
                          style={style}
                          title={id}
                        />
                      );
                    })}
                  </div>
                  {selectedTarget && (
                    <Moveable
                      target={selectedTarget}
                      dragTarget={selectedTarget}
                      draggable
                      resizable
                      snappable
                      throttleDrag={1}
                      throttleResize={1}
                      keepRatio={selectedNode?.type === 'image'}
                      bounds={{ left: 0, top: 0, right: 0, bottom: 0, position: 'css' }}
                      onDrag={(event) => {
                        lastMoveableDragRef.current = event;
                        event.target.style.transform = event.transform;
                      }}
                      onDragEnd={onMoveableDragEnd}
                      onResize={(event) => {
                        lastMoveableResizeRef.current = event;
                        event.target.style.width = `${event.width}px`;
                        event.target.style.height = `${event.height}px`;
                        event.target.style.transform = event.drag.transform;
                      }}
                      onResizeEnd={onMoveableResizeEnd}
                    />
                  )}
                  {canvasStatus && (
                    <div className="absolute inset-0 grid place-items-center bg-[color-mix(in_oklch,var(--surface)_58%,transparent)]">
                      <span className="rounded-lg border border-[var(--border-muted)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--muted)] shadow-[var(--shadow-soft)]">
                        {canvasStatus}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid gap-3 text-center text-[var(--muted)]">
                <Eye className="mx-auto h-10 w-10 text-[var(--subtle)]" />
                <div className="text-sm">选择结构示例或输入 B 站链接后生成真实预览</div>
              </div>
            )}
          </div>
        </Card>

        <Card as="aside" className="overflow-hidden" padded={false}>
          <PanelHeader title="属性面板" icon={Braces} />
          <div className="max-h-[72vh] overflow-y-auto">
            <PropertyPanel
              node={selectedNode}
              schema={schema}
              liveLayout={liveLayout}
              onChange={(patch) => pushTemplate((current) => updateNode(current, selectedId, patch))}
              onDelete={() => deleteNode(selectedId)}
              onDuplicate={duplicateNode}
            />
            {selectedNode && selectedNode.id !== 'root' && (
              <div className="border-t border-[var(--border-subtle)] p-4">
                <Button icon={RotateCcw} variant="danger" className="w-full" onClick={() => resetSaved(selectedNode.id)}>重置已保存节点</Button>
              </div>
            )}
          </div>
        </Card>
      </section>
    </div>
  );
}
