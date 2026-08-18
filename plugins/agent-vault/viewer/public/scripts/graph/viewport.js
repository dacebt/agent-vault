(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const MIN_ZOOM = 75;
  const RESET_ZOOM = 100;
  const MAX_ZOOM = 300;
  const ZOOM_STEP = 25;

  function isElement(value) {
    return Boolean(value && value.nodeType === 1);
  }

  function validateInputs(container, svg, legend) {
    if (!isElement(container)) {
      throw new TypeError("graphViewport.mount requires an element container.");
    }
    if (!isElement(svg) || svg.namespaceURI !== SVG_NS || svg.localName !== "svg") {
      throw new TypeError("graphViewport.mount requires an SVG element.");
    }
    if (!isElement(legend) || legend === container || legend === svg) {
      throw new TypeError("graphViewport.mount requires a distinct legend element.");
    }
  }

  function clamped(value) {
    return Math.max(0, Math.min(1, value));
  }

  function visibleCenter(stage) {
    const rect = stage.getBoundingClientRect();
    return {
      x: rect.left + stage.clientLeft + stage.clientWidth / 2,
      y: rect.top + stage.clientTop + stage.clientHeight / 2,
    };
  }

  function captureCenter(stage, svg) {
    const center = visibleCenter(stage);
    const rect = svg.getBoundingClientRect();
    return {
      x: rect.width > 0 ? clamped((center.x - rect.left) / rect.width) : 0.5,
      y: rect.height > 0 ? clamped((center.y - rect.top) / rect.height) : 0.5,
    };
  }

  function restoreCenter(stage, svg, center) {
    const visible = visibleCenter(stage);
    const rect = svg.getBoundingClientRect();
    const targetX = rect.left + rect.width * center.x;
    const targetY = rect.top + rect.height * center.y;
    stage.scrollLeft += targetX - visible.x;
    stage.scrollTop += targetY - visible.y;
  }

  function savedState(container) {
    const stage = container.querySelector(".graph-stage");
    const svg = stage?.querySelector(".graph-canvas");
    const zoom = Number(stage?.dataset.zoom);
    if (!stage || !svg || !Number.isInteger(zoom) || zoom < MIN_ZOOM || zoom > MAX_ZOOM
      || (zoom - MIN_ZOOM) % ZOOM_STEP !== 0) {
      return { zoom: RESET_ZOOM, center: { x: 0.5, y: 0.5 } };
    }
    return { zoom, center: captureCenter(stage, svg) };
  }

  function control(label, text) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "graph-zoom-button";
    button.setAttribute("aria-label", label);
    button.textContent = text;
    return button;
  }

  function mount(container, svg, legend) {
    validateInputs(container, svg, legend);
    const state = savedState(container);
    const frame = document.createElement("div");
    frame.className = "graph-frame";
    const stage = document.createElement("section");
    stage.className = "graph-stage";
    stage.tabIndex = 0;
    stage.setAttribute("role", "region");
    stage.setAttribute("aria-label", "Graph viewport");
    stage.setAttribute("aria-describedby", "graph-viewport-instructions");
    const instructions = document.createElement("p");
    instructions.id = "graph-viewport-instructions";
    instructions.className = "graph-viewport-instructions";
    instructions.textContent = "Use the zoom buttons or Command-wheel to change the graph scale. Scroll the viewport to explore the graph.";

    const controls = document.createElement("div");
    controls.className = "graph-zoom-controls";
    controls.setAttribute("role", "group");
    controls.setAttribute("aria-label", "Graph zoom controls");
    const zoomOut = control("Zoom out", "−");
    const reset = control("Reset zoom", `${state.zoom}%`);
    reset.classList.add("graph-zoom-reset");
    const zoomIn = control("Zoom in", "+");
    const status = document.createElement("output");
    status.className = "graph-zoom-status";
    status.setAttribute("aria-live", "polite");
    controls.append(zoomOut, reset, zoomIn, status);
    const presentation = document.createElement("div");
    presentation.className = "graph-presentation";
    presentation.append(svg);

    let zoom = state.zoom;

    function reflectZoom() {
      stage.dataset.zoom = String(zoom);
      stage.style.setProperty("--graph-zoom", String(zoom));
      reset.textContent = `${zoom}%`;
      reset.setAttribute("aria-describedby", "graph-zoom-status");
      status.id = "graph-zoom-status";
      status.textContent = `Current zoom ${zoom}%`;
      zoomOut.disabled = zoom === MIN_ZOOM;
      zoomIn.disabled = zoom === MAX_ZOOM;
      reset.disabled = zoom === RESET_ZOOM;
    }

    function setZoom(nextZoom) {
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
      if (next === zoom) return;
      const center = captureCenter(stage, svg);
      zoom = next;
      reflectZoom();
      restoreCenter(stage, svg, center);
    }

    zoomOut.addEventListener("click", () => setZoom(zoom - ZOOM_STEP));
    reset.addEventListener("click", () => setZoom(RESET_ZOOM));
    zoomIn.addEventListener("click", () => setZoom(zoom + ZOOM_STEP));
    stage.addEventListener("wheel", (event) => {
      if (!event.metaKey || event.deltaY === 0) return;
      event.preventDefault();
      setZoom(zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
    }, { passive: false });

    reflectZoom();
    stage.append(instructions, presentation);
    frame.append(controls, stage);
    container.replaceChildren(frame, legend);
    restoreCenter(stage, svg, state.center);
    return stage;
  }

  window.graphViewport = Object.freeze({ mount });
})();
