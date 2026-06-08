import React, { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import Moveable from 'react-moveable';

function stripCssTagWrappers(css) {
  return (css || '').replace(/<\/?style[^>]*>/g, '');
}

// Scope fullCss (designed for isolated Puppeteer) so it doesn't pollute the dashboard.
// :root { --vars } → .preview-live-dom-sandbox { --vars } (CSS custom props are inherited)
// all other rules  → @scope (.preview-live-dom-sandbox) { ... }
// @scope is supported in Chrome 118+, Safari 17.4+, Firefox 128+ (all 2023-2024 releases).
function buildScopedCss(rawCss) {
  const stripped = stripCssTagWrappers(rawCss);
  const rootVarBlocks = [];
  const withoutRoot = stripped.replace(/:root(\s*\{[^}]*\})/g, (_, block) => {
    rootVarBlocks.push(`.preview-live-dom-sandbox${block}`);
    return '';
  });
  const scoped = `@scope (.preview-live-dom-sandbox) {\n${withoutRoot}\n}`;
  return rootVarBlocks.join('\n') + '\n' + scoped;
}

function elementMapReducer(state, action) {
  if (action.type === 'set') return action.elements;
  if (action.type === 'clear') return {};
  if (import.meta.env.DEV) console.warn('[LivePreviewCanvas] unknown elementMapReducer action:', action.type);
  return state;
}

function applyAxisLock(rawBt, shiftKey) {
  if (!shiftKey) return rawBt;
  return Math.abs(rawBt[0]) >= Math.abs(rawBt[1]) ? [rawBt[0], 0] : [0, rawBt[1]];
}

export default function LivePreviewCanvas({
  htmlArtifact,
  selectedId,
  selectedIds,
  onNodeDragEnd,
  onNodeResizeEnd,
  onNodeGroupDragEnd,
  onNodeClick,
  onInteractionChange,
  canvasStatus,
  keepNodeRatio = false,
  isResizable = true,
  snapEnabled = true,
  snapToGrid = false
}) {
  const outerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [wrapperEl, setWrapperEl] = useState(null);
  const containerRef = useRef(null);
  const styleElRef = useRef(null);
  const [nodeElements, dispatch] = useReducer(elementMapReducer, {});
  const lastDragRef = useRef(null);
  const lastResizeRef = useRef(null);
  const groupDeltaMapRef = useRef(new Map());
  const groupInitMapRef = useRef(new Map());
  const [altKeyPressed, setAltKeyPressed] = useState(false);

  useEffect(() => {
    const onKeyDown = (e) => { if (e.key === 'Alt') setAltKeyPressed(true); };
    const onKeyUp = (e) => { if (e.key === 'Alt') setAltKeyPressed(false); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!htmlArtifact?.bodyHtml) {
      container.innerHTML = '';
      dispatch({ type: 'clear' });
      return;
    }

    if (!styleElRef.current) {
      styleElRef.current = document.createElement('style');
      styleElRef.current.setAttribute('data-live-canvas-css', '');
      container.before(styleElRef.current);
    }
    styleElRef.current.textContent = htmlArtifact.fullCss
      ? buildScopedCss(htmlArtifact.fullCss)
      : stripCssTagWrappers(htmlArtifact.css);

    container.innerHTML = htmlArtifact.bodyHtml;

    const map = {};
    for (const el of container.querySelectorAll('[data-template-node-id]')) {
      map[el.getAttribute('data-template-node-id')] = el;
    }
    dispatch({ type: 'set', elements: map });
  }, [htmlArtifact?.bodyHtml, htmlArtifact?.fullCss, htmlArtifact?.css]);

  useEffect(() => {
    return () => {
      styleElRef.current?.remove();
      styleElRef.current = null;
    };
  }, []);

  const naturalWidth = htmlArtifact?.container?.width || 420;
  const naturalHeight = htmlArtifact?.container?.height || 0;
  const scale = containerWidth > 0 && naturalWidth > 0 ? containerWidth / naturalWidth : 1;

  const activeIds = useMemo(
    () => (selectedIds && selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : []),
    [selectedIds, selectedId]
  );
  const selectedElement = activeIds.length === 1 ? (nodeElements[activeIds[0]] || null) : null;
  const multiSelectedElements = useMemo(() => {
    if (activeIds.length <= 1) return null;
    const els = activeIds.map((id) => nodeElements[id]).filter(Boolean);
    return els.length > 1 ? els : null;
  }, [activeIds, nodeElements]);

  const siblingElements = useMemo(() => {
    if (!selectedId) return [];
    return Object.entries(nodeElements)
      .filter(([id]) => id !== selectedId)
      .map(([, el]) => el);
  }, [nodeElements, selectedId]);

  const verticalGuidelines = useMemo(() => [Math.round(naturalWidth / 2)], [naturalWidth]);
  const horizontalGuidelines = useMemo(
    () => (naturalHeight > 0 ? [Math.round(naturalHeight / 2)] : []),
    [naturalHeight]
  );

  const isSnappable = snapEnabled && !altKeyPressed;
  const snapGridSize = snapToGrid ? 8 : 0;
  const snapProps = {
    snappable: isSnappable,
    snapContainer: wrapperEl,
    snapThreshold: 8,
    snapGridWidth: snapGridSize || undefined,
    snapGridHeight: snapGridSize || undefined,
    snapDirections: { left: true, center: true, right: true, top: true, middle: true, bottom: true },
    elementSnapDirections: { left: true, center: true, right: true, top: true, middle: true, bottom: true },
    isDisplaySnapDigit: false
  };
  // Note: bounds prop intentionally omitted — Moveable miscomputes CSS-position bounds when the
  // parent has transform:scale(), converting them to viewport coords incorrectly (right=0) and
  // applying massive leftward corrections. The template validator already clamps allowed ranges.

  return (
    <div
      ref={outerRef}
      style={{
        width: '100%',
        height: naturalHeight > 0 ? naturalHeight * scale : undefined,
        overflow: 'hidden',
      }}
    >
    <div
      ref={setWrapperEl}
      className="preview-live-dom-sandbox relative"
      style={{
        width: naturalWidth,
        transformOrigin: 'top left',
        transform: scale !== 1 ? `scale(${scale})` : undefined,
      }}
    >
      <div
        ref={containerRef}
        className="preview-live-dom-canvas"
        onClick={onNodeClick ? (e) => {
          let el = e.target;
          while (el && el !== containerRef.current) {
            const nodeId = el.getAttribute?.('data-template-node-id');
            if (nodeId) { onNodeClick(nodeId, e.shiftKey); return; }
            el = el.parentElement;
          }
        } : undefined}
      />

      {/* Single-node selection */}
      {selectedElement && !multiSelectedElements && (
        <Moveable
          target={selectedElement}
          draggable
          resizable={isResizable}
          {...snapProps}
          elementGuidelines={siblingElements}
          verticalGuidelines={verticalGuidelines}
          horizontalGuidelines={horizontalGuidelines}
          throttleDrag={1}
          throttleResize={1}
          keepRatio={keepNodeRatio}
          onDragStart={(event) => {
            // Capture the element's existing CSS translate so onDrag can add the delta on top,
            // preventing a visual jump when the element already has a non-zero template transform.
            const m = (event.target.style.transform || '').match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
            const init = m ? [parseFloat(m[1]), parseFloat(m[2])] : [0, 0];
            lastDragRef.current = { _init: init };
            onInteractionChange?.({ type: 'drag', nodeId: activeIds[0], delta: { x: 0, y: 0 } });
          }}
          onDrag={(event) => {
            const rawBt = event.beforeTranslate || event.translate || [0, 0];
            const lockedBt = applyAxisLock(rawBt, event.inputEvent?.shiftKey);
            const init = lastDragRef.current?._init || [0, 0];
            event.target.style.transform = `translate(${init[0] + lockedBt[0]}px, ${init[1] + lockedBt[1]}px)`;
            lastDragRef.current = { ...lastDragRef.current, _lockedBt: lockedBt };
            onInteractionChange?.({ type: 'drag', nodeId: activeIds[0], delta: { x: lockedBt[0], y: lockedBt[1] } });
          }}
          onDragEnd={(event) => {
            if (!onNodeDragEnd) { onInteractionChange?.(null); return; }
            // Prefer our ref (has _lockedBt from shift-lock) over Moveable's lastEvent (no _lockedBt)
            const last = lastDragRef.current || event.lastEvent || {};
            const beforeTranslate = last._lockedBt || last.beforeTranslate || last.translate || [0, 0];
            lastDragRef.current = null;
            onInteractionChange?.(null);
            onNodeDragEnd(activeIds[0], { x: beforeTranslate[0], y: beforeTranslate[1] });
          }}
          onResizeStart={() => {
            lastResizeRef.current = null;
            onInteractionChange?.({ type: 'resize', nodeId: activeIds[0], width: null, height: null });
          }}
          onResize={(event) => {
            lastResizeRef.current = event;
            event.target.style.width = `${event.width}px`;
            event.target.style.height = `${event.height}px`;
            event.target.style.transform = event.drag.transform;
            onInteractionChange?.({ type: 'resize', nodeId: activeIds[0], width: event.width, height: event.height });
          }}
          onResizeEnd={(event) => {
            if (!onNodeResizeEnd) { onInteractionChange?.(null); return; }
            const last = event.lastEvent || lastResizeRef.current || {};
            lastResizeRef.current = null;
            onInteractionChange?.(null);
            onNodeResizeEnd(activeIds[0], { width: last.width, height: last.height });
          }}
        />
      )}

      {/* Multi-node selection — drag only, no resize */}
      {multiSelectedElements && (
        <Moveable
          targets={multiSelectedElements}
          draggable
          resizable={false}
          {...snapProps}
          verticalGuidelines={verticalGuidelines}
          horizontalGuidelines={horizontalGuidelines}
          throttleDrag={1}
          onDragGroupStart={(e) => {
            groupDeltaMapRef.current.clear();
            groupInitMapRef.current.clear();
            // Capture initial translates for each target to avoid visual jump (same as single-drag fix).
            for (const ev of (e.events || [])) {
              const m = (ev.target.style.transform || '').match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
              groupInitMapRef.current.set(ev.target, m ? [parseFloat(m[1]), parseFloat(m[2])] : [0, 0]);
            }
          }}
          onDragGroup={(e) => {
            for (const ev of (e.events || [])) {
              const rawBt = ev.beforeTranslate || ev.translate || [0, 0];
              const lockedBt = applyAxisLock(rawBt, ev.inputEvent?.shiftKey);
              const init = groupInitMapRef.current.get(ev.target) || [0, 0];
              ev.target.style.transform = `translate(${init[0] + lockedBt[0]}px, ${init[1] + lockedBt[1]}px)`;
              groupDeltaMapRef.current.set(ev.target, lockedBt);
            }
          }}
          onDragGroupEnd={(e) => {
            if (!onNodeGroupDragEnd) return;
            const results = (e.events || []).map((ev) => {
              const lockedBt = groupDeltaMapRef.current.get(ev.target);
              const fallback = (ev.lastEvent || ev);
              const bt = lockedBt || fallback.beforeTranslate || fallback.translate || [0, 0];
              const nodeId = ev.target?.getAttribute('data-template-node-id');
              return nodeId ? { nodeId, delta: { x: bt[0], y: bt[1] } } : null;
            }).filter(Boolean);
            groupDeltaMapRef.current.clear();
            groupInitMapRef.current.clear();
            if (results.length > 0) onNodeGroupDragEnd(results);
          }}
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
  );
}
