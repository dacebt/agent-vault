(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const ELLIPSIS = "…";
  const TIERS = new Set(["spacious", "dense", "compact"]);

  function validateTier(tier) {
    if (!tier || typeof tier !== "object") {
      throw new TypeError("graphLabels.create requires a label tier object.");
    }
    if (!TIERS.has(tier.name)) {
      throw new RangeError("graphLabels.create received an unknown label tier.");
    }
    for (const boundary of ["width", "font"]) {
      if (!Number.isFinite(tier[boundary]) || tier[boundary] <= 0) {
        throw new RangeError(`graphLabels.create requires a positive finite tier.${boundary}.`);
      }
    }
    return Object.freeze({ name: tier.name, width: tier.width, font: tier.font });
  }

  function createElement(name, attributes = {}) {
    const element = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) {
      element.setAttribute(key, String(value));
    }
    return element;
  }

  function create(tier) {
    const boundary = validateTier(tier);
    if (!document.body) {
      throw new Error("graphLabels.create requires an attached document body.");
    }
    if (typeof Intl?.Segmenter !== "function") {
      throw new Error("graphLabels.create requires Intl.Segmenter grapheme support.");
    }

    const surface = createElement("svg", {
      class: `graph-label-measure graph-labels-${boundary.name}`,
      "aria-hidden": "true",
      focusable: "false",
    });
    const text = createElement("text", {
      class: "graph-node-label",
      "font-size": boundary.font,
    });
    surface.append(text);
    document.body.append(surface);

    let disposed = false;
    function dispose() {
      if (disposed) return;
      disposed = true;
      surface.remove();
    }

    try {
      const strokeWidth = Number.parseFloat(getComputedStyle(text).strokeWidth);
      if (!Number.isFinite(strokeWidth) || strokeWidth < 0) {
        throw new Error("graphLabels.create could not resolve the painted label stroke width.");
      }
      const budget = boundary.width - (strokeWidth + 1) * 2;
      if (!Number.isFinite(budget) || budget <= 0) {
        throw new RangeError("graphLabels.create resolved a non-positive label line budget.");
      }
      const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

      function measure(value) {
        if (disposed) throw new Error("graphLabels measurer has been disposed.");
        text.textContent = value;
        const width = text.getComputedTextLength();
        if (!Number.isFinite(width) || width < 0) {
          throw new Error("graphLabels could not measure an SVG label.");
        }
        return width;
      }

      const ellipsisWidth = measure(ELLIPSIS);
      if (ellipsisWidth > budget) {
        throw new RangeError("graphLabels label budget cannot contain its ellipsis.");
      }
      const fits = (value) => measure(value) <= budget;

      function truncateToken(token) {
        let visible = "";
        for (const { segment } of segmenter.segment(token)) {
          if (!fits(`${visible}${segment}${ELLIPSIS}`)) break;
          visible += segment;
        }
        return `${visible}${ELLIPSIS}`;
      }

      function appendEllipsis(line) {
        const lineWords = line.split(" ");
        const words = [...lineWords];
        while (words.length && !fits(`${words.join(" ")}${ELLIPSIS}`)) words.pop();
        return words.length ? `${words.join(" ")}${ELLIPSIS}` : truncateToken(lineWords[0]);
      }

      function lines(title) {
        if (typeof title !== "string") {
          throw new TypeError("graphLabels.lines requires a string title.");
        }
        if (disposed) throw new Error("graphLabels measurer has been disposed.");
        const normalized = title.replace(/\s+/gu, " ").trim();
        if (!normalized) return Object.freeze([""]);

        const words = normalized.split(" ");
        const visible = [];
        let cursor = 0;
        while (visible.length < 2 && cursor < words.length) {
          if (!fits(words[cursor])) {
            visible.push(truncateToken(words[cursor]));
            cursor += 1;
            continue;
          }
          const lineWords = [words[cursor++]];
          while (cursor < words.length && fits(`${lineWords.join(" ")} ${words[cursor]}`)) {
            lineWords.push(words[cursor++]);
          }
          visible.push(lineWords.join(" "));
        }
        if (cursor < words.length && !visible[1].endsWith(ELLIPSIS)) {
          visible[1] = appendEllipsis(visible[1]);
        }
        return Object.freeze(visible);
      }

      return Object.freeze({ lines, dispose });
    } catch (error) {
      dispose();
      throw error;
    }
  }

  window.graphLabels = Object.freeze({ create });
})();
