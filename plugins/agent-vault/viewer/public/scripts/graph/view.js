(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const MAX_WEIGHT = Number.MAX_SAFE_INTEGER;
  const TYPE_ORDER = Object.freeze([
    "project", "task", "decision", "handoff", "journal", "note", "document",
  ]);
  const TYPE_ALIASES = Object.freeze({
    project: "project",
    task: "task",
    decision: "decision",
    adr: "decision",
    handoff: "handoff",
    journal: "journal",
    timeline: "journal",
    note: "note",
    knowledge: "note",
  });

  function svgElement(name, attributes = {}) {
    const element = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) {
      element.setAttribute(key, String(value));
    }
    return element;
  }

  function rounded(value) {
    return Number((Number.isFinite(value) ? value : 0).toFixed(3));
  }

  function conceptType(node) {
    if (node.resource.kind === "task") return "task";
    const path = node.resource.path.toLowerCase();
    if (path === "/readme.md" || path === "/index.md") return "project";
    const metadataType = node.type.trim().toLowerCase();
    if (TYPE_ALIASES[metadataType]) return TYPE_ALIASES[metadataType];
    if (path.startsWith("/tasks/")) return "task";
    if (path.startsWith("/docs/decisions/") || path.startsWith("/decisions/")) return "decision";
    if (path.startsWith("/handoffs/")) return "handoff";
    if (path.startsWith("/journal/")) return "journal";
    if (path.startsWith("/knowledge/")) return "note";
    return "document";
  }

  function weightedDegrees(nodes, edges) {
    const degrees = new Map(nodes.map((node) => [node.id, 0]));
    for (const edge of edges) {
      for (const id of [edge.source, edge.target]) {
        const degree = degrees.get(id);
        degrees.set(id, degree > MAX_WEIGHT - edge.weight ? MAX_WEIGHT : degree + edge.weight);
      }
    }
    return degrees;
  }

  function heatMetrics(degree, maximum) {
    const heat = maximum === 0 ? 0 : Math.sqrt(degree / maximum);
    return Object.freeze({
      heat,
      warmth: heat,
      radius: 12 + heat * 9,
      haloRadius: 18 + heat * 9,
      haloOpacity: 0.04 + heat * 0.14,
    });
  }

  function edgeMetrics(weight) {
    const strength = Math.log1p(Math.min(weight, 8)) / Math.log1p(8);
    return Object.freeze({
      width: 0.8 + strength * 2.2,
      opacity: 0.16 + strength * 0.42,
    });
  }

  function appendGlyph(parent, type) {
    const glyph = svgElement("g", {
      class: `graph-node-glyph graph-glyph-${type}`,
      "aria-hidden": "true",
    });
    if (type === "project") {
      glyph.append(
        svgElement("path", { d: "M-5-4H5M-5 4H5M-5-4V4M5-4V4" }),
        svgElement("circle", { cx: 0, cy: 0, r: 1.5 }),
      );
    } else if (type === "task") {
      glyph.append(svgElement("path", { d: "M-6 0l4 4 8-9" }));
    } else if (type === "decision") {
      glyph.append(svgElement("path", { d: "M-5-6v3a7 7 0 0 0 7 7h4M2 4l-3-3M2 4l-3 3M-5-3h4" }));
    } else if (type === "handoff") {
      glyph.append(svgElement("path", { d: "M-6 0H6M2-4l4 4-4 4" }));
    } else if (type === "journal") {
      glyph.append(
        svgElement("circle", { cx: 0, cy: 0, r: 6 }),
        svgElement("path", { d: "M0-3v4l3 2" }),
      );
    } else if (type === "note") {
      glyph.append(svgElement("path", { d: "M-6-4H6M-6 0H6M-6 4H3" }));
    } else {
      glyph.append(svgElement("path", { d: "M-5-7h7l4 4v10H-5ZM2-7v4h4M-2 1h5M-2 4h5" }));
    }
    parent.append(glyph);
  }

  function appendDefinitions(svg, nodes, visualById) {
    const defs = svgElement("defs");
    const shadow = svgElement("filter", {
      id: "graph-node-shadow",
      x: "-80%",
      y: "-80%",
      width: "260%",
      height: "260%",
      "color-interpolation-filters": "sRGB",
    });
    shadow.append(svgElement("feDropShadow", {
      dx: 1.5, dy: 2.5, stdDeviation: 2.2, "flood-color": "#493719", "flood-opacity": 0.28,
    }));
    defs.append(shadow);
    nodes.forEach((node, ordinal) => {
      const visual = visualById.get(node.id);
      const hue = rounded(50 - visual.warmth * 17);
      const light = rounded(90 - visual.warmth * 24);
      const fill = svgElement("radialGradient", {
        id: `graph-node-fill-${ordinal}`, cx: "34%", cy: "28%", r: "72%",
      });
      fill.append(
        svgElement("stop", { offset: "0%", "stop-color": `hsl(${hue} 100% ${Math.min(96, light + 8)}%)` }),
        svgElement("stop", { offset: "100%", "stop-color": `hsl(${hue} 88% ${light}%)` }),
      );
      const halo = svgElement("radialGradient", { id: `graph-node-halo-${ordinal}` });
      halo.append(
        svgElement("stop", { offset: "0%", "stop-color": `hsl(${hue} 96% 60%)`, "stop-opacity": 0.72 }),
        svgElement("stop", { offset: "100%", "stop-color": `hsl(${hue} 96% 60%)`, "stop-opacity": 0 }),
      );
      defs.append(fill, halo);
    });
    svg.append(defs);
  }

  function appendEdges(svg, edges, positions) {
    const layer = svgElement("g", { class: "graph-edges", "aria-hidden": "true" });
    for (const edge of edges) {
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);
      if (!source || !target) continue;
      const visual = edgeMetrics(edge.weight);
      layer.append(svgElement("line", {
        class: "graph-edge",
        x1: rounded(source.x), y1: rounded(source.y),
        x2: rounded(target.x), y2: rounded(target.y),
        "data-source": edge.source,
        "data-target": edge.target,
        "data-weight": edge.weight,
        "stroke-width": rounded(visual.width),
        opacity: rounded(visual.opacity),
      }));
    }
    svg.append(layer);
  }

  function appendNode(svgLayer, node, ordinal, position, tier, box, degree, visual, type, labels) {
    const resourceLabel = node.resource.kind === "document" ? node.resource.path : `task:${node.resource.id}`;
    const group = svgElement("g", {
      class: "graph-node",
      transform: `translate(${rounded(position.x)} ${rounded(position.y)})`,
      "data-id": node.id,
      "data-type": type,
      "data-degree": degree,
      "data-heat": rounded(visual.heat),
      "data-warmth": rounded(visual.warmth),
      "data-footprint": `${box.left},${box.top},${box.right},${box.bottom}`,
      role: "button",
      tabindex: 0,
      "aria-label": `${node.title}; ${type}; weighted degree ${degree}; ${resourceLabel}`,
    });
    const nodeTitle = svgElement("title");
    nodeTitle.textContent = `${node.title}; ${type}; weighted degree ${degree}`;
    group.append(
      nodeTitle,
      svgElement("rect", {
        class: "graph-node-hit",
        x: -box.left, y: -box.top,
        width: box.left + box.right, height: box.top + box.bottom,
      }),
      svgElement("circle", {
        class: "graph-node-halo", r: rounded(visual.haloRadius),
        opacity: rounded(visual.haloOpacity), fill: `url(#graph-node-halo-${ordinal})`,
        "data-halo-radius": rounded(visual.haloRadius),
        "data-halo-opacity": rounded(visual.haloOpacity),
      }),
      svgElement("circle", {
        class: "graph-node-shadow", r: rounded(visual.radius), filter: "url(#graph-node-shadow)",
      }),
      svgElement("circle", {
        class: "graph-node-mark", r: rounded(visual.radius), fill: `url(#graph-node-fill-${ordinal})`,
        "data-radius": rounded(visual.radius),
      }),
      svgElement("circle", {
        class: "graph-node-outline", r: rounded(visual.radius - 1),
      }),
    );
    appendGlyph(group, type);
    const labelClip = svgElement("svg", {
      class: "graph-node-label-clip",
      x: -tier.width / 2, y: box.labelTop,
      width: tier.width, height: tier.height,
      viewBox: `0 0 ${tier.width} ${tier.height}`,
      "aria-hidden": "true",
    });
    const label = svgElement("text", {
      class: "graph-node-label", x: tier.width / 2, y: tier.font,
      "font-size": tier.font, "text-anchor": "middle",
    });
    labels.lines(node.title).forEach((line, index) => {
      const span = svgElement("tspan", { x: tier.width / 2, y: tier.font + index * tier.line });
      span.textContent = line;
      label.append(span);
    });
    labelClip.append(label);
    group.append(labelClip);
    svgLayer.append(group);
  }

  function legendIcon(type) {
    const icon = svgElement("svg", { class: "graph-legend-icon", viewBox: "-11 -11 22 22", "aria-hidden": "true" });
    icon.append(svgElement("circle", { class: "graph-legend-icon-mark", cx: 0, cy: 0, r: 10 }));
    appendGlyph(icon, type);
    return icon;
  }

  function buildLegend(presentTypes) {
    const legend = document.createElement("aside");
    legend.className = "graph-legend";
    legend.setAttribute("aria-label", "Graph visual legend");
    const heat = document.createElement("p");
    heat.className = "graph-heat-legend";
    heat.textContent = "Connection heat: larger, warmer circles have more weighted connections.";
    legend.append(heat);
    if (presentTypes.length) {
      const list = document.createElement("ul");
      list.className = "graph-type-legend";
      list.setAttribute("aria-label", "Concept types");
      for (const type of presentTypes) {
        const item = document.createElement("li");
        const label = document.createElement("span");
        label.textContent = type.charAt(0).toUpperCase() + type.slice(1);
        item.append(legendIcon(type), label);
        list.append(item);
      }
      legend.append(list);
    }
    return legend;
  }

  function render(container, graph, options) {
    if (typeof options?.onActivate !== "function") {
      throw new TypeError("graphView.render requires options.onActivate to be a function.");
    }
    const onActivate = options.onActivate;
    const compare = window.graphLayout.compareOrdinal;
    const nodes = [...graph.nodes].sort((left, right) => compare(left.id, right.id));
    const edges = [...graph.edges].sort((left, right) => (
      compare(left.source, right.source)
      || compare(left.target, right.target)
      || compare(String(left.weight), String(right.weight))
    ));
    const { positions, tier, box, width, height } = window.graphLayout.settle(nodes, edges);
    let labels;
    try {
      labels = window.graphLabels.create(tier);
      const degrees = weightedDegrees(nodes, edges);
      const maximum = nodes.reduce((value, node) => Math.max(value, degrees.get(node.id)), 0);
      const visualById = new Map(nodes.map((node) => [node.id, heatMetrics(degrees.get(node.id), maximum)]));
      const typeById = new Map(nodes.map((node) => [node.id, conceptType(node)]));
      const titlesById = new Map(nodes.map((node) => [node.id, node.title]));
      const concepts = nodes.length ? nodes.map((node) => (
        `${node.title} (${typeById.get(node.id)}, weighted degree ${degrees.get(node.id)})`
      )).join("; ") : "none";
      const relationships = edges.length ? edges.map((edge) => (
        `${titlesById.get(edge.source)} connected to ${titlesById.get(edge.target)} (weight ${edge.weight})`
      )).join("; ") : "none";
      const svg = svgElement("svg", {
        class: `graph-canvas graph-labels-${tier.name}`,
        viewBox: `0 0 ${width} ${height}`,
        role: "group",
        "aria-labelledby": "graph-canvas-title",
        "aria-describedby": "graph-canvas-description",
      });
      const title = svgElement("title", { id: "graph-canvas-title" });
      title.textContent = "OKF project concept graph";
      const description = svgElement("desc", { id: "graph-canvas-description" });
      description.textContent = `Fixed layout of Markdown and SQLite task concepts and their resolved links. Larger and warmer circles mean more weighted connections. Concepts: ${concepts}. Relationships: ${relationships}.`;
      svg.append(title, description);
      appendDefinitions(svg, nodes, visualById);
      appendEdges(svg, edges, positions);
      const nodeLayer = svgElement("g", { class: "graph-nodes" });
      nodes.forEach((node, ordinal) => appendNode(
        nodeLayer, node, ordinal, positions.get(node.id), tier, box,
        degrees.get(node.id), visualById.get(node.id), typeById.get(node.id), labels,
      ));
      svg.append(nodeLayer);
      svg.__graphNodes = new Map(nodes.map((node) => [node.id, node]));
      window.graphInteraction.attach(svg, onActivate);
      const presentTypes = TYPE_ORDER.filter((type) => [...typeById.values()].includes(type));
      window.graphViewport.mount(container, svg, buildLegend(presentTypes));
    } finally {
      labels?.dispose();
    }
  }

  window.graphView = Object.freeze({ render });
})();
