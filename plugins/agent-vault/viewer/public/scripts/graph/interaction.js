(function () {
  function attach(svg, onActivate) {
    const nodeElements = new Map([...svg.querySelectorAll(".graph-node")]
      .map((node) => [node.dataset.id, node]));
    const edgeElements = [...svg.querySelectorAll(".graph-edge")];
    const adjacency = new Map([...nodeElements.keys()].map((id) => [id, new Set()]));

    edgeElements.forEach((edge) => {
      const source = edge.dataset.source;
      const target = edge.dataset.target;
      if (!adjacency.has(source) || !adjacency.has(target)) return;
      adjacency.get(source).add(target);
      adjacency.get(target).add(source);
    });

    let hoveredId = null;
    let focusedId = null;
    let activeSource = null;

    function activeId() {
      if (activeSource === "hover") return hoveredId;
      if (activeSource === "focus") return focusedId;
      return null;
    }

    function applyNeighborhood() {
      const active = activeId();
      const neighbors = active ? adjacency.get(active) : null;

      nodeElements.forEach((element, id) => {
        element.classList.toggle("is-active", id === active);
        element.classList.toggle("is-neighbor", Boolean(active && neighbors.has(id)));
      });

      edgeElements.forEach((edge) => {
        const connected = Boolean(active
          && (edge.dataset.source === active || edge.dataset.target === active));
        edge.classList.toggle("is-connected", connected);
      });
    }

    function enter(source, id) {
      if (source === "hover") hoveredId = id;
      else focusedId = id;
      activeSource = source;
      applyNeighborhood();
    }

    function leave(source, id) {
      if (source === "hover" && hoveredId === id) hoveredId = null;
      if (source === "focus" && focusedId === id) focusedId = null;
      if (activeSource === source) {
        if (source === "hover" && focusedId) activeSource = "focus";
        else if (source === "focus" && hoveredId) activeSource = "hover";
        else activeSource = null;
      }
      applyNeighborhood();
    }

    function activate(event, node) {
      if (event.type === "keydown") {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        if (event.repeat) return;
      }

      onActivate(node.resource);
    }

    nodeElements.forEach((element, id) => {
      const node = svg.__graphNodes.get(id);
      element.addEventListener("mouseenter", () => enter("hover", id));
      element.addEventListener("mouseleave", () => leave("hover", id));
      element.addEventListener("focus", () => enter("focus", id));
      element.addEventListener("blur", () => leave("focus", id));
      element.addEventListener("click", (event) => activate(event, node));
      element.addEventListener("keydown", (event) => activate(event, node));
    });
  }

  window.graphInteraction = Object.freeze({ attach });
})();
